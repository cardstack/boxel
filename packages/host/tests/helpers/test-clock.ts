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

// A realm's fixture mtimes, as a fresh sequence per adapter.
//
// Two constraints pull against each other here.
//
// They must advance: the indexer decides what a from-scratch pass has to
// revisit by comparing a file's mtime against the one on its index row and
// skipping where they match, so a write that leaves the mtime alone is an edit
// it cannot see.
//
// They must also stay within a minute of the pinned instant, because
// `formatLastSavedText` calls anything closer than that "just now" and the
// inspector asserts a seeded fixture reads that way — which it did when both
// the clock and the stamp were the real one, the files having been written
// moments earlier.
//
// A minute of one-second steps is only sixty values, which a whole shard would
// exhaust immediately. Per adapter it is ample: a realm seeds once and a test
// writes a handful of times. Sequences in different realms overlap, which
// costs nothing — the comparison that matters is between a file and its own
// index row.
const FIXTURE_MTIME_SPAN_S = 59;

export function createFixtureMtimeSequence(): () => number {
  let pinnedSeconds = Math.floor(TEST_CLOCK_INSTANT / 1000);
  let step = 0;
  return () =>
    Math.min(pinnedSeconds - FIXTURE_MTIME_SPAN_S + step++, pinnedSeconds - 1);
}
