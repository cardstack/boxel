## What it is

A lightweight vote-and-tally block: a ballot of features, each with a vote button and a count, sorted by support.

## The contract

```
@features (required) — the ballot
@title?        — heading. Default 'What should we build next?'
@description?  — one line under the heading
@onVote?       — fires with the feature and the state the reader is asking for
@sort?         — 'votes' (default) sorts by tally, highest first, with the title
                 as a stable tiebreak; 'given' keeps the caller's order
@emptyMessage? — what an empty ballot says
```

**The component never mutates the tally.** `@onVote` fires with the feature and the state being *requested*; the caller owns the number, because the number lives on a server. A block that incremented its own count would be showing a number that is not true anywhere else.

**Sorting by votes uses the title as a stable tiebreak**, so two features on equal support do not swap places on every render.

## Prior art

**cult-ui's feature-voting and vote-tally.**

Where Pretui is better: the tally is not owned locally. The upstream increments in place, which reads well in a demo and is wrong the moment two people are looking at the same ballot. The stable tiebreak is the other difference — an unstable sort over equal counts makes a ballot jitter.

Where it is thinner: no vote limit or budget across the ballot, no per-feature state beyond voted/not, no comments or detail view, and no optimistic-update affordance — if the server is slow, the count does not move until the caller moves it.

## Accessibility

- **The block is a named region** taking its name from `@title`, so it can be found and skipped.
- **Each vote control is a toggle with `aria-pressed`**, which is the right semantic: voting is a state the reader is in, not an action they repeat.
- **Each button carries its own computed label**, so a row of vote buttons does not announce as "vote, vote, vote".
- **The count and the share bar are both `aria-hidden`**, because the count is already in the button's label — announcing it twice, once as a number and once inside the name, is noise.
- **The bar conveys share visually only**, and it is decoration over a number that is already text. Nothing depends on reading it.
- **The glyph is `aria-hidden` with `focusable='false'`.**

## Theming

The block rides the kit's shared surface, control and tone tokens rather than defining a token surface of its own — the vote button is a **Toggle**-shaped control and follows whatever the season does to pressed states, and the share bar takes the accent.

That is the right dependency for a block at this tier: a voting panel should look like the product it is embedded in, and a season that changes how "pressed" reads changes it here without anyone touching this component.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
