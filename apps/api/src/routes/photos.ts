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

    const userId = currentUserId(c);
    const recipeId = c.req.param('recipeId');

    const created = await asUser(userId, async (tx) => {
      // The insert is blocked by RLS if the recipe is not theirs, so there is no
      // separate ownership check to forget here.
      const rows = await tx
        .insert(recipePhotos)
        .values({
          recipeId,
          ownerId: userId,
          bytes: buffer,
          contentType,
          byteSize: buffer.byteLength,
        })
        .returning({ id: recipePhotos.id });
      return rows[0];
    }).catch(() => undefined);

    if (created === undefined) return c.json({ error: 'Not found' }, 404);
    return c.json({ id: created.id, url: `/api/photos/${created.id}` }, 201);
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
