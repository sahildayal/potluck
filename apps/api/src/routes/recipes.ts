import { desc, eq, sql as sqlRaw } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  createRecipeSchema,
  parseIngredient,
  primaryDuration,
  updateRecipeSchema,
} from '@potluck/core';
import { asUser, type ScopedDatabase } from '../db/client.js';
import {
  ingredients,
  recipeCategories,
  recipePhotos,
  recipes,
  steps,
} from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';

/**
 * Recipe routes.
 *
 * Note what is absent: an `owner_id = $me` clause on the read queries. That is
 * deliberate. Row-level security applies it inside Postgres, and leaving it out
 * of the handlers keeps the sharing rules in exactly one place instead of two
 * that can drift. The RLS integration tests exist to keep that honest.
 */

/** Shapes a recipe row plus children into the API response. */
async function loadRecipe(tx: ScopedDatabase, id: string) {
  const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, id)).limit(1);
  if (recipe === undefined) return null;

  const [ings, stps, photos, cats] = await Promise.all([
    tx.select().from(ingredients).where(eq(ingredients.recipeId, id)).orderBy(ingredients.position),
    tx.select().from(steps).where(eq(steps.recipeId, id)).orderBy(steps.position),
    tx
      .select({
        id: recipePhotos.id,
        isHero: recipePhotos.isHero,
        width: recipePhotos.width,
        height: recipePhotos.height,
        byteSize: recipePhotos.byteSize,
      })
      .from(recipePhotos)
      .where(eq(recipePhotos.recipeId, id)),
    tx
      .select({ categoryId: recipeCategories.categoryId })
      .from(recipeCategories)
      .where(eq(recipeCategories.recipeId, id)),
  ]);

  return {
    ...recipe,
    ingredients: ings,
    steps: stps,
    // Photo bytes are never inlined into JSON — they are fetched per-photo so a
    // recipe list does not drag megabytes of base64 through the response.
    photos: photos.map((p) => ({ ...p, url: `/api/photos/${p.id}` })),
    categoryIds: cats.map((c) => c.categoryId),
  };
}

export function recipeRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', requireUser);

  /** Everything visible to the caller: their own, plus anything shared. */
  app.get('/', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .select({
          // Aggregated rather than joined: a join would multiply a recipe by its
          // categories and the list would show duplicates.
          categoryIds: sqlRaw<string[]>`coalesce(array(
            SELECT rc.category_id::text FROM recipe_categories rc
             WHERE rc.recipe_id = ${recipes.id}
          ), '{}')`,
          // A scalar subquery rather than a join, for the same reason as
          // categoryIds above: a card only ever needs one photo id, and a join
          // would multiply the recipe row by however many photos it has.
          heroPhotoId: sqlRaw<string | null>`(
            SELECT rp.id FROM recipe_photos rp
             WHERE rp.recipe_id = ${recipes.id} AND rp.is_hero
             LIMIT 1
          )`,
          id: recipes.id,
          ownerId: recipes.ownerId,
          title: recipes.title,
          servings: recipes.servings,
          rating: recipes.rating,
          isFavorite: recipes.isFavorite,
          sourceType: recipes.sourceType,
          attributedTo: recipes.attributedTo,
          updatedAt: recipes.updatedAt,
        })
        .from(recipes)
        .orderBy(desc(recipes.updatedAt))
        .limit(1000),
    );
    return c.json({ recipes: rows });
  });

  app.get('/:id', async (c) => {
    const recipe = await asUser(currentUserId(c), (tx) => loadRecipe(tx, c.req.param('id')));
    // RLS returning nothing and the row not existing are indistinguishable from
    // outside, which is the correct answer to both.
    if (recipe === null) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe });
  });

  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createRecipeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid recipe', issues: parsed.error.issues }, 400);
    }

    const userId = currentUserId(c);
    const input = parsed.data;

    const created = await asUser(userId, async (tx) => {
      const [recipe] = await tx
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
          yearLearned: input.yearLearned,
          rating: input.rating,
          isFavorite: input.isFavorite,
          forkedFromId: input.forkedFromId,
        })
        .returning();

      if (recipe === undefined) throw new Error('Insert returned no row');
      await writeChildren(tx, recipe.id, userId, input);
      return loadRecipe(tx, recipe.id);
    });

    return c.json({ recipe: created }, 201);
  });

  app.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateRecipeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid recipe', issues: parsed.error.issues }, 400);
    }

    const id = c.req.param('id');
    const userId = currentUserId(c);
    const input = parsed.data;

    const updated = await asUser(userId, async (tx) => {
      const fields = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.servings !== undefined && { servings: input.servings }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.attributedTo !== undefined && { attributedTo: input.attributedTo }),
        ...(input.story !== undefined && { story: input.story }),
        ...(input.yearLearned !== undefined && { yearLearned: input.yearLearned }),
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
        updatedAt: new Date(),
      };

      const rows = await tx.update(recipes).set(fields).where(eq(recipes.id, id)).returning();
      // Zero rows means RLS blocked it — either it does not exist or it is not
      // ours. Both are a 404 from the caller's point of view.
      if (rows.length === 0) return null;

      // Children are replaced wholesale when supplied; partial merges of an
      // ordered list are a reliable source of duplicated and orphaned rows.
      if (input.ingredients !== undefined || input.steps !== undefined) {
        await writeChildren(tx, id, userId, input, { replace: true });
      }
      if (input.categoryIds !== undefined) {
        await tx.delete(recipeCategories).where(eq(recipeCategories.recipeId, id));
        if (input.categoryIds.length > 0) {
          await tx.insert(recipeCategories).values(
            input.categoryIds.map((categoryId) => ({ recipeId: id, categoryId, ownerId: userId })),
          );
        }
      }

      return loadRecipe(tx, id);
    });

    if (updated === null) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe: updated });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.delete(recipes).where(eq(recipes.id, id)).returning({ id: recipes.id }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ deleted: true });
  });

  /** Favourite toggling is its own route so the star does not send the whole
   *  recipe back over a phone connection. */
  app.post('/:id/favorite', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { isFavorite?: unknown };
    const next = body.isFavorite === true;

    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .update(recipes)
        .set({ isFavorite: next, updatedAt: new Date() })
        .where(eq(recipes.id, id))
        .returning({ id: recipes.id, isFavorite: recipes.isFavorite }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json(rows[0]);
  });

  app.post('/:id/rating', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { rating?: unknown };
    const raw = body.rating;

    // Rating is optional by requirement, so null is a legitimate value meaning
    // "un-rate this", not a validation failure.
    const rating =
      raw === null ? null : typeof raw === 'number' && raw >= 1 && raw <= 5 ? Math.round(raw) : undefined;
    if (rating === undefined) return c.json({ error: 'Rating must be 1-5 or null' }, 400);

    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .update(recipes)
        .set({ rating, updatedAt: new Date() })
        .where(eq(recipes.id, id))
        .returning({ id: recipes.id, rating: recipes.rating }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json(rows[0]);
  });

  /**
   * Forking copies the recipe rather than pointing at it, so the original owner
   * deleting theirs never removes yours. forked_from_id records lineage only.
   */
  app.post('/:id/fork', async (c) => {
    const sourceId = c.req.param('id');
    const userId = currentUserId(c);

    const forked = await asUser(userId, async (tx) => {
      const source = await loadRecipe(tx, sourceId);
      if (source === null) return null;

      const [copy] = await tx
        .insert(recipes)
        .values({
          ownerId: userId,
          title: source.title,
          servings: source.servings,
          notes: source.notes,
          sourceUrl: source.sourceUrl,
          sourceType: 'fork',
          attributedTo: source.attributedTo,
          story: source.story,
          yearLearned: source.yearLearned,
          forkedFromId: sourceId,
        })
        .returning();
      if (copy === undefined) return null;

      if (source.ingredients.length > 0) {
        await tx.insert(ingredients).values(
          source.ingredients.map((i, index) => ({
            recipeId: copy.id,
            ownerId: userId,
            position: index,
            rawText: i.rawText,
            item: i.item,
            note: i.note,
            qtyCanonical: i.qtyCanonical,
            unitCanonical: i.unitCanonical,
            dimension: i.dimension,
          })),
        );
      }
      if (source.steps.length > 0) {
        await tx.insert(steps).values(
          source.steps.map((s, index) => ({
            recipeId: copy.id,
            ownerId: userId,
            position: index,
            body: s.body,
            durationSeconds: s.durationSeconds,
          })),
        );
      }

      return loadRecipe(tx, copy.id);
    });

    if (forked === null) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe: forked }, 201);
  });

  return app;
}

/**
 * Accepts both the fully-parsed create payload and the partial update one.
 * The explicit `| undefined` is required by exactOptionalPropertyTypes, which
 * distinguishes "absent" from "present and undefined".
 */
interface ChildInput {
  ingredients?: { rawText: string; item?: string | undefined; note?: string | undefined }[] | undefined;
  steps?: { body: string; durationSeconds?: number | null | undefined }[] | undefined;
  categoryIds?: string[] | undefined;
}

/**
 * Writes ingredients and steps, deriving the canonical quantity and the step
 * duration on the way in.
 *
 * Doing it here rather than in the client means every entry point — manual,
 * website import, photo import, fork — gets the same treatment, and a client
 * cannot submit a canonical quantity that disagrees with its own raw text.
 */
async function writeChildren(
  tx: ScopedDatabase,
  recipeId: string,
  ownerId: string,
  input: ChildInput,
  options: { replace?: boolean } = {},
): Promise<void> {
  if (options.replace === true) {
    await tx.delete(ingredients).where(eq(ingredients.recipeId, recipeId));
    await tx.delete(steps).where(eq(steps.recipeId, recipeId));
  }

  if (input.ingredients !== undefined && input.ingredients.length > 0) {
    await tx.insert(ingredients).values(
      input.ingredients.map((raw, index) => {
        const parsed = parseIngredient(raw.rawText);
        return {
          recipeId,
          ownerId,
          position: index,
          rawText: raw.rawText,
          // Prefer an explicitly supplied item, else the name left over once the
          // quantity and unit were consumed.
          item: raw.item !== undefined && raw.item.length > 0 ? raw.item : parsed.item,
          note: raw.note ?? '',
          qtyCanonical: parsed.qty,
          unitCanonical: parsed.unit,
          dimension: parsed.dimension,
        };
      }),
    );
  }

  if (input.steps !== undefined && input.steps.length > 0) {
    await tx.insert(steps).values(
      input.steps.map((step, index) => ({
        recipeId,
        ownerId,
        position: index,
        body: step.body,
        // Detected here so Cooking Mode timers work on every recipe regardless
        // of how it got into the app.
        durationSeconds: step.durationSeconds ?? primaryDuration(step.body),
      })),
    );
  }

  if (input.categoryIds !== undefined && input.categoryIds.length > 0) {
    await tx
      .insert(recipeCategories)
      .values(input.categoryIds.map((categoryId) => ({ recipeId, categoryId, ownerId })))
      .onConflictDoNothing();
  }
}

export { loadRecipe, writeChildren };
