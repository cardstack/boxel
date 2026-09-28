## What it is

A horizontal row of status chips that filter a list, each optionally carrying a count. Use it above a **DataGrid**, a **Feed** or a **Grid** where the filter is a single named bucket — All / Open / Blocked / Done. If the filters live in a sidebar, **FilterList**. If several can be on at once, this is not it (see below). If the filter is a structured predicate, **FilterSet**.

## The contract

```
@options: { value, label, count?, hue? }[]
@value?, @defaultValue?, @onValueChange?(value: string)
```

Hybrid controlled/uncontrolled, seeded from `@defaultValue ?? options[0].value` — so a FilterChips row always has exactly one selection and can never be in a "nothing selected" state.

**It is single-select despite looking like a multi-select.** Filter chips in most products toggle independently; these behave like a **SegmentedControl** that happens to be chip-shaped. That is a real constraint to know before you reach for it: if a user needs "Open _and_ Blocked", this component cannot express it, and `aria-pressed` on the chips (see below) actively suggests it can.

**`count` and `hue` are per-option data.** The count rides a tabular-numeral dress shared with **FilterList**; the hue feeds the same Law-2 derivation **Chip** uses, so a filter chip and a status chip for the same value can be given the same colour.

Adopted from Beautiful UI: status chips that filter live data.

## Prior art

**React Spectrum's `TagGroup`** with `selectionMode` is the closest real component: roving tabindex, arrow navigation, Delete-key removal, and proper `role="listbox"`/`option` semantics. **Web Awesome `wa-tag`** is display-only with a `with-remove` affordance. **Radix `ToggleGroup`** with `type="single"` is the structural analogue and exposes `rovingFocus` and `loop`. **shadcn** has no filter chips.

Where Pretui is ahead of the shadcn-style hand-roll: counts and hues are declared per option rather than composed, so a row of filter chips is one line derived from a model, and the hue derivation matches **Chip**'s so the whole ink territory agrees.

Where it is behind Spectrum's `TagGroup`, and the gap is the same one **SegmentedControl** and **Tabs** have in this kit: **no roving tabindex, no arrow navigation**, and — the more serious problem — the wrong roles.

## Accessibility

This is the third component in the kit with the same defect, and it is worth stating plainly.

**The container carries `role="tablist"` while its children are `<button aria-pressed>`.** That is invalid on two counts:

1. **A `tablist` requires children with `role="tab"`.** These have no role at all, so assistive tech is told "tab list, 4 items" and then finds four ordinary buttons.
2. **`role="tablist"` is the wrong pattern regardless**, because nothing here controls a tab panel. APG's guidance is direct: do not use `tablist` unless it actually swaps panels.

And a third, specific to this component: **`aria-pressed` describes an independent toggle**, which contradicts the single-select behaviour. A user is told four buttons each have a pressed state, with nothing conveying that pressing one releases the others.

The correct shape, since this is a single choice from a visible set:

- **`role="radiogroup"`** on the container with an accessible name, **`role="radio"` + `aria-checked`** on each chip, roving tabindex so the row is one tab stop, and Left/Right/Up/Down moving _and_ selecting with wrapping. **RadioGroup** in this kit gets all of that for free by using native `<input type="radio">` with a shared `name`, and the same technique — visually hidden radios with the chips as their labels — would fix this component entirely without changing how it looks.

Remaining gaps:

- **No accessible name** on the group.
- **Every chip is its own tab stop.**
- **The count is inside the chip**, so it joins the accessible name: "Blocked 12". Acceptable, but "12" has no unit.
- **The filter change is not announced**, and neither is the resulting row count. A `role="status"` region is the caller's job.
- **Hue conveys nothing** to assistive tech — correct, since the label carries the meaning, but it does mean a season must not use hue as the only distinction between two similarly-named filters.
- Chip height is 18–28px depending on dress; check against WCAG **2.5.8**'s 24×24 minimum.

## Theming

Per-option `hue` feeding **Chip**'s Law-2 derivation (`--pretui-chip-mix`, `--pretui-ink-mix`, mixed against `--card`, hairline against `--border`), plus `--foreground`, `--muted-foreground`, `--hover` for resting and hover states, the count's tabular-numeral dress, and `--text-ui-xs`/`--text-ui-md`.

Because the selected chip and the unselected ones differ by fill strength within the same hue, a season that raises `--pretui-chip-mix` narrows that gap — the selected state can become hard to pick out in a row of tinted chips. Check the selected chip against its unselected neighbours, not against the page.
