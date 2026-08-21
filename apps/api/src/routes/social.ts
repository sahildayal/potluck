import { and, desc, eq, ne, or, sql as raw } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { asUser } from '../db/client.js';
import { attemptHides, attempts, friendships, recipeShares, recipes, users } from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';

/**
 * Friends, sharing and "I made this".
 *
 * Almost none of the authorisation lives here. Row-level security already
 * enforces that sharing grants reading and never writing, that only the
 * addressee can accept a friend request, that a cook owns their own attempt
 * photo, and that a recipe owner can hide an attempt without being able to
 * rewrite its caption. These handlers are the shape of the API over those
 * rules, not a second implementation of them.
 */

const handleSchema = z.object({ handle: z.string().min(1).max(60) });
const shareSchema = z.object({ recipeId: z.string().uuid(), handle: z.string().min(1).max(60) });
const attemptSchema = z.object({
  caption: z.string().max(500).default(''),
  wentWell: z.boolean().nullable().default(null),
});

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

export function socialRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser);

  // ---------------------------------------------------------------- friends
  /**
   * Finding someone by handle.
   *
   * Deliberately an exact match, not a prefix search. A "who is on here?"
   * browse would let anyone enumerate the whole user table; requiring the exact
   * handle means you can only find someone you already know how to name.
   */
  app.get('/users/:handle', async (c) => {
    const handle = c.req.param('handle').toLowerCase();
    const userId = currentUserId(c);

    const rows = await asUser(userId, (tx) =>
      tx
        .select({ id: users.id, handle: users.handle, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.handle, handle), ne(users.id, userId)))
        .limit(1),
    );

    // RLS hides users you have no relationship with, so a plain query returns
    // nothing for a stranger. The lookup runs unscoped by handle on purpose —
    // this is the one place you are allowed to learn someone exists.
    const found = rows[0];
    if (found !== undefined) return c.json({ user: found, known: true });

    const unscoped = await asUser(userId, (tx) =>
      tx.execute<{ id: string; handle: string; display_name: string }>(raw`
        SELECT id, handle, display_name FROM find_user_by_handle(${handle})`),
    );
    const list = unscoped as unknown as { id: string; handle: string; display_name: string }[];
    const stranger = list[0];
    if (stranger === undefined) return c.json({ error: 'No one with that handle' }, 404);

    return c.json({
      user: { id: stranger.id, handle: stranger.handle, displayName: stranger.display_name },
      known: false,
    });
  });

  app.get('/friends', async (c) => {
    const userId = currentUserId(c);
    const rows = await asUser(userId, (tx) =>
      tx.execute<{
        id: string;
        handle: string;
        display_name: string;
        status: string;
        direction: string;
      }>(raw`
        SELECT u.id, u.handle, u.display_name, f.status,
               CASE WHEN f.requester_id = ${userId} THEN 'outgoing' ELSE 'incoming' END AS direction
          FROM friendships f
          JOIN users u ON u.id = CASE WHEN f.requester_id = ${userId}
                                      THEN f.addressee_id ELSE f.requester_id END
         ORDER BY f.created_at DESC`),
    );

    const list = rows as unknown as {
      id: string;
      handle: string;
      display_name: string;
      status: string;
      direction: string;
    }[];

    return c.json({
      friends: list.map((r) => ({
        id: r.id,
        handle: r.handle,
        displayName: r.display_name,
        status: r.status,
        direction: r.direction,
      })),
    });
  });

  app.post('/friends', async (c) => {
    const parsed = handleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid handle' }, 400);

    const userId = currentUserId(c);
    const handle = parsed.data.handle.toLowerCase();

    const result = await asUser(userId, async (tx) => {
      const found = await tx.execute<{ id: string }>(raw`
        SELECT id FROM find_user_by_handle(${handle})`);
      const target = (found as unknown as { id: string }[])[0];
      if (target === undefined) return null;

      // If they already asked you, accepting is the obvious intent — sending a
      // mirror-image request instead would leave two rows and no friendship.
      const existing = await tx
        .select()
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, target.id)),
            and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, userId)),
          ),
        )
        .limit(1);

      const already = existing[0];
      if (already !== undefined) {
        if (already.addresseeId === userId && already.status === 'pending') {
          await tx
            .update(friendships)
            .set({ status: 'accepted' })
            .where(
              and(
                eq(friendships.requesterId, already.requesterId),
                eq(friendships.addresseeId, already.addresseeId),
              ),
            );
          return { status: 'accepted' };
        }
        return { status: already.status };
      }

      await tx.insert(friendships).values({ requesterId: userId, addresseeId: target.id });
      return { status: 'pending' };
    });

    if (result === null) return c.json({ error: 'No one with that handle' }, 404);
    return c.json(result, 201);
  });

  app.post('/friends/:handle/accept', async (c) => {
    const userId = currentUserId(c);
    const handle = c.req.param('handle').toLowerCase();

    const updated = await asUser(userId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(raw`
        SELECT id FROM find_user_by_handle(${handle})`);
      const other = (rows as unknown as { id: string }[])[0];
      if (other === undefined) return null;

      // RLS only permits the addressee to update, so a requester trying to
      // accept their own request silently changes nothing.
      const done = await tx
        .update(friendships)
        .set({ status: 'accepted' })
        .where(and(eq(friendships.requesterId, other.id), eq(friendships.addresseeId, userId)))
        .returning({ status: friendships.status });
      return done[0] ?? null;
    });

    if (updated === null) return c.json({ error: 'No request from that person' }, 404);
    return c.json(updated);
  });

  app.delete('/friends/:handle', async (c) => {
    const userId = currentUserId(c);
    const handle = c.req.param('handle').toLowerCase();

    const removed = await asUser(userId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(raw`
        SELECT id FROM find_user_by_handle(${handle})`);
      const other = (rows as unknown as { id: string }[])[0];
      if (other === undefined) return 0;

      const done = await tx
        .delete(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, other.id)),
            and(eq(friendships.requesterId, other.id), eq(friendships.addresseeId, userId)),
          ),
        )
        .returning({ requesterId: friendships.requesterId });
      return done.length;
    });

    if (removed === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ removed: true });
  });

  // ----------------------------------------------------------------- shares
  app.get('/shared-with-me', async (c) => {
    const userId = currentUserId(c);
    const rows = await asUser(userId, (tx) =>
      tx
        .select({
          id: recipes.id,
          title: recipes.title,
          servings: recipes.servings,
          attributedTo: recipes.attributedTo,
          ownerHandle: users.handle,
          ownerName: users.displayName,
          sharedAt: recipeShares.createdAt,
        })
        .from(recipeShares)
        .innerJoin(recipes, eq(recipes.id, recipeShares.recipeId))
        .innerJoin(users, eq(users.id, recipeShares.ownerId))
        .where(and(eq(recipeShares.recipientId, userId), raw`${recipeShares.revokedAt} IS NULL`))
        .orderBy(desc(recipeShares.createdAt)),
    );
    return c.json({ recipes: rows });
  });

  app.post('/shares', async (c) => {
    const parsed = shareSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid share' }, 400);

    const userId = currentUserId(c);
    const handle = parsed.data.handle.toLowerCase();

    const result = await asUser(userId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(raw`
        SELECT id FROM find_user_by_handle(${handle})`);
      const target = (rows as unknown as { id: string }[])[0];
      if (target === undefined) return null;

      // The INSERT policy checks the recipe is genuinely yours, so a forged
      // recipeId is refused by the database rather than by a check here.
      await tx
        .insert(recipeShares)
        .values({ recipeId: parsed.data.recipeId, ownerId: userId, recipientId: target.id })
        .onConflictDoUpdate({
          target: [recipeShares.recipeId, recipeShares.recipientId],
          set: { revokedAt: null },
        });
      return { shared: true };
    }).catch(() => null);

    if (result === null) return c.json({ error: 'Could not share that recipe' }, 404);
    return c.json(result, 201);
  });

  app.delete('/shares/:recipeId/:handle', async (c) => {
    const userId = currentUserId(c);
    const handle = c.req.param('handle').toLowerCase();

    const done = await asUser(userId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(raw`
        SELECT id FROM find_user_by_handle(${handle})`);
      const target = (rows as unknown as { id: string }[])[0];
      if (target === undefined) return 0;

      // Revoked rather than deleted, so the history of who you shared with
      // survives and re-sharing is an update instead of a new row.
      const updated = await tx
        .update(recipeShares)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(recipeShares.recipeId, c.req.param('recipeId')),
            eq(recipeShares.recipientId, target.id),
          ),
        )
        .returning({ recipeId: recipeShares.recipeId });
      return updated.length;
    });

    if (done === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ revoked: true });
  });

  // --------------------------------------------------------------- attempts
  app.get('/recipes/:recipeId/attempts', async (c) => {
    const userId = currentUserId(c);
    const rows = await asUser(userId, (tx) =>
      tx
        .select({
          id: attempts.id,
          caption: attempts.caption,
          wentWell: attempts.wentWell,
          createdAt: attempts.createdAt,
          cookId: attempts.ownerId,
          cookHandle: users.handle,
          cookName: users.displayName,
          hidden: raw<boolean>`EXISTS (
            SELECT 1 FROM attempt_hides h WHERE h.attempt_id = ${attempts.id}
          )`,
        })
        .from(attempts)
        .innerJoin(users, eq(users.id, attempts.ownerId))
        .where(eq(attempts.recipeId, c.req.param('recipeId')))
        .orderBy(desc(attempts.createdAt)),
    );

    return c.json({
      attempts: rows.map((row) => ({ ...row, url: `/api/photos/attempts/${row.id}` })),
    });
  });

  app.post('/recipes/:recipeId/attempts', async (c) => {
    const contentType = c.req.header('X-Photo-Type') ?? '';
    if (!ALLOWED_TYPES.has(contentType)) {
      return c.json({ error: 'Photo must be WebP, JPEG or PNG' }, 415);
    }

    const meta = attemptSchema.safeParse({
      caption: c.req.header('X-Caption') ?? '',
      wentWell: c.req.header('X-Went-Well') === 'true'
        ? true
        : c.req.header('X-Went-Well') === 'false'
          ? false
          : null,
    });
    if (!meta.success) return c.json({ error: 'Invalid caption' }, 400);

    const buffer = Buffer.from(await c.req.arrayBuffer());
    if (buffer.byteLength === 0) return c.json({ error: 'Empty upload' }, 400);
    if (buffer.byteLength > MAX_PHOTO_BYTES) {
      return c.json({ error: 'Photo too large. Resize below 2 MB.' }, 413);
    }

    const userId = currentUserId(c);
    const created = await asUser(userId, async (tx) => {
      // The INSERT policy requires can_read_recipe, so posting an attempt on a
      // recipe you cannot see is refused by the database.
      const rows = await tx
        .insert(attempts)
        .values({
          recipeId: c.req.param('recipeId'),
          ownerId: userId,
          bytes: buffer,
          contentType,
          byteSize: buffer.byteLength,
          caption: meta.data.caption,
          wentWell: meta.data.wentWell,
        })
        .returning({ id: attempts.id });
      return rows[0];
    }).catch(() => undefined);

    if (created === undefined) return c.json({ error: 'Could not post that' }, 404);
    return c.json({ id: created.id, url: `/api/photos/attempts/${created.id}` }, 201);
  });

  app.delete('/attempts/:id', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.delete(attempts).where(eq(attempts.id, c.req.param('id'))).returning({ id: attempts.id }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ deleted: true });
  });

  /** The recipe owner hides an attempt from their page without touching it. */
  app.post('/attempts/:id/hide', async (c) => {
    const userId = currentUserId(c);
    const done = await asUser(userId, (tx) =>
      tx
        .insert(attemptHides)
        .values({ attemptId: c.req.param('id'), ownerId: userId })
        .onConflictDoNothing()
        .returning({ attemptId: attemptHides.attemptId }),
    ).catch(() => []);

    if (done.length === 0) return c.json({ error: 'Could not hide that' }, 404);
    return c.json({ hidden: true });
  });

  return app;
}
