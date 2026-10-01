# Accessibility and Testing

An animation should help someone understand a change. The interface must still make sense when movement is reduced, when someone uses the keyboard, or when an animation is interrupted.

## Respecting Reduced Motion

`MotionConfig` applies motion preferences to a subtree. The library honors the user's reduced-motion preference by default. You can make that policy explicit at your application boundary.

```gts title="Application Template Excerpt"
import { MotionConfig } from 'glimmer-motion';

<template>
  <MotionConfig @reducedMotion='user'>
    {{outlet}}
  </MotionConfig>
</template>
```

Test with the operating system's reduced-motion setting enabled. Check that buttons still respond, content remains visible, and instructions do not depend on following a moving object. Keep focus indicators and use semantic controls independently of the animation.

## Waiting for Motion

In a test, wait for the motion system to settle instead of guessing how long an animation takes. This keeps the test useful when a transition changes.

```gts title="tests/integration/components/moving-marker-test.gts"
import { click, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { MovingMarker } from 'my-app/components/moving-marker';

module('Moving marker', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the marker reaches its destination', async function (assert) {
    await render(<template><MovingMarker /></template>);
    await animationsSettled();
    const marker = this.element.querySelector('span')!;
    const before = marker.getBoundingClientRect().left;

    await click('button');
    await animationsSettled();

    const distance = marker.getBoundingClientRect().left - before;
    assert.true(Math.abs(distance - 120) < 1, 'the marker moved 120 pixels');
  });
});
```

Replace `my-app` with your application's module prefix. This example tests the marker from [Animating an Element](/docs/core-elements). For production components, add `data-test-*` attributes so test selectors remain stable as markup changes.

## Testing Interruptions

A completion test is only part of the behavior. Also trigger a second action while movement is in progress and verify the final application state. For Choreo scenes, `orphanCount()` and `strandedTransforms()` help detect leaving elements or transforms that were not cleaned up.

The [test-support reference](https://github.com/cardstack/choreo#test-support) describes the available assertions and inspection helpers.

## Choosing a Test Boundary

Use a small fixture when the question is about one invariant, such as a leaving item retaining its content or a card preserving velocity after interruption. Use the gallery when the question is whether those rules coexist under repeated real interactions. These checks complement each other: a gallery screenshot rarely explains which measurement rule failed, while a tiny fixture may not expose competition between several active renderers. The dedicated timing and geometry guides below explain the complete test-support surface, including gates, live-element selection, orphan cleanup, and transformed bounds. Keep those assertions tied to behavior a user can observe.

A passing endpoint assertion should accompany, rather than replace, checks of the intermediate behavior that motivated the animation.
