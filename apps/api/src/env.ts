import { z } from 'zod';

/**
 * Environment validation, done once at startup.
 *
 * A missing DATABASE_URL should stop the process immediately with a readable
 * message, not surface as a null-pointer three requests into production.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  /**
   * Where the PWA is served from. Accepts a comma-separated list.
   *
   * A list rather than a single value because moving the frontend between hosts
   * is otherwise a flag day: the CORS allowlist and the cookie origin have to be
   * exact, so switching them means the old site breaks the instant the new one
   * starts working. With both listed, the two can overlap for as long as the
   * migration needs. The first entry is canonical and is what better-auth uses
   * as its base URL.
   */
  APP_URL: z
    .string()
    .default('http://localhost:5173')
    .refine(
      (value) => value.split(',').every((u) => URL.canParse(u.trim())),
      'APP_URL must be a URL, or a comma-separated list of URLs',
    ),
  API_PORT: z.coerce.number().int().positive().default(8787),
  GROQ_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Runs the import queue in-process. True on Render, false on k3s where the
   *  worker is its own deployment. */
  WORKER_INLINE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached !== null) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Derives a connection URL pinned to a specific database role for its whole
 * session. Used to give the auth handler a pool that physically cannot reach
 * recipe data, rather than relying on it to switch roles correctly per query.
 */
export function urlForRole(databaseUrl: string, role: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c role=${role}`);
  return url.toString();
}
