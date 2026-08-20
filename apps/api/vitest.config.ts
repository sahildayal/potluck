import { configDefaults, defineConfig } from 'vitest/config';

/** Fast tests — no containers, no network. These gate every commit. */
export default defineConfig({
  test: {
    name: 'unit',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    environment: 'node',
  },
});
