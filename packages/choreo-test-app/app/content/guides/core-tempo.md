# Slow Motion and Playback Rate

Slow motion is useful for judging a transition, but there are two different controls that can produce it. The binding's global tempo scales transitions when they start. A Choreo run's speed changes a particular running clock. Confusing those controls can make a tuning panel appear to work while changing the wrong part of the experience.

## Scaling Future Transitions

`setMotionSpeed()` takes a duration divisor. A value of five makes newly started transitions take five times as long; one restores normal timing. Despite the name, a larger argument is slower. `motionSpeed()` returns the current divisor and `onMotionSpeed()` subscribes to changes.

```ts title="Component logic excerpt"
import { motionSpeed, onMotionSpeed, setMotionSpeed } from 'glimmer-motion';

const previous = motionSpeed();
const stop = onMotionSpeed((divisor) => console.log(divisor));
setMotionSpeed(5);
// Trigger the interaction being inspected.
// When this tuning session ends:
stop();
setMotionSpeed(previous);
```

The scale is applied before the engine receives a transition. It does not retime an animation that has already started. Replay the interaction after editing the setting if you want to compare its full response. The playground remounts a demo where necessary to provide that explicit replay boundary.

## Preserving the Shape

`scaleTransition(transition, divisor)` provides the same calculation directly. Time-valued properties are multiplied, including per-value transition overrides. For a physical spring, mass and damping are adjusted so the response slows while retaining its shape. Simply multiplying an arbitrary spring duration would not express the same physical configuration.

Avoid applying the divisor twice. A Choreo step already passes through the library's timing path, so an editor should not also multiply its seconds before handing them to Choreo. Double scaling makes a requested five-times preview last twenty-five times as long and can hide a sequencing mistake behind apparently deliberate pauses.

## Controlling a Run

Use the run's `speed` or `choreo-player.setPlaybackRate()` when the requirement is to control an owned transport. That rate has the ordinary playback interpretation: a larger positive rate is faster. It belongs to a selected set of runs rather than every future transition in the document.

Restore global tempo when a temporary inspection tool is destroyed. Otherwise a demo opened later can inherit an unexplained slow response. Verify the normal-speed result after tuning and keep the user's reduced-motion preference separate from debugging tempo. One is an accessibility policy; the other is a temporary way to inspect the same authored motion more closely.

## API Coverage

**glimmer-motion**: `motionSpeed`, `onMotionSpeed`, `scaleTransition`, `setMotionSpeed`.

Read the implementation: [`speed.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/speed.ts).
