# Holds, Waits, and Standing Steps

Some scene work is about keeping a condition true while other work happens. A card may need a higher stacking order during a flight, or a connector may remain attached while the scene is otherwise still. Choreo represents these lifetimes in the score so cleanup does not depend on a separate timer.

## Holding a Property

`c.Hold` applies properties for a window and releases them according to the hold's policy. Give it an explicit duration, or let it share the span of its containing block. A hold beside a move in a parallel block is a useful way to keep the moving subject above neighboring content until the flight ends.

```gts title="Component template excerpt"
<c.Parallel>
  <c.Move @of={{c.moved 'card'}} />
  <c.Hold @of={{c.moved 'card'}} @zIndex={{2}} />
</c.Parallel>
```

`@fill` changes whether the held values remain beyond the immediate window. Use it when the score deliberately owns a continuing value, and verify what replaces or releases that ownership. A property left behind accidentally is different from a camera pose or annotation intentionally standing at rest.

## Leaving Space in a Sequence

`c.Wait` creates an interval without a required subject. Its duration is in seconds. It is useful for reading time or a deliberate pause between automatic actions. A wait is still part of the run's clock, so pause, seek, and external transport remain coherent. Use a gate instead when progress depends on a person's next action.

## Understanding Standing Work

Open-ended steps can form a standing run: the annotation remains active until the score is replaced or canceled, without pretending to be an animation that is still traveling toward completion. `run.standing` distinguishes this condition. A standing wire or raised element is settled for interaction and testing purposes, even though the run continues to own its effect.

This distinction is important when a host waits before mounting expensive content. Waiting for an indefinitely standing annotation to finish would create a latch that never opens. The arming helper recognizes the relevant run lifecycle rather than treating every existing run as busy.

## Reviewing Cleanup

Test a hold's beginning, its tail, and the state after its surrounding region changes. For standing work, test replacement and destruction rather than waiting for a finite duration. Use `strandedTransforms()` carefully: a directed camera is expected to rest transformed, and a shared-layout follower can legitimately remain projected onto its lead. The useful question is whether every remaining value still has an owner, not whether every inline transform is empty.

## API Coverage

**ChoreoContext**: `c.Hold`, `c.Wait`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
