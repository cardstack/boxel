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
    // The integration files' setup hooks are the heaviest thing in this
    // package: `startTestRealmServer` clones a migrated Postgres database,
    // starts a queue worker, logs each realm into Matrix, runs the realm's
    // initial index, and registers a Synapse user. That is a multi-second
    // fixture even unloaded, so vitest's 10s hook default sits inside the
    // fixture's own spread and fires on a busy runner rather than on a fault.
    // The budget is a ceiling for a wedged fixture, not a target: a healthy
    // boot uses a small fraction of it, and one that does not prints its phase
    // breakdown (see `reportSlowBoot` in tests/helpers/integration.ts).
    hookTimeout: 120000,
    sequence: {
      hooks: 'list',
    },
  },
});
