## What it is

A grouped field: several sub-fields under one legend, laid out in rows — a name, an address, a date range, a money amount with a currency. Use it whenever several inputs are conceptually one answer. If they are independent, they are separate **FormField**s in a **FormLayout**. If they are a repeating set, that is a table or a list, not a compound.

## The contract

```
@label: string   (required — a real <legend>)
@path?, @issues?, @hint?
@collapsible?, @open? / @defaultOpen? (true), @onOpenChange?, @disabled?
@variant? 'default' | 'address'
@span? 'auto' | 'full'
<:default as |{ Row }|>
Element: HTMLFieldSetElement
```

**`R.Field`s go inside a `Row`, and they keep participating in the record's batch** — because a compound is a *layout and legend contract*, not a second state machine. That is the design decision that keeps it composable: a CompoundField inside a **RecordDetail** does not intercept anything.

**`@path` is the compound's own BXL label path.** Issues targeting the compound itself (`Billing Address`) render here; issues targeting sub-fields render on their fields. Matched as a whole string, never split — the same rule as **FormField**.

**The presentation is `FormSection`**, which is why `@collapsible` exists at all; the earlier hand-rolled version had no disclosure.

## Prior art

**SLDS is the layout ancestor** (`slds-form-element__row`, `slds-form-element_address`). **GOV.UK is the better ancestor for how a grouped field *behaves***, because its patterns are user-tested on people filling in forms that matter, and the 2026-08-13 rebuild adopted three of its rules:

- **Errors render between the legend and the fields, never beneath them.** A screen reader then hears the problem as part of the group's introduction, and a sighted user reads it *before* filling rather than discovering it underneath afterwards. This is the single most consequential difference from the SLDS shape.
- **`@hint` is visible text, not a tooltip.** Guidance needed in order to answer must be readable without hover — which does not exist on touch. `@help` stays for nice-to-know detail only.
- **The legend is typed as a Label, one step stronger than its sub-field labels**, because it names a control group. It had been an uppercase mono eyebrow, which is section-divider typography and read as chrome rather than as a label.

Four defects were fixed in the same pass, and they are worth recording because each is a class of bug:

1. **The Row paired `grid-auto-flow: column` with an explicit track list**, so children past the last declared track created *implicit* columns instead of wrapping — a row never wrapped at any width. Now `auto-fit` + `minmax`, which reflows through every intermediate count.
2. **The `address` variant set `align-items: baseline` on the body**, aligning the Rows against each other rather than the sub-fields — one level too high, so the variant did nothing. It now travels as an inherited custom property to the Row.
3. **The invalid state added `padding-inline-start`**, so every field jumped sideways when validation ran. The bar's gutter is now always reserved and only its colour changes — the same reserved-space discipline **Field** applies to its message line.
4. **`<abbr title='required'>`** — a `title` tooltip does not open on touch and is inconsistently announced. The asterisk is now the visual channel and visually-hidden text is the real one.

**`CompoundRow`'s track list travels as a custom property rather than an inline `grid-template-columns`** — precisely so the narrow container query can override it without `!important`. That is a small, exemplary piece of CSS architecture.

## Accessibility

No APG pattern; a native `<fieldset>`/`<legend>` group, governed by WCAG **1.3.1**, **3.3.1**, **3.3.2** and **3.3.3**.

What is right, and most of it is the GOV.UK inheritance:

- **A real `<fieldset>` with a real `<legend>`.** The group has a name assistive tech announces on entry — more reliable than a reconstructed `role="group"` + `aria-label`.
- **Errors before the fields** (above). This is the accessibility argument, not a visual preference: an error announced after the inputs is an error the user has already failed to act on.
- **`@hint` is visible and wired via `aria-describedby`** by FormSection, so it reaches touch users, hover-less users and screen readers alike.
- **The required marker is visually-hidden text plus a decorative asterisk**, so required-ness reaches the accessible name — the same fix **FormField** made.
- **The invalid gutter is always reserved**, so validation causes no layout shift (**WCAG 3.2.x** in spirit, and a real usability win).
- Native fieldset `@disabled` is announced per control by the platform.

Gaps:

- **Everything inside the legend contributes to the group's accessible name.** A legend carrying a label plus a required marker plus an issue count can produce a long name; keep it short.
- **`@collapsible` uses FormSection's disclosure**: the toggle carries `aria-expanded` and an `aria-controls` that points at the body. A collapsed compound holding an error is only discoverable through the legend's issue count, so leave `hideIssueCount` off.
- **No `aria-level` or heading semantics on the legend**, so a long form's compounds do not appear in a heading list.
- **Sub-field errors render on their own fields**, so a compound with three failing sub-fields shows three messages plus possibly a compound-level one — verify that reads as a hierarchy rather than as four unrelated errors.

## Theming

`--border` and `--pretui-shadow-hairline` (the fieldset edge), `--destructive` (the invalid bar, whose gutter is always reserved), `--foreground` (legend), `--muted-foreground` (hint), plus **Label**'s voice for the legend, **FormField**'s tokens for the sub-fields, and **FormSection**'s for the disclosure.

The Row's track list is a custom property, so a season — or a container query — can retune column proportions without fighting an inline style. The `address` variant's baseline alignment likewise travels as an inherited custom property; that indirection is what made it work at all.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
