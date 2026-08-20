import { eq, sql } from 'drizzle-orm';
import { db, closeDatabase } from './db/client.js';
import { importJobs } from './db/schema.js';
import { loadEnv } from './env.js';
import { processJob, UnprocessableImport, type JobKind } from './import/process.js';

/**
 * The import worker.
 *
 * Polls a Postgres table rather than running a message broker. At this scale a
 * broker would be a second stateful service to operate, back up and pay for, to
 * solve a problem one `FOR UPDATE SKIP LOCKED` already solves — and that lock
 * is what makes it safe to run more than one replica without two workers
 * claiming the same job.
 *
 * Deliberately paced. Groq's free tier allows about 6,000 tokens a minute and a
 * photo import costs roughly 2,200, so the ceiling is a couple of imports per
 * minute. Going faster only produces 429s.
 */

const env = loadEnv();

const IDLE_POLL_MS = 5_000;
const BUSY_POLL_MS = 1_000;
const MAX_ATTEMPTS = 3;

let running = true;

interface Claimed extends Record<string, unknown> {
  id: string;
  ownerId: string;
  kind: string;
  payload: string;
  attempts: number;
}

/**
 * Claims one queued job atomically.
 *
 * SKIP LOCKED is the whole trick: concurrent workers step over each other's
 * rows instead of blocking, so scaling the deployment up needs no coordination
 * and no leader election.
 */
async function claim(): Promise<Claimed | null> {
  const rows = await db.execute<Claimed>(sql`
    UPDATE import_jobs
       SET status = 'reading', attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM import_jobs
        WHERE status = 'queued'
           OR (status = 'reading' AND updated_at < now() - interval '10 minutes')
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, owner_id AS "ownerId", kind, payload, attempts`);

  const list = rows as unknown as Claimed[];
  return list[0] ?? null;
}

async function finish(id: string, draft: unknown): Promise<void> {
  await db
    .update(importJobs)
    .set({ status: 'ready', draft: JSON.stringify(draft), error: null, updatedAt: new Date() })
    .where(eq(importJobs.id, id));
}

async function fail(id: string, message: string, retryable: boolean, attempts: number): Promise<void> {
  // A retryable failure goes back on the queue until it has burned its
  // attempts; anything else fails immediately, because retrying a link the
  // platform will never serve just wastes the token budget three times.
  const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
  await db
    .update(importJobs)
    .set({
      status: giveUp ? 'failed' : 'queued',
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(importJobs.id, id));
}

async function tick(): Promise<boolean> {
  const job = await claim();
  if (job === null) return false;

  console.log(`[worker] job ${job.id.slice(0, 8)} kind=${job.kind} attempt=${job.attempts}`);

  try {
    const result = await processJob(job.kind as JobKind, job.payload, {
      groqApiKey: env.GROQ_API_KEY,
    });
    await finish(job.id, { ...result.draft, via: result.via });
    console.log(`[worker] job ${job.id.slice(0, 8)} ready via ${result.via}: ${result.draft.title}`);
  } catch (error) {
    const retryable = error instanceof UnprocessableImport ? error.retryable : true;
    const message = error instanceof Error ? error.message : String(error);
    await fail(job.id, message, retryable, job.attempts);
    console.warn(`[worker] job ${job.id.slice(0, 8)} failed: ${message.slice(0, 120)}`);
  }

  return true;
}

async function main(): Promise<void> {
  console.log(`[worker] started (${env.NODE_ENV})`);

  const stop = (signal: string): void => {
    console.log(`[worker] ${signal} received, finishing current job`);
    running = false;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  while (running) {
    let didWork = false;
    try {
      didWork = await tick();
    } catch (error) {
      // A database blip must not kill the worker; Neon suspends after five
      // minutes idle and the first query back can fail while it wakes.
      console.error('[worker] poll failed:', error);
      await sleep(10_000);
    }
    if (running) await sleep(didWork ? BUSY_POLL_MS : IDLE_POLL_MS);
  }

  await closeDatabase();
  console.log('[worker] stopped');
  process.exit(0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

main().catch((error: unknown) => {
  console.error('[worker] fatal:', error);
  process.exit(1);
});
