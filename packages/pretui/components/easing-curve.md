## What it is

A cubic-bezier editor: two draggable control points over a curve, four numeric fields, a preset picker and a travelling preview dot.

## The contract

```
@value?, @defaultValue? — the four cubic-bezier control-point coordinates
@presets?    — render the preset picker. Default true
@fields?     — render the four numeric fields. Default true
@preview?    — render the travelling preview dot. Default true
@previewDuration? — preview duration in ms. Default 1200
@precision?  — decimal places. Default 2
@label?, @disabled?
@onInput?, @onChange?
```

**The four fields are the exact-value path, and they are what make the two draggable handles an enhancement rather than the only way to author a curve.** That is stated in the source as the reason they default on, and it is the right framing for every direct-manipulation control in this territory.

**`@precision` defaults to 2 because CSS authors write two.** `cubic-bezier(0.23, 1, 0.32, 1)` is the shape of the value people copy in and out.

**The preview is a dot travelling the curve**, not a graph annotation — the only way to see what an easing actually feels like.

## Prior art

The cubic-bezier editors on the web, and figui3's.

Where Pretui is better: the fields being a default rather than an advanced toggle, and the preview being part of the component rather than a separate demo.

Where it is thinner: only cubic-bezier — no `linear()`, no springs, no steps — and no curve library beyond the presets.

## Accessibility

- **The handles are **Handle** buttons**, so the curve is adjustable by arrow keys.
- **The four fields are the precise path**, and turning them off leaves a control that can only be authored by drag.
- **The presets are real controls**, which matters more than usual here: for most readers a named preset is the answer, and it should be reachable first.
- **The preview is a moving dot conveying timing**, which is inherently visual — a reader who cannot see it gets the numbers, which is why the fields matter.
- **`@preview={{false}}` and reduced motion** should both stop the dot; a looping animation in a property panel is the definition of decoration that repeats.

## Theming

The curve and handles take the kit's control and accent tokens; the preview dot uses the accent.

Nothing is separately themeable, which keeps an easing editor looking like the property panel it sits in rather than like an embedded tool.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
