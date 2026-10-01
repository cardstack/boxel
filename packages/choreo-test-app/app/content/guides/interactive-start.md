# Understanding a Choreo Scene

Interactive Choreo coordinates changes across a region of your interface. A user changes application state, Glimmer renders the result, and Choreo describes how the elements get from the previous layout to the new one.

This is useful when several movements need to agree. An inbox might remove a message, move the remaining rows, and then reveal a confirmation. Each part belongs to the same interaction.

## Motivation

As an interface grows, an action can change several places at once. Removing a message might move its neighbors, update an archive count, and reveal a confirmation. Independently timed animations can make that single action feel disconnected.

Interactive Choreo lets you describe the relationship between those changes. Use it when order, shared identity, or movement between regions becomes part of the product's behavior.

## Learning Goals

By the end of this section, you will be able to:

- Identify participants and select inserted, removed, and kept elements.
- Express an interaction as sequential and overlapping steps.
- Move an item toward a destination without changing the destination's identity.
- Coordinate a transfer between regions in the same render pass.
- Keep the interface responsive when another action interrupts the first.

## Participating in a Scene

Wrap the region in `Choreo`. Give each participating motion element an `id` for identity and a `role` for selection.

```gts title="A Message Region — Template Excerpt"
<Choreo as |c|>
  {{#each @messages key="id" as |message|}}
    <article {{motion id=message.id role='message'}}>
      {{message.subject}}
    </article>
  {{/each}}

  <c.Move @of={{c.kept 'message'}} @duration={{0.4}} />
</Choreo>
```

Import `Choreo` and `motion` from `glimmer-motion` in the component containing this excerpt. The parent supplies messages with stable IDs. When the list changes, the kept messages move from their previous bounds to their new positions.

## Reading the Changeset

Choreo compares the participating elements before and after a render pass. That comparison is the **changeset**.

- `c.inserted 'message'` selects messages that arrived.
- `c.removed 'message'` selects messages that left.
- `c.kept 'message'` selects messages present in both layouts.

A role names a group; an ID names an individual. Neither replaces your application data. Your component still decides which messages exist and what they contain.

## Choosing the Right Scope

Use a single modifier for an independent element and layout animation for a simple position change. Reach for Choreo when ordering or relationships between elements become part of the interaction.

The [sequence demo](/sequence) makes that ordering visible. Continue with [Writing a Timeline](/docs/interactive-timelines) to connect departures, movement, and arrivals.

## API Coverage

**glimmer-motion**: `ChoreoContext`, `Choreo`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
