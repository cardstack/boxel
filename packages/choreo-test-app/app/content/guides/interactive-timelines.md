# Writing a Timeline

A Choreo timeline describes the order of an interaction. Its steps select elements from the current changeset, so the same timeline can handle different items without naming each one in advance.

## Running Steps in Order

Let's extend the message region from the previous guide. Departing rows should fade out first, remaining rows should move, and new rows should appear last.

```gts title="A Message Timeline — Template Excerpt"
<c.Sequence>
  <c.Tween @of={{c.removed 'message'}} @opacity={{0}} @duration={{0.16}} />
  <c.Move @of={{c.kept 'message'}} @duration={{0.4}} />
  <c.Tween @of={{c.inserted 'message'}} @opacity={{array 0 1}} @duration={{0.2}} />
</c.Sequence>
```

Place this block inside the `Choreo` region and import `array` from `@ember/helper`. `Sequence` waits for each step's duration before starting the next. A removed participant stays available for its departure because the timeline names it.

You do not need a separate `Presence` wrapper for those Choreo participants. Choreo owns their leaving lifetime for this scene.

## Running Steps Together

Use `Parallel` when several steps belong to the same moment. A nested parallel block ends when its longest child ends.

```gts title="Overlapping Movement and Arrival"
<c.Sequence>
  <c.Tween @of={{c.removed 'message'}} @opacity={{0}} @duration={{0.16}} />
  <c.Parallel>
    <c.Move @of={{c.kept 'message'}} @duration={{0.4}} />
    <c.Tween @of={{c.inserted 'message'}} @opacity={{array 0 1}} @duration={{0.2}} />
  </c.Parallel>
</c.Sequence>
```

The remaining rows now move while arrivals fade in. The shorter fade finishes first; the sequence continues after the movement completes.

## Changing the Timing

Durations are expressed in seconds with `@duration`. Springs can determine their own settling time, so a sequence can wait for the actual motion rather than a duplicated delay in application code.

Keep the ordering in the timeline. Scheduling the next action with `setTimeout` creates a second clock that can drift when you change a duration, pause playback, or interrupt the interaction.

Try the [interrupt demo](/interrupt) to see a new state change arrive before the previous movement has completed. For the full step vocabulary, read the [construct reference](https://github.com/cardstack/choreo/blob/main/docs/choreo-constructs.md).

## Where to Go Deeper

Read the dedicated sequence, anchor, gate, property-step, and run guides before building a larger inspector. Each explains a different contract: how spans compose, how named overlap affects flow, how a presenter parks a build, and how a replacement run preserves continuity. These are separate concepts even though a short demo can use all of them in one template. Keep a concrete interaction as the example while learning the vocabulary, then inspect intermediate frames rather than judging only its settled appearance.
