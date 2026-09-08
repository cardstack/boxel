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
export const TEST_CLOCK_INSTANT = Date.UTC(2026, 8, 1, 0, 0, 0);

export function pinTestClock() {
  (globalThis as { __boxelNow?: number }).__boxelNow = TEST_CLOCK_INSTANT;
}
