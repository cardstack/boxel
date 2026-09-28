## What it is

A start/end date field: a Pretui **Input** trigger, a **Popover**, and a **Calendar** in range mode showing two months by default. Use it for any span — a report period, a booking, a filter window. Do not compose two **DatePicker**s: a range needs the prospective-span preview and the swap-on-reverse-selection behaviour, and two independent fields give you neither plus a validation problem.

## The contract

```
@value? { start, end } / @defaultValue? / @onValueChange?({ start, end })
@minDate?, @maxDate?, @months? (default 2), @disabled?
```

ISO `yyyy-mm-dd` strings throughout, matching **Calendar** — which compare lexicographically, so the range math needs no `Date` objects and has none of the timezone bugs the category is known for.

**`@onValueChange` fires on _both_ clicks**, with `end: null` after the first. That is the decision worth knowing: the caller sees the intermediate state, so it can disable a submit button or show "select an end date" while the range is half-built. A component that only reported completed ranges would hide that state.

Picked in reverse, start and end swap. While the end is unset, the prospective span paints from the hovered day **or from the keyboard focus when arrowing** — so the preview is not pointer-only.

`@months` defaults to 2, and a narrow container collapses to the first panel via an inline-size container query.

## Prior art

**This was previously a wrap of boxel-ui's ember-power-calendar `DateRangePicker`, and the wrap was deliberately deleted** so both Pretui date controls share the same **Calendar**. That is the design decision to understand: two calendar implementations in one kit is a guaranteed inconsistency — different keyboard behaviour, different disabled-day rules, different visual language — and the rebuild traded a working third-party component for one that agrees with **DatePicker** in every detail.

**React Spectrum `DateRangePicker`** is the field's reference: two segmented fields (each segment a `role="spinbutton"`), a range calendar, `minValue`/`maxValue`, `isDateUnavailable`, `allowsNonContiguousRanges`, and full internationalisation. **react-day-picker** with `mode="range"` is the ecosystem default. **Web Awesome** ships nothing.

Where Pretui is better than the react-day-picker composition: it is one component with one keyboard model rather than a Popover plus a calendar library plus a trigger you wired yourself, and the trigger is a real **Input** so the value is visible and copyable.

Where it is behind Spectrum, plainly: **no locale support** (formatters are hard-coded `en-US`), no segmented entry, no unavailable-dates predicate, no minimum or maximum span length, and no preset shortcuts ("Last 7 days", "This quarter") — which is the feature every analytics range picker has and the one users reach for first.

## Accessibility

Governing pattern: APG's **datepicker dialog**, plus the range-specific problem that there is no settled pattern for communicating a _span_ to a screen reader.

What is right: `aria-haspopup="dialog"` and `aria-expanded` on the trigger — the correct wiring, and more than **Menu** or **Popover** do in this kit. Enter/Space/ArrowDown open the panel.

Gaps, and the range-specific one is the interesting one:

- **The span is visual only.** `data-in-range` days are dressed as part of the selection, but their `aria-pressed` is false — only the two endpoints report as pressed. A screen-reader user arrowing through a selected range hears "March 4, pressed", then eleven unpressed days, then "March 15, pressed". There is no announcement of "in selected range" and no live region reporting the span's length. Spectrum announces the range description on change; nothing here does.
- **The half-built state is silent.** After the first click the component is waiting for an end date, and nothing announces that. This is exactly the state `@onRangeChange`'s `end: null` exists to let _you_ surface — do it, in a `role="status"` region.
- **Both Popover gaps are inherited**: focus is not moved into the panel on open or restored on close, and **Escape only works once focus is inside the panel**, so a keyboard user who opens the picker cannot dismiss it without tabbing in first.
- **All of Calendar's keyboard gaps apply** — Arrow keys only; no Home/End, no Page Up/Down for month, no Shift+Page for year — and they hurt more here, because selecting a range across two months means arrowing across a month boundary twice.
- **The two month panels have no individual accessible names**, so a screen-reader user cannot tell which month they are in without reading a day's label.
- **No accessible name of its own.** Use **Field**/**FormField**, or pass `aria-label`.
- **No format hint for typed entry** (**WCAG 3.3.2**), and no parsing feedback.
- Calendar's inline-size containment means the popover must be given an explicit width — at `@months={{2}}` that is roughly double, and a too-narrow panel silently collapses to one month.

## Theming

Trigger: **Input**'s tokens. Surface: **Popover**'s, including the `--pretui-popover-*` sizing knobs — which you **must** widen for two panels. Grid: **Calendar**'s `data-*` day states.

The range-specific dressing is where a season earns its keep: `data-range-start`, `data-in-range` and `data-range-end` should read as one continuous band, which usually means asymmetric radii on the endpoints and a flat fill between them. Because those are `data-*` attributes rather than component args, a season can do that entirely in CSS.

Check `data-in-range` against `--hover` per season: the in-range fill and the pointer-hover fill often use the same token, and when they do, the user cannot tell the committed range from the one they are previewing.
