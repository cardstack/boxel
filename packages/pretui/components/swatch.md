## What it is

A round colour chip with a hairline, an optional label, and a selected ring. Use it to show or choose a single colour — in a **ColorPalette**, beside a theme token, as a legend key next to a chart series. If the user needs an arbitrary colour, **ColorPicker**. If the value is a category rather than a colour, **Chip** or **StatusChip**.

## The contract

```
@color, @label?, @selected?, @onSelect?
Element: HTMLButtonElement
```

**It is interactive only when `@onSelect` is given.** One component covers both the display case (a legend key) and the choice case (a palette cell), and the presence of a handler is what decides — no interactivity flag, no second component.

Two details that look cosmetic and are not:

**The hairline exists so light colours read against the card.** A white or pale-yellow swatch with no border is invisible on a white surface, and this is the failure every hand-rolled swatch grid ships.

**The selected ring sits *off* the chip, on a card-coloured gap.** A ring drawn directly on the chip's edge is unreadable against a similar-hued colour; inserting a gap of `--card` between the chip and the ring means the selection indicator works for every possible swatch colour, including one that matches the ring. That is the kind of detail that only shows up after you try it with a hundred colours.

## Prior art

**Web Awesome** has no swatch; `wa-color-picker` includes a swatches list as a prop. **React Spectrum `ColorSwatch`** is the closest named component — `color`, `size`, `rounding`, and a checkerboard behind transparent colours. **Radix** has none.

Where Spectrum is ahead: **the checkerboard.** A swatch showing a semi-transparent colour over a solid background lies about the colour; Spectrum renders a checker pattern behind it. This component has no transparency handling at all, so `rgba(255,0,0,0.2)` renders as pale pink over `--card` and is indistinguishable from an opaque pale pink. If your palette can contain alpha, that is a real correctness gap.

Where Pretui is ahead: **the off-chip selection ring** (above). Spectrum's selection indicator is a border, which has the contrast problem described. And the display/choice unification through `@onSelect` is a smaller API than Spectrum's separate `ColorSwatch` and `ColorSwatchPicker.Item`.

Missing versus both: no size axis, no shape option (always round), no drag-and-drop, and no "no colour" / null state.

## Accessibility

No APG pattern; a swatch is a toggle button or a coloured span.

What is right: it renders a real `<button>` with `aria-pressed` reflecting `@selected` and an `aria-label` — so a selected swatch announces as "Red, pressed" rather than as an unlabelled square. That is the correct treatment for a single swatch, and it is more than most implementations do.

Gaps:

- **The `aria-label` derives from `@label`, which is optional.** A Swatch with no `@label` falls back to something derived from the colour value — verify what it produces, because `#e3474c` announced as a hex string is nearly useless. A colour used as a choice must have a human name; if your palette has none, that is a data problem the component cannot fix.
- **It is always a `<button>`, even when non-interactive.** A Swatch with no `@onSelect` still renders a focusable button with `aria-pressed`, so a legend of twelve colours is twelve tab stops that do nothing. A non-interactive Swatch should be a `<span>` with `role="img"` and a label, or `aria-hidden` beside its own text. This is the clearest fix.
- **`aria-pressed` is the wrong vocabulary inside a `ColorPalette`.** A palette is a single-choice group, so `role="radio"` with `aria-checked`, or `role="option"` with `aria-selected`, describes it more accurately — `aria-pressed` says "this button is toggled on", which does not convey that choosing another deselects this one.
- **Colour is the entire content.** For users who cannot perceive the hue, the `aria-label` is the only information — which is why the label being optional matters. There is no secondary channel (a hex readout, a pattern) at all.
- **No contrast guarantee on the hairline.** The hairline is a fixed token; a swatch whose colour is close to `--border` has an invisible edge.
- **Target size**: check the chip's rendered diameter against WCAG **2.5.8**'s 24×24 minimum. Palette swatches are conventionally small.

## Theming

`--card` (the ring gap and the surface the hairline is designed to work against), `--border` (the hairline), `--primary` or `--pretui-selected` (the selection ring), `--muted-foreground` (the label), `--text-ui-sm`.

The chip diameter, hairline width and ring gap are fixed. Because the ring gap is `--card`, a Swatch placed on `--canvas` or `--inset` — inside an **EmptyState**, a table band, a striped row — will show a ring gap in the wrong colour, the same placement trap **AvatarGroup** has. The component assumes it sits on a card surface.
