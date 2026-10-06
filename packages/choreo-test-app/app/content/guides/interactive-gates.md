# Gates, Advance, and Retreat

A presentation often needs to wait for a person rather than proceed after a fixed number of seconds. `c.Gate` marks that boundary in the same score that owns the animation. The run can park on a complete visual state, advance on input, and retreat through authored builds without creating another timer system.

## Waiting at a Build Boundary

Put a gate inside a sequence after the steps that should complete before the next action. Bind `c.advance` to a button or keyboard action. A gate with `@delay` opens automatically after its delay, which is useful for a build that normally advances itself but can still be controlled by the presenter.

```gts title="Component template excerpt"
<c.Sequence>
  <c.Tween @of={{c.id 'title'}} @opacity={{array 0 1}} @duration={{0.3}} />
  <c.Gate />
  <c.Move @of={{c.moved 'card'}} />
  <c.Gate @delay={{0.8}} />
</c.Sequence>
```

A gate is a total-order boundary. The compiler rejects gates under a parallel context because the meaning of parking only one branch would be ambiguous. Put parallel visual work between gates instead.

## Advancing and Going Back

Advancing during an active segment completes that segment's authored values and parks at the next boundary. It does not skip its final state. `run.segment` and `run.parked` expose the transport state for a build inspector. A parked run is considered settled because no movement is in flight while it waits.

`run.retreat()` moves back through a gate-bounded score and holds the resulting state. Its boolean result tells the host whether there was a prior build to return to; a presentation can then decide whether to move to an earlier slide. Do not confuse retreat within a run with undoing application data. If the visual transition came from a state change, reversing that data change produces a new changeset and a new run.

## Designing the Controls

Give next and previous actions consistent semantics. A fast second click should complete the current build before moving beyond it, and focus should stay on a usable control. The presentation and build-order demos are useful examples because their controls edit or advance a live score.

Test parked states with `animationsSettled()` and use `advanceGate()` where a test intentionally releases a build. Also test advancing during movement and retreating from the tail. An abandoned run may have released removed content, so a host should not assume a transport operation can resurrect every destroyed application component. Keep the visual build model and the data lifecycle explicit.

## API Coverage

**@cardstack/choreo**: `GateNode`.

**ChoreoContext**: `c.Gate`, `c.advance`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
