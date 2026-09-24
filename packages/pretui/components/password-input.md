## What it is

A password field with a reveal toggle. Use it for any credential entry. The reveal is on by default, which is the right default — hiding a password the user is _typing_ protects against shoulder-surfing and costs them the ability to check their own typing, and letting them choose is strictly better than choosing for them.

## The contract

```
@value?, @placeholder?, @disabled?, @required?, @controlId?
@autocomplete? (default 'current-password')
@revealable? (default true)
@onInput?(value: string)
```

**`@autocomplete` defaults to `'current-password'`, and this is the arg you must think about.** A sign-in field is `current-password`; a registration or change-password field is `new-password` — and getting that wrong means password managers offer the saved password where they should generate a new one, or vice versa. It is also the only member of the typed-input family that exposes `autocomplete` as a first-class arg, which is a good decision that the rest of the family should copy.

**`@revealable={{false}}` removes the toggle**, and the component swaps its inline metrics accordingly (`PASSWORD_METRICS` reserves room for the button; `TYPED_FONT` does not) so a non-revealable field has no dead space on its right.

The reveal is implemented by swapping `type` between `'password'` and `'text'` — the standard approach, and worth knowing because it means the value is briefly a plain text input, visible to anything reading the DOM.

## Prior art

**Web Awesome** folds this into `wa-input`: `password-toggle`, `password-visible`, and `show-password-icon`/`hide-password-icon` slots, with the toggle at **`tabindex="-1"`** and a localized `aria-label`. **React Spectrum** has no password field at all. **shadcn** has none; the reveal is a docs recipe.

So the comparison is really against `wa-input`, and Pretui matches it on the essentials while making it a distinct component rather than a mode of the text input. That is arguably the better factoring — a password field has a different `autocomplete` contract, a different validation story and a different security posture from a text field, and modelling it as `type="password"` on a general input invites people to forget all three.

Where Pretui is ahead: **`@autocomplete` as an explicit arg with a considered default.** Web Awesome inherits `autocomplete` from the generic input and does not default it, so every call site must remember.

Where it is behind:

- **No strength meter and no requirements display.** A registration field needs both, and **Meter** is right there. Composing it is on you.
- **No `caps lock` warning**, which is the single most common cause of a failed sign-in.
- **No confirm-field pairing.**
- **No masked-reveal timeout** — once revealed, it stays revealed until toggled back.

## Accessibility

No APG pattern; a native `<input type="password">` with a toggle button.

Gaps, and the toggle is where most of them live:

- **The toggle's tab-order treatment needs checking.** Web Awesome deliberately sets `tabindex="-1"` on its reveal button so Tab moves from the password field to the submit button rather than into a decorative control. If Pretui's toggle is a normal tab stop, every sign-in form costs an extra Tab. Verify.
- **The toggle's accessible name must change with state** — "Show password" / "Hide password" — and the state change should be announced. Changing an `aria-label` does not announce on its own; a screen-reader user pressing the toggle may hear nothing and not know whether the password is now visible. This is the same gap **CopyButton** has, and it matters more here because the consequence is a visible credential.
- **`aria-pressed` would be more honest than a changing label.** The toggle _is_ a two-state control, and APG's toggle-button guidance is explicit that the label should stay fixed while `aria-pressed` carries the state. A changing label also breaks voice control ("click show password" stops working once pressed).
- **Revealing the password is a visual state with no non-visual signal.** A screen-reader user has no indication that their password is currently displayed on screen — which is a privacy consideration, not just a usability one.
- **No accessible name of its own** for the field. Outside **Field**/**FormField** and without an explicit `aria-label`, it is unnamed.
- **Never block paste**, and this does not — good, and worth stating because blocking paste is still common and actively harms password-manager users.
- **Requirements must be available before submission** (**WCAG 3.3.2**). There is no `@hint`; use **FormField**'s `@description`, and reference it with `aria-describedby` so it is announced with the field rather than encountered after it.
- **`@disabled` uses the native attribute**, removing the field from the tab order.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`, plus **IconButton**'s tokens for the toggle.

Forwarded into boxel-ui through the `--boxel-*` channel, matching **Input**'s metrics.

`data-revealed` is reflected on the wrapper, so a season can dress the revealed state — a tinted hairline, a changed toggle colour — beyond the icon swap. Given that the revealed state has real privacy consequences and is currently signalled only by the glyph, using that hook is worth doing. Note the inline metrics differ between revealable and non-revealable modes, so a season cannot change the toggle's reserved width through a token.
