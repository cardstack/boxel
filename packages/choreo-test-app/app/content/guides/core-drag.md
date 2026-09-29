# Dragging, Constraints, and Momentum

Dragging makes a direct promise: the object under the pointer should respond in the coordinate system the user sees. The motion modifier provides the gesture and momentum machinery, while your application decides what the movement means. Start by choosing an axis, a boundary, and a release behavior before tuning the spring.

## Defining the Allowed Movement

`drag=true` enables both axes; an axis value restricts movement. `dragConstraints` can describe numeric bounds or refer to a containing element. The latter is useful when responsive layout determines the available space. `dragElastic` controls movement beyond a boundary, and `dragDirectionLock` lets an initially free gesture settle onto one axis.

```gts title="Component template excerpt"
import { motion, inertia } from 'glimmer-motion';

const release = inertia({
  power: 0.28,
  bounceStiffness: 300,
  bounceDamping: 30,
});

<template>
  <div
    {{motion drag='x' dragTransition=release dragConstraints=this.track}}
  >Slide</div>
</template>
```

The example assumes `this.track` has been filled with the containing DOM element. Capture it through a modifier or an existing reference rather than querying a fragile global selector. Measure the actual responsive track, including the size of the dragged item, when testing the allowed travel.

## Choosing the Release

Momentum is enabled by the drag system unless the configuration disables it. `dragMomentum=false` stops the throw, while `dragSnapToOrigin` expresses a return to the starting position. The `inertia()` helper describes the release transition: power and time constant affect the projection, bounds constrain it, and bounce parameters govern a boundary response. A `modifyTarget` function can adjust the projected resting target when the application has discrete valid positions.

Use `onDragStart`, `onDrag`, and `onDragEnd` for meaningful host decisions. Avoid a state write on every sample if a MotionValue can carry the visual position. A drag-end callback may select a resting slot or dispatch a reorder, but the visible flight should keep its current pose and velocity when the engine takes over.

## Interaction Details

`whileDrag` supplies feedback while the gesture is active. Pan callbacks observe movement without necessarily moving the element, which is useful when a gesture controls something else. Make touch behavior intentional with appropriate `touch-action` styling, and keep a keyboard alternative for actions that would otherwise require dragging.

If the object moves twice as far as the pointer under a scaled parent, the release curve is not the issue. Correct the pointer coordinates using the transform helpers described in the next guide. Check fast flicks, boundary pulls, cancellation, and a second interaction before the first release has settled.

## API Coverage

**glimmer-motion**: `GestureRef`, `InertiaArgs`, `inertia`.

**ChoreoContext**: `c.gesture`.

Read the implementation: [`gesture.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/gesture.ts), [`helpers.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
