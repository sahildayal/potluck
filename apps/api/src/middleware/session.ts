import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { auth, type Session } from '../auth.js';

export interface AppEnv {
  Variables: {
    session: Session | null;
  };
}

/**
 * Resolves the caller's session and hangs it on the request context.
 *
 * Deliberately does NOT reject anonymous requests — some routes are public.
 * Requiring a user is a separate, explicit decision made by requireUser below,
 * so a route is never accidentally public because a middleware was forgotten.
 */
export const withSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('session', session as Session | null);
  await next();
});

/** 401s anonymous callers. Every data route sits behind this. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get('session');
  if (session === null || session === undefined) {
    return c.json({ error: 'Not signed in' }, 401);
  }
  await next();
});

/**
 * The signed-in user's id, for handing to asUser().
 * Throws rather than returning null: reaching here without a session means
 * requireUser was omitted, and failing loudly beats querying as nobody.
 */
export function currentUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  const id = session?.user?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('currentUserId called on a route without requireUser');
  }
  return id;
}
