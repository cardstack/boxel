# The Run and Interruption

Every compiled Choreo pass produces a run. The run is the concrete object a transport can pause, seek, advance, or cancel. It is also temporary: a new render pass may replace it, so an application should not assume one captured run remains the scene's owner indefinitely.

## Reading and Driving Time

The context exposes `c.run`, which can be null between passes. A live run has a duration, a settable time in seconds, and a playback speed. Pause before assigning an explicit time when you want a stable inspection frame. Use play to resume its clock and cancel to relinquish the current work.

```ts title="Component logic excerpt"
import type { ChoreoRun } from 'glimmer-motion';

function inspect(run: ChoreoRun, seconds: number) {
  run.pause();
  run.time = Math.min(seconds, run.duration);
}
```

The gate-specific controls include advance, retreat, segment, and parked. Standing work is identified separately from a finite animation in flight. A timeline editor should expose these distinctions rather than treating every run as a video with an unconditional finite tail.

## Preserving Continuity

When a render changes the destination during movement, the replacement pass measures the visible state and constructs a new response. A spring can inherit velocity where the model supports it. The application should update its state promptly instead of waiting for the old animation to finish before accepting the next input.

Choreo also preserves a continuing flight when a conditional score disappears and the replacement score no longer explicitly names that moving participant. This protects an interrupted subject from snapping to rest. It does not mean every unnamed reflow automatically animates; layout that was not part of an active flight remains outside the score unless selected.

## Understanding Finished

The `finished` promise is useful for lifecycle work, but a resolved old run does not prove the region has no successor. Read the current region when coordinating a whole interaction, or use the arming helper that follows replacements. For a player, supply a provider that returns currently owned runs rather than keeping a stale array forever.

## Testing the Middle

Final-state checks are necessary but insufficient. Test position before interruption, immediately after the replacement, and at settlement. Use `velocityOf()` when the contract concerns momentum, and use `live()` when a counterpart skin might otherwise satisfy a selector. Then check orphan cleanup and stranded transforms after the run ends.

The key invariant is that state changes remain responsive while the visual explanation stays continuous. A transport that disables all input until finished may make a recording look stable, but it avoids the interaction model rather than validating it.

## API Coverage

**glimmer-motion**: `ChoreoRun`.

**ChoreoContext**: `c.run`.

Read the implementation: [`run.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/run.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
