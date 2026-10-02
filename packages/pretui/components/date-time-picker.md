## What it is

**A date and a time in one field**, committed as one wall-clock datetime such as `2026-10-02T07:30`. Use it for a meeting start, a roast slot, a delivery window, or any moment that needs both halves.

Reach for a neighbour when only one half is needed:

- **DatePicker** is a date alone.
- **TimeInput** is a time alone.
- **Calendar** is an inline month grid with no field.

## The contract

```
@value?, @defaultValue?, @onChange? (alias @onValueChange)
@granularity? ('minute' | 'second'; default 'minute'), @hourCycle?
@label? (default 'Date and time'), @placeholder?
@minDate?, @maxDate?, @disabled?
Element: HTMLSpanElement
```

**One field, one popover.** The trigger opens a popover with a **Calendar** above a **TimeInput** and a Done button. Choosing a day and setting the time change a draft. Done commits the draft as one string and closes the popover.

**The value always has the `T` and no zone.** It is `YYYY-MM-DDTHH:MM`, with `:SS` at second granularity, and a seeded value is fitted to the granularity (padded with `:00`, or trimmed): the wall-clock shape a DateTimeField stores. Time zones belong to the field, not the picker.

**A half-filled value never leaves.** Done is `aria-disabled` until both a day and a time in exactly the granularity's shape are set, and pressing it early does nothing. Closing without Done keeps the committed value. Opening again seeds the draft from it, so changing only the day keeps the time.

## Prior art

**Mantine `DateTimePicker`** takes `value`, `onChange`, `withSeconds`, `valueFormat`, `minDate`, `maxDate` and `submitButtonProps`, and has the same one-popover-plus-submit shape. **Ant `DatePicker showTime`** adds a time column beside the calendar with an OK button. **MUI X `DateTimePicker`** is a stepped view with tabs.

Where Pretui is better: **the committed value is one explicit string** with no `Date` object, zone or format to configure, and **Done refuses a half-filled value**. Mantine emits a `Date` in local time.

Where it is thinner: **no typed input.** The field is a button, so you can't type "2026-10-02 07:30". There are **no presets** ("Now", "Tomorrow 9:00"), **no range mode**, and **no time-zone selection**.

## Accessibility

A disclosure trigger opening a dialog-like popover, composed from **Calendar** and **TimeInput**, each with its own pattern.

- **The trigger** is a `<button>` with `aria-haspopup="dialog"` and `aria-expanded`. It is named "{label}: {date}, {time}", or "{label}: {placeholder}" while empty, so the name includes the visible text (WCAG 2.5.3) and the committed value is heard. The tests assert the name, including the committed time, and the expanded state.
- **The calendar** is Calendar's grid of day buttons with its roving keyboard, and **the time** is TimeInput's labelled group of spinbuttons.
- **Done is `aria-disabled`, not `disabled`,** so it stays focusable and announced while it refuses. The tests assert that it refuses and then commits.
- **ArrowDown on the trigger opens it**, as for DatePicker. Escape and an outside click close it through **Popover**.

## Theming

The trigger reads `--input-background`, `--input`, `--ring`, `--radius-control`, `--pretui-control-h`, `--foreground`, `--muted-foreground`, `--font-sans` and `--text-ui-md`. The panel reads **Popover**'s tokens (the width is set with `--pretui-popover-width`), **Calendar**'s and **TimeInput**'s own, `--border` for the rule above the time, and `--space-2` / `--space-3`.

The panel's one-month width is fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                               | Give them                           |
| ----------------------------------------- | ----------------------------------- |
| Mantine `<DateTimePicker value onChange>` | `<DateTimePicker @value @onChange>` |
| Mantine `withSeconds`                     | `@granularity='second'`             |
| Ant `<DatePicker showTime>`               | `<DateTimePicker>`                  |
| `Date` object values                      | an ISO wall-clock string with `T`   |
| Ant `presets`                             | not supported                       |
