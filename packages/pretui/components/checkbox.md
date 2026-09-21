## What it is

A single binary choice, rendered as a label-wrapped native checkbox with a custom face. Use it for opt-ins, "select this row", and any independent on/off that is _submitted with a form_ or read as part of a set. If the toggle takes effect immediately with no save step, use **Switch** — that is the real distinction between the two, not shape. For one-of-many use **RadioGroup**; for many-of-many from a list use **MultiSelect** or **DuelingPicklist**; for filter chips use **FilterChips**.

## The contract

```
@label?, @checked?, @defaultChecked?, @disabled?
@onCheckedChange?(checked: boolean)
Element: HTMLLabelElement
```

**The root element is the `<label>`, not the input.** `...attributes` therefore land on the label. This is what makes `@label` optional and safe: the input is _inside_ its label, so the implicit association exists whether or not text is rendered, and clicking anywhere in the row toggles. It also means that if you want to put attributes on the input itself, you cannot — the API is deliberately closed there.

**Hybrid controlled/uncontrolled**, the kit-wide idiom: `@checked ?? @internal`, with `@internal` written only when `@checked === undefined`. `@onCheckedChange` receives a boolean read off the event target, never the event.

The face is `appearance: none` plus a `clip-path` polygon check mark on `::before` — no SVG, no icon dependency, and it inherits `--primary-foreground` so the tick recolours with the season.

## Prior art

**Web Awesome `wa-checkbox`** is a form-associated custom element with `checked`, `indeterminate`, `required`, `value`, `size`, `hint`, and full constraint-validation participation. **Radix `Checkbox`** composes `Root` + `Indicator`, uses `checked` with the three-state value `'indeterminate'`, and renders a visually-hidden native input for form submission. **React Spectrum** exposes `isSelected`/`defaultSelected`/`isIndeterminate`/`isInvalid` and requires children as the label. **shadcn** wraps Radix.

Where Pretui is better: it is a _real_ native input in a real label. Radix and Web Awesome both build a custom control and then reintroduce a hidden native input to get form participation back; Pretui never leaves the platform, so `form` association, `name`/`value` submission, `:checked` styling, and screen-reader semantics are free and cannot drift.

Where Pretui is thinner, and it matters:

- **No indeterminate state.** Every kit above has it, and it is the standard affordance for "select all" over a partially selected list — a pattern **DataGrid** and **Table** will want. This is the most conspicuous missing feature.
- **No `@invalid`.** There is no error dress and no `aria-invalid`; a required unchecked checkbox cannot be shown as failing except by the surrounding **Field**.
- No `name`/`value` args. You can pass them through `...attributes`, but they land on the _label_, not the input — so native form submission by name is not actually reachable through the public API. Worth knowing before you assume the "native input" advantage extends to uncontrolled form posts.
- No size axis, unlike Button and the rest of the control family.

## Accessibility

Native `<input type="checkbox">`; no APG pattern required, and that is the right answer. Keyboard contract is the platform's: Tab to focus, Space to toggle. Implicit labelling comes from the wrapping `<label>`.

Honest gaps:

- **`@label` is optional and nothing enforces a name.** `<Checkbox />` with no `@label` and no `aria-label` on the label element produces an unnamed control. It is easy to reach for in a table row's select column and end up with a grid full of unlabelled checkboxes.
- **`@disabled` uses the native attribute**, removing the control from the tab order — so a disabled checkbox cannot be discovered or read by a keyboard user scanning the form. Spectrum and Web Awesome behave the same way, so this is conventional, but `aria-disabled` would be kinder in a long form.
- **`opacity: 0.45` for disabled** will fail text contrast against most seasons' backgrounds.
- **Focus-visible paints its own ring**: `outline: 2px solid var(--ring)` with a 2px offset, since `appearance: none` discards the UA ring.
- The `clip-path` tick has no `forced-colors` treatment, so in Windows High Contrast mode the checked state may render as an empty box.

## Theming

`--pretui-control-rest` (falling back to `--field`), `--pretui-control-border` (falling back to `--input`), `--pretui-control-hover` (falling back to `--hover`), `--primary` (checked fill), `--primary-foreground` (the tick), `--border` (mixed into the checked hairline), `--pretui-edge-highlight` (the inset top highlight that gives the checked box its pressed-metal read), `--pretui-dur-snap` / `--pretui-ease-snap`, `--text-ui-md`.

The 15px box, 5px radius and 9px tick are fixed; a season cannot scale the control. If a season sets `--primary` very light, the tick (painted `--primary-foreground`, usually white) disappears — define both together, as with Button's tone/on-tone pairs.

## React ecosystem

Accept `isSelected` / `indeterminate` / `isDisabled`. Card-shaped
choices are **CheckboxCard**.
