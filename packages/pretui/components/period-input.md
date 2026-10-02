## What it is

A named-period parser: type `Q3`, `Jan 2026`, `W12` or `Fall 2025` and get a typed, sortable range.

It is the control for a field whose value is a *period* rather than a date — a reporting quarter, a fiscal year, a week number — where a calendar is the wrong shape entirely.

## The contract

```
@value?, @defaultValue? — the period token ('2026-Q3') or any recognised text
@reference?       — the instant a partial period like 'Q3' resolves against, YYYY-MM-DD
@locale?          — BCP-47 tag for month names and the resolved range
@fiscalYearStart? — the calendar month a fiscal year starts in, 1–12. Default 1
@fiscalYearLabel? — whether a fiscal year is named for the year it starts or ends in
@hemisphere?      — which hemisphere the season names describe
@label?, @hint?, @controlId?
@disabled?
@noStep?          — hide the previous / next stepper
@quiet?           — hide the accepted-forms line
@onChange?        — fires with the resolved period, or undefined and the reason
```

**Without `@reference`, a partial period is refused with a message rather than resolved against the wall clock.** `Q3` alone is not a period — it is a quarter of some year — and guessing which year from the system clock produces a value that changes meaning on New Year's Day. Realm code may not read the clock, and this is the honest consequence.

**Fiscal years are configurable in both directions.** `@fiscalYearStart` says which month begins the year; `@fiscalYearLabel` says whether FY2026 is the one that *starts* in 2026 or the one that *ends* there. Both conventions are in use and neither is a default anyone can assume.

**`@hemisphere` decides what the season names mean.** "Fall 2025" is a different range in Sydney than in New York.

**`@onChange` reports the reason when there is no period**, so a form decides when to show it.

## Prior art

The kit's own `fields-configuration` month, quarter, week and year specs — four separate field types this replaces with one.

Where Pretui is better: one control instead of four, a real refusal rather than a clock-based guess, and fiscal and hemisphere conventions as configuration rather than as assumptions.

Where it is thinner: no range of periods ("Q1–Q3"), no custom period definitions beyond the built-in vocabulary, and no calendar affordance for a reader who would rather pick than type.

## Accessibility

- **The accepted-forms line is the component's most important affordance.** A permissive parser with no visible vocabulary is a guessing game; the line says what it understands, and `@quiet` should only remove it when the form says the same thing elsewhere.
- **The resolved range is announced through a polite `role='status'` region**, so a reader can confirm that `Q3` became the right three months.
- **The box carries `aria-invalid` and an `aria-describedby`** pointing at the explanation, so a refusal is both announced and located.
- **The stepper buttons are individually named** — previous and next period — and use `aria-disabled` so they stay announced at the bounds rather than disappearing.
- **`@hint` is ghost text behind the box, not a `placeholder` attribute**, so the field keeps its accessible name once typing starts.
- **A refused partial period explains why**, which is the difference between "that's not valid" and "say which year".

## Theming

`--pretui-destructive-ink` for the invalid state, over the kit's shared control tokens; the ghost text and the stepper take the standard muted and control treatments rather than component-specific values.

The deliberate absence of a token surface here is the point: a period field should be indistinguishable from a text field on the same form until it is used, so nothing about it is separately themeable.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
