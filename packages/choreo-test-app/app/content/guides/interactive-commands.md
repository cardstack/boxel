# Perform Commands and Backward Folding

A guided demo needs to do more than move a cursor. It must open the panel, select the mode, or change the data that illustrates the narration. `c.Perform` places semantic application commands on the timeline, and the host implements their meaning through the region's dispatcher.

## Declaring a Command

A perform step has an action and optional target and payload. It occupies an instant positioned by sequence order, delay, or an anchor. The region calls `@onPerform` when the clock includes the command.

```gts title="Component template excerpt"
<Choreo @onPerform={{this.dispatch}} @onPerformReset={{this.reset}} as |c|>
  {{! The demo's real controls and state are rendered here. }}
  <c.Sequence>
    <c.Perform @action='mockup.mode' @payload='3d' />
    <c.Wait @duration={{0.5}} />
    <c.Perform @action='app.open' @target='mail' />
  </c.Sequence>
</Choreo>
```

The action names in this example are application-defined. Choreo does not have built-in knowledge of mail or mockup modes. The dispatcher validates the command and changes the same state that the real controls use, so a guided action and a manual action have the same outcome.

## Designing Idempotent Actions

Prefer commands that state a desired result: open a named panel, select a mode, set a value. Avoid toggles or increments whose outcome depends on how many times they were dispatched. `PerformCommand` carries the semantic request, but the host owns the state it changes.

During forward playback, newly eligible commands are dispatched. Seeking backward invokes the reset handler and replays the remaining prefix in order. This fold reconstructs the state appropriate to the requested time. It requires reset to restore every commanded field to its known baseline; resetting only the most visible field can leave a later panel or selection behind.

## Separating Reversible State From Side Effects

A replayable command is appropriate for local demo state. It is not automatically appropriate for sending a message, charging a card, or performing an external write. Those effects cannot be undone by resetting a component and replaying the prefix. Keep the tour dispatcher limited to the application's reversible demonstration actions.

Test direct seeks to moments after several commands, then seek backward and forward again. Compare the actual expanded interface, not just the cursor position. A cursor animation can remain on time while the underlying demo failed to activate. The fold and playhead demos show why the system treats commands as a state reconstruction problem rather than simulated clicks fired from independent timers.

## API Coverage

**@cardstack/choreo**: `PerformCommand`.

**ChoreoContext**: `c.Perform`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
