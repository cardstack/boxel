## What it is

A gradient editor: a bar of colour stops you can add, move, recolour and remove, with an explicit interpolation colour space.

## The contract

```
@value?, @defaultValue? — the gradient spec
@disabled?
@lockInterpolation?     — hide the interpolation-space control
@onValueChange?

<:bar> — replaces the built-in stop bar; yields a GradientBarApi
```

**The interpolation space is part of the value, not a rendering detail.** The same stops interpolated through sRGB and through OKLCH produce visibly different gradients — sRGB goes grey through the middle of a complementary pair, OKLCH does not — so a gradient that does not record its space is a gradient that cannot be reproduced.

**`@lockInterpolation` hides the control, not the property.** A product that has decided on one space stops offering the choice; the value still carries it.

**`<:bar>` yields an API rather than expecting the caller to reimplement stop maths.**

## Prior art

**figui3's fill picker**, and **CSS Images 4** for the interpolation model.

Where Pretui is better: the interpolation space is first-class. Most gradient editors emit stops and let CSS decide, which means the preview and the shipped gradient can differ; carrying the space through makes what you see what you get.

Where it is thinner: linear gradients only in the stop model — no radial or conic authoring — no easing or midpoint hints between stops, which CSS supports, and no gradient library or presets.

## Accessibility

- **Each stop is a **ColorStopEditor**, which carries its own trigger, name and remove control** — so the bar is a set of named controls rather than a canvas of draggable dots.
- **The gradient preview is presentation.** The value lives in the stops, each of which is separately reachable and announced.
- **Editing a gradient without sight is possible but not pleasant**, and honesty matters here: the component gives every stop a keyboard path, and the *result* is still a visual artefact that cannot be perceived from its parts.
- **`@lockInterpolation` removes a control**, which reduces what a reader has to travel through when the choice is not theirs to make.

## Theming

`--pretui-gradient-preview` and `--pretui-gradient-preview-h` (the preview band and its height), `--pretui-stop-color` and `--pretui-stop-x` (each stop's swatch and position), over the shared `--pretui-checker` and the colour module's slider tokens.

Keeping the preview height as its own token lets a season give a gradient editor a taller band than a colour field's swatch without either component knowing about the other — the preview is the thing being edited here, and it deserves the room.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
