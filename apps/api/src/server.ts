import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { assertRlsEnforced, closeDatabase } from './db/client.js';
import { closeAuthPool } from './auth.js';

const env = loadEnv();

async function main(): Promise<void> {
  // Refuse to serve a single request if the database role can bypass row-level
  // security. Everything else in this codebase assumes it cannot.
  await assertRlsEnforced();

  const server = serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
    console.log(`[api] listening on :${info.port} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, draining`);
    server.close(() => {
      void Promise.all([closeDatabase(), closeAuthPool()]).then(() => process.exit(0));
    });
    // Kubernetes sends SIGKILL after terminationGracePeriodSeconds; exit first
    // so an in-flight request cannot hang the shutdown indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[api] failed to start:', error);
  process.exit(1);
});
