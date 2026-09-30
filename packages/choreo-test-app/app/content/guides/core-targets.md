# Targets, Styles, and Property Ownership

An animated element has two kinds of values: the state it currently exposes and the destination it is moving toward. Keeping those responsibilities separate prevents a common integration bug in which a Glimmer render erases a transform that Motion just applied. This chapter explains the small typed helpers that establish that boundary.

## Declaring a Destination

`to()` returns a typed Motion target. It does not schedule work by itself. Pass the result to `initial`, `animate`, `exit`, or a gesture target on the `motion` modifier. A target may include several properties, and changing tracked state can select a different target without replacing the element. The helper's value is type checking: an accidental property name is easier to catch than it is with a general-purpose hash.

```gts title="Component template excerpt"
import { motion, to, styles, perValue, spring, tween } from 'glimmer-motion';

const arrival = perValue({
  opacity: tween({ duration: 0.18 }),
  y: spring({ stiffness: 280, damping: 28 }),
});

<template>
  <article
    {{motion
      initial=(to opacity=0 y=16)
      animate=(to opacity=1 y=0)
      transition=arrival
      style=(styles borderRadius='14px')
    }}
  >Ready to review</article>
</template>
```

Here, position uses a spring while opacity uses a short tween. `perValue()` builds the transition object that assigns those different rules. Its `default` entry can cover properties that do not have an explicit entry. Keep reusable transition objects at module scope so the example expresses a design decision rather than constructing a new configuration throughout the template.

## Supplying Present Values

`styles()` describes values the element has now. A number or string is applied as style; a MotionValue is bound so the renderer can update it without a Glimmer render on every frame. This makes `styles()` suitable for a dragged position, scroll-derived opacity, or a CSS custom property. It is not another spelling of an animation target.

Give Motion every value it must correct during layout projection. In particular, a border radius declared only in a stylesheet cannot be corrected against the scale of a resizing layout animation. Static class rules can still define typography, colors, and ordinary layout, but a bound `style` attribute on the same animated element competes with the modifier's inline styles.

When debugging, first check ownership. If state changes correctly but movement disappears, look for a second writer of the transform or style attribute. If motion works but corners stretch, check whether the radius was declared through the modifier. These are different failures and need different fixes.

## API Coverage

**glimmer-motion**: `perValue`, `styles`, `to`.

Read the implementation: [`helpers.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts).
