## What it is

A gradient sheen sweeping across text: `background-clip: text` over an animated two-layer gradient, on a pure-CSS infinite loop.

It is the kit's waiting-state voice for text — a pending lot, an in-flight job, a value still resolving. For a block-shaped placeholder rather than live text, that is **Skeleton**.

## The contract

```
@text (required) — the text to shimmer
@duration?       — seconds per sweep; a non-positive value is floored
@spread?         — sheen half-width, in px per character of text
```

**`@spread` is per character, not absolute.** The sheen is sized to the length of the text, so a short label and a long sentence get a proportionate sweep instead of the same physical band crossing one in a flash and the other over several seconds.

**The text itself is rendered, not chopped.** Unlike the per-character effects in this module, the sheen is a background over a single text node — which is why this one needs no screen-reader mirror.

**A non-positive duration is floored** rather than producing a zero-length animation.

## Prior art

**motion-primitives' TextShimmer** and **ShimmerWave**, plus **react-bits**.

Where Pretui is better: **the colours ride the token channel** — `--muted-foreground` for the base and `--foreground` for the sheen — rather than being a hardcoded gradient. So a shimmer in a dark season shimmers correctly without anyone restating the gradient, and a shimmering label sits at the same weight as the static labels around it. The sweep is also a pure CSS loop with no JavaScript driving it.

Where it is thinner: one sweep direction, no pause, no finite repeat count, and no way to shimmer anything but a text string — a shimmering row or card needs **Skeleton** instead. There is no wave variant either; motion-primitives' ShimmerWave animates per character, and this does not.

## Accessibility

- **The text is real text in the document**, announced normally. The shimmer is a background treatment, so there is nothing to hide and nothing to mirror.
- **Reduced motion collapses it to the resolved state.** The base styles are the end state, so stopping the animation leaves legible text in the base colour rather than a frozen gradient mid-sweep.
- **The shimmer conveys "waiting" visually and only visually.** A screen-reader user is told nothing by it. If the pending state matters — and for an in-flight job it usually does — it needs saying in text or in a live region; this component will not do it for you.
- **Contrast moves during the sweep.** The base is `--muted-foreground`, which is the lower-contrast end, so text that only just passes at rest passes for less of the cycle. Shimmer is for transient states, not for body copy.

## Theming

`--pretui-shimmer-duration` (seconds per sweep, from `@duration`) and `--pretui-shimmer-spread` (the sheen half-width, from `@spread`), over `--muted-foreground` and `--foreground` for the two gradient stops.

Because both colours are theme tokens rather than literals, a season retunes every shimmer in the product by retuning its foreground pair — and the sheen is always the brighter of the two, so the effect reads the same way in light and dark without a second definition.
