## What it is

Pick a number from a continuous range by dragging or arrowing a thumb along a track. Use it when the _approximate_ value matters more than the exact one and the range is bounded and meaningful — opacity, volume, a price ceiling, a confidence threshold. If the exact number matters, use **NumberInput** or **Stepper**, which let someone type it. If the range is unbounded, a slider is the wrong shape entirely. For a bounded _rating_ out of five, use **Rating**.

## The contract

```
@value?, @defaultValue?, @label?, @min? (0), @max? (100), @step? (1)
@ticks?: (string | number)[]
@onValueChange?(value: number)
```

Hybrid controlled/uncontrolled, the kit-wide idiom: `@value ?? @internal`, with `@internal` seeded from `@defaultValue ?? @min ?? 0` and written only when `@value === undefined`.

**It is a native `<input type="range">`.** That is the whole design. The filled portion of the track is a `linear-gradient` whose colour stop is driven by a single custom property — `--pretui-slider-pct`, computed as `(value - min) / (max - min) × 100%` and passed via `htmlSafe` inline style. No overlay div, no measured track, no drag handler.

`@ticks` is a decorative label row under the track, evenly distributed with `justify-content: space-between`. It does **not** snap; snapping is `@step`'s job. The two are independent, and passing ticks that do not correspond to step boundaries produces labels the thumb cannot land on — worth knowing.

## Prior art

**Radix `Slider`** composes `Root/Track/Range/Thumb`, models value as `number[]` for multi-thumb, and adds `onValueCommit` (fires on drag end, so you can defer an expensive update), `minStepsBetweenThumbs`, `orientation`, `inverted` and `dir`. **React Aria** renders a visually hidden `input[type=range]` per thumb and implements Home/End/PageUp/PageDown explicitly, with page size computed as `max(snapValueToStep((max-min)/10), step)` and Shift+Arrow mapped to a page step. **Web Awesome `wa-slider`** has `range` (two thumbs auto-labelled "(minimum value)"/"(maximum value)"), `with-markers`, `with-tooltip`, `tooltip-placement`, `indicator-offset`, and a property-only `valueFormatter: (v) => string` that feeds **both** the tooltip and `aria-valuetext`.

Pretui is the smallest by a wide margin, and honestly so: single thumb only, no tooltip, no `onValueCommit`, no vertical orientation, no formatter.

What it gets right that the composed implementations have to work for: because it is a real range input, the entire APG Slider keyboard contract — Arrow keys by step, Home to minimum, End to maximum, Page Up/Down by a larger increment — arrives from the browser, along with `role="slider"`, `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. Radix and React Aria both write that code. This is the same platform-first bet **RadioGroup** makes, and it pays off the same way.

The `@ticks` row is a genuine small improvement over Web Awesome's `with-markers`, which draws marks but not labels.

## Accessibility

Governing pattern: APG **Slider**, satisfied structurally by the native element: role, `aria-valuenow`/`min`/`max`, and the full key list including Page Up/Page Down, which most hand-rolled sliders omit.

Gaps:

- **`aria-label` defaults to the literal string `'Slider'`.** Two sliders on a page with no `@label` are both announced "Slider". Always pass `@label`.
- **No `aria-valuetext`.** The whole point of `valuetext` is that "70" is meaningless where "70 percent opacity" or "£70" is not, and it is the one thing Web Awesome's `valueFormatter` exists to feed. Pretui has no formatter arg and sets no `valuetext`, so every slider announces a bare number. This is the most valuable single addition to the component.
- **`@ticks` are not associated with the control.** They are a visual row; a screen-reader user hears the numbers as loose text adjacent to the slider.
- **`@label` is not a visible label** — it only becomes `aria-label`. A sighted user gets nothing unless the surrounding **Field** supplies one, and `Field`'s `<label for>` cannot bind here because Slider accepts no `@controlId`. Same API hole as RadioGroup.
- **`::-moz-range-thumb` is not styled.** Only `::-webkit-slider-thumb` is defined, so **in Firefox the thumb falls back to the UA default** — a different size, colour and shadow from every other browser. That is a real cross-browser defect, not just a polish issue, and it is a one-rule fix.
- **No `:focus-visible` treatment.** `outline-offset: 4px` is set, so the UA outline is at least given room, which is better than most controls in this kit — but nothing is painted deliberately.
- **Target size**: the 14px thumb is under WCAG 2.5.8's 24×24 minimum. The track is only 3px tall, so the pointer target is genuinely small.
- No `aria-orientation` is needed (horizontal is the default), and none is set — correct.

## Theming

`--primary` (filled track), `--line-strong` (remaining track and thumb hairline), `--card` (thumb fill), `--shadow-ink-mid` (thumb shadow), `--font-mono` and `--ink-3` (tick labels). The 3px track, 14px thumb, 2px radius and 10px tick type are fixed.

A season that sets `--card` close to `--line-strong` loses the thumb against the unfilled track — check the thumb at both ends of the range, not just the middle. And because the fill is a gradient stop rather than a separate element, a season cannot give the filled and unfilled halves different heights or radii without replacing the component.

## React ecosystem

**Range is already implemented** (`@range`, `@values`, `@onValuesChange`).
**RangeSlider** is this component with range mode forced on. Agents will pass a 2-tuple `value`.

- [ ] Accept a 2-tuple `@value` as implying range.
- [ ] Accept `onValueChange` as an alias of `@onChange` / `@onValuesChange`.
- [ ] `minStepsBetweenThumbs` is the remaining UX gap.
