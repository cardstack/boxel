## What it is

The kit's single-line text control. Every typed value that is not a picker goes through it, and the typed-input family — **EmailInput**, **PhoneInput**, **UrlInput**, **PasswordInput**, **NumberInput**, **SearchInput** — is built on the same underlying machinery with format-specific behavior layered on. Reach for `Input` directly for free text; reach for the typed sibling when the value has a shape, because those add validation, `inputmode`, `autocomplete` and affordances you would otherwise re-invent. For multi-line use **Textarea**; for a value chosen from a list use **Select**; for a value chosen from a list _or_ typed freely use **Combobox**.

## The contract

```
@value?, @placeholder?, @type? (default 'text'), @invalid?, @disabled?, @controlId?
@onInput?(value: string)
@helperText?, @errorMessage?, @required?, @optional?
```

`@onInput` receives the **string value**, not the event. That is the kit-wide convention for controls and it is why call sites never touch `event.target`.

`@controlId` exists so **Field** and **FormField** can mint an id, put it on their `<label for>`, and hand it down. Input does not generate its own id — labelling is the wrapper's job, and this keeps a single owner for the association.

The non-obvious decision: **Input is a retrofit on boxel-ui's `BoxelInput`, not a raw `<input>`.** BoxelInput carries the machinery — validation-state plumbing, `aria-invalid` / `aria-errormessage` / `aria-describedby` wiring, the error and helper message rows, the "Optional" indicator. Pretui keeps its own unchanged signature on the outside and re-dresses the inside through a **token channel**: the wrapper `<div>` redefines `--background`, `--border` and a set of `--boxel-*` dimension knobs, and BoxelInput restyles itself. No Pretui CSS reaches into boxel-ui markup, so a boxel-ui upgrade cannot break the dress.

Two places the channel cannot reach, handled by a single inline `style`: the UA font on native controls, and variables boxel defines on the element itself. Splatted `...attributes` land on the **inner** `<input>`, so `aria-label`, `autocomplete`, `min`, `max` and friends still work.

## Prior art

**Web Awesome `wa-input`** is a full custom element with `label`, `hint`, `clearable`, `password-toggle`, `with-label`/`with-hint` slots, plus the whole constraint-validation surface. **React Spectrum `TextField`** splits `label`/`description`/`errorMessage` as props and returns wiring from `useTextField`, with `validationState` (now `isInvalid`) driving both. **shadcn `Input`** is a styled `<input>` and nothing else — no label, no error, no wiring.

Pretui sits deliberately between them. It does not own its label (Field/FormField does), which avoids the two-labels problem you hit when a form layout also wants to place labels. But unlike shadcn it _does_ carry `@helperText` and `@errorMessage`, because those are ARIA-wired by the layer below and re-implementing them at the wrapper would mean re-implementing the wiring.

The genuine improvement over both: **invalid styling travels through the token channel.** Field sets `data-invalid` on itself, and its stylesheet repoints `--border` on the wrapper — the inner control re-dresses itself. Compare the usual approach of a `.error` class threaded down through every layer. It also means a theme can change what "invalid" looks like by changing one token.

## Accessibility

Native `<input>`; no APG pattern needed. The wiring that matters is inherited from BoxelInput: `aria-invalid` when `@invalid`, `aria-errormessage` pointing at the rendered error row, `aria-describedby` pointing at the helper row.

Honest gaps:

- **`@invalid` and `@errorMessage` are independent.** Passing `@invalid` without `@errorMessage` produces a red control with nothing announced; passing `@errorMessage` without `@invalid` renders nothing (the error row is gated on validation state). Nothing warns you. Always pass both, or use **FormField**, which does it for you.
- **No accessible name of its own.** An `<Input>` used outside `Field`/`FormField`/`FormField`'s descendants and without an explicit `aria-label` is unlabeled. A placeholder is not a label.
- `@required` sets the native attribute, which is correct, and suppresses the "Optional" indicator. `@optional` is a purely visual marker with no ARIA meaning — fine, but do not read it as the inverse of `@required`.
- `@disabled` uses the native attribute, so the control leaves the tab order and its value is not submitted. If you need a read-only-but-focusable field, pass `readonly` through `...attributes` instead.
- The focus ring is the kit's 2px `--ring` outline laid over the edge, so it still shows in forced-colors mode.

## Theming

Input, **Select** and **Autocomplete** share one field look at rest: a `--field` face with `--foreground` text, an `--input` edge, a `--muted-foreground` placeholder, Button's corner (`calc(var(--radius) - 0.125rem)`), a `--boxel-form-control-height-sm` (1.75rem) height and `--boxel-font-size-xs` text, with the helper and error rows and the Optional label a step below at `--boxel-font-size-2xs`. On touch screens (`pointer: coarse`) the field's text and placeholder are at least 16px (`--boxel-form-control-touch-font-size`), so iOS doesn't zoom into the field on focus. `@type='search'` draws **SearchInput**'s magnifier.

The three share their states too. Hover pulls the edge 30% toward `--foreground`, only where the pointer can hover, so the edge doesn't stick after a tap. Invalid is a `--destructive-ink` edge, since the `--destructive` fill misses the 3:1 a field boundary needs; hovering the field (not its message rows) darkens it the same 30% toward `--foreground`, and focus swaps it for the ring, as GOV.UK, Carbon and Primer do. Disabled is 0.45 opacity with the usual edge and no error row, invalid or not, since a disabled field can't be fixed; read-only isn't dimmed, since the field can still be focused and its value copied. Focus is a 2px `--ring` outline.

The dress lives in `internal/field-dress`, which Textarea and the typed inputs (Email, Url, Phone, Number, Password, Search) wear too, so the whole family shares these states. Forwarded into boxel-ui: `--boxel-form-control-height`, `--boxel-input-height`, `--boxel-form-control-border-radius`, `--boxel-font-size-sm` (the helper and error rows), `--boxel-sp-xs`, `--boxel-sp-sm`, and the state knobs `--boxel-input-hover-border-color`, `--boxel-input-outline`, `--boxel-input-outline-offset`, `--boxel-input-invalid-color`, `--boxel-input-invalid-box-shadow`, `--boxel-input-invalid-focus-outline`, `--boxel-input-invalid-focus-box-shadow`, `--boxel-input-disabled-opacity` and `--boxel-input-readonly-opacity`. The end inset goes in through `--boxel-input-padding-inline-end`, so while a validation icon shows, BoxelInput can swap it for the icon's column. The dress also sets `--pretui-invalid-border` and `--pretui-invalid-background`, which tell Field how to dress it when the Field has an error.

A theme must keep `--field` and `--card` visually distinct or inputs vanish into panels; and must not set `--input` equal to `--border` if it wants controls to read as inset rather than as bordered boxes.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React / Aria / MUI / Ant                           | Pretui Input                          |
| -------------------------------------------------- | ------------------------------------- |
| TextField / TextInput / Input                      | this tile + channel wrappers          |
| `isInvalid` / `error` / `status=error`             | @invalid + **FieldError**             |
| `isDisabled` / `disabled`                          | @disabled                             |
| `isReadOnly` / `readOnly`                          | @readonly                             |
| `isRequired` / `required`                          | @required                             |
| `prefix` / `suffix` / InputAdornment / addonBefore | **InputGroup**                        |
| `allowClear` / `onClear`                           | **SearchInput** clear                 |
| `type=search\|password\|email\|url\|number`        | the channel wrappers, not a type soup |

- [ ] Accept `isInvalid` / `isDisabled` / `isReadOnly` / `isRequired`.
- [ ] Keep channel wrappers as the home for search/password/email/url/number.
