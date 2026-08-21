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

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  baseURL: env.APP_URL,
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
    // verification link. Signup is invite-gated instead, which is a stronger
    // control than an unverified email address anyway.
    requireEmailVerification: false,
    minPasswordLength: 10,
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
        defaultValue: 'metric',
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

  trustedOrigins: [env.APP_URL],
});

export type Session = typeof auth.$Infer.Session;

export async function closeAuthPool(): Promise<void> {
  await authClient.end({ timeout: 5 });
}
