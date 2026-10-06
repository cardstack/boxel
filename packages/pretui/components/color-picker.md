## What it is

A colour picker built around a real colour engine: a gradient area, per-channel sliders, a text readout, and a gamut check that can tell you a colour is **not showable** and what the nearest one is.

That last part is what separates it from every picker that just gives you a swatch. Use it wherever a colour is being chosen rather than merely displayed — for display alone, **Swatch** or **SwatchChip**.

## The contract

```
@value?, @defaultValue?  — controlled / uncontrolled; any CSS colour string
@space?, @defaultSpace?  — the channel model shown: srgb | p3 | rec2020 |
                           oklch | oklab | hsl | hsv
@gamut?                  — the gamut colours are checked and clamped against. Default sRGB
@format?                 — emitted string shape: 'auto' (hex for RGB-ish models,
                           the space's own CSS function otherwise) | 'hex' | 'css'
@noAlpha?                — hide the alpha slider and drop alpha from the value
@lockSpace?              — hide the space switcher, locking the model to @space
@lockGamut?              — hide the gamut switcher; the gamut READOUT always stays
@resolution?             — area paint resolution
@disabled?
@onValueChange?, @onSpaceChange?
```

**Space and gamut are different things, and keeping them apart is the design.** OKLCH is a _space_; sRGB is also a _gamut_. Conflating the two is why most pickers cannot tell you that a colour is unshowable — they only ever work in coordinates the display can render, so the question never arises.

**`@lockGamut` hides the switcher but never the readout.** You can stop someone changing the target gamut; you cannot stop them being told their colour falls outside it.

**Out-of-gamut is reported in full**: which gamut it is outside, the nearest showable colour as hex, and the ΔE distance to it — plus a control to take that nearest colour.

**`@format='auto'` emits hex for the RGB-ish models and the space's own CSS function otherwise**, so an OKLCH selection round-trips as `oklch(...)` rather than being flattened to hex on the way out.

## Prior art

**`wa-color-picker`**, and boxel-ui's own ColorPicker.

Where Pretui is better: **the gamut model.** Neither upstream has one. A colour picked in OKLCH can be outside sRGB — perfectly valid, and invisible on most displays — and a picker that silently clamps it has lied about what was chosen. This one names the condition, quantifies it with ΔE, and offers the correction rather than applying it.

Seven spaces including two perceptual ones is also well beyond either upstream's RGB/HSL pair.

Where it is thinner: no palette or recent-colours memory, no eyedropper on browsers without the API, no contrast checking against a second colour — which is the obvious next thing for a design-system picker — and no named-colour input beyond what the engine parses.

**The catalog row and spec disagree with this file.** Both describe the component as _"Wrapped boxel-ui ColorPicker: native input + hex · runtime reuse"_, with `buildsOn: boxel-ui ColorPicker`. Nothing here wraps boxel-ui's picker: the colour engine, the gamut model and the seven channel models are this component's own, so the row and the spec want correcting.

## Accessibility

- **The text readout is a labelled input** with `aria-invalid` reflecting whether the typed value parses, and a visible "Not a colour" message beside it — so a bad paste is reported rather than silently ignored.
- **The tools are named buttons** — "Pick a colour from the screen", "Copy colour value" — rather than icon-only controls with no accessible name.
- **The preview chip and the gamut swatch are `aria-hidden`.** Both restate a value that is already text beside them.
- **Out-of-gamut is text, not a colour cue.** The warning names the gamut, the nearest hex and the ΔE, so the condition is perceivable without seeing the difference — which is the point, since by definition the display cannot show it.
- **The area is a two-dimensional control**, and it is the part to check most carefully in any picker: a gradient surface that is pointer-only excludes keyboard users from the primary interaction.
- **Colour cannot be the only channel here**, by the nature of the component — which is why the readout carries the value as text at all times.

## Theming

`--pretui-picker-width`, `--pretui-picker-preview` (the readout's current colour), `--pretui-picker-clamped` (the nearest-showable colour in the gamut warning), plus the control tokens it reaches through its parts: `--pretui-slider-track`, `--pretui-slider-thumb`, `--pretui-slider-h` for the channel sliders (defined in `channel-slider.gts`), `--pretui-area-x` / `--pretui-area-y` / `--pretui-area-thumb-size` / `--pretui-area-thumb-color` / `--pretui-area-thumb-ink` / `--pretui-area-ratio` for the gradient area (defined in `color-area.gts`), `--pretui-swatch-color` and `--pretui-checker` for the previews, and `--pretui-destructive-ink` for the invalid state.

Sharing the slider and area tokens with **ChannelSlider**, **ColorArea** and **GradientEditor** is what keeps the colour tools reading as one family: a season that retunes a thumb retunes every colour control at once, rather than leaving the picker and the gradient editor visibly different.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
