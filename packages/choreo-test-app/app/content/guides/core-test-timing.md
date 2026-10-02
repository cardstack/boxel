# Testing Time, Gates, and Settlement

Animation tests need to distinguish a rendered application from a settled animation. A click can finish its Ember update while a spring is still moving. Conversely, an interruption test must deliberately interact before motion ends. The test-support entrypoint gives each test an explicit choice instead of hiding all animation behind the framework's default waiter.

## Setting Up Motion Tests

Import from `glimmer-motion/test-support`. Call `setupMotion(hooks)` alongside the usual rendering-test setup. It resets document-level motion state between tests and reports a layout-loop guard failure with a useful explanation rather than leaving the runner to time out.

A suite that renders `<Choreo>` calls `setupChoreo(hooks)` from `glimmer-motion/choreo/test-support` instead. It is the same setup, and it also clears Choreo's document-wide state: the beacon registry, the far-match barrier, and the gesture samples. One setup call covers both layers.

```ts title="Component logic excerpt"
import { setupMotion, animationsSettled } from 'glimmer-motion/test-support';

module('animated notice', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  test('finishes its exit', async function (assert) {
    // Render the fixture and trigger its removal.
    await animationsSettled();
    assert.dom('[data-test-notice]').doesNotExist();
  });
});
```

This excerpt assumes QUnit and Ember test helpers are imported by the test file. The important boundary is the explicit wait after the action whose settled result is being asserted.

## Waiting for the Right Condition

`animationsSettled()` waits until motion is idle on consecutive checks, accounting for a completion that triggers another render or releases a leaving element. It accepts a timeout for diagnosing genuinely stuck work. `isMotionIdle()` and `whatIsBusy()` provide the underlying diagnostic view.

Do not use a fixed sleep. Changing a spring configuration can make that sleep either too short or unnecessarily long. Do not globally force animations to complete instantly for the interruption suite either: doing so removes the behavior the test is supposed to observe.

## Driving a Score

The score drivers come from `glimmer-motion/choreo/test-support`. `seekTo(seconds)` pauses and positions live test runs, producing a still for assertions. `advanceGate()` releases parked gates and waits for the released segment. A parked gate and a standing annotation count as settled states even though the score remains available for later input.

For an interruption test, trigger the second action before calling animationsSettled. Inspect intermediate geometry or velocity where the contract requires continuity. Then wait and assert the final state and cleanup.

## Restoring the Test Environment

`resetMotion()` clears global registries and temporary configuration. Use the setup helper for ordinary cases so cleanup remains consistent. A layer built on glimmer-motion that keeps its own document-wide state adds its reset with `registerMotionReset(reset)`, and `resetMotion()` runs it after glimmer-motion's own; Choreo's test-support adds its resets this way when it loads. A test that leaves the projection root blocked or a beacon registered can make the next test fail for reasons unrelated to its own code. Reliable tests should pass individually and in the suite without relying on a fresh browser for every fixture.

## API Coverage

**glimmer-motion/test-support**: `isMotionIdle`, `whatIsBusy`, `SettleOptions`, `animationsSettled`, `setupMotion`, `resetMotion`, `registerMotionReset`.

**glimmer-motion/choreo/test-support**: `setupChoreo`, `advanceGate`, `seekTo`.

Read the implementation: [`activity.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/activity.ts), [`test-support/index.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts), [`choreo/test-support/index.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts).
