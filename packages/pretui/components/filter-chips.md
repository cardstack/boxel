## What it is

A horizontal row of status chips that filter a list, each optionally carrying a count. Use it above a **DataGrid**, a **Feed** or a **Grid** where the filter is a named bucket — All / Open / Blocked / Done — or, with `@multiple`, a set of them. If the filters live in a sidebar, **FilterList**. If the filter is a structured predicate, **FilterSet**.

## The contract

```
@options: { value, label, count?, hue? }[]
@value?, @defaultValue?, @onValueChange?(value: string)
@multiple?, @values?, @defaultValues?, @onValuesChange?(values: string[]), @label?
@display? 'all' (default) | 'few', @visibleCount? (3), @moreLabel? ('more filters')
```

Hybrid controlled/uncontrolled. Single-select is seeded from `@defaultValue ?? options[0].value`, so it always has exactly one selection and can never be in a "nothing selected" state. `@multiple` is seeded from `@defaultValues ?? []` and may be empty.

**It is single-select by default, and looks like a multi-select.** Without `@multiple` the chips behave like a **SegmentedControl** that happens to be chip-shaped: exactly one is chosen. With `@multiple` they toggle independently (`@values`, `@defaultValues`), and the group's role changes to match (see Accessibility).

**`count` and `hue` are per-option data.** The count rides a tabular-numeral dress shared with **FilterList**; the hue feeds the same Law-2 derivation **Chip** uses, so a filter chip and a status chip for the same value can be given the same colour.

**`@display='few'`** keeps the first `@visibleCount` chips plus any selected one on a single line and puts the rest behind a `+N` trigger that opens a **Menu** (radio rows, or checkbox rows with `@multiple`). The trigger's name is `+N` followed by `@moreLabel`, so it starts with its visible text. The menu rows carry labels only: **Menu** has no slot for a chip's hue dot or count.

Adopted from Beautiful UI: status chips that filter live data.

## Prior art

**React Spectrum's `TagGroup`** with `selectionMode` is the closest real component: roving tabindex, arrow navigation, Delete-key removal, and proper `role="listbox"`/`option` semantics. **Web Awesome `wa-tag`** is display-only with a `with-remove` affordance. **Radix `ToggleGroup`** with `type="single"` or `type="multiple"` is the structural analogue and exposes `rovingFocus` and `loop`. **shadcn** has no filter chips.

Where Pretui is ahead of the shadcn-style hand-roll: counts and hues are declared per option rather than composed, so a row of filter chips is one line derived from a model, and the hue derivation matches **Chip**'s so the whole ink territory agrees.

Where it is behind Spectrum's `TagGroup`: **no per-option removal and no Delete-key handling**. Its roles and keyboard model are right: native radios and checkboxes inside a labelled group, so the platform supplies them.

## Accessibility

The row is a labelled group of native inputs, so the role matches how the chips behave:

- **Single-select** is `role="radiogroup"` over visually hidden `<input type="radio">` elements sharing one `name`, with each chip's `<label>` wearing the chip dress. The chips are one Tab stop, and the arrow keys move _and_ select, with the platform's wrapping.
- **`@multiple`** is `role="group"` over native `<input type="checkbox">` elements. Each chip is its own Tab stop, and Space toggles it. A radiogroup would be wrong here, since any combination is legal.
- **It is not a tablist.** A filter row picks a value; it does not swap a panel, and there are no `aria-pressed` buttons.
- **`@label`** names the group. Pass it: the prop is optional, but without one the row has no accessible name.
- **`@display='few'`** adds the `+N` menu trigger as one more Tab stop. The arrow keys move only among the chips on screen, and the chips in the menu are reached through the menu.

Remaining gaps:

- **The count is inside the chip**, so it joins the accessible name: "Blocked 12". Acceptable, but "12" has no unit.
- **The filter change is not announced**, and neither is the resulting row count. A `role="status"` region is the caller's job.
- **Hue conveys nothing** to assistive tech — correct, since the label carries the meaning, but it does mean a theme must not use hue as the only distinction between two similarly-named filters.
- Chip height is 18–28px depending on dress; check against WCAG **2.5.8**'s 24×24 minimum.

## Theming

Per-option `hue` feeding **Chip**'s Law-2 derivation (`--pretui-chip-mix`, `--pretui-ink-mix`, mixed against `--card`, hairline against `--border`), plus `--foreground`, `--muted-foreground`, `--hover` for resting and hover states, the count's tabular-numeral dress, and `--text-ui-xs`/`--text-ui-md`.

Because the selected chip and the unselected ones differ by fill strength within the same hue, a theme that raises `--pretui-chip-mix` narrows that gap — the selected state can become hard to pick out in a row of tinted chips. Check the selected chip against its unselected neighbors, not against the page.

Per-instance knob: `--pretui-filterchip-h` (chip height, `1.625rem` by default), read after `--pretui-row-h` (the height LayoutControl's `@controlHeight` sets), which wins, on a touch screen too (where a chip is otherwise at least `2.125rem`); the corner is half of it, so a taller chip stays a pill.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
