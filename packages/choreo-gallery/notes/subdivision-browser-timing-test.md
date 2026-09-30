# Subdivision browser timing test

## Status

The failing subdivision test is not evidence that `choreo-player` broke
Choreo or layout animation. The player package builds and its tests pass. The
failure is an older browser test whose observation method is not isolated or
deterministic enough for the full CI suite.

The failure is nevertheless real and reproducible on the merge commit:

- merge commit: [`ea0419f`](https://github.com/cardstack/choreo/commit/ea0419fe11f0b4f5ce2941a68824a8ddad0d5928)
- failing test: `Integration | motion | subdivision: evening a seam springs the tiles rather than snapping them`
- observation: `{"before":48,"readings":[48],"after":48}`
- the exact commit failed this test twice; a later `main` run passed the full browser suite

That pattern makes this an order-, fixture-, or browser-scheduling-sensitive
test, not a stable product regression.

## What the test is trying to prove

The Subdivision demo begins with a `40% / 60%` column split. Double-clicking
the vertical seam calls `layoutChange`, changes the split to `50% / 50%`, and
the existing tiles should spring to their new layout over roughly 420ms.

There are two independent contracts:

1. the interaction commits a new layout and the first tile ends at a different
   width;
2. the change is animated rather than snapped.

The current test combines both contracts by reading the first `.sub-tile` on
every animation frame for 260ms, sleeping for 900ms, and comparing rounded
widths.

## Why the existing hardening did not solve it

Commit `16d2dd9` wrapped the demo in an explicit 600×500 stage because the demo
uses container units. That was a good precondition fix and it is already an
ancestor of `ea0419f`, but the exact merge commit still failed with every
reading equal to 48px.

The result tells us more than “CI skipped the middle of the spring.” Even the
reading after the 900ms sleep is 48px. The test either measured an element
whose geometry did not change or measured the wrong element. Increasing either
sleep will not fix that.

The remaining hazards are:

- `document.querySelector('.sub-tile')` and the seam/grid queries search the
  whole document, not the current rendering-test fixture. A live or stale demo
  elsewhere in the test page can satisfy every selector, including the
  `gridWidth() > 100` guard.
- the test rounds every width to an integer, hiding small but legitimate
  intermediate changes.
- a 260ms wall-clock loop still depends on browser scheduling. A loaded runner
  can deliver one late animation frame and observe no intermediate value.
- raw `dispatchEvent` is not an Ember test interaction and gives the test no
  explicit render boundary.
- `setTimeout(900)` violates the repository's motion-test contract. Completion
  should use `animationsSettled()`.

## Recommended rewrite — no engine change

Split the test at the contract boundary.

### 1. Demo interaction and endpoint

- Add stable `data-test-*` hooks to the Subdivision root, vertical seam, and
  one tile, or scope all selectors beneath the element returned from the
  current test fixture.
- Use Ember's `triggerEvent`/`doubleClick` helper.
- Measure with `bounds()` from `glimmer-motion/test-support` and keep the raw
  floating-point width.
- Call `animationsSettled()` before the initial measurement and after the
  interaction.
- Assert the explicit preconditions: the rendered grid is the expected size,
  the selected tile belongs to that grid, and the final width differs from the
  initial width by a meaningful tolerance.

This test answers: “does the real demo interaction produce the intended final
layout?” It should not sample the middle of an animation.

### 2. Animated-not-snapped behavior

Test this separately with a small, isolated layout fixture. Prefer an engine
signal over elapsed browser time:

- trigger the layout change;
- assert that Motion reports active work (`isMotionIdle() === false`, with
  `whatIsBusy()` included in the failure message), or use the layout-animation
  start/completion callbacks if the fixture can expose them;
- finish with `animationsSettled()` and assert the final geometry.

The engine's interpolation contract belongs in a minimal motion-layout test.
The demo test only needs to prove that Subdivision requests that contract. If
we later add a deterministic test clock for element/layout motion, the engine
test can seek to 50% and assert an exact intermediate width. A new core clock
API is not required to fix today's CI failure.

## Do not fix it by

- increasing the 260ms sampling window;
- increasing the 900ms sleep;
- weakening `before !== after`;
- retrying the full suite until the browser happens to expose a middle frame;
- changing `choreo-player` or Choreo's runtime without a separately reproduced
  engine failure.

## Acceptance criteria

- the test passes alone and in the complete Chrome suite;
- it passes with a constrained or shifted QUnit fixture;
- every queried element is proven to be inside the current rendering fixture;
- no fixed-duration sleep remains;
- the endpoint failure reports the stage, grid, tile, before, and after bounds;
- the animation assertion observes engine activity or a deterministic clock,
  not a lucky `requestAnimationFrame` sample;
- no Choreo core behavior changes are needed for the test repair.

## Relevant code

- `test-app/tests/integration/motion/subdivision-test.gts`
- `test-app/app/components/examples/subdivision.gts`
- `packages/glimmer-motion/src/test-support/index.ts`
