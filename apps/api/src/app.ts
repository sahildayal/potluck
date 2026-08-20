import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { auth } from './auth.js';
import { loadEnv } from './env.js';
import { sqlClient } from './db/client.js';
import { withSession, type AppEnv } from './middleware/session.js';
import { categoryRoutes } from './routes/categories.js';
import { photoRoutes } from './routes/photos.js';
import { recipeRoutes } from './routes/recipes.js';
import { shoppingRoutes } from './routes/shopping.js';
import { catalogRoutes } from './routes/catalog.js';

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
      allowHeaders: ['Content-Type'],
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

  app.route('/api/recipes', recipeRoutes());
  app.route('/api/categories', categoryRoutes());
  app.route('/api/photos', photoRoutes());
  app.route('/api/shopping', shoppingRoutes());
  app.route('/api/catalog', catalogRoutes());

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    // Never leak internals to the client; the details go to the logs.
    console.error('[api]', error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}
