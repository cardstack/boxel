import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Nearly every test here drives the CLI as a subprocess through `runBoxel`,
// which imposes its own kill deadline (`RUN_BOXEL_DEFAULT_DEADLINE_MS`, 60s).
// That deadline is the only thing that can end a wedged command *and say
// which command it was*, so vitest's budgets have to sit above it: a budget
// that fires first abandons the subprocess instead, leaving a bare "Test
// timed out in Nms" that names neither the command nor its output — and
// leaving the command itself running against the realm server the rest of
// the file is using.
//
// The ladder, innermost first: a `--timeout` the command was given on its own
// argv < runBoxel's kill deadline < these budgets. `tests/lib/deadline-ladder`
// asserts the config end of it.
const RUN_BOXEL_DEADLINE_HEADROOM_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000 + RUN_BOXEL_DEADLINE_HEADROOM_MS;

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
    testTimeout: TEST_TIMEOUT_MS,
    // Setup hooks carry the heaviest thing in this package on top of whatever
    // commands they run: `startTestRealmServer` clones a migrated Postgres
    // database, starts a queue worker, logs each realm into Matrix, runs the
    // realm's initial index, and registers a Synapse user. vitest's 10s hook
    // default is a unit-test budget and sits inside that fixture's own spread,
    // so it fires on a busy runner rather than on a fault — and an overrun
    // hook is the expensive kind of failure here, because the boot it
    // abandons goes on to bind the fixture's port (see
    // tests/integration/fixture-teardown.test.ts).
    //
    // This is a ceiling for a wedged fixture, not a target: a healthy boot
    // uses a small fraction of it, and one that runs an order of magnitude
    // over its usual cost prints its phase breakdown (see
    // `reportSlowFixture` in tests/helpers/integration.ts).
    hookTimeout: TEST_TIMEOUT_MS + RUN_BOXEL_DEADLINE_HEADROOM_MS,
    sequence: {
      hooks: 'list',
    },
  },
});
