## What it is

A date the reader already knows — a birthday, an issue date, an expiry — typed into three boxes rather than browsed in a calendar.

Nobody scrolls back forty years to find their own birthday. This is not a second date control: **DatePicker** and **Calendar** are for a date you are *choosing*; this is for one you are *recalling*.

## The contract

```
@value?      — the INITIAL date, YYYY-MM-DD
@onChange?   — fires on every keystroke with the ISO date, or undefined while the
               three boxes do not yet describe a real date; the second argument
               carries the reason
@label?      — the fieldset's legend
@hint?       — example copy under the boxes, associated with all three
@reference?  — the instant relative phrasing and two-digit years are measured against
@min?, @max? — earliest and latest accepted dates, YYYY-MM-DD
@disabled?
@locale?     — BCP-47 tag deciding field ORDER and month vocabulary
@quiet?      — suppress the echoed confirmation line
```

**`@value` seeds and then stops mattering.** The component owns the three boxes after mount and reports through `@onChange`; re-key it to seed again. That is named in the contract rather than hidden, because a re-seeding control would have to write tracked state from a modifier during render — a backtracking re-render waiting to happen.

**Nothing here reads the clock.** `@reference` is how relative phrasing and two-digit-year expansion get an "now" — omit it and no relative phrase is shown at all. Realm code may not read the clock, so the app passes its own.

**Parsing is deliberately permissive.** `3`, `mar` or `March` all work in the month box; `90` works in the year box; a whole date pasted into any one of them is distributed across all three.

**`@onChange` reports `undefined` with a reason while the boxes do not describe a real date**, so a form decides when to show the problem rather than the component deciding for it.

**`@locale` moves the field order and the month vocabulary only.** The labels stay in the interface language.

## Prior art

**`wa-known-date`.**

Where Pretui is better: the reason accompanying an incomplete value, so a form can distinguish "not finished" from "wrong"; the clock-free design, which is a realm requirement and also makes the component deterministic in a test; and locale affecting order without dragging the interface language with it.

Where it is thinner: no calendar fallback for a reader who would rather browse, no era or non-Gregorian calendars, and no partial dates — a month and year without a day is a real thing to want for an expiry, and this cannot express it.

## Accessibility

- **The three boxes are a `fieldset` with a legend from `@label`**, so they are announced as one field with three parts rather than as three unrelated inputs.
- **`@hint` is associated with all three boxes** through `aria-describedby`, not just the first.
- **The verdict line is a polite `role='status'` live region.** It echoes what was understood — "3 March 1990" — which is the affordance that makes permissive parsing safe: the reader can see that `mar` and `90` became what they meant.
- **`@quiet` suppresses that echo**, and should be used only when the surrounding form shows the same confirmation.
- **Relative phrasing depends on `@reference`.** Without it there is no "34 years ago", which is a loss for comprehension but never a loss of the value itself.
- **Errors are reported through `@onChange`'s reason rather than rendered**, so the form owns the message and its placement.

## Theming

`--pretui-knowndate-day-width`, `--pretui-knowndate-month-width` and `--pretui-knowndate-year-width` size the three boxes independently, and `--pretui-destructive-ink` carries the invalid state.

Three separate width tokens rather than one is the point: a month box wide enough for "September" and a day box wide enough for "31" are very different, and a season that sets them together produces either a cramped month or three boxes of wasted space.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
