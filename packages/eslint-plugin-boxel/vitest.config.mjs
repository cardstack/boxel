import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: [],
    include: ['**/tests/**/*.js'],
    exclude: ['tests/helpers/**', 'node_modules'],
    sequence: {
      hooks: 'list',
    },
  },
});
