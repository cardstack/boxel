# Tween and Spring Steps

Choreo's property steps let a scene describe visual changes across participants selected by the current render pass. `c.Tween` and `c.Spring` share the idea of a subject and target properties, but use different timing models. They complement `c.Move`, which derives movement from measured layout changes.

## Selecting the Subject

Use `@of` with a query such as inserted details, removed labels, or a particular identity. Supply target properties as flat component arguments. A property can be a value, a keyframe array, or a function that receives the sprite and changeset. `PropSource` and `PropValue` describe that authored boundary.

```gts title="Component template excerpt"
<c.Parallel>
  <c.Tween @of={{c.removed 'label'}} @opacity={{0}} @duration={{0.16}} />
  <c.Spring @of={{c.inserted 'badge'}} @scale={{array 0.8 1}}
    @spring={{response}} />
</c.Parallel>
```

A tween takes `@duration` and `@ease`. A spring takes `@spring` and has a duration resolved by the engine. Springs accept two keyframes rather than an arbitrary multi-point itinerary. Use a tween for a pulse or a deliberate round trip through several authored values.

## Calculating a Target

A property function can use the measurements captured by the pass. This is useful when a value depends on another participant's destination, but remains a target calculated for the step. If a value must continuously follow a moving source every frame, use `c.Follow` and its constrained derived context instead.

Keep property functions stable and pure. Do not allocate a new closure on every score collection merely to return the same value, and do not write tracked state or measure the live DOM while compiling a target. Those actions create feedback between the render and the animation it is trying to describe.

## Timing and Delivery

Property steps accept the common timing controls: name, anchor, delay, and stagger. Text delivery can subdivide work by word, character, or paragraph; it has its own guide because its slot timing and cleanup deserve explicit attention. Repetition is useful for emphasis but should have a deliberate ownership boundary if it can run indefinitely.

Review both selected and unselected participants. A query that accidentally includes every kept element can animate unrelated content and make the scene feel slower. A removed element must remain available for the exit interval and be released afterward. Verify this with the presence of real controls during the transition and an orphan-count assertion after settlement, not just a screenshot of the final frame.

## API Coverage

**glimmer-motion**: `PropSource`, `PropValue`.

**ChoreoContext**: `c.Spring`, `c.Tween`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
