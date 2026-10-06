---
name: motion-testing
description: >-
  Testing animated UI with glimmer-motion/test-support (setupMotion,
  animationsSettled, bounds, shape) and @cardstack/choreo/test-support
  (setupChoreo, orphanCount, strandedTransforms). Use
  when writing or debugging any test that renders motion elements, Presence,
  layout animation, or Choreo — and to avoid sleep()-based flake.
---

# Testing motion

**Never `sleep(200)`.** A sleep encodes a duration the test doesn't own;
change a spring and every sleep becomes flaky or slow.

```ts
import { setupChoreo } from '@cardstack/choreo/test-support';
import {
  animationsSettled,
  bounds,
  shape,
} from 'glimmer-motion/test-support';

module('the inbox', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('a deleted row flies to the bin', async function (assert) {
    await render(<template><Inbox /></template>);
    await animationsSettled();

    await click('[data-test-delete="row-2"]');
    await animationsSettled();

    assert.dom('[data-test-row="row-2"]').doesNotExist();
  });
});
```

- **`setupMotion(hooks)`** — resets what outlives an owner: the projection
  root, the layout-loop guard, motion speed. Always pair with
  `setupRenderingTest`.
- **`setupChoreo(hooks)`** (`@cardstack/choreo/test-support`) — the
  setup for a suite that renders `<Choreo>`, in place of `setupMotion`. It
  is `setupMotion` plus Choreo's own resets: the beacon registry, the
  far-match barrier, gesture samples.
- **`animationsSettled()`** — resolves when every motion element, layout
  animation and `<Choreo>` timeline in the document has stopped. On timeout
  it names what was still moving. It is deliberately NOT folded into
  `settled()`: a blocking waiter would turn "click again while it is still
  moving" into "wait for it to finish", and interruption tests would go
  green by no longer testing anything.
- **`bounds(el)`** — measures relative to `#ember-testing`, not the
  viewport (QUnit moves and scales its container; raw
  `getBoundingClientRect()` answers a different question depending on how
  many tests have run).
- **`shape(el)`** — the cumulative 2×2 transform. The way to assert a label
  was not smeared by its parent's scale; reading `x` will never tell you.
- **`orphanCount()` / `strandedTransforms()`**
  (`@cardstack/choreo/test-support`) — the two invariants to assert
  after any interruption test: nothing parked in a Choreo orphan
  layer, nothing wearing a transform nobody is animating.

## Conventions

- Hooks are `data-test-*` attributes, never class names.
- Interruption tests: click mid-flight on purpose, then assert the two
  invariants above plus the final resting bounds.
- DOM-read start values need a second frame in a real browser (the suite
  runs in Chrome, not jsdom); if a ported upstream literal was changed, the
  reason goes inline next to it.
- Run: the Motion ports with `pnpm test` in `packages/glimmer-motion` (runs
  the suite in headless Chrome, compiled from source), or `pnpm start:test`
  there for interactive runs. The Choreo and film suites run the same way in
  `packages/choreo`, compiling choreo and glimmer-motion from source. The
  tests that render gallery demos run with `pnpm test` in test-app (builds the
  suite, runs it in Chrome), or
  `pnpm --filter test-app exec vite --port 4202 --strictPort` + `/tests` for
  interactive runs.

Reference suites: `packages/choreo/tests/integration/choreo/` (the Choreo
contract suite) and the upstream ports under `packages/glimmer-motion/tests/`.
