import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '#realm-server': resolve(import.meta.dirname, '../realm-server'),
    },
  },
  test: {
    globals: true,
    setupFiles: [],
    include: ['**/tests/**/*.ts'],
    exclude: ['tests/helpers/**', 'node_modules'],
    testTimeout: 30000,
    sequence: {
      hooks: 'list',
    },
  },
});
