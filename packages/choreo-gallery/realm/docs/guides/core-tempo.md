# Slow Motion and Playback Rate

Slow motion is useful for judging a transition, but there are two different controls that can produce it. The binding's global tempo scales transitions when they start. A Choreo run's speed changes a particular running clock. Confusing those controls can make a tuning panel appear to work while changing the wrong part of the experience.

::card[../../demos/path]

**Live example: Slow Motion and Playback Rate.** Change Time Scale and replay to inspect the stroke at the new tempo. [Open the demo](../../demos/path) to tune it with DialKit.

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

## Retiming What Is Already Running

A transition is read when an animation starts, so an edited `transition` whose target is unchanged waits for the next animation: a running spring keeps its old stiffness and an infinite loop keeps its old duration. That is the right rule for an application, and the wrong one for a tuning panel, where the edit is the thing being judged. `retime(root)` asks for the edit now. Call it after the render that delivered the new transitions.

```ts title="Component logic excerpt"
import { postRender, retime } from 'glimmer-motion';

// after writing the panel's values into tracked state
postRender(() => retime(stageElement));
```

Each element at or under `root` whose timing has changed since it mounted or was last retimed restarts the values still animating, toward the targets they already have, from where they stand. A value past its delay does not wait for it again. An infinite loop goes back to the same point of its turn, including which way a reversing loop is heading and any repeat delay, so it changes speed without a jump. A value that has finished stays where it settled, and an element whose timing is unchanged, or that is leaving, is not touched. Choreo needs no call: an edited timeline replaces its run, and the new run carries each ambient loop on from where it was. The gallery's lab does both on every edit, which is why moving a control changes a running demo at once.

## Preserving the Shape

`scaleTransition(transition, divisor)` provides the same calculation directly. Time-valued properties are multiplied, including per-value transition overrides. For a physical spring, mass and damping are adjusted so the response slows while retaining its shape. Simply multiplying an arbitrary spring duration would not express the same physical configuration.

Avoid applying the divisor twice. A Choreo step already passes through the library's timing path, so an editor should not also multiply its seconds before handing them to Choreo. Double scaling makes a requested five-times preview last twenty-five times as long and can hide a sequencing mistake behind apparently deliberate pauses.

## Controlling a Run

Use the run's `speed` or `choreo-player.setPlaybackRate()` when the requirement is to control an owned transport. That rate has the ordinary playback interpretation: a larger positive rate is faster. It belongs to a selected set of runs rather than every future transition in the document.

Restore global tempo when a temporary inspection tool is destroyed. Otherwise a demo opened later can inherit an unexplained slow response. Verify the normal-speed result after tuning and keep the user's reduced-motion preference separate from debugging tempo. One is an accessibility policy; the other is a temporary way to inspect the same authored motion more closely.

## API Coverage

**glimmer-motion**: `motionSpeed`, `onMotionSpeed`, `retime`, `scaleTransition`, `setMotionSpeed`.

Read the implementation: [`speed.ts`](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/speed.ts).

---

[← Page Transitions and Live Crossings](core-page-transitions) · [All guides](README) · [Host Adapters and the Render Pipeline →](core-host)
