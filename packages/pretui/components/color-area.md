## What it is

The two-channel picking plane of a colour tool: a gradient surface where one axis is one channel and the other is another, with a thumb you can move by pointer or by keyboard.

It is a building block of **ColorPicker**. Reach for it when composing a colour tool.

## The contract

```
@color (required)  — the current colour
@gamut (required)  — the gamut the plane is painted and clamped against
@resolution?       — paint resolution. 96 is ~10ms; 128 is ~36ms and visibly crisper
                     on a large picker
@disabled?
@onChange (required) — fires as the colour moves
@onCommit?           — fires once when a gesture ends
```

**`@resolution` is a real performance knob with a documented cost.** The plane is painted per render, and the two numbers in the contract are measurements rather than guesses — a large picker earns the crisper paint, a small one does not.

**The gamut is an argument, not an assumption.** The plane is painted for the gamut it is told about, so a colour outside it is visibly outside rather than silently clamped into the surface.

**`@onChange` and `@onCommit` split continuous movement from gesture end**, the same way **ChannelSlider** does.

## Prior art

**hdr-color-input's area picker.**

Where Pretui is better: the accessibility model below, and the gamut being explicit rather than implicit.

Where it is thinner: no zoom into a region of the plane, no alternate channel pairings beyond what the picker's space provides, and no touch-specific magnifier — a fingertip covers the thumb it is moving.

## Accessibility

**A 2D control cannot be one slider, and this is the component where that matters most.** A single `role='slider'` has one value; a plane has two, and announcing a colour as one number is meaningless.

- **The plane is a `role='group'`** containing **two named sliders**, one per axis, each with its own label and its own value text. That is the only arrangement that lets a keyboard user move in both dimensions and be told where they are in each.
- **Each axis announces a sentence**, not a coordinate.
- **The painted surface itself is `aria-hidden`**, as is the thumb — they are the visual expression of two values that are already announced.
- **Keyboard movement is per axis**, which is what the two-slider model buys: arrows move one channel at a time, deliberately, rather than dragging a point around a plane.
- **A picking plane is the hardest part of any colour tool to use without sight**, and this arrangement does not make it easy — it makes it *possible*, which no single-slider or canvas-only implementation does.

## Theming

`--pretui-area-x` and `--pretui-area-y` (the thumb's position), `--pretui-area-thumb-size`, `--pretui-area-thumb-color` and `--pretui-area-thumb-ink`, `--pretui-area-ratio` (the plane's shape).

Splitting the thumb's fill from its ink is what keeps it visible over the whole plane: the thumb sits on every colour the surface can show, so a season sets a ring and a contrasting core rather than one colour that will disappear somewhere on the gradient.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
