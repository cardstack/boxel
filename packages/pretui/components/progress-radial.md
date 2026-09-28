## What it is

A ring showing completion as a filled arc. Same semantics as **ProgressBar**, different geometry: it is for places where a bar does not fit or where the progress is incidental to something else — beside an avatar, inside a table cell, in a dense toolbar. Reach for the bar when progress is the point and the radial when it is an annotation. For a _measurement_ within a range rather than progress, use **Meter**. For unknown duration, **Spinner**.

## The contract

```
@value: number   (required)
@max? (100), @size? (28)
```

Three args, and no label, count, or text of any kind — the ring is the whole component.

**The arc is a `conic-gradient`, and the hole is a pseudo-element.** No SVG, no `stroke-dasharray` arithmetic, no `viewBox`. The percentage rides a single custom property (`--pretui-radial-pct`) consumed as `calc(var(--pretui-radial-pct) * 1%)` in the gradient's colour stop, and `::after` paints a 70%-diameter disc of `--card` over the middle to make it a ring rather than a pie.

That has one consequence worth knowing: **the ring's hole is opaque `--card`.** Over any surface that is not `--card` — a `--canvas` panel, an `--inset` band, a striped table row — the centre will be a visible disc of the wrong colour. The SVG implementations everyone else uses are transparent in the middle. This is the cost of the CSS-only approach and it is not currently escapable through a token.

`@size` sets both dimensions inline and defaults to 28px — the kit's control height, so a radial lines up with a **Button** or **IconButton** without adjustment.

## Prior art

**Web Awesome `wa-progress-ring`** takes `value` and `label` and exposes `--size`, `--track-width`, `--track-color` and `--indicator-color` as custom properties, rendering an SVG with a `stroke-dasharray` arc. **Radix** has no ring. **React Spectrum `ProgressCircle`** has `value`, `size` (`S`/`M`/`L`), `isIndeterminate` and `staticColor`, and its indeterminate mode is the reason most people reach for it.

Pretui's version is the smallest possible implementation of the shape, and the `conic-gradient` route is genuinely elegant — one gradient, one pseudo-element, no geometry code, and the arc animates by changing a single number.

Where it is behind, plainly:

- **No indeterminate mode.** Spectrum's and Web Awesome's rings both spin when the duration is unknown; this one cannot.
- **No `--track-width` equivalent.** Ring thickness is fixed at 15% of the diameter by the `::after` margin, so a season cannot make it thinner or thicker.
- **No label.** Web Awesome renders text in the centre; here the hole is painted over, so centre content is impossible without changing the component.
- **The opaque hole** (above) — the SVG implementations do not have this problem.

## Accessibility

Governing role: `progressbar` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, plus `aria-valuetext` when the number needs units.

Gaps:

- **No accessible name at all.** There is no `@label` arg and no `aria-label`, so every radial on a page is announced as "progress bar, 60" with no subject. Since the component has no visible text either, a screen-reader user has no way to learn what it measures. This is the most serious gap and there is currently no way to fix it through the public API except by passing `aria-label` through `...attributes` — which works, and should be documented as required.
- **`aria-valuemin` is missing**; only `valuenow` and `valuemax` are set.
- **No `aria-valuetext`**, so "60" is announced where "60 percent uploaded" is meant.
- **No visible value.** A sighted user reads an arc and estimates. For anything where the number matters, pair it with text — and then that text is the thing to label it with.
- **No announcement on change**, and no live region.
- **The arc conveys its value by geometry and colour only.** With `--primary` against `--inset`, users with low vision at small `@size` values may not resolve the arc at all; 28px is small for a ring.
- No `forced-colors` handling — `conic-gradient` backgrounds are commonly flattened in Windows High Contrast mode, which can erase the arc entirely.

Practical guidance: treat this as decorative unless you pass `aria-label`, and prefer **ProgressBar** anywhere the value is the message.

## Theming

`--primary` (the arc), `--inset` (the track), `--card` (the hole). That is the whole set — and note the hole's dependence on `--card` described above.

The 15% ring thickness and the circular shape are fixed; `@size` is the only dimension knob and it is an arg rather than a token, so a season cannot set a default size. A season must keep `--primary` and `--inset` separable in luminance, since at 28px the arc is a few pixels wide and hue alone will not carry it.
