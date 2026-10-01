## What it is

Text set along an SVG path — a circle, an arc, a wave, or a path you supply — optionally travelling around it.

At rest this is a **layout** capability rather than motion. It lives in the motion territory because that is where the catalog files it.

## The contract

```
@text (required) — the string to set along the path; it is the SVG's accessible name
@shape?          — which path. Default 'circle'
@path?           — SVG path data for @shape='custom'; validated against an allowlist,
                   and anything unrecognised falls back to the circle
@size?           — the square viewBox edge. Default 240
@radius?         — circle / arc radius. Default 40% of size
@amplitude?      — wave height. Default 12% of size
@offset?         — where along the path the text starts, in percent. Default 0
@repeat?         — repeat the string around the path. Default 1
@separator?      — what separates the repeats. Default a spaced middot
@fontSize?       — glyph size in viewBox units. Default 6% of size
@tracking?       — extra tracking in viewBox units
@fill?           — fill colour; goes through the kit's cssValue allowlist
@travel?         — rotate the whole ring. OFF by default
@revolution?     — seconds for one full turn. Default 14
@direction?      — 'cw' (default) | 'ccw'
```

**It uses `textPath`, so the glyphs keep real shaping** — kerning, ligatures, the actual typeface — rather than being individually positioned characters.

**`@size` sets the coordinate space, not the rendered size.** The SVG scales to its box; `@size` only decides what units the geometry is expressed in.

**A custom `@path` is validated against an allowlist** and falls back to the circle rather than being written through.

**`@travel` defaults to off, and that is a rule rather than a preference.** Rotation reads as "something is ongoing". It is honoured only for the closed shapes, and when it is on it must be paired with a text affordance saying *what* is ongoing — it is never the only carrier of that fact.

## Prior art

**react-bits' CircularText** and **CurvedLoop**, **fancy's TextAlongPath**, and **motion-primitives' SpinningText**.

Where Pretui is better: **the ring has an accessible name and the glyphs are presentation**, so a string repeated three times around a circle is read once rather than three times — which is exactly what the upstream components get wrong, because repeating the text is how they fill the path. The custom path is also validated rather than interpolated, and `@travel` is off by default where every upstream spins by default.

Where it is thinner: four shapes plus an allowlisted custom path, no per-glyph effects, no text that reflows to fit the path automatically — if the string is longer than the path it overruns — and no vertical or 3D variants.

## Accessibility

- **The SVG is `role='img'` with `aria-label` from `@text`.** The glyphs themselves are presentation, which is what stops a repeated ring being announced several times.
- **`@travel` is the borderline case and it is legislated rather than left to taste.** Off by default; on only where rotating is truthful; and never the sole indication that something is ongoing, because a screen-reader user cannot perceive rotation at all.
- **Reduced motion lands on the end state** — a still ring — rather than a frozen midpoint of a revolution.
- **Curved text is harder to read for everyone**, and substantially harder with dyslexia or low vision. Keep it short and never put anything a reader must act on in it.
- **`@repeat` repeats the visual only.** The accessible name stays the single string.

## Theming

`--pretui-pathtext-fill` (from `@fill`, through the CSS guard) and `--pretui-pathtext-revolution` (from `@revolution`).

Everything else is geometry expressed in viewBox units and passed as args, because a ring's proportions belong to the composition rather than to the season. The fill defaults to `currentColor`'s context, so a ring inherits the ink of whatever it sits in and a season needs to do nothing.
