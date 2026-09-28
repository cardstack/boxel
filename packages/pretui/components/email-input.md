## What it is

A text field that knows it holds an email address: format checking, debounced feedback, and errors that surface on blur rather than on every keystroke. Use it instead of `<Input @type='email'>` whenever the value is an address a user must get right. If you only need the mobile keyboard hint and nothing else, plain **Input** with `type='email'` is lighter. For a _list_ of addresses, this is not it — compose several, or use **MultiSelect** over known contacts.

## The contract

```
@value?, @placeholder?, @disabled?, @required?, @controlId?
@onInput?(value: string)
@onValidation?(error: string | null)
```

**The two-callback split is the notable API decision.** boxel-ui's underlying control emits a single three-argument `onChange(value, validationError, event)`. Pretui splits that into `@onInput(value)` — the same signature as **Input**, **Textarea** and every other control in the kit — plus `@onValidation(error | null)`. So a call site that does not care about validation is written exactly like a plain Input, and one that does gets the error as its own channel rather than as a second positional argument it has to remember to read.

`@controlId` comes down from **Field**/**FormField**; the component mints no id of its own.

## Prior art

This is a **thin runtime wrap of boxel-ui's email input**, per the kit's standing reuse directive: the validation engine — format checks, debounced feedback, blur-gated error surfacing — is boxel-ui's, and only the cloth changes. The wrapper `<div class='pretui-boxelwrap'>` re-dresses the inner control through the **semantic-token + `--boxel-*` custom-property channel**; no Pretui CSS reaches into boxel-ui markup, so a boxel-ui upgrade cannot break the dress.

Against the field: **Web Awesome** has no email input — `wa-input type="email"` plus native constraint validation, with `label`/`hint` props and slots. **React Spectrum** likewise has no dedicated email field; `TextField type="email"` with a `validate` function. **shadcn** has none.

So the honest comparison is against native `type="email"` plus the browser's validation, and the difference is **when the error appears**. Native constraint validation fires on submit and shows a UA bubble that cannot be styled, positioned or announced consistently. The boxel engine's blur-gated, debounced feedback is the behaviour every serious form eventually implements by hand — showing an error while someone is still typing "chris@" is the single most common form-UX mistake.

Where Pretui adds value over boxel-ui: the callback split (above) and API consistency with the rest of the typed-input family — **PhoneInput**, **UrlInput**, **NumberInput** and **PasswordInput** all take the same shape, so they are interchangeable at a call site.

Where the whole family is behind Web Awesome: no `clearable`, no start/end slots, no `size` axis.

## Accessibility

Native `<input type="email">`; no APG pattern needed.

What is right: the `type` gives mobile keyboards the `@` and `.` keys, and gives assistive tech the field's purpose. `@required` sets the native attribute.

Gaps:

- **The ARIA wiring is boxel-ui's, and this wrapper adds none.** Whether the validation error is announced — via `aria-describedby`, `aria-errormessage`, or a live region — depends on the boxel-ui version. Verify it rather than trusting this page. Note the ecosystem's settled position: `aria-errormessage` is still poorly supported, and React Aria carries an explicit code comment that it uses `aria-describedby` for error text "because `aria-errormessage` is unsupported using VoiceOver or NVDA".
- **No accessible name of its own.** Outside **Field**/**FormField** and without an explicit `aria-label`, the field is unnamed. A placeholder is not a label.
- **No `autocomplete`.** There is no arg, so `autocomplete="email"` — which is a **WCAG 1.3.5 Identify Input Purpose** (AA) requirement for a field collecting the user's own email — must be passed through `...attributes`. Every field in this family has the same hole, and it is the clearest family-wide fix.
- **`@onValidation` is a callback, not rendered output.** Unlike **Input**, this component has no `@errorMessage`/`@helperText` args, so the error boxel-ui computed is handed to you and you decide where it goes. If you drop it on the floor, the field may show an invalid dress with nothing announced. Route it into a **FormField**.
- **`@disabled` uses the native attribute**, so the field leaves the tab order. Use `readonly` via `...attributes` for focusable-but-fixed.
- **Format validation is not correctness.** An address can be well-formed and wrong; do not present a passing check as confirmation.

## Theming

Consumed: `--field` (control face), `--input` (hairline), `--primary` (focus ring, via `--ring`), `--ink-3` (placeholder ink), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`.

Forwarded into boxel-ui through the `--boxel-*` channel: the form-control height, radius, font sizes and spacing knobs, exactly as **Input** does — the two are dressed to be pixel-identical, so an email field and a text field in the same form align.

An inline `style` carries the font inheritance, because the UA font on native controls is one of the two places the custom-property channel cannot reach. The invalid dress arrives through the token channel from an enclosing **Field** (`--border` → `--destructive`), so it works here without the component knowing about it.
