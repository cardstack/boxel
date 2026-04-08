import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: [],
    include: ['**/tests/**/*.ts'],
    exclude: ['tests/helpers/**', 'node_modules'],
    sequence: {
      hooks: 'list',
    },
  },
});
