import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real Postgres in a throwaway container, which
 * is the only way to test row-level security honestly — a mock would just agree
 * with whatever we assumed.
 */
export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
