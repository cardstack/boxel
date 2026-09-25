## What it is

**THE Pretui date surface.** One month-grid implementation — pure date math, roving-tabindex arrow keys, single and range modes — shared by every date control in the kit. Use it inline when the calendar should always be visible (a booking view, a scheduling panel). If it should live behind a field, use **DatePicker** or **DateRangePicker**, both of which wrap this exact component. There is deliberately no second calendar anywhere in the kit.

## The contract

```
@mode? 'single' | 'range'   (default 'single')
single:  @value? / @defaultValue? / @onValueChange?(iso)
range:   @range? / @defaultRange? / @onRangeChange?({ start, end })
@months? (default 1), @minDate?, @maxDate?, @disabled?
```

**ISO `yyyy-mm-dd` strings at every boundary.** Not `Date` objects, not timestamps. The reason is that ISO date strings **compare lexicographically** — `'2026-03-04' < '2026-03-11'` is true — so the entire range and bounds math runs on string comparison with no `Date` construction, no timezone, and no off-by-one from a UTC/local mismatch. That is the single best decision in this component, and it is why a range calendar here has none of the DST bugs the category is famous for.

**Range semantics:** first click sets `start` with `end: null`, second completes; picked in reverse they swap. While the end is unset, the prospective span paints from the hovered day — **or from the keyboard focus when arrowing**, so the preview works without a pointer.

**Day state is reflected as `data-*`**: `data-selected`, `data-range-start`, `data-range-end`, `data-in-range`, `data-today`, `data-outside`. A season dresses every state without the component exposing a variant.

`@months` puts panels side by side; **an inline-size container query collapses to the first panel** in a narrow host. Note the consequence the source flags: containment means width comes from the parent, so **a host or popover panel must give the calendar an explicit width**.

## Prior art

**React Aria's `useCalendar`/`useCalendarGrid`** is the most complete implementation in the field, and the comparison is instructive: it renders `role="application"` on the calendar (with the visible range folded into the accessible name), `role="grid"` on the table, `aria-hidden` column headers (day names are already in each cell's label), and announces month changes imperatively via `announce(visibleRangeDescription)` — but **only** when the change came from the Prev/Next buttons, not when it came from arrowing. **Web Awesome** has no calendar. **react-day-picker** is the ecosystem default and is `role="grid"` based.

Where Pretui is better: **lexicographic ISO math** (above) — react-day-picker and Spectrum both carry substantial date-object machinery (Spectrum has an entire `@internationalized/date` package) to avoid the bugs that string comparison simply does not have. And **one calendar for the whole kit**: the source records that `DateRangePicker` previously wrapped boxel-ui's ember-power-calendar and that the wrap was deliberately deleted so both date controls share this grid. Two calendars in one kit is a guaranteed inconsistency.

Where it is behind, and it is a real distance: **no locale support.** Every formatter is hard-coded `'en-US'`, so weekday order, month names and day names are American English regardless of the user. For an internationalised product this is disqualifying, and it is the largest gap in the component.

Also absent: year/month dropdown navigation, week numbers, multi-date (non-range) selection, and any notion of a disabled _set_ of dates beyond min/max.

## Accessibility

Governing pattern: APG's **datepicker dialog** grid — `role="grid"` on the table, roving `tabindex` on cells, `aria-selected` on the selected date, and a specific keyboard contract.

The implementation takes a different, defensible route: **days are `<button aria-pressed>` in a plain container**, with a roving tabindex and `focusWhen` moving real focus. Toggle-button semantics rather than grid semantics. That is legitimate — each day announces as a pressed/unpressed button with a full `aria-label` (weekday, month, day, year via `LABEL_FMT`) — and it avoids the grid pattern's complexity. But it means the calendar is **not announced as a grid**, so a screen-reader user gets no row/column context and no "week of" orientation.

Concrete gaps against the pattern:

- **Only Arrow keys are implemented.** `ArrowLeft/Right` are ±1 day, `ArrowUp/Down` are ±7. **Home/End (first/last day of the current week), Page Up/Page Down (previous/next month), and Shift+Page Up/Page Down (previous/next year) are all missing.** That is more than half the pattern's key list, and it means keyboard users must arrow through 30 presses to change month. This is the highest-value fix on the component.
- **Arrow keys hard-stop at `@minDate`/`@maxDate`** — the handler returns rather than clamping, so focus simply does not move and nothing says why.
- **No live region on the month heading.** APG's pattern puts `aria-live="polite"` on the month/year heading so navigation announces; React Aria announces imperatively. Here, pressing "Next month" changes the visible grid silently. Arrow navigation across a month boundary does call `setViewToInclude`, so the view follows focus — good — but that change is also silent.
- **Weekday headers are plain `<span>`s** with no association to the columns. Since each day's `aria-label` includes the weekday name, nothing is lost for screen-reader users, and the spans should arguably be `aria-hidden` (React Aria hides its column headers for exactly this reason).
- **No accessible name on the calendar itself.** No `aria-label`, no `role`. Two calendars in a range picker are two unnamed groups.
- **`aria-pressed` on the day buttons is not the range vocabulary.** In range mode, `data-in-range` days are visually part of the selection but their pressed state does not reflect that, so a screen-reader user hears only the two endpoints as pressed.
- **`disabled` on out-of-range days** removes them from the tab order entirely, which is right for a roving-tabindex composite.
- `data-today` styling exists; verify it is not colour-only.

## Theming

`--pretui-selected` / `--primary` (selected day), `--hover` (hover and in-range fill), `--foreground` / `--muted-foreground` (day ink, and the dimmed `data-outside` days), `--border`, `--card`, `--radius`, `--text-ui-md`, `--text-ui-sm`.

Every day state is a `data-*` attribute, so a season can dress `today`, `in-range`, `range-start` and `range-end` independently — including giving the range endpoints asymmetric radii, which is what makes a range read as one continuous band.

Two things to check per season: `data-today` must be distinguishable from `data-selected` without relying on colour alone, and `data-outside` (adjacent-month days) must be dim enough to recede but still clear **WCAG 1.4.3** — it is the most common contrast failure in any calendar.
