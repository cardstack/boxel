## What it is

A phone-number field with as-you-type formatting, E.164 normalisation and region-aware validation. Use it whenever a phone number is collected — the formatting alone is worth it, because a number typed as a continuous digit string is much harder to check by eye than one grouped by the user's region. Do not reach for plain **Input** with `type='tel'`: that gives you a numeric keypad and nothing else.

## The contract

```
@value?, @placeholder?, @disabled?, @required?, @controlId?
@onInput?(value: string)
@onValidation?(error: string | null)
```

Identical in shape to **EmailInput**, **UrlInput** and the rest of the typed-input family — which is the point. They are interchangeable at a call site, and learning one teaches the others.

**The two-callback split** is the same adaptation: boxel-ui's underlying control returns a `NormalizePhoneFormatResult` from its `onChange`, carrying the formatted value, the normalised E.164 form and any validation state in one object. Pretui collapses that into `@onInput(value)` — the same signature as every other control in the kit — plus `@onValidation(error | null)`.

Worth being precise about what `@onInput` receives, because it determines what you store: it is the field's value as the user sees it, not necessarily the E.164 normalisation. If you need the canonical form for storage or comparison, read it from the boxel-ui layer rather than assuming the displayed string is it.

`@value` is passed through as `null` when undefined, matching the underlying control's expectation.

## Prior art

A **thin runtime wrap of boxel-ui's phone input**, whose machinery is `awesome-phonenumber` — a port of Google's libphonenumber. That is the value being reused: as-you-type formatting per region, E.164 normalisation, and validity checks that know a UK mobile from a UK landline. Reimplementing any of that is a multi-year mistake.

Against the field: **Web Awesome**, **Radix**, **React Spectrum** and **shadcn** all ship nothing here. Phone input is universally left to `react-phone-number-input`, `intl-tel-input` or an in-house regex — and the regex version is always wrong. So the comparison is: a real libphonenumber-backed field, dressed to match the kit, versus rolling your own.

Where Pretui adds over boxel-ui: the callback split, and API consistency with the family.

What is **not** exposed, and is the honest gap: **no country selector, no `@region` arg, no `@format` choice.** Every mature phone input has a flag dropdown that sets the parsing region, and there is none here — the region is whatever the underlying control defaults to. For an international form that is a real limitation, and the workaround is composing **InputGroup** with a **Select** yourself.

## Accessibility

Native `<input type="tel">` underneath; no APG pattern.

What is right: `type="tel"` gives mobile users the numeric keypad and gives assistive tech the field's purpose.

Gaps, and the first two are specific to phone fields:

- **As-you-type formatting rewrites the field while the user types**, which is exactly the interaction screen readers and voice-input users handle worst — characters are inserted that the user did not type, and the caret moves. Verify what your target readers announce during input; this is a known-hard interaction and boxel-ui owns the implementation, so Pretui can neither guarantee nor fix it. If it is a problem, formatting on blur rather than on input is the accessible fallback.
- **No `autocomplete="tel"`**, and no arg for it. **WCAG 1.3.5 Identify Input Purpose** (AA) requires it for a field collecting the user's own phone number, and it must currently be passed through `...attributes`. Family-wide hole.
- **The ARIA wiring is boxel-ui's** and this wrapper adds none — whether the validation error reaches `aria-describedby` depends on the boxel-ui version. Verify it. The ecosystem's settled choice is `aria-describedby` over `aria-errormessage`, which VoiceOver and NVDA still handle poorly.
- **No accessible name of its own.** Outside **Field**/**FormField** and without an explicit `aria-label`, the field is unnamed.
- **`@onValidation` is a callback, not rendered output** — no `@errorMessage`/`@helperText` args here, unlike **Input**. If you drop the error, the field can show an invalid dress with nothing announced. Route it into a **FormField**.
- **No visible format hint.** A user who does not know whether to include a country code has no instruction, which is a **WCAG 3.3.2 Labels or Instructions** concern. Use **FormField**'s `@description`.
- **`@disabled` uses the native attribute**, removing the field from the tab order.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`.

Forwarded into boxel-ui through the `--boxel-*` channel — the same height, radius, type-size and spacing knobs **Input** sets, so a phone field and a text field in the same form are pixel-identical.

An inline `style` carries font inheritance (the UA font on native controls is one of the two places the token channel cannot reach). The invalid dress arrives from an enclosing **Field** by repointing `--border` and `--background`, so it works here without this component knowing about it — and the same mechanism means a season redefines "invalid" once for the whole family.
