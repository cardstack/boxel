## What it is

A numeric text field with min/max clamping and decimal-precision rounding. Use it when the user types a number and the exact value matters — a price, a quantity, a threshold. If the value is nudged rather than typed, **Stepper** puts `−`/`+` buttons around it. If it is approximate within a bounded range, **Slider**. If you are displaying a number rather than collecting one, **Stat**, **Token** or **FormatNumber**.

## The contract

```
@value?, @min?, @max?, @precision?, @placeholder?
@disabled?, @required?, @controlId?
@onInput?(value: number | null)
```

**`@onInput` yields `number | null`, not a string.** That is the one place this component's signature diverges from the rest of the typed-input family, and it is correct: a numeric field that hands you `'12'` forces every call site to parse, and a field that hands you `NaN` for an empty box forces every call site to guard. `null` is the honest representation of "no number here".

**`clampRound` applies bounds first, then precision.** `Math.max(min, …)`, `Math.min(max, …)`, then round to `10^precision`. Order matters: rounding after clamping means a value at the boundary stays exactly at the boundary rather than being rounded past it.

`@value` is passed through as `null` when undefined, matching the underlying control.

## Prior art

A **thin runtime wrap of boxel-ui's number input**, per the standing reuse directive — the parsing and commit machinery is boxel-ui's, and the wrapper re-dresses it through the semantic-token + `--boxel-*` channel with no CSS reaching boxel markup.

**Web Awesome `wa-number-input`** is the fullest reference: `step` (`number | 'any'`), `without-steppers`, `inputMode` (`numeric | decimal`), localized `increment`/`decrement` `aria-label`s, steppers auto-disabled at bounds, and the decrement button rendered _before_ the input in the DOM. **React Spectrum `NumberField`** takes `formatOptions` (an `Intl.NumberFormat` bag), `minValue`/`maxValue`/`step`, and picks `inputMode` from the format options and locale.

Where Pretui is thinner, and these are the honest gaps:

- **No `Intl.NumberFormat`.** Spectrum's `formatOptions` is what lets a number field display `$1,284.00` while holding `1284`. This component has `@precision` and nothing else — no currency, no percent, no grouping, no locale. **FormatNumber** exists for display; there is no formatted _input_.
- **No `@step`.** The native arrow-key stepping uses the browser's default of 1, so a price field steps by whole units. **Stepper** has `@step`; this does not.
- **No `inputMode` control**, so the mobile keyboard is whatever `type="number"` gives you.

## Accessibility

Governing pattern: APG **Spinbutton** — `role="spinbutton"` with `aria-valuenow`/`valuemin`/`valuemax`/`valuetext`, Up/Down by step, Home/End to the bounds, Page Up/Page Down by a larger step, and `aria-invalid` when out of range.

An `<input type="number">` supplies the role and the `aria-value*` properties implicitly, plus Up/Down stepping. What it does not supply, and what this component does not add:

- **Home/End and Page Up/Page Down are missing.** Half the pattern's key list.
- **No `aria-valuetext`**, so a value with units announces as a bare number.
- **A significant platform caveat**: React Aria's `useNumberField` deliberately **strips** the spinbutton role (`role: null`, all four `aria-value*` nulled) because **VoiceOver cannot focus a spin button**, substituting `aria-roledescription` and wrapping the field in `role="group"`. If VoiceOver is a target, `input[type=number]` inherits that problem and this component does nothing about it.
- **`type="number"` has known input problems** independent of ARIA: scroll-wheel changes the value when the field has focus, non-numeric keystrokes are silently swallowed in some browsers, and the value is empty-string rather than partial for intermediate states. Spectrum uses `type="text"` with `inputMode` for exactly these reasons.
- **No accessible name of its own.** Outside **Field**/**FormField** and without an explicit `aria-label`, the field is unnamed.
- **No `autocomplete`** arg — relevant for numeric personal data (postal codes, card numbers) under **WCAG 1.3.5**. Family-wide hole.
- **Clamping is silent.** Typing 500 into a field with `@max={{100}}` commits 100 with no announcement and no explanation. **WCAG 3.3.1** wants the error identified in text and **3.3.3** wants a suggestion; silently altering the user's input satisfies neither, and is arguably worse than rejecting it. Surface the bounds via **FormField**'s `@description` at minimum.
- **`@disabled` uses the native attribute**, removing the field from the tab order.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`.

Forwarded into boxel-ui through the `--boxel-*` channel, matching **Input**'s metrics so a numeric field and a text field align in the same form.

Native spinner buttons are a UA-rendered control that CSS custom properties cannot reach — a season cannot restyle them, and they will look like the browser's rather than like the kit's. **Stepper** exists partly for that reason. If a season wants consistent numeric chrome, prefer Stepper. The invalid dress arrives from an enclosing **Field** through the token channel, as with the rest of the family.
