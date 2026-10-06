## What it is

A seamless drifting strip of repeated content: logos, tags, a ticker of names. The content is rendered twice and the track loops, so the join is invisible.

## The contract

```
@speed?        — drift speed in px/s. Default 60
@direction?    — 'left' (default) | 'right'
@pauseOnHover? — pause the loop while the pointer is over the strip

<:default> — strip content, rendered twice for the seamless loop
```

**`@speed` is a rate in pixels per second, not a duration.** That is the difference that makes a marquee usable: a strip of three logos and a strip of thirty drift at the same visual pace, where a fixed duration would make the long one a blur.

**The content is rendered twice**, and the second copy is `aria-hidden`. The loop translates by exactly one copy's width, so the wrap is seamless without measuring anything.

**`@pauseOnHover` is a CSS `:hover` rule**, not a listener — no pointer bindings anywhere.

## Prior art

**fancy's SimpleMarquee** and **AlongSvgPath**, and **motion-primitives' InfiniteSlider**.

Where Pretui is better: the rate is content-independent, and the duplicate copy is hidden from assistive technology rather than being announced twice — which is the defect most marquee implementations ship with, because duplicating the DOM is the easy part and remembering what it does to a screen reader is not.

Where it is thinner: horizontal only, no vertical marquee, no path-following variant (fancy's AlongSvgPath), no gradient mask at the edges, and no pause on focus — only on hover, which means a keyboard user tabbing into a link inside the strip is chasing a moving target.

## Accessibility

- **The second copy is `aria-hidden`**, so the content is announced once rather than twice.
- **Motion that never stops is a WCAG 2.2.2 problem.** A marquee running for more than five seconds needs a way to pause it, and `@pauseOnHover` is not that: it is pointer-only and it does not persist. If the strip carries anything a reader needs, this component does not currently give them a way to stop it.
- **Focusable content inside a moving strip is hard to use.** There is no pause on focus, so tabbing to a link in a marquee moves it under the reader. Prefer non-interactive content in the strip.
- **Reduced motion should stop the drift.** The resting state is the strip at its start position, which is a complete, readable first copy.
- **Nothing is conveyed by the movement.** It is texture.

## Theming

`--pretui-marquee-duration` (derived from `@speed` and the content's width) and `--pretui-marquee-gap` (the space between repeats).

There are no colour tokens — the strip inherits everything from context, which is what lets a marquee of logos sit on any surface without restyling. The gap token is the one thing a season tunes, and it is what keeps a logo strip's rhythm consistent with the spacing scale around it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
