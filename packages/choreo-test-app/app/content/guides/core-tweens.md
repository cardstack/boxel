# Tweens, Easing, and Keyframes

A tween is the appropriate tool when the journey has a known duration. A notification fading in, an SVG stroke being drawn, or a title passing through a deliberate sequence of values benefits from predictable timing. This chapter covers the `tween()` and `ease()` helpers and explains how to keep that timing readable in a template.

## Starting With Two Values

A basic tween moves from the current or initial value to a destination over `duration` seconds. Supply `ease` to describe progress through that interval. Named easings are strings; `ease(x1, y1, x2, y2)` creates a cubic Bézier tuple for a custom curve. Easing changes progress along the journey, while duration changes how much time the journey receives.

```gts title="Component template excerpt"
import { motion, to, tween, ease } from 'glimmer-motion';

const reveal = tween({ duration: 0.4, ease: ease(0.4, 0, 0.1, 1) });

<template>
  <div
    {{motion initial=(to opacity=0) animate=(to opacity=1) transition=reveal}}
  >Saved</div>
</template>
```

For an emphasis effect, a target can contain a keyframe array that returns to its starting value. A scale sequence such as `[1, 1.06, 1]` produces a pulse without changing the resting size. Optional `times` places the intermediate values along the normalized timeline. Keep the number and ordering of those positions consistent with the authored keyframes.

## Repetition and Completion

`repeat`, `repeatDelay`, and `repeatType` describe what happens after a pass. A reverse repetition returns along the animation; a loop restarts it. Decide whether the effect needs a finite completion before putting it into a larger interaction. An intentionally endless ambient loop should not be something a test waits to finish, and it should not accidentally determine when a guided tour advances.

Use `perValue()` when opacity and movement need different timing. A short opacity tween can accompany a longer positional spring without making the fade bounce. For Choreo property steps, `c.Tween` exposes duration and easing directly; the principle is the same even though the template vocabulary is different.

## Evaluating the Result

Compare the first frame, an intermediate frame, and the settled state. A tween that looks correct at the end may still reveal content too early or obscure a control during its useful interval. Then interrupt the transition to understand its restart behavior. If changing direction must retain physical momentum, revisit the spring chapter rather than trying to hide the discontinuity with a longer duration.

For recorded output, a timed keyframe path is particularly useful because its state can be sampled at an explicit time. Keep any accompanying application commands on the same declared timeline so the visual sequence and the interface state agree after a backward seek.

## Cosine Easing Functions

`easeIn`, `easeOut`, and `easeInAndOut` are exported cosine-based easing functions that accept normalized progress and return eased progress. Pass the function itself to a compatible Choreo `@ease` argument. They are distinct from the `ease()` helper, which constructs a four-number Bézier tuple. The raised cosine has zero slope at both ends; use it when that response is the authored intent rather than assuming every easing with a similar name has identical mathematics.

## API Coverage

**glimmer-motion**: `easeIn`, `easeInAndOut`, `easeOut`, `Easing`, `TweenArgs`, `ease`, `tween`.

Read the implementation: [`easings.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/easings.ts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`helpers.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts).
