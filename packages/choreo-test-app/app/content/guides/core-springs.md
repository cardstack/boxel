# Spring Transitions

A spring is useful when an interface can change direction while it is moving. Instead of treating every input as a new timed clip, the engine moves toward the latest target with a response shaped by the spring configuration. This is why a card can feel connected to a hand even when the user changes their mind.

## Choosing the Response

Import `spring()` from `glimmer-motion`. Its result works both as a modifier transition and as the `@spring` argument of a Choreo step. The helper accepts physical parameters such as stiffness, damping, and mass, or a perceived-duration configuration using `visualDuration` and `bounce`. Choose a coherent configuration instead of combining controls without knowing which representation the engine will resolve.

```ts title="Component logic excerpt"
import { spring } from 'glimmer-motion';

const responsive = spring({ stiffness: 300, damping: 30 });
const expressive = spring({ visualDuration: 0.45, bounce: 0.25 });
```

Stiffness changes how strongly the object is pulled toward its target. Damping changes how quickly oscillation is removed. Mass changes the response to the same force. `restDelta` and `restSpeed` define when the remaining distance and velocity are small enough to count as finished. They affect completion, which matters when another step waits for the spring.

## Connecting a Spring to State

Pass a target selected by application state to `animate`, and pass the spring to `transition`. For a coordinated layout change, use the same configuration on `c.Move`. Choreo obtains the spring's duration from the engine when it compiles the timeline, so a following step does not need a guessed timeout. A multi-point emphasis sequence should use a tween: a spring accepts a start and target rather than an arbitrary itinerary of keyframes.

Test the response by interrupting it. Click the next target before the object arrives, then reverse again. Watch position and velocity, not just the final frame. The interruption demo makes this comparison visible: a spring can preserve momentum while a newly started tween has a different continuity model.

## Tuning Without Hiding the Problem

The playground's native spring editor makes bounce and duration easier to feel. Keep the original configuration available for comparison, and test at normal speed after using slow motion. A slow preview is a diagnostic tool, not evidence that the normal interaction is comfortable. Honor reduced motion and keep essential state changes readable even when large spatial movement is suppressed.

Finally, distinguish an analytically sampled animation from a live simulation. A pointer-following spring with continually changing input depends on that input history. Deterministic film rendering needs a defined clock-based path or a controlled reconstruction of the simulation, not merely the same spring parameters.

## API Coverage

**glimmer-motion**: `SpringSpec`, `SpringArgs`, `spring`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`helpers.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts).
