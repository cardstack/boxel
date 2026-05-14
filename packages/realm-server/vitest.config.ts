import { defineConfig } from 'vitest/config';

// CS-10346 proof-of-concept: a single leaf test runs under vitest while the
// rest of the realm-server suite stays on QUnit. The codemod regenerates
// tests-vitest/ from tests/, so include only what's been vetted to pass and
// extend the list as files graduate.
export default defineConfig({
  test: {
    include: ['tests-vitest/async-semaphore.test.ts'],
    globals: false,
    testTimeout: 60000,
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    sequence: {
      hooks: 'list',
    },
  },
});
