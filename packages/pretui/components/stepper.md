## What it is

The property-panel number control: a centred number field flanked by `−` and `+` buttons sharing one hairline. Use it where a value is nudged rather than typed — a quantity, a font size, a count, a zoom level — and where the increments are meaningful. If the user will type a precise number, **NumberInput** gives you formatting and validation. If the value is approximate within a range, **Slider**. If it is a count you display rather than edit, **Stat** or **Token**.

## The contract

```
@value?, @defaultValue?, @min?, @max?, @step? (default 1)
@disabled?, @controlId?, @onValueChange?(value: number)
```

Hybrid controlled/uncontrolled, the kit-wide idiom: `@value ?? @internal`, with `@internal` seeded from `@defaultValue ?? @min ?? 0` and written only when `@value === undefined`.

**The text field commits on `change`, not on `input`.** That is the decision that makes the control usable: `change` fires on blur, on Enter, and on the native spinner buttons, so clamping happens once the user has finished rather than fighting them mid-keystroke. Typing "15" into a field with `@max={{10}}` would otherwise clamp to 1 the moment you press the first key.

**Unparsable text restores the last good value.** `parseFloat` returning `NaN` writes the previous value back into the input directly, so the field can never be left holding garbage.

**The flanking buttons disable at the bounds** — `atMin`/`atMax` are only true when `@min`/`@max` are actually set, so an unbounded Stepper never disables.

## Prior art

Neither of the kit's reference libraries ships this standalone: **Web Awesome** folds steppers into `wa-number-input` (`without-steppers` to remove them, localized increment/decrement `aria-label`s, buttons auto-disabled at bounds, decrement rendered _before_ the input); **React Spectrum**'s `NumberField` likewise integrates them. **Radix** has no number control at all. So this is a fresh component, and the closest analogues are property panels in design tools — Figma's, Blender's — where the flanked-field form is the convention.

Where Pretui's version is deliberate and good: **commit-on-change** (above), and the shared hairline, which makes the three elements read as one control rather than three adjacent ones.

Where it is behind Web Awesome and Spectrum, and these matter:

- **No `Intl.NumberFormat`**. A Stepper shows the raw number, so currency, percent and locale-specific grouping are unavailable. **NumberInput** has them; this does not.
- **No press-and-hold repeat.** Holding `+` increments once. Every mature stepper repeats with acceleration, and its absence is the first thing users notice on a range of any size.
- **No Shift/Page modifiers** for a larger step.
- **The buttons are ordinary buttons**, so they are in the tab order — see below.

## Accessibility

Governing pattern: APG **Spinbutton** — `role="spinbutton"` with `aria-valuenow`/`valuemin`/`valuemax`/`valuetext`, focus staying on the text field while the `+`/`−` buttons operate it, and keys Up/Down by step, Home/End to the bounds, Page Up/Page Down by a larger step.

The implementation is a native `<input type="number">` flanked by buttons, which gets you some of this and not the rest:

- **The native input supplies Up/Down arrow stepping** and honours `min`/`max`/`step`. It does **not** supply Home/End or Page Up/Page Down, and neither does the component — so half the pattern's key list is missing.
- **`role="spinbutton"` is implicit** on `input[type=number]`, along with the `aria-value*` properties. Worth knowing that React Aria deliberately _strips_ the spinbutton role in its `NumberField` (`role: null`, all four `aria-value*` nulled) because **VoiceOver cannot focus a spin button**, substituting `aria-roledescription` and a wrapping `role="group"`. If VoiceOver is a target, this component inherits that platform problem.
- **The `−` and `+` buttons are in the tab order.** APG is explicit that they should be `tabindex="-1"`: focus belongs on the field, and the buttons duplicate what the arrow keys already do. As written, tabbing through a panel of five Steppers costs fifteen tab stops instead of five. Web Awesome sets `tabindex="-1"` on both. **This is the clearest fix.**
- **The buttons' accessible names are not visible in the source excerpt** — verify they carry `aria-label="Increase"`/`"Decrease"` (Web Awesome localizes these). A button whose only content is `−` is announced as "minus".
- **No `aria-valuetext`**, so "12" is announced where "12 items" or "12 px" is meant.
- **No accessible name of its own.** `@controlId` lets **Field**/**FormField** wire a `<label for>`; outside those, pass `aria-label`.
- **`@disabled` uses the native attribute** on all three elements, removing the whole control from the tab order.
- **Target size**: the flanking buttons are small by design in a property panel; check them against WCAG **2.5.8**'s 24×24 minimum.

## Theming

`--field` (the shared face), `--input` (the shared hairline), `--foreground`, `--muted-foreground`, `--primary` (focus ring), `--hover`, `--control-h`, `--radius`, `--text-ui-md`, `--track-ui`.

The single shared hairline is the visual signature: the buttons and the field are one box with internal rules rather than three boxes, so a season that gives `--input` a strong colour will see it as a frame with two dividers. Check that the disabled-at-bounds state remains distinguishable — `opacity`-based dimming on a small `−` glyph is easy to miss, and it is the only signal that a bound has been reached.
