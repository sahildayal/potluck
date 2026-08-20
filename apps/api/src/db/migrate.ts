import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Applies schema migrations, then the row-level security policies.
 *
 * Order is not optional: rls.sql references every table by name, so it can only
 * run once they exist. It is also written to be idempotent, because it re-runs
 * on every deploy — that is what keeps a newly added table from silently
 * shipping without a policy.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1, prepare: false });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: join(here, '../../drizzle') });

    const rls = await readFile(join(here, 'rls.sql'), 'utf8');
    await client.unsafe(rls);
  } finally {
    await client.end({ timeout: 5 });
  }
}

// Allow `tsx src/db/migrate.ts` as a deploy step — but only when this module is
// the process entrypoint. Comparing resolved URLs matters: a looser check fires
// when the integration tests import runMigrations, killing the test runner.
const entrypoint = process.argv[1];
const isDirectRun =
  entrypoint !== undefined && pathToFileURL(resolve(entrypoint)).href === import.meta.url;

if (isDirectRun) {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('migration failed:', error);
      process.exit(1);
    });
}
