# Testing Geometry, Identity, and Cleanup

A moving interface can reach the correct endpoint while stretching its text, flashing an old skin, or losing pointer input during the journey. Geometry and ownership assertions make those failures observable. The test-support helpers account for the way QUnit positions its fixture and the way Choreo temporarily retains departing elements.

## Measuring the Fixture

`bounds(element)` returns the element's rectangle relative to the test container. A raw viewport rectangle includes QUnit's own placement, which can change as the runner executes. `shape(element)` composes the linear transform through ancestors, and `boundsAndShape()` combines both views.

```ts title="Component logic excerpt"
import {
  bounds,
  shape,
  live,
  animationsSettled,
} from 'glimmer-motion/test-support';

await animationsSettled();
const card = live('[data-test-card]');
assert.ok(card);
assert.strictEqual(bounds(card!).width, 240);
assert.deepEqual(shape(card!), { a: 1, b: 0, c: 0, d: 1 });
```

Use expected dimensions appropriate to the fixture. A shape assertion is useful when the contract says text must not be stretched by an ancestor's layout scale. Reading only the child's inline transform cannot detect all inherited distortion.

## Selecting the Live Representation

During a crossing, a departing counterpart can share an identity with the arriving live element. `live()` and `liveAll()` exclude elements in orphan layers. A bare querySelector may find the departing skin first, which can no longer respond to the click the test sends.

A raised participant is still live and should remain eligible. This is why excluding every element outside its original DOM position would be incorrect. Test the interaction through the same usable representation a person should see.

## Inspecting Motion and Cleanup

`velocityOf()` samples movement over frames when momentum is part of the contract. `orphanCount()` reports retained departing elements, and `strandedTransforms()` looks for unexplained transforms left after settlement. Some resting transforms are legitimate: a camera can remain zoomed, and a shared-layout follower can remain projected onto its active lead.

Use these helpers at meaningful phases. Measure just before interruption, immediately after the new pass, and after settlement. A final orphan count of zero does not prove that the first arriving frame was correct, just as a good midpoint does not prove teardown succeeded.

## Testing the Real Space

Include an external scale and a clipped parent in fixtures for spatial or elevated movement. Check scroll containers independently from the window. Reproduce expanded content sizes so a layout policy that works for a square card does not silently fail for a tall editor. Small focused fixtures make the failed invariant clear, while a gallery soak can then check that the same rules survive realistic repeated interaction.

## API Coverage

**glimmer-motion/test-support**: `Box`, `bounds`, `shape`, `boundsAndShape`, `velocityOf`, `orphanCount`, `live`, `liveAll`, `strandedTransforms`.

Read the implementation: [`index.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts).
