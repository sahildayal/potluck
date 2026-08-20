import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Database access, scoped to a user by construction.
 *
 * The only supported way to read or write user data is `asUser()`. It opens a
 * transaction, stamps the caller's id onto it with SET LOCAL, and hands you a
 * client whose every query is filtered by the row-level security policies in
 * rls.sql. There is deliberately no exported "just run this query" escape
 * hatch — the absence of one is what makes the guarantee hold.
 */

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set');
}

/**
 * Neon auto-suspends after five minutes idle and the free tier bills by
 * compute-hour, so a large idle pool is actively expensive here. A small pool
 * that closes idle connections is both cheaper and kinder to a 1 GB node.
 */
export const sqlClient = postgres(connectionString, {
  max: Number(process.env['DB_POOL_MAX'] ?? 5),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sqlClient, { schema });

export type Database = typeof db;
export type ScopedDatabase = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs `fn` inside a transaction scoped to `userId`.
 *
 * SET LOCAL means the setting is discarded when the transaction ends, so a
 * pooled connection can never leak one user's identity into the next request's
 * queries — the classic and very quiet way to get this wrong.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: ScopedDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config with is_local = true is the parameterised form of SET LOCAL.
    // Using it instead of string interpolation keeps userId out of the SQL text.
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * For the handful of operations that legitimately have no user yet: signup,
 * invite redemption, and the worker claiming a job. These run without an
 * app.user_id, which means RLS shows them nothing — so anything they need is
 * reached through a SECURITY DEFINER function with a narrow, audited surface.
 */
export async function asSystem<T>(fn: (tx: ScopedDatabase) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

export async function closeDatabase(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}

export { schema };
