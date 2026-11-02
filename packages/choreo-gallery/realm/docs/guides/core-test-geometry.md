# Testing Geometry, Identity, and Cleanup

A moving interface can reach the correct endpoint while stretching its text, flashing an old skin, or losing pointer input during the journey. Geometry and ownership assertions make those failures observable. The test-support helpers account for the way QUnit positions its fixture and the way Choreo temporarily retains departing elements.

## Measuring the Fixture

`bounds(element)` returns the element's rectangle relative to the test container. A raw viewport rectangle includes QUnit's own placement, which can change as the runner executes. `shape(element)` composes the linear transform through ancestors, and `boundsAndShape()` combines both views.

```ts title="Component logic excerpt"
import {
  animationsSettled,
  bounds,
  live,
  shape,
} from 'glimmer-motion/test-support';

await animationsSettled();
const card = live('[role="article"]');
assert.ok(card);
assert.strictEqual(bounds(card!).width, 240);
assert.deepEqual(shape(card!), { a: 1, b: 0, c: 0, d: 1 });
```

Use expected dimensions appropriate to the fixture. A shape assertion is useful when the contract says text must not be stretched by an ancestor's layout scale. Reading only the child's inline transform cannot detect all inherited distortion.

## Selecting the Live Representation

While an exit plays, a leaver can stay on screen as a memory: the copy a `<Presence @mode="snapshot">` fades, or a departing skin in a Choreo orphan layer, which can share an identity with the arriving live element. A memory is inert, so a click the test sends it does nothing, and its box is where the old scene stood. Its test hooks carry a suffix, so a selector made of test hooks, such as `[data-test-card]`, finds only the live element, and a test that means the leaver names it as `[data-test-card-memory]`. Any other selector, such as a class, a role or a tag, can match the memory too, and a bare querySelector may answer with it first. `live()` and `liveAll()`, from `glimmer-motion/test-support` and re-exported by `@cardstack/choreo/test-support`, skip memories for those selectors.

A raised participant is still live and should remain eligible. This is why excluding every element outside its original DOM position would be incorrect. Test the interaction through the same usable representation a person should see.

## Inspecting Motion and Cleanup

`velocityOf()` samples movement over frames when momentum is part of the contract. The Choreo invariants come from `@cardstack/choreo/test-support`: `orphanCount()` reports retained departing elements, and `strandedTransforms()` looks for unexplained transforms left after settlement. Some resting transforms are legitimate: a camera can remain zoomed, and a shared-layout follower can remain projected onto its active lead.

Use these helpers at meaningful phases. Measure just before interruption, immediately after the new pass, and after settlement. A final orphan count of zero does not prove that the first arriving frame was correct, just as a good midpoint does not prove teardown succeeded.

## Testing the Real Space

Include an external scale and a clipped parent in fixtures for spatial or elevated movement. Check scroll containers independently from the window. Reproduce expanded content sizes so a layout policy that works for a square card does not silently fail for a tall editor. Small focused fixtures make the failed invariant clear, while a gallery soak can then check that the same rules survive realistic repeated interaction.

## API Coverage

**glimmer-motion/test-support**: `Box`, `bounds`, `shape`, `boundsAndShape`, `live`, `liveAll`, `velocityOf`.

**@cardstack/choreo/test-support**: `orphanCount`, `live`, `liveAll`, `strandedTransforms`.

Read the implementation: [`test-support/index.ts`](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts), [`choreo/test-support/index.ts`](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts).

---

[← Testing Time, Gates, and Settlement](core-test-timing) · [All guides](README) · [Reordering a Wrapped Grid →](core-reorder-grid)
