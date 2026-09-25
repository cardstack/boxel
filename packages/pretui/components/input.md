## What it is

The kit's single-line text control. Every typed value that is not a picker goes through it, and the typed-input family — **EmailInput**, **PhoneInput**, **UrlInput**, **PasswordInput**, **NumberInput**, **SearchInput** — is built on the same underlying machinery with format-specific behaviour layered on. Reach for `Input` directly for free text; reach for the typed sibling when the value has a shape, because those add validation, `inputmode`, `autocomplete` and affordances you would otherwise re-invent. For multi-line use **Textarea**; for a value chosen from a list use **Select**; for a value chosen from a list _or_ typed freely use **Combobox**.

## The contract

```
@value?, @placeholder?, @type? (default 'text'), @invalid?, @disabled?, @controlId?
@onInput?(value: string)
@helperText?, @errorMessage?, @required?, @optional?
```

`@onInput` receives the **string value**, not the event. That is the kit-wide convention for controls and it is why call sites never touch `event.target`.

`@controlId` exists so **Field** and **FormField** can mint an id, put it on their `<label for>`, and hand it down. Input does not generate its own id — labelling is the wrapper's job, and this keeps a single owner for the association.

The non-obvious decision: **Input is a retrofit on boxel-ui's `BoxelInput`, not a raw `<input>`.** BoxelInput carries the machinery — validation-state plumbing, `aria-invalid` / `aria-errormessage` / `aria-describedby` wiring, the error and helper message rows, the "Optional" indicator. Pretui keeps its own unchanged signature on the outside and re-dresses the inside through a **token channel**: the wrapper `<div>` redefines `--background`, `--border`, `--ring`, `--muted-foreground` and a set of `--boxel-*` dimension knobs, and BoxelInput restyles itself. No Pretui CSS reaches into boxel-ui markup, so a boxel-ui upgrade cannot break the dress.

Two places the channel cannot reach, handled by a single inline `style`: the UA font on native controls, and variables boxel defines on the element itself. Splatted `...attributes` land on the **inner** `<input>`, so `aria-label`, `autocomplete`, `min`, `max` and friends still work.

## Prior art

**Web Awesome `wa-input`** is a full custom element with `label`, `hint`, `clearable`, `password-toggle`, `with-label`/`with-hint` slots, plus the whole constraint-validation surface. **React Spectrum `TextField`** splits `label`/`description`/`errorMessage` as props and returns wiring from `useTextField`, with `validationState` (now `isInvalid`) driving both. **shadcn `Input`** is a styled `<input>` and nothing else — no label, no error, no wiring.

Pretui sits deliberately between them. It does not own its label (Field/FormField does), which avoids the two-labels problem you hit when a form layout also wants to place labels. But unlike shadcn it _does_ carry `@helperText` and `@errorMessage`, because those are ARIA-wired by the layer below and re-implementing them at the wrapper would mean re-implementing the wiring.

The genuine improvement over both: **invalid styling travels through the token channel.** Field sets `data-invalid` on itself, and its stylesheet repoints `--border` and `--background` on the wrapper — the inner control re-dresses itself. Compare the usual approach of a `.error` class threaded down through every layer. It also means a season can change what "invalid" looks like by changing one token.

## Accessibility

Native `<input>`; no APG pattern needed. The wiring that matters is inherited from BoxelInput: `aria-invalid` when `@invalid`, `aria-errormessage` pointing at the rendered error row, `aria-describedby` pointing at the helper row.

Honest gaps:

- **`@invalid` and `@errorMessage` are independent.** Passing `@invalid` without `@errorMessage` produces a red control with nothing announced; passing `@errorMessage` without `@invalid` renders nothing (the error row is gated on validation state). Nothing warns you. Always pass both, or use **FormField**, which does it for you.
- **No accessible name of its own.** An `<Input>` used outside `Field`/`FormField`/`FormField`'s descendants and without an explicit `aria-label` is unlabelled. A placeholder is not a label.
- `@required` sets the native attribute, which is correct, and suppresses the "Optional" indicator. `@optional` is a purely visual marker with no ARIA meaning — fine, but do not read it as the inverse of `@required`.
- `@disabled` uses the native attribute, so the control leaves the tab order and its value is not submitted. If you need a read-only-but-focusable field, pass `readonly` through `...attributes` instead.
- Focus ring is `--ring`, applied by BoxelInput. Verify it against WCAG 2.4.11 in dark seasons — the default is `--primary`, which on a `--field` background can be low-contrast.

## Theming

Consumed: `--field` (control face), `--input` (hairline), `--primary` (focus ring, via `--ring`), `--ink-3` (placeholder ink, injected as a locally-narrowed `--muted-foreground`), `--control-h` (28px), `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`.

Forwarded into boxel-ui: `--boxel-form-control-height`, `--boxel-input-height`, `--boxel-form-control-border-radius`, `--boxel-font-size-sm`, `--boxel-font-size-xs`, `--boxel-sp-xs`, `--boxel-sp-sm`.

A season must keep `--field` and `--card` visually distinct or inputs vanish into panels; and must not set `--input` equal to `--border` if it wants controls to read as inset rather than as bordered boxes. Note that this component _narrows_ `--muted-foreground` to `--ink-3` inside its wrapper — a season redefining `--ink-3` is changing placeholder colour kit-wide.

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
