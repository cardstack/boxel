import { defineConfig } from 'vite';

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
