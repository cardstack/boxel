---
name: motion-scroll
description: >-
  Scroll-linked and viewport-triggered animation: parallax, scroll progress
  bars, reveal-on-scroll, hide-on-scroll headers, in-view triggers. Use when
  motion is driven by scroll position or by an element entering the
  viewport.
---

# Scroll-driven motion

Two questions, two tools:

**"Where is the scroll?"** — `scrollProgress()` returns motion values for
position/progress; bind them through `style=(styles …)`:

```ts
import { scrollProgress } from 'glimmer-motion';
// container, target, and offsets (['start end', 'end start'] etc.) supported
const { scrollYProgress } = scrollProgress({ target: el, offset: ['start end', 'end start'] });
```

Feed a motion value through a transform for parallax (`parallax.gts`), or
into a scaleX for a progress bar. The lower-level `scroll()` /
`scrollInfo()` from motion-dom are exported too, and use the native
ScrollTimeline where the browser has one.

**"Is it on screen?"** — `InView` (a tracked `isInView`) or the `whileInView`
prop with `viewport` options (`root`, `margin`, `amount`, `once`):

```gts
<section {{motion initial=(to opacity=0 y=24) whileInView=(to opacity=1 y=0)
  viewport=(hash once=true amount=0.4)}} />
```

`useScroll` / `useInView` still exist as deprecated aliases — don't write
new code against them.

## Judgment calls

- Reveal-on-scroll wants `once=true` almost always; repeating reveals read
  as noise on the way back up.
- A hide-on-scroll header is direction, not position: track the delta sign
  (see `hide-header.gts`), animate `y`, and keep the show-threshold smaller
  than the hide-threshold so it doesn't flicker at rest.
- Parallax layers should stay subtle (single-digit % offsets) and must not
  create their own scroll height — transform, never top/margin.
- Scroll-linked values bypass `transition` entirely — the scrubbing IS the
  timing. Don't wrap them in springs unless you want lag on purpose
  (sometimes you do: smoothed parallax).

Canonical demos: `parallax.gts`, `reveal.gts`, `hide-header.gts`.
