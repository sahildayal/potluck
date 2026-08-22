import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DEFAULT_CATEGORIES } from '@potluck/core';
import { loadEnv, urlForRole } from './env.js';
import { asUser } from './db/client.js';
import { accounts, categories, sessions, users, verifications } from './db/schema.js';

const env = loadEnv();

/**
 * A dedicated pool pinned to potluck_auth for its entire session.
 *
 * The role is set in the connection's startup packet, so every query better-auth
 * issues runs as potluck_auth whether or not the library cooperates. It can read
 * and write sessions, accounts and users; it gets "permission denied" on
 * recipes. That isolation is structural rather than a rule someone has to
 * remember, which is the only kind worth relying on.
 */
const authClient = postgres(urlForRole(env.DATABASE_URL, 'potluck_auth'), {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

const authDb = drizzle(authClient, {
  schema: { users, sessions, accounts, verifications },
});

/**
 * APP_URL may list several origins while the frontend moves between hosts.
 * The first is canonical; all of them are trusted for CSRF.
 */
const appOrigins = env.APP_URL.split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter((u) => u.length > 0);
const canonicalAppUrl = appOrigins[0] ?? 'http://localhost:5173';
const trustedAppOrigins = appOrigins;

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  baseURL: canonicalAppUrl,
  basePath: '/api/auth',

  database: drizzleAdapter(authDb, {
    provider: 'pg',
    // Our tables are plural; better-auth's models are singular.
    usePlural: true,
    schema: { users, sessions, accounts, verifications },
  }),

  emailAndPassword: {
    enabled: true,
    // No mail provider on a zero-cost stack, so there is nowhere to send a
    // verification link.
    //
    // This used to claim invite gating made up for that. It does not, because
    // the gate is not wired in: invite_codes and redeem_invite() exist and are
    // tested, but nothing in this signup path calls them. Signup is open to
    // anyone with the URL, which is a deliberate trade for an unlisted link and
    // a friend group, and has to change before the link is posted publicly.
    requireEmailVerification: false,
    // Eight, not ten. This guards a recipe collection behind an unlisted link,
    // and every extra character is typed on a phone keyboard by someone who
    // only wanted to see a curry. Sessions are httpOnly cookies and passwords
    // are scrypt-hashed either way.
    minPasswordLength: 8,
  },

  user: {
    // better-auth calls these `name` and `image`; our schema calls them
    // display_name and avatar_key, and the app-owned columns sit alongside.
    fields: {
      name: 'displayName',
      image: 'avatarKey',
    },
    additionalFields: {
      handle: { type: 'string', required: true, input: true },
      theme: { type: 'string', required: false, defaultValue: 'system', input: true },
      unitPreference: {
        type: 'string',
        required: false,
        // Must match the column default in schema.ts. better-auth applies this
        // one on insert, so the two disagreeing would mean a user's preference
        // depended on which path created the row.
        defaultValue: 'imperial',
        input: true,
      },
      invitedBy: { type: 'string', required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Seed the five default categories from the requirements doc.
         *
         * Runs through asUser as the new account itself, so the rows are
         * created under the same RLS policies as everything else rather than
         * through a privileged back door. A failure here is logged but does not
         * fail the signup — an account with no categories is recoverable, an
         * account that could not be created is not.
         */
        after: async (user) => {
          try {
            await asUser(user.id, async (tx) => {
              await tx.insert(categories).values(
                DEFAULT_CATEGORIES.map((name, position) => ({
                  ownerId: user.id,
                  name,
                  position,
                  isDefault: true,
                })),
              );
            });
          } catch (error) {
            console.error('[auth] failed to seed default categories', error);
          }
        },
      },
    },
  },

  advanced: {
    /**
     * The web app is served from a different host than the API in production,
     * which makes the session cookie cross-site. Browsers drop a cross-site
     * cookie unless it is SameSite=None AND Secure, so both are required — and
     * Secure means this only works over HTTPS, which Render provides.
     *
     * In development the Vite proxy makes everything same-origin, so Lax is
     * correct there and avoids needing HTTPS locally.
     */
    defaultCookieAttributes:
      env.NODE_ENV === 'production'
        ? { sameSite: 'none', secure: true, httpOnly: true }
        : { sameSite: 'lax', secure: false, httpOnly: true },
    database: {
      // Our columns are uuid, and every RLS policy casts app.user_id to uuid.
      // better-auth's default id generator would produce something that fails
      // that cast at runtime rather than at boot.
      generateId: () => randomUUID(),
    },
  },

  trustedOrigins: trustedAppOrigins,
});

export type Session = typeof auth.$Infer.Session;

export async function closeAuthPool(): Promise<void> {
  await authClient.end({ timeout: 5 });
}
