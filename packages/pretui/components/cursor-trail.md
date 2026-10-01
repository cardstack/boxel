## What it is

A fan of marks trailing the pointer across a surface: a head mark at the pointer and a tail of progressively smaller, fainter, slower ones behind it.

It is decoration with one saving grace — it has a keyboard path. The marker travels to a focused child, so the trail is not purely a pointer ornament.

## The contract

```
@count?       — number of trailing marks, 1–24. Default 6
@size?        — diameter of the head mark in px. Default 14
@lag?         — seconds the LAST mark takes to reach the pointer; the fan is
                linear from ~0.05s at the head to this. Default 0.42
@hue?         — any CSS colour for the marks; defaults to --primary
@shape?       — 'dot' (filled) | 'ring' (hairline) | 'square'
@seed?        — seed for deterministic per-mark size jitter; omit for an even fan
@followFocus? — move the marker to a focused child on focusin. Default true
@restX?, @restY? — resting origin as a fraction of the field. Default 0.5 each

<:default> — the live field the trail rides over; fully interactive
<:mark>    — replaces the default mark; yields { index, depth }, depth 0 at head, 1 at tail
```

**The fan is built from one lag value, not from N.** Each mark's delay interpolates linearly from about 0.05s at the head to `@lag` at the tail, so the shape of the trail is one number rather than a table.

**`@count` is clamped to 1–24.** A trail is an effect, not a particle system.

**The jitter is seeded and deterministic — there is no `Math.random` anywhere.** Omit `@seed` for a perfectly even fan; supply one and the same seed produces the same fan on every render, which is what keeps a card screenshottable.

**`<:mark>` yields depth as a 0–1 fraction**, so a custom mark can size, fade or rotate itself along the trail without knowing how many marks there are.

**The trail rides in a hidden layer over live content**, which stays fully interactive — the marks never intercept a pointer event.

## Prior art

**motion-primitives'** cursor effects and the same family in react-bits.

Where Pretui is better: **determinism and a focus path.** Upstream trails randomise their jitter per frame and are strictly pointer-driven; here the jitter is seeded and the marker follows focus, so the component means something to a keyboard user and produces the same picture twice.

Where it is thinner: no spring physics, no velocity-reactive sizing, no collision or field effects, and a hard cap of 24 marks. The lag fan is linear, with no easing curve across the trail.

## Accessibility

- **The whole trail layer is hidden from assistive technology.** It is ornament; announcing a run of marks would be noise.
- **`@followFocus` is the keyboard path**, and the reason to leave it on: turn it off only when the field's children have their own clear focus indicators, because otherwise you have removed the one non-pointer thing this component does.
- **The marks never take a pointer event.** Content underneath stays fully operable, which is the correctness property that matters most for an overlay effect.
- **This component conveys nothing.** There is no state, no affordance and no feedback in it — treat it as texture, and never as the only indication of anything.
- **Reduced motion should drop the trail to its resting origin.** With `@restX` and `@restY` at their defaults, that is the centre of the field.

## Theming

`--pretui-trail-size` (from `@size`), `--pretui-trail-hue` (from `@hue`), `--pretui-trail-dur` (from `@lag`), `--pretui-trail-scale` and `--pretui-trail-opacity` (the per-mark falloff), `--pretui-trail-radius` (the shape), plus the shared `--pretui-px` / `--pretui-py` pointer channel.

The falloff tokens are what make a season able to change the trail's character without touching the component: a season that wants a subtler trail lowers the opacity floor rather than reducing `@count` at every call site.
