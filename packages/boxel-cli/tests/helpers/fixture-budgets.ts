// What teardown of the integration fixture is allowed to spend, and why each
// step needs a ceiling at all.
//
// `stopTestRealmServer` releases resources that are process-wide — a fixed
// port, a queue worker, a database — while the suite shares one process
// (`--poolOptions.forks.singleFork`). A teardown that stops partway therefore
// does not fail the file that caused it; it fails the next one, on a port or a
// connection that file never asked for. So every step that can wait
// indefinitely gets a budget and teardown carries on when one expires.
//
// These live apart from `integration.ts` so that `tests/lib/deadline-ladder`
// can read them: importing the harness pulls in the realm-server test helpers,
// which resolve a Synapse registration secret at module scope and throw
// without one — and the unit suite runs before Matrix is up.
//
// A hook budget has to exceed their sum; the ladder test asserts it.

// How long teardown waits for an in-flight boot to publish its results (or
// fail), so that it sees everything the boot created. The boot goes on to bind
// the fixture port whether or not anything holds a reference to it, so teardown
// settles it rather than racing it.
//
// A cap rather than an unbounded wait, because a boot that never settles would
// otherwise hold teardown until the hook budget above it. Reaching the cap is
// the one case teardown cannot clean up: the boot has by definition not reached
// its `listen` yet, so there is nothing to close and nothing for the next
// file's pre-flight check to see either. Generous enough that a boot costing an
// order of magnitude over its usual second is still waited out.
export const BOOT_SETTLE_TIMEOUT_MS = 60_000;

// Draining the queue runner. `runner.destroy()` waits for the runner's loop to
// return, and that loop checks `shuttingDown` only between claims — a job
// already claimed runs to completion, and the lease deadline that would cut it
// short is an hour out.
export const DRAIN_BUDGET_MS = 60_000;

// Closing the database pool, which ends by waiting for its checked-out
// clients: a job still holding one holds this step too, so the drain's budget
// does not on its own bound the teardown.
export const DB_CLOSE_BUDGET_MS = 15_000;
