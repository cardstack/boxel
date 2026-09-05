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
// The ladder, innermost first: a deadline the command was given for itself <
// runBoxel's kill deadline < these budgets. `tests/lib/deadline-ladder`
// asserts the config end of it.
//
// Only the outer two rungs are enforced. runBoxel reads a command's own
// deadline off argv, and a command can hold one that never appears there —
// `parse` gives ember-tsc 120s through `execFile` — so for those the call site
// has to set the harness deadline itself, as `parse.test.ts` does.
const RUN_BOXEL_DEADLINE_HEADROOM_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000 + RUN_BOXEL_DEADLINE_HEADROOM_MS;
// The wall-clock a teardown can legitimately spend, mirrored from
// `tests/helpers/fixture-budgets.ts` because a vitest config cannot import the
// suite's TypeScript. `tests/lib/deadline-ladder` asserts the two stay in step.
const FIXTURE_TEARDOWN_BUDGET_MS = 60_000 + 60_000 + 15_000;

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
    // Teardown is what actually sets this number, though, not the runBoxel
    // deadline: `stopTestRealmServer` can spend every one of its budgets in
    // sequence — settling an abandoned boot, draining a job already claimed,
    // then closing a pool that job still holds (tests/helpers/fixture-budgets).
    // A hook that fires inside that sum stops teardown partway, and what it
    // did not reach becomes the next file's failure, which is the whole
    // failure mode the budgets exist to prevent.
    //
    // This is a ceiling for a wedged fixture, not a target: a healthy boot
    // uses a small fraction of it, and one that runs an order of magnitude
    // over its usual cost prints its phase breakdown (see
    // `reportSlowFixture` in tests/helpers/integration.ts).
    hookTimeout:
      Math.max(TEST_TIMEOUT_MS, FIXTURE_TEARDOWN_BUDGET_MS) +
      RUN_BOXEL_DEADLINE_HEADROOM_MS,
    sequence: {
      hooks: 'list',
    },
  },
});
