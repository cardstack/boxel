# Changesets, Sprites, and Queries

A Choreo timeline describes the response to a render pass. Its input is a changeset, not a list of arbitrary DOM selectors. Understanding that input makes the rest of the vocabulary easier to use: a step names the participants it cares about and the compiler resolves their measured state.

## Reading the Changeset

A `Sprite` represents a participant in the transition. It carries an identity, a role, measured initial and final bounds, and the relationship to a counterpart when two elements represent the same identity. `Bounds` exposes coordinate spaces; `Rect` is the basic rectangle representation. A `Changeset` gathers these participants and supports the queries used by steps.

`c.inserted`, `c.removed`, and `c.kept` select by participation across the pass. `c.moved` and `c.still` distinguish kept participants whose measured bounds changed from those whose bounds did not. `c.all` includes the broader set. Each selector can narrow by role, while `c.id()` and `c.role()` identify a particular subject or semantic group.

```gts title="Component template excerpt"
<c.Sequence>
  <c.Tween @of={{c.removed 'detail'}} @opacity={{0}} @duration={{0.16}} />
  <c.Move @of={{c.moved 'card'}} />
  <c.Tween @of={{c.inserted 'detail'}} @opacity={{array 0 1}} @duration={{0.2}} />
</c.Sequence>
```

This fragment assumes a yielded Choreo context and an imported `array` helper. Its selectors describe the render's meaning: departing details fade, displaced cards move, and arriving details appear. They do not depend on the cards' current CSS selectors or the order in which event handlers happened to run.

## Identity Across Replacement

`c.received` selects the receiving side of a claimed identity. `c.counterpart` selects the departing skin associated with that match. This distinction matters when a new component instance replaces an old one while representing the same item. A kept DOM node and a counterpart pair are different implementations of continuity, and the timeline can treat them differently.

Use `c.onstage(query)` to narrow work to subjects visible to the relevant viewport. It is useful for a page crossing with many offscreen participants, but visibility filtering should not determine essential application state. A command that must happen regardless of scrolling belongs to the host's state model.

## Avoiding Ambiguity

Give each logical subject a stable identity and use roles for choreography categories. Do not reuse an identity for unrelated objects just because a morph looks attractive. Conversely, changing identity on every render prevents the system from recognizing continuity. When debugging, enable the region's debug view and inspect which participants were inserted, removed, kept, or received before changing timing values.

## API Coverage

**@cardstack/choreo**: `Changeset`, `Bounds`, `Query`, `Sprite`.

**ChoreoContext**: `c.all`, `c.counterpart`, `c.id`, `c.inserted`, `c.kept`, `c.moved`, `c.onstage`, `c.received`, `c.removed`, `c.role`, `c.still`.

Read the implementation: [`changeset.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/changeset.ts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
