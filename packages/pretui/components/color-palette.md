## What it is

A grid of **Swatch**es with one selected. Use it where the choice is from a curated set — theme accents, category colours, a chart palette, label colours. If the user needs an arbitrary colour, use **ColorPicker**, or compose the two (this deliberately does not bundle a custom-colour input). If the choice is not a colour, **RadioGroup** or **SegmentedControl**.

## The contract

```
@colors, @value?, @onValueChange?
Element: HTMLDivElement
```

**`@value` is matched case-insensitively**, as boxel-ui does. That is a small mercy with a real cause: hex values arrive from CSS, from JSON, from a designer's paste, and `#E3474C` and `#e3474c` are the same colour. A case-sensitive match here would produce a palette with nothing selected and no error.

**The custom-colour input is deliberately not bundled.** boxel-ui's `color-palette` includes one; this does not. Compose **ColorPicker** beside it when you need both, so a palette stays a palette and a picker stays a picker.

## Prior art

**React Spectrum `ColorSwatchPicker`** is the closest — `value`/`defaultValue`/`onChange`, `layout` (`grid`/`stack`), `size`, `rounding` — and it is built on `ListBox` semantics. **Web Awesome** folds swatches into `wa-color-picker` as a `swatches` prop rather than shipping a standalone grid. **Radix** has none.

Where Pretui is thinner than Spectrum: no layout axis, no size axis, and — importantly — **no `ColorSwatchPicker.Item` equivalent**, so a swatch cannot carry extra content (a name, a usage count) alongside its colour.

Where the composition-over-bundling choice pays off: boxel-ui's palette-with-input is one component doing two jobs, and the input's dress and validation are then the palette's problem. Keeping them separate means **ColorPicker** can be improved without touching the palette, and a caller who only needs a fixed set does not ship a colour input.

## Accessibility

No APG pattern for a colour grid specifically; the applicable models are **Radio Group** (single choice from a set) or **Listbox** (single-select option list). Spectrum uses the listbox model.

Pretui uses `role="group"` with `aria-label="Color palette"` around a set of **Swatch** buttons, and that is the component's central accessibility gap: **`role="group"` is not a selection widget.**

Concretely:

- **A `role="group"` of `aria-pressed` buttons does not express single-choice selection.** Each Swatch announces as an independent toggle button, so a screen-reader user is told several buttons are pressed-or-not with nothing indicating that choosing one deselects the others, and no set position ("3 of 12"). The correct shape is `role="radiogroup"` with `role="radio"` + `aria-checked` on each swatch, or `role="listbox"` with `role="option"` + `aria-selected`. This is the same class of error **SegmentedControl** has, and the fix is the same shape.
- **Every swatch is its own tab stop.** A twelve-colour palette is twelve tab stops. Both correct models are single-tab-stop widgets with roving focus and arrow-key navigation; there is none here.
- **No arrow-key navigation** in either axis, which for a *grid* of swatches means Left/Right/Up/Down should all move.
- **`aria-label="Color palette"` is hardcoded**, so two palettes on a page are announced identically and neither says what it colours.
- **Swatch's own gaps compound here**: a swatch's accessible name comes from an optional `@label`, so a palette of unnamed hex values announces as a row of hex strings. Colour is the entire content, and the label is the only channel for it — **WCAG 1.4.1** makes naming the colours effectively mandatory, not optional.
- **The selection change is not announced.**
- Target size: palette swatches are conventionally small; check against WCAG **2.5.8**'s 24×24 minimum.

None of this makes the component unusable — every swatch is reachable and operable by keyboard — but it does mean a palette is announced as a pile of toggle buttons rather than as a choice.

## Theming

**Swatch**'s tokens throughout: `--card` (the ring gap and hairline backdrop), `--border` (hairline), `--primary` or `--pretui-selected` (selection ring), plus the grid's own gap.

The grid columns and gap are fixed. Because Swatch's selection ring gap is `--card`, a palette placed on `--canvas` or `--inset` shows ring gaps in the wrong colour — the same placement assumption **Swatch** and **AvatarGroup** both make. Keep palettes on card surfaces, or expect to override.
