## What it is

A date field: a Pretui **Input** as the trigger, a **Popover** holding a single-mode **Calendar**. Use it wherever a single date is collected. For a start/end pair, **DateRangePicker** — do not compose two of these, because a range needs the prospective-span preview that only range mode gives. For a time of day, **TimeInput**. For a relative timestamp you are displaying rather than collecting, **RelativeTime**.

## The contract

```
@value? (ISO yyyy-mm-dd), @defaultValue?, @onValueChange?(iso), @disabled?
```

Four args, and the shortness is the thing to notice — see the gaps below.

ISO `yyyy-mm-dd` strings at the boundary, matching **Calendar** — which means the value a form stores is the value the component speaks, with no parsing step and no timezone in play.

**It is a composition, not a new implementation.** The trigger is the kit's **Input** so it matches every other field in a form pixel for pixel; the surface is the kit's **Popover** so it inherits light-dismiss, Escape and the anchored positioning; the grid is the kit's one **Calendar**. Nothing here re-implements date logic. That is the whole design, and it is why fixing a bug in Calendar fixes it in both date controls at once.

**The trigger opens on Enter, Space or ArrowDown** — the standard combobox-style opening keys — which is a genuine addition over the underlying Popover, whose trigger is otherwise pointer-only.

## Prior art

**React Spectrum `DatePicker`** is the reference: a _segmented_ field (each of day/month/year is its own `role="spinbutton"` with `aria-valuetext`) plus a calendar popover, with `granularity`, `minValue`/`maxValue`, `isDateUnavailable` and full internationalisation through `@internationalized/date`. **Web Awesome** ships no date picker. **shadcn** composes Popover + react-day-picker + a Button trigger.

Where Pretui sits: closer to shadcn's composition than to Spectrum's segmented field, and honestly so. The improvement over the shadcn recipe is that **the trigger is a real text input** rather than a button showing formatted text — so the value is visible, selectable, and copyable — and that everything is kit components rather than an assembly of three libraries.

The improvement over Spectrum, such as it is: much less machinery. The cost is everything Spectrum's machinery buys — no locale support (the formatters are hard-coded `en-US`), no granularity, no unavailable-dates predicate, no time component.

**It also has no date bounds and no placeholder**, which **DateRangePicker** does have: that component takes min and max dates, this one takes four args and none of them constrain the value. A single date that must fall inside a window has to be validated by the form around it.

**The segmented-field question is the interesting trade.** Spectrum's approach — three spinbuttons — is more accessible for keyboard entry and much better for screen readers, because each segment announces its own value and steps independently. A single text input is simpler and lets a user paste a date. Pretui chose the input; that is defensible, and it does mean typed entry has no parsing feedback (see below).

## Accessibility

Governing pattern: APG's **datepicker dialog** — a trigger with `aria-haspopup="dialog"` and `aria-expanded`, a modal or non-modal dialog containing the grid, focus into the dialog on open and back to the trigger on close.

What is right: `aria-haspopup="dialog"` and `aria-expanded` are both present on the trigger — which is more than **Menu** or **Popover** do in this kit, and worth noting as the right pattern the others should copy. Enter/Space/ArrowDown open.

Gaps, and they stack:

- **The Popover's own gaps are inherited.** Focus is not moved into the panel on open and not restored to the trigger on close, and **Escape only works once focus is already inside the panel** — so opening the calendar with the keyboard and pressing Escape does nothing. For a date picker that is a genuine trap: the user has opened a surface they cannot dismiss without tabbing into it first.
- **All of Calendar's keyboard gaps apply**: Arrow keys only, no Home/End, no Page Up/Down for month, no Shift+Page for year, and no live-region announcement of month changes.
- **Typed input is not validated or parsed against the calendar.** The trigger is an `Input`; what happens when a user types "next tuesday" or "3/4/26" into it is unspecified by the component, and there is no `aria-invalid`, no error message, and no format hint. **WCAG 3.3.2** wants the expected format stated — use **FormField**'s `@description`.
- **No accessible name of its own, and no `controlId` arg to wire one.** Unlike **Input**, this component does not accept an id for a wrapper's `<label for>`, so outside a labelling wrapper the name has to arrive as an `aria-label` through `...attributes`.
- **The selected date is not announced on selection** — the popover closes and the input's value changes silently.
- **`@disabled` uses the native attribute**, removing the trigger from the tab order.
- Because Popover renders in place with a `position: fixed` panel, an `overflow: hidden` ancestor can still clip it in some layouts — and the Calendar needs an explicit width from its host, so a mis-sized popover is the first thing to check when the grid renders squashed.

## Theming

Trigger: **Input**'s tokens (`--field`, `--input`, `--primary` via `--ring`, `--ink-3`, `--control-h`, `--radius`, `--text-ui-md`). Surface: **Popover**'s (`--popover`, `--popover-foreground`, `--pretui-shadow-overlay`, and the `--pretui-popover-*` sizing knobs — which is where you set the calendar's width). Grid: **Calendar**'s day-state tokens.

Three components' token sets, no tokens of its own — which is the intended shape. The one thing a season must do here that it does not have to do elsewhere is **set `--pretui-popover-width` or `--pretui-popover-min-width` wide enough for a month grid**, since Calendar's inline-size containment means it takes its width from the panel rather than pushing the panel open.

## React ecosystem

Date only (DateField, `YYYY-MM-DD`, no `T`). Date+time is
**DateTimePicker**. Range is **DateRangePicker**. Permissive birthday
is **KnownDate**. Accept `onChange` / `isDisabled` / `min` / `max`.
