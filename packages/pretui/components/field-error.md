## What it is

One validation issue, rendered. It is the atom of the forms territory's messaging — **FormField** uses it for routed issues, **ErrorSummary** composes rows from the same data, and you can use it directly for an issue that belongs to no field. If you want the whole list, use **ErrorSummary**; if you want a page-level banner, use **Alert**.

## The contract

```
@issue: FormIssue   (required)
@announce?          — add role='alert'. Default false.
@showRuleId?        — print issue.ruleId as a mono Token
```

`FormIssue` is `{ targetPath, severity, message, ruleId? }`.

Two decisions carry the component.

**The message is printed verbatim.** A rule author wrote it; rewriting rule copy in a component is how enterprise forms end up lying about what actually failed. There is no truncation, no sentence-casing, no "Please" prefix.

**Severity normalisation fails closed.** `normalizeSeverity` returns `'warning'` or `'info'` only for exactly those two strings. Anything else — `undefined`, `''`, `'critical'`, `'ERROR'`, a typo — resolves to `'error'` and therefore **blocks the commit**. This mirrors the BXL guide contract, where a rule that cannot be evaluated counts as a failure. A misspelled severity making a form stricter is the safe direction to fail.

`@showRuleId` renders `issue.ruleId` as a mono **Token** after the message — provenance for rule authors debugging why a form refused, and off by default because end users should never see it.

## Prior art

Ported from **React Spectrum's `<FieldError>`**, which is errors-only and unstyled by severity, and **SLDS's `.slds-form-element__help`**, which is one flat red line with no severity concept at all. Neither library has severity tiers on a field message.

Pretui's improvements, each concrete:

- **Three severities** on the kit's Law 2 hue treatment — one hue in, a complete treatment out — so error, warning and info are one recipe rather than three stylesheets.
- **Fail-closed normalisation** (above). Neither reference normalises at all; an unknown severity in SLDS is simply an unstyled message.
- **Optional rule provenance** as a Law 3 Token.
- **A deliberate live-region policy**, which is the part everyone gets wrong.

The glyph vocabulary (`✕` / `!` / `i`) is shared with **Alert**, so a field message and a banner about the same thing read as one system.

## Accessibility

No APG pattern. The governing criteria are WCAG **3.3.1 Error Identification** and **4.1.3 Status Messages**, and the interesting decision here is a live-region one.

**Stated plainly: `role="alert"` interrupts.** A field message that re-renders on every keystroke must never be a live region, or a screen-reader user is talked over while typing. So `@announce` is opt-in, and **FormField only turns it on in `record` mode**, where an error appears as the result of one discrete commit. In `submit` mode the **ErrorSummary** announces by taking focus. In `live` mode nothing announces at all — and the message is still read whenever the field itself is focused, because FormField already put this element's id in the control's `aria-describedby`.

That last clause is what makes the restraint safe. The message is always reachable; the question is only whether it interrupts.

Gaps and cautions:

- **Severity is not exposed to assistive tech.** The glyph is decorative and the hue is visual; a warning and an error are announced identically as message text. `role="alert"` versus `role="status"` would be the natural distinction (assertive for blocking, polite for advisory) and it is not made — `@announce` produces `role="alert"` regardless of severity. Worth fixing.
- **Nothing prefixes the message with "Error:".** GOV.UK's pattern adds a visually-hidden prefix to the inline message so a screen-reader user hears the severity before the text. Here they hear only the text.
- **`role="alert"` on a message that is already in `aria-describedby`** will be announced twice when the field receives focus after the alert fires. This is inherent to the pattern rather than a Pretui bug, but it is the reason `@announce` is scoped to `record` mode.
- **The glyph is `aria-hidden`**, so "✕" is never part of the announced text; the message carries the meaning.
- **Using `@announce` directly, outside FormField, is easy to get wrong.** The rule of thumb from the source is the one to follow: turn it on only where the message appears as the result of a discrete commit, never on a control that revalidates per keystroke.

## Theming

Severity hues: `--destructive` (error), `--warning`, `--pretui-info`, each feeding the Law 2 treatment that derives ink, glyph and any tint from the single hue. Type: `--text-ui-sm`. Provenance: **Token**'s `--font-mono`, `--inset`, `--muted-foreground`, `--pretui-shadow-hairline`.

Because severity is carried by **glyph and hue together**, it survives WCAG 1.4.1 (Use of Colour) even in a season whose warning and error hues are close. A season that removes the glyphs would break that — they are not decoration.

A season must define `--warning` and `--pretui-info` legibly at 11.5px against `--card`; amber and pale blue at small sizes are the two most common contrast failures in this territory.

The styles sit in `@layer PretComposite`, above Token's `PretComponent` layer, so what this component sets on Token wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
