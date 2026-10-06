## What it is

**Transfer** is **DuelingPicklist** under the name Ant Design uses. The export is the same class; nothing is re-implemented. Import it when a port or an agent already speaks Ant's vocabulary — two lists, move buttons, `targetKeys` — and wants the first guess to resolve. The depth lives in the **DuelingPicklist** writeup: this page only says what the name maps to.

## The contract

```
@options            — every record in play: {id, label, meta?, icon?, locked?}
@value? / @defaultValue?   — the selected list as an ORDERED id list
@label? @availableLabel? @selectedLabel?
@reorder? @disabled? @required? @rows?
@onValueChange?     — the full ordered id list after every move
<:option as |record state|>
```

Identical to DuelingPicklist. The one rule worth restating under this name: **the order of `@value` is the payload**, which is where Ant's `targetKeys` set and this control part ways.

## Prior art

**Ant `Transfer`** takes a flat `dataSource` plus `targetKeys`, renders the same row on both sides, and adds what DuelingPicklist does not have: a search box per list, `oneWay` (a single direction with a per-row remove), pagination inside each list, and a `render` prop for the row. DuelingPicklist has none of those and instead has the SLDS half Ant lacks — the up/down **reorder column**, `locked` records that cannot leave, a polite live region that announces every move, and focus that follows the moved records into the destination list. Ant announces nothing and leaves focus on the button. Neither drags.

## Accessibility

Two multi-select listboxes (`role="listbox"` with `aria-multiselectable`, `role="option"` with `aria-selected`) inside a labelled group. Each list has its own accessible name from `@availableLabel` / `@selectedLabel`, the group's from `@label`, and every move is announced with the destination noun. Arrows move, Space toggles, Shift extends, Ctrl/Cmd+A selects all, Ctrl/Cmd plus left/right transfers, Alt plus up/down reorders. Locked records carry `aria-disabled`. There is no drag path, so WCAG 2.5.7 does not arise.

## Theming

**RecordFace**'s row tokens, `--card` / `--inset` for the two list surfaces, `--border` for their edges, `--pretui-selected` and `--hover` for option states, and **Button** / **IconButton** tokens for the move and reorder controls. A season must keep the two surfaces visually equal and `--pretui-selected` distinguishable from `--hover` within one list.

## React ecosystem

| Ant Transfer | Pretui Transfer |
| --- | --- |
| `dataSource` | `@options` |
| `targetKeys` / `onChange(nextTargetKeys)` | `@value` / `@onValueChange` — order kept |
| `titles=[left, right]` | `@availableLabel` / `@selectedLabel` |
| `render` | `<:option>` |
| `oneWay` | not supported; both directions always show |
| `showSearch` / `pagination` | not supported; filter before handing over |
