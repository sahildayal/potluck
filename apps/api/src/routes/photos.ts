import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { asUser } from '../db/client.js';
import { attempts, recipePhotos } from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';

/**
 * Photo bytes live in Postgres, so these routes stream them back out.
 *
 * The important property is that access is decided by the same RLS policies as
 * everything else: the SELECT simply returns no row for a photo attached to a
 * recipe you cannot see, and the handler turns that into a 404 without needing
 * its own permission logic.
 */

/** Client uploads are already downscaled; this is a backstop, not the policy. */
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED = new Set(['image/webp', 'image/jpeg', 'image/png']);

export function photoRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser);

  app.get('/:id', async (c) => {
    const row = await asUser(currentUserId(c), async (tx) => {
      const [photo] = await tx
        .select({
          bytes: recipePhotos.bytes,
          contentType: recipePhotos.contentType,
        })
        .from(recipePhotos)
        .where(eq(recipePhotos.id, c.req.param('id')))
        .limit(1);
      return photo;
    });

    if (row === undefined) return c.json({ error: 'Not found' }, 404);

    return new Response(new Uint8Array(row.bytes), {
      headers: {
        'Content-Type': row.contentType,
        // Photo bytes never change for a given id, so this can be cached hard.
        // Private, because the URL is only meaningful to someone authorised.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });

  app.get('/attempts/:id', async (c) => {
    const row = await asUser(currentUserId(c), async (tx) => {
      const [photo] = await tx
        .select({ bytes: attempts.bytes, contentType: attempts.contentType })
        .from(attempts)
        .where(eq(attempts.id, c.req.param('id')))
        .limit(1);
      return photo;
    });

    if (row === undefined) return c.json({ error: 'Not found' }, 404);

    return new Response(new Uint8Array(row.bytes), {
      headers: {
        'Content-Type': row.contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });

  app.post('/recipes/:recipeId', async (c) => {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!ALLOWED.has(contentType)) {
      return c.json({ error: 'Photo must be WebP, JPEG or PNG' }, 415);
    }

    const buffer = Buffer.from(await c.req.arrayBuffer());
    if (buffer.byteLength === 0) return c.json({ error: 'Empty upload' }, 400);
    if (buffer.byteLength > MAX_BYTES) {
      return c.json(
        { error: 'Photo too large. Resize below 2 MB before uploading.' },
        413,
      );
    }

    // Query params rather than a JSON body, because the body is already spoken
    // for by the raw bytes. Absent or nonsense values are stored as null rather
    // than rejected — the client always sends them, but a photo missing its
    // dimensions is still a perfectly good photo.
    const width = positiveInt(c.req.query('width'));
    const height = positiveInt(c.req.query('height'));

    const userId = currentUserId(c);
    const recipeId = c.req.param('recipeId');

    const created = await asUser(userId, async (tx) => {
      // The insert is blocked by RLS if the recipe is not theirs, so there is no
      // separate ownership check to forget here.
      //
      // Whichever photo lands first becomes the hero automatically, so a recipe
      // never sits with a picture attached and the doodle still showing.
      const existing = await tx
        .select({ id: recipePhotos.id })
        .from(recipePhotos)
        .where(eq(recipePhotos.recipeId, recipeId))
        .limit(1);

      const rows = await tx
        .insert(recipePhotos)
        .values({
          recipeId,
          ownerId: userId,
          bytes: buffer,
          contentType,
          byteSize: buffer.byteLength,
          width,
          height,
          isHero: existing.length === 0,
        })
        .returning({ id: recipePhotos.id, isHero: recipePhotos.isHero });
      return rows[0];
    }).catch(() => undefined);

    if (created === undefined) return c.json({ error: 'Not found' }, 404);
    return c.json(
      { id: created.id, url: `/api/photos/${created.id}`, isHero: created.isHero },
      201,
    );
  });

  /**
   * Hero selection is exclusive: a recipe has at most one. Both writes happen
   * inside the one asUser transaction so a reader never observes a moment with
   * zero heroes or two.
   */
  app.post('/:id/hero', async (c) => {
    const id = c.req.param('id');

    const result = await asUser(currentUserId(c), async (tx) => {
      const [photo] = await tx
        .select({ recipeId: recipePhotos.recipeId })
        .from(recipePhotos)
        .where(eq(recipePhotos.id, id))
        .limit(1);
      if (photo === undefined) return null;

      await tx
        .update(recipePhotos)
        .set({ isHero: false })
        .where(eq(recipePhotos.recipeId, photo.recipeId));

      const rows = await tx
        .update(recipePhotos)
        .set({ isHero: true })
        .where(eq(recipePhotos.id, id))
        .returning({ id: recipePhotos.id, isHero: recipePhotos.isHero });
      return rows[0] ?? null;
    });

    if (result === null || result === undefined) return c.json({ error: 'Not found' }, 404);
    return c.json(result);
  });

  app.delete('/:id', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .delete(recipePhotos)
        .where(eq(recipePhotos.id, c.req.param('id')))
        .returning({ id: recipePhotos.id }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ deleted: true });
  });

  return app;
}

/** A dimension query param that is missing or garbage becomes null, not 400. */
function positiveInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
