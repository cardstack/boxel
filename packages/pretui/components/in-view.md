## What it is

Entrance choreography that fires when content scrolls into view — a fade, a rise, a scale — optionally staggered across a list.

Use it to give a long page some rhythm. If you want to _defer the work_ rather than animate the arrival, that is **Defer**, and the two are often wanted together.

## The contract

```
@enter?      — preset: fade | rise | fall | scale | slide
@once?       — reveal once and disconnect the observer. Default true
@threshold?  — IntersectionObserver threshold, 0–1. Default 0.2
@rootMargin? — IntersectionObserver rootMargin, e.g. '0px 0px -12% 0px' to trip early
@stagger?    — seconds between consecutive children; only meaningful with @items
@duration?   — transition duration in seconds
@delay?      — seconds before the first child moves
@distance?   — travel distance in px for rise / fall / slide
@scale?      — start scale for the scale preset, 0–1
@items?      — a list to stagger; each entry renders through <:item>

<:default> — a single-block reveal
<:item>    — receives each entry and its index
```

**An IntersectionObserver inside a modifier flips one attribute; everything else is CSS.** The reveal is a transition and the stagger is a precomputed index × interval delay — no engine, no timers, and one style recalculation for the whole list rather than one per child.

**`@once` defaults to true and disconnects the observer** once revealed. Set it false only when you want content to re-hide on exit, which costs a live observer for the page's lifetime.

**The resting style is the finished state.** A still frame, a prerender, or a render with no JavaScript all show real content rather than a blank box. This is the property that makes the component safe to use above the fold.

## Prior art

**motion-primitives' InView** and **react-bits' AnimatedContent/ScrollReveal**.

Where Pretui is better: **the unrevealed state is not the default state.** Most scroll-reveal implementations start elements at `opacity: 0` in CSS and rely on JavaScript to turn them on, which means a prerender, a crawler, or a failed script leaves a blank page. Here the finished state is the base and the observer only adds choreography. The stagger is also computed once as delays rather than driven by a timeline.

Where it is thinner: five presets and no custom keyframes, no exit choreography distinct from the entrance, no per-item override, and no scroll-linked progress — the reveal is a threshold trip, not a scrubbed animation. `@items` yields untyped entries, so the item block is not type-safe.

## Accessibility

- **Content is present and announced before it is revealed.** Because the base style is the finished state, assistive technology never waits on the animation, and the text is in the accessibility tree from first paint.
- **Reduced motion should collapse every preset to its end state**, which costs nothing here since that state is already the base.
- **`@once={{false}}` re-hides content on exit**, which is the one configuration to be careful with: content that disappears when scrolled past can surprise a screen-magnifier user working at the edge of the viewport.
- **The reveal conveys nothing.** Nothing about state, order or importance should depend on it.
- **A stagger long enough to notice is long enough to annoy.** The delay accumulates across `@items`, so a long list with a generous `@stagger` leaves the last item moving well after the reader arrived at it.

## Theming

`--pretui-inview-duration` (from `@duration`), `--pretui-inview-delay` (from `@delay`), `--pretui-inview-stagger` (from `@stagger`), `--pretui-inview-i` (each child's index), `--pretui-inview-from` (the preset's starting transform), `--pretui-inview-display` and `--pretui-inview-item-display`, over the shared `--pretui-motion-distance` and `--pretui-motion-scale`.

Sharing the distance and scale tokens with the rest of the motion module is what keeps entrances consistent: a season that shortens travel shortens it for every entrance in the product at once, rather than per call site.
