# Named Anchors and Overlap

Sequential order is sufficient until an action needs to begin during another action or after a named group somewhere earlier in the score. `at()` and `after()` express those relationships without duplicating durations. They let a timing edit propagate through the composition while preserving the intended overlap.

## Referring to a Named Span

Give a step or block a unique `@name`. `at(name, progress)` refers to a fraction of that span; `after(name, delay)` refers to its end plus an optional delay in seconds. These helpers return an `AnchorRef`, which a step accepts through `@at`.

```gts title="Component template excerpt"
import { at, after } from '@cardstack/choreo';

<template>
  <c.Sequence>
    <c.Move @name='flight' @of={{c.received}} @spring={{response}} />
    <c.Tween
      @at={{at 'flight' 0.7}}
      @of={{c.inserted 'label'}}
      @opacity={{array 0 1}}
      @duration={{0.2}}
    />
    <c.Tween
      @at={{after 'flight' 0.1}}
      @of={{c.id 'status'}}
      @opacity={{1}}
      @duration={{0.15}}
    />
  </c.Sequence>
</template>
```

This excerpt belongs inside a Choreo scope. The label begins while the flight is approaching its destination; the status follows shortly after the flight finishes. Neither step needs to know whether the flight uses a short tween or a longer spring.

## Understanding Flow

An anchored node does not advance its parent's sequential cursor in the usual way. It has its own scheduled start. Its end still contributes to the total duration, so an overlapping action can make the run longer than the last unanchored action. The same rule applies to a named parallel or sequence block.

Anchors point to previously declared names. A forward reference is a compile error, as is a duplicate name in the same timeline tree. Keep names meaningful and stable. A reusable composite should derive internal names from its own public name so two instances do not collide.

## Editing With Confidence

When adjusting overlap, evaluate the reason for the relationship. A label may need to wait until its subject is recognizable, rather than simply starting at a visually fashionable percentage. Compare the composition at several speeds and with the subject traveling different distances.

Use the build-order demo to inspect the relationship between names, starts, delays, and durations. For tests, verify a moment before the anchor, a moment during its work, and the final state. This exposes a misplaced anchor that a completion-only assertion would miss. Keep all duration values in seconds at the template boundary; custom node authors must convert to the compiler's milliseconds with `toMs()`.

## API Coverage

**@cardstack/choreo**: `AnchorRef`, `after`, `at`.

Read the implementation: [`anchors.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/anchors.ts).
