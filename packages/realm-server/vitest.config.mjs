import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests-vitest/**/*.test.ts'],
    setupFiles: ['tests-vitest/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    server: {
      deps: {
        external: ['pg'],
      },
    },
    sequence: {
      hooks: 'list',
    },
    reporters:
      process.env.GITHUB_ACTIONS === 'true'
        ? ['default', 'github-actions', 'blob']
        : ['default'],
  },
});
