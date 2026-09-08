// The instant the suite reports as "now".
//
// Card code reads the clock through `@cardstack/base/helpers/clock`, which
// falls through to the real one unless something pins it. Pinning it here
// makes what a card renders a function of its own data: "3d ago", a countdown,
// an age and an "expires soon" warning all stop depending on when the suite
// happened to run, so a visual comparison of them is a comparison of the code
// rather than a race against whichever threshold each is nearest.
//
// The value is arbitrary — determinism is the point, not realism — but it is
// not free of consequences, so it is chosen rather than picked. Two things
// follow from it:
//
// Realms the tests build in the browser stamp their files with this same
// instant (see `adapter.ts`), so those files read as `today`, which is what
// they read as when both sides were the real clock. Nothing about them moves.
//
// Realms served from the index cache carry mtimes that
// `scripts/normalize-realm-mtimes.mjs` derives from file content, so they are
// fixed dates scattered across decades. Their rendered ages are measured from
// this instant instead of from today, which shifts some of them by a unit the
// first time this lands. That is a one-time baseline change, and it buys the
// property that they never shift again on their own.
// Mid-month and mid-day on purpose. A calendar test asserts that days earlier
// in the current month are disabled by a `today` sentinel, and guards itself
// with `getDate() > 1` — pinned to the first, that assertion would skip rather
// than fail, which is a quieter way to lose it than leaving it broken.
export const TEST_CLOCK_INSTANT = Date.UTC(2026, 8, 15, 12, 0, 0);

export function pinTestClock() {
  (globalThis as { __boxelNow?: number }).__boxelNow = TEST_CLOCK_INSTANT;
}

// A fixture file's recorded mtime.
//
// These cannot all be the pinned instant. The indexer decides what a
// from-scratch pass has to revisit by comparing a file's mtime against the one
// on its index row and skipping where they match, so a write that leaves the
// mtime alone is a change the indexer cannot see — which is what
// `scripts/normalize-realm-mtimes.mjs` exists to keep working, and what a
// single frozen stamp would defeat.
//
// So they advance, one second per stamp, from far enough below the pinned
// instant that a suite would have to write tens of thousands of files in one
// page load to reach it. Staying below matters: a mtime after the pinned
// instant is in the future, and a file with a future mtime renders as an
// absolute date rather than an age. Staying within the same day matters too —
// that is what keeps these files reading as `today`, which is what they read
// as when both the clock and the stamp were the real one.
const FIXTURE_MTIME_FLOOR =
  Math.floor(TEST_CLOCK_INSTANT / 1000) - 12 * 60 * 60;
const FIXTURE_MTIME_CEILING = Math.floor(TEST_CLOCK_INSTANT / 1000) - 1;
let fixtureMtimeCounter = 0;

export function nextFixtureMtime(): number {
  return Math.min(
    FIXTURE_MTIME_FLOOR + fixtureMtimeCounter++,
    FIXTURE_MTIME_CEILING,
  );
}
