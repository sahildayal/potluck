import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { auth } from './auth.js';
import { loadEnv } from './env.js';
import { asAuthService, asUser, sqlClient } from './db/client.js';
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

/** APP_URL may list several origins while the frontend moves between hosts. */
function appOrigins(value: string): string[] {
  return value
    .split(',')
    .map((u) => u.trim().replace(/\/$/, ''))
    .filter((u) => u.length > 0);
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  if (env.NODE_ENV !== 'test') app.use('*', logger());

  // The PWA is served from a different origin than the API, so credentialed
  // CORS is required and the allowlist must be exact — a wildcard is rejected
  // by browsers outright once credentials are involved.
  app.use(
    '/api/*',
    cors({
      origin: appOrigins(env.APP_URL),
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

  /**
   * Sign in with either an email address or a handle.
   *
   * People remember the name their friends see, not the address they typed once
   * at signup — and the app deliberately never displays that address back to
   * them. Requiring the exact email to return therefore asks for the one string
   * a user has no way to look up.
   *
   * The handle is resolved to an email server-side and the request is then
   * handed to better-auth unchanged, so the email never travels to the client
   * and there is no lookup endpoint for anyone else to point at either.
   *
   * A missing handle returns the same generic failure as a wrong password.
   * Handles are already public — the whole friends feature is people searching
   * for each other by handle — so this discloses nothing new; the point is
   * simply not to tell an attacker which half of the pair was wrong.
   */
  app.post('/api/sign-in', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const identifier = typeof body?.['identifier'] === 'string' ? body['identifier'].trim() : '';
    const password = typeof body?.['password'] === 'string' ? body['password'] : '';

    const rejection = c.json({ message: 'Invalid email or password' }, 401);
    if (identifier.length === 0 || password.length === 0) return rejection;

    let email = identifier;
    if (!identifier.includes('@')) {
      // Handles are stored lowercase; a person typing their own name may not be.
      const [found] = await asAuthService((tx) =>
        tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.handle, identifier.toLowerCase()))
          .limit(1),
      );
      if (found === undefined) return rejection;
      email = found.email;
    }

    // Rebuilt rather than forwarded: the body changes, so a copied
    // Content-Length would describe the old one. Origin and Cookie are carried
    // over because better-auth checks the first for CSRF and sets the second.
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const origin = c.req.header('Origin');
    if (origin !== undefined) headers.set('Origin', origin);
    const cookie = c.req.header('Cookie');
    if (cookie !== undefined) headers.set('Cookie', cookie);

    const url = new URL(c.req.url);
    url.pathname = '/api/auth/sign-in/email';
    url.search = '';

    return auth.handler(
      new Request(url, { method: 'POST', headers, body: JSON.stringify({ email, password }) }),
    );
  });

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
