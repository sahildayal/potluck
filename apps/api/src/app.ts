import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { auth } from './auth.js';
import { loadEnv } from './env.js';
import { asUser, sqlClient } from './db/client.js';
import { users } from './db/schema.js';
import { withSession, type AppEnv } from './middleware/session.js';
import { categoryRoutes } from './routes/categories.js';
import { photoRoutes } from './routes/photos.js';
import { recipeRoutes } from './routes/recipes.js';
import { shoppingRoutes } from './routes/shopping.js';
import { catalogRoutes } from './routes/catalog.js';
import { importRoutes } from './routes/imports.js';
import { socialRoutes } from './routes/social.js';

const env = loadEnv();

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  if (env.NODE_ENV !== 'test') app.use('*', logger());

  // The PWA is served from a different origin (Cloudflare Pages) than the API,
  // so credentialed CORS is required and the origin allowlist must be exact —
  // a wildcard is rejected by browsers when credentials are included anyway.
  app.use(
    '/api/*',
    cors({
      origin: [env.APP_URL],
      credentials: true,
      allowHeaders: ['Content-Type', 'X-Photo-Type', 'X-Caption', 'X-Went-Well'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  /**
   * Liveness. Deliberately does not touch the database: Kubernetes restarts a
   * pod that fails this, and restarting the API because Neon is briefly
   * suspended would turn a recoverable blip into a crash loop.
   */
  app.get('/health', (c) => c.json({ ok: true }));

  /** Readiness. This one does check the database, because a pod that cannot
   *  reach Postgres should be pulled out of the load balancer. */
  app.get('/ready', async (c) => {
    try {
      await sqlClient`SELECT 1`;
      return c.json({ ok: true, db: 'up' });
    } catch {
      return c.json({ ok: false, db: 'down' }, 503);
    }
  });

  // better-auth owns everything under its basePath. Registered before the
  // session middleware, since it is what creates sessions in the first place.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.use('/api/*', withSession);

  app.get('/api/me', (c) => {
    const session = c.get('session');
    if (session === null || session === undefined) return c.json({ user: null });
    return c.json({ user: session.user });
  });

  /**
   * Updates the caller's own preferences.
   *
   * Deliberately narrow: only the two display preferences, never the handle,
   * email or anything better-auth owns. A general "patch the user" endpoint is
   * how an account takeover becomes a one-line request.
   *
   * The write goes through asUser like everything else, so the users_update_self
   * policy is what actually confines it to the caller's own row — the WHERE
   * clause here is for clarity, not for security.
   */
  app.patch('/api/me', async (c) => {
    const session = c.get('session');
    if (session === null || session === undefined) return c.json({ error: 'Unauthorized' }, 401);

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null) return c.json({ error: 'Expected a JSON body' }, 400);

    const patch: { unitPreference?: string; theme?: string } = {};

    if ('unitPreference' in body) {
      const value = body['unitPreference'];
      if (value !== 'metric' && value !== 'imperial') {
        return c.json({ error: 'unitPreference must be "metric" or "imperial"' }, 400);
      }
      patch.unitPreference = value;
    }

    if ('theme' in body) {
      const value = body['theme'];
      if (value !== 'light' && value !== 'dark' && value !== 'system') {
        return c.json({ error: 'theme must be "light", "dark" or "system"' }, 400);
      }
      patch.theme = value;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'Nothing to update' }, 400);
    }

    const userId = session.user.id;
    const [updated] = await asUser(userId, (tx) =>
      tx
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          handle: users.handle,
          theme: users.theme,
          unitPreference: users.unitPreference,
        }),
    );

    if (updated === undefined) return c.json({ error: 'Not found' }, 404);
    return c.json({ user: updated });
  });

  app.route('/api/recipes', recipeRoutes());
  app.route('/api/categories', categoryRoutes());
  app.route('/api/photos', photoRoutes());
  app.route('/api/shopping', shoppingRoutes());
  app.route('/api/catalog', catalogRoutes());
  app.route('/api/imports', importRoutes());
  app.route('/api/social', socialRoutes());

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    // Never leak internals to the client; the details go to the logs.
    console.error('[api]', error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}
