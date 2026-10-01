## What it is

One component that paints nine compiled ambient fields behind its content: `dot-grid` (the default), `line-grid`, `mesh`, `aurora`, `wave`, `beams`, `glow`, `stripes`, `grain`.

It is chrome, never content. The painted layer is `aria-hidden` and takes no pointer events, the caller gives the element its size, and the field fills whatever box it lands in and inherits that box's border radius. Yield content into it and the content sits above the paint.

Reach for it when a surface needs texture rather than an image. If you want a scrim over content, that is **Backdrop**; if you want a decorative shape that is part of the composition rather than behind it, that is not this.

## The contract

```
@variant?  — 'dot-grid' (default) | 'line-grid' | 'mesh' | 'aurora' | 'wave'
             | 'beams' | 'glow' | 'stripes' | 'grain'
@animated? — ambient motion; OFF by default
@scale?    — pattern size multiplier, clamped 0.25–4 (1 = the field's natural cell)
@speed?    — motion rate, clamped 0.05–6; ignored when @animated is false
@opacity?  — strength of the whole painted stack, 0–1
@hue?      — primary colour; any CSS colour or a token reference
@hue2?     — second colour: mesh, aurora, wave, beams, glow
@hue3?     — third colour: aurora, wave, mesh
@fade?     — 'none' | 'edges' | 'bottom' | 'top'
<:default> — content stacked above the field
```

**The arg is `@variant` rather than the obvious `field`, and that is a platform trap rather than a naming preference.** An `Args` key named `field` makes the realm's lint endpoint inject a phantom card-api `field` import and then fail on it.

**Motion is off by default.** A background is chrome, and chrome that moves by default is a tax on every card that renders one. `@speed` of zero or less also counts as off. **`grain` is exempt in the other direction**: it never animates, whatever `@animated` says, because honest film grain needs per-frame noise and a drifting static noise tile reads as sliding sandpaper.

**Every numeric arg is clamped and every colour goes through the kit's CSS guard**, so a rejected value drops its declaration and the field's own default stands.

**Each field renders exactly the layers it uses** — one for `grain`, two for the grids and `mesh`, three for `aurora` and `wave`. An unused empty layer is cheap but not free, and this is the component that sits under everything.

**The paint wrapper clips, not the root.** Layers are deliberately oversized so a drifting pattern never shows its own edge; clipping them on the wrapper rather than on the element means yielded content is never cut off.

**The overhang invariant is the non-obvious part.** A drifting layer travels `--pretui-field-dx/dy` and has to stay covered for the whole trip, so each axis overhangs by at least the unsigned drift distance — `max()` of that and 25%, not a sum, so a tall box does not pay twice. Without it a coarse tile in a short box walks its own edge into view near the end of its cycle.

## Prior art

Three upstreams, all of them catalogues rather than components: **react-bits' Backgrounds** category (Aurora, DotGrid, GridMotion, Waves, Particles, Silk, Topography and some fifty others), **cult-ui's** `bg-*` and `hero-*` families, and **fancy's** AnimatedGradientWithSvg.

Where Pretui is better: **one import and one arg instead of a component per effect**, and **colour from theme tokens instead of hardcoded palettes**, so a season restyles every ambient surface in the product at once. Motion is compositor-driven with no animation frame loop, and `prefers-reduced-motion` lands on the base rule — which *is* the resting state, so a reduced-motion reader gets a still, deliberate field rather than a frozen midpoint of a loop.

Where it is thinner, and the cuts were deliberate: **the shader and particle cohort is gone** — react-bits' Ballpit, MetaBalls and LiquidEther and cult-ui's shader heroes need a rendering engine, and this component owns none. **The mouse-follow variants are gone**, because a background that tracks the cursor cannot be screenshotted honestly. And nine fields is not fifty-five: the CSS-drivable subset covers the gradient, grid, wave and glow families, and anything outside it is not here at all.

## Accessibility

- **The paint layer is `aria-hidden` and `pointer-events: none`.** It contributes nothing to the accessibility tree and cannot intercept a click meant for the content above it. That is the whole accessibility design, and it is the right one: this is decoration.
- **`prefers-reduced-motion` stops every field.** Because the base rule is the resting state rather than frame zero of a keyframe, the still frame is composed rather than arbitrary.
- **Contrast is the caller's problem, and it is a real one.** Text yielded over `mesh`, `aurora` or `glow` sits on a gradient whose luminance varies across the box, so a contrast ratio measured at one point does not hold at another. `@opacity` and `@fade` are the levers; neither is checked, and nothing warns.
- **The field carries no name and no role**, so a surface whose *meaning* is partly carried by its texture — a status conveyed by which field is painted — is conveying it invisibly.

## Theming

Caller-facing: `--pretui-field-scale`, `--pretui-field-opacity`, `--pretui-field-speed`, `--pretui-field-hue`, `--pretui-field-hue-2`, `--pretui-field-hue-3` — each written by the matching arg after its guard.

Derived on the element: `--pretui-field-cell` (22px × scale) and `--pretui-field-tile` (120px × scale), the two sizes every field's geometry is built from.

Per-layer internals, set by the field rules rather than by callers: `--pretui-field-o0` / `--pretui-field-o1` (layer opacity), `--pretui-field-fx0` / `--pretui-field-fy0` / `--pretui-field-fx1` / `--pretui-field-fy1` (offsets), `--pretui-field-r0` / `--pretui-field-r1` (rotation), `--pretui-field-s0` / `--pretui-field-s1` (scale), `--pretui-field-dx` / `--pretui-field-dy` with `--pretui-field-over-x` / `--pretui-field-over-y` (drift and its matching overhang).

Hue defaults are per field — the `--chart-*` channel for the pattern fields, `--foreground` for `grain` — so a season that retunes its chart palette retunes every ambient surface with it, and a season that changes `--foreground` changes the grain's weight in both light and dark without touching this component.
