import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { asUser } from '../db/client.js';
import { categories } from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';

const createSchema = z.object({ name: z.string().min(1).max(60) });
const renameSchema = z.object({ name: z.string().min(1).max(60) });
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).max(100) });

export function categoryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser);

  app.get('/', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.select().from(categories).orderBy(asc(categories.position)),
    );
    return c.json({ categories: rows });
  });

  app.post('/', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid category name' }, 400);

    const userId = currentUserId(c);
    const created = await asUser(userId, async (tx) => {
      const existing = await tx.select({ position: categories.position }).from(categories);
      const next = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;
      const [row] = await tx
        .insert(categories)
        .values({ ownerId: userId, name: parsed.data.name, position: next })
        .returning();
      return row;
    });

    return c.json({ category: created }, 201);
  });

  app.patch('/:id', async (c) => {
    const parsed = renameSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid category name' }, 400);

    const rows = await asUser(currentUserId(c), (tx) =>
      tx
        .update(categories)
        .set({ name: parsed.data.name })
        .where(eq(categories.id, c.req.param('id')))
        .returning(),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ category: rows[0] });
  });

  /**
   * Reorder takes the full ordered list of ids rather than a single move.
   *
   * Sending "move item 3 to position 1" from a drag-and-drop UI means the server
   * and client have to agree on the list they started from, and they will not
   * when two devices are open. Sending the whole order makes the last write win
   * cleanly, which is the right semantics for one person's own categories.
   */
  app.post('/reorder', async (c) => {
    const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid order' }, 400);

    const userId = currentUserId(c);
    const rows = await asUser(userId, async (tx) => {
      for (const [index, id] of parsed.data.ids.entries()) {
        // RLS silently drops ids the caller does not own, so a forged list
        // cannot reorder somebody else's categories.
        await tx.update(categories).set({ position: index }).where(eq(categories.id, id));
      }
      return tx.select().from(categories).orderBy(asc(categories.position));
    });

    return c.json({ categories: rows });
  });

  app.delete('/:id', async (c) => {
    // Recipes are not deleted with the category — the join rows cascade and the
    // recipe simply becomes uncategorised. Losing recipes because you tidied
    // your sections would be a terrible surprise.
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.delete(categories).where(eq(categories.id, c.req.param('id'))).returning({ id: categories.id }),
    );
    if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ deleted: true });
  });

  return app;
}
