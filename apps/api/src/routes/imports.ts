import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createImportSchema, createRecipeSchema, parseIngredient, primaryDuration } from '@potluck/core';
import { asUser } from '../db/client.js';
import { importJobs, ingredients, recipes, steps } from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';
import { loadEnv } from '../env.js';
import { processJob, UnprocessableImport, type JobKind } from '../import/process.js';

const env = loadEnv();

/**
 * Imports.
 *
 * A job is queued and a worker picks it up, rather than the request doing the
 * work. Reading a photo means waiting on a vision model, which takes long
 * enough that a synchronous request would either time out or hold a connection
 * open for no reason — and the free tier's token budget means the queue may
 * legitimately need to wait a minute before starting.
 *
 * Nothing here writes a recipe. A finished job holds a DRAFT that the user
 * confirms on the review screen. That single rule is what makes an unreliable
 * extractor acceptable: a bad parse becomes an edit, not a corrupted recipe.
 */
export function importRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser);

  app.get('/', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .select({
          id: importJobs.id,
          kind: importJobs.kind,
          payload: importJobs.payload,
          status: importJobs.status,
          error: importJobs.error,
          draft: importJobs.draft,
          createdAt: importJobs.createdAt,
        })
        .from(importJobs)
        .orderBy(desc(importJobs.createdAt))
        .limit(50),
    );

    return c.json({
      jobs: rows.map((row) => ({
        ...row,
        // The payload for a photo is a base64 data URL — megabytes of it. The
        // list only needs to know what kind of thing it was.
        payload: row.kind === 'image' ? '' : row.payload.slice(0, 300),
        draft: row.draft === null ? null : (JSON.parse(row.draft) as unknown),
      })),
    });
  });

  app.post('/', async (c) => {
    const parsed = createImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid import' }, 400);

    const userId = currentUserId(c);
    const created = await asUser(userId, async (tx) => {
      const rows = await tx
        .insert(importJobs)
        .values({ ownerId: userId, kind: parsed.data.kind, payload: parsed.data.payload })
        .returning({ id: importJobs.id, status: importJobs.status });
      return rows[0];
    });

    // When the worker runs in-process — Render, where 750 free instance-hours
    // buys exactly one always-on service — nothing else is polling the queue,
    // so the job is handled here. Deliberately not awaited: the caller gets its
    // job id immediately and polls, exactly as it would with a separate worker.
    if (env.WORKER_INLINE && created !== undefined) {
      void runInline(created.id, userId, parsed.data.kind as JobKind, parsed.data.payload);
    }

    return c.json({ job: created }, 202);
  });

  app.get('/:id', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.select().from(importJobs).where(eq(importJobs.id, c.req.param('id'))).limit(1),
    );
    const job = rows[0];
    if (job === undefined) return c.json({ error: 'Not found' }, 404);

    return c.json({
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        error: job.error,
        draft: job.draft === null ? null : (JSON.parse(job.draft) as unknown),
      },
    });
  });

  /**
   * Confirms a draft, creating the real recipe.
   *
   * The client sends the edited recipe rather than a "yes please" — whatever the
   * user corrected on the review screen is what gets saved, and quantities are
   * re-derived here so a hand-edited line is parsed identically to an imported
   * one.
   */
  app.post('/:id/confirm', async (c) => {
    const parsed = createRecipeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid recipe', issues: parsed.error.issues }, 400);
    }

    const id = c.req.param('id');
    const userId = currentUserId(c);
    const input = parsed.data;

    const saved = await asUser(userId, async (tx) => {
      const found = await tx
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(eq(importJobs.id, id))
        .limit(1);
      if (found.length === 0) return null;

      const created = await tx
        .insert(recipes)
        .values({
          ownerId: userId,
          title: input.title,
          servings: input.servings,
          notes: input.notes,
          sourceUrl: input.sourceUrl,
          sourceType: input.sourceType,
          attributedTo: input.attributedTo,
          story: input.story,
        })
        .returning();

      const recipe = created[0];
      if (recipe === undefined) return null;

      if (input.ingredients.length > 0) {
        await tx.insert(ingredients).values(
          input.ingredients.map((line, index) => {
            const detail = parseIngredient(line.rawText);
            return {
              recipeId: recipe.id,
              ownerId: userId,
              position: index,
              rawText: line.rawText,
              item: detail.item,
              qtyCanonical: detail.qty,
              unitCanonical: detail.unit,
              dimension: detail.dimension,
            };
          }),
        );
      }

      if (input.steps.length > 0) {
        await tx.insert(steps).values(
          input.steps.map((step, index) => ({
            recipeId: recipe.id,
            ownerId: userId,
            position: index,
            body: step.body,
            durationSeconds: step.durationSeconds ?? primaryDuration(step.body),
          })),
        );
      }

      // The job has done its job. Keeping it would leave a photo's base64 in the
      // database forever, which the 512 MB budget cannot spare.
      await tx.delete(importJobs).where(eq(importJobs.id, id));

      return recipe;
    });

    if (saved === null) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe: { id: saved.id, title: saved.title } }, 201);
  });

  app.delete('/:id', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.delete(importJobs).where(eq(importJobs.id, c.req.param('id'))).returning({ id: importJobs.id }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ deleted: true });
  });

  return app;
}

/**
 * Processes a job in the API process. Mirrors what worker.ts does, minus the
 * SKIP LOCKED claim — with one process there is nothing to race against.
 */
async function runInline(
  jobId: string,
  userId: string,
  kind: JobKind,
  payload: string,
): Promise<void> {
  try {
    await asUser(userId, (tx) =>
      tx.update(importJobs).set({ status: 'reading', updatedAt: new Date() }).where(eq(importJobs.id, jobId)),
    );

    const result = await processJob(kind, payload, { groqApiKey: env.GROQ_API_KEY });

    await asUser(userId, (tx) =>
      tx
        .update(importJobs)
        .set({
          status: 'ready',
          draft: JSON.stringify({ ...result.draft, via: result.via }),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof UnprocessableImport ? error.retryable : false;
    await asUser(userId, (tx) =>
      tx
        .update(importJobs)
        .set({
          status: retryable ? 'queued' : 'failed',
          error: message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId)),
    ).catch(() => {
      // The job row may be gone if the user discarded it mid-flight; that is
      // not an error worth surfacing.
    });
  }
}
