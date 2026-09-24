## What it is

A URL field with format validation that surfaces after the user has touched it. Use it for a link a user supplies — a repo, a homepage, a webhook target. If the value is an internal card reference, that is **Lookup** or **RecordPill**, not a URL. If you are showing a URL rather than collecting one, **Token** with a **CopyButton** reads better.

## The contract

```
@value?, @placeholder?, @disabled?, @required?, @controlId?
@onInput?(value: string)
@onValidation?(error: string | null)
```

Same shape as **EmailInput** and **PhoneInput** — the typed-input family is deliberately interchangeable.

**The `touched` gate is the interesting bit here**, and unlike its siblings it is implemented in the Pretui layer rather than delegated. The component tracks `touched` and derives a three-state `state`: `'initial'` until the user has interacted at all, then `'invalid'` if there is an error, then `'valid'` if there is a value, else `'initial'` again. So a pristine empty field is neutral, a field the user typed a good URL into gets a positive state, and only a touched field with a bad value goes red.

That three-state model is worth noting because it is richer than the rest of the family: **EmailInput** and **PhoneInput** hand you an error and let the underlying engine decide when to show it; **UrlInput** owns the display gate itself. The practical difference is that a valid URL here gets affirmative feedback, which the others do not give.

`@onValidation(error | null)` is the same split-out channel as the rest of the family, so a call site that ignores validation is written like a plain **Input**.

## Prior art

**Web Awesome** has no URL input — `wa-input type="url"` with native constraint validation. **React Spectrum** likewise: `TextField type="url"` plus a `validate` function. **shadcn** none. So, as with the rest of the family, the comparison is against native `type="url"` and the browser's own bubble.

Two ways Pretui is better than the native baseline:

- **The error is styled, positioned and yours.** Native constraint validation fires on submit and pops a UA bubble that cannot be styled, cannot be positioned, and is announced inconsistently. Here the error is a value you route wherever it belongs — usually a **FormField**.
- **The touched gate** (above). Native validity is available from the first keystroke, so a naive implementation turns the field red while the user is typing "htt". Gating on touch is the behaviour every serious form implements by hand.

Where it is behind: **no normalisation.** A user typing `example.com` gets a validation error rather than `https://example.com`; a user pasting a URL with tracking parameters gets it stored verbatim. Every mature URL field prepends a scheme when one is missing, and this does not. That is the clearest addition.

Also missing versus a richer field: no scheme restriction (you cannot require `https`), no link-preview affordance, and no "open in new tab" companion.

## Accessibility

Native `<input type="url">`; no APG pattern.

What is right: `type="url"` gives mobile keyboards the `/` and `.com` keys and gives assistive tech the field's purpose. The touched gate means a screen-reader user is not told the field is invalid before they have entered anything.

Gaps:

- **The valid state is visual only.** `state='valid'` produces a positive dress and announces nothing — there is no `aria-describedby` text saying the URL is well-formed. That is a smaller loss than a silent _error_ would be, but it means sighted and non-sighted users are getting different information.
- **The ARIA wiring for the error is boxel-ui's**, and this wrapper adds none — verify against your boxel-ui version whether `@errorMessage` reaches `aria-describedby`. The ecosystem's settled choice is `aria-describedby` over `aria-errormessage`, which VoiceOver and NVDA still handle poorly.
- **No accessible name of its own.** Outside **Field**/**FormField** and without an explicit `aria-label`, the field is unnamed.
- **No `autocomplete="url"`**, and no arg for it. **WCAG 1.3.5 Identify Input Purpose** (AA) applies when the field collects the user's own URL. Family-wide hole, passed through `...attributes` for now.
- **No format instruction.** "Enter a URL" without saying whether a scheme is required is a **WCAG 3.3.2** gap — and it bites harder here than elsewhere because the answer is "yes, and we will not add it for you". Use **FormField**'s `@description`.
- **WCAG 3.3.3 Error Suggestion** asks for a correction where one is possible, and prepending a missing scheme is exactly such a correction. Not doing the normalisation is therefore an accessibility gap as well as a usability one.
- **`@disabled` uses the native attribute**, removing the field from the tab order.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`. The valid state additionally reads `--success` through the boxel-ui validation channel.

Forwarded into boxel-ui through the `--boxel-*` channel, matching **Input**'s metrics exactly so the family aligns in a shared form.

`--success` is the token to check per season here: unlike the rest of the family, this component has an affirmative state, and a season that tunes `--success` for a **Delta**'s 11.5px mono ink may find it too light as a field hairline. The invalid dress still arrives from an enclosing **Field** by repointing `--border`/`--background`, so error styling is a season concern defined once.
