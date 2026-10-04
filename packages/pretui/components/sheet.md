## What it is

A spreadsheet-grade editable data grid: cells you select with the arrow keys, edit in place, sort and quick-filter. **Reach for it when values must be *edited* in place.** **DataGrid** and **Table** are read-only presentations and are the right choice when values only need to be read — they are far less machinery and, being APG *Tables*, do not put the page into a cell-navigation mode.

## The contract

```
@rows, @columns, @density? ('compact'|'default'|'roomy'), @zebra? (true)
@maxHeight? ('22rem'), @editable? (true), @sortable? (true), @defaultSort?
@filter?, @pinFirstColumn?
@validate?(next, column, row) → false keeps the editor open with the bad text intact
@onCommit?(row, key, next), @onSortChange?(sort | null), @onFilterChange?(query)
<:toolbar as |api|>  <:empty>  <:footer as |api|>
```

`@validate` returning `false` **keeps the editor open with the bad text intact** — the correct behaviour for a spreadsheet, where discarding what someone typed is worse than holding a bad value.

## Prior art

Ported from **`@cardstack/surfaces` boxel-grid** — a self-contained ESM bundle with `@tanstack/table-core` v9-alpha inlined, copied into this realm (a cross-realm absolute URL cannot be resolved by local `boxel parse`).

**What the engine supplies, and Pretui does not rebuild:** row/column materialisation, per-cell edit gating, commit routing with retry, the `SheetRuntime` cell-selection and edit lifecycle, the keyboard map (arrows move, Tab/Shift-Tab by flat index, Home/End to the row edge, Enter/F2 open the editor, Escape cancels then clears selection), `role="grid"/"row"/"gridcell"` markup, the sticky header, subgrid column threading so tracks can never go jagged, roving tabindex plus `aria-activedescendant`, and the text/number/date/boolean cell widgets with commit-on-blur.

**What Pretui adds, and why — this list is the component:**

1. **The cloth.** boxel-grid declares its palette *on* the grid element, which beats any inherited value; the documented override channel is the inline `style` splat, so a token map routes every engine variable onto a Pretui token.
2. **`@chrome='none'` plus our own surface**, because upstream's header ships a fixed `box-shadow` behind no variable — un-themable otherwise, and `:deep()` is forbidden.
3. **Sort and quick filter.** `getSheet` builds the table with the core row model only — no sorted row model, no column filters — so the engine cannot sort despite advertising `sortable: true`. Pretui sorts and filters the array *before* handing it over, preserving row object identity so edits still write through.
4. **Header semantics.** Upstream's examples put `role="columnheader"` directly inside the rowgroup — invalid ARIA, and it fails the realm linter. Pretui wraps them in a real `role="row"` subgrid, carries `aria-sort`, and makes each sortable header a real `<button>`.
5. **`aria-rowcount` / `-colcount` / `-rowindex` / `-colindex`.** The engine emits none; without them a screen reader cannot say "row 4 of 18".
6. **Tab is not a trap** — see below.
7. **PageUp/PageDown and Ctrl+Home/Ctrl+End**, bound through the runtime's public `keyboard.bind()` extension point, because the APG grid pattern expects them and the defaults omit them. Space toggles a boolean cell without opening an editor.
8. **Edits actually appear.** Row objects are plain and untracked, so after the engine writes `row[key] = next` nothing invalidates and the cell re-renders its *pre-edit* value. A tracked generation counter bumps on every commit.
9. **Date columns that work.** `getSheet`'s `type: 'date'` reads through `isoDate()`, which returns `''` for anything that is not a `Date` instance — so an ISO string silently renders an empty column. Pretui declares date columns to the engine as text and passes `@type='date'` to the cell, then validates the ISO shape on commit.
10. Validation hook, tabular/mono machine values, density, zebra, sticky first column, empty state, and a live status line.

**Honest limits, stated by the source:** **no range selection** (the engine's `select()` sets the range to the single current cell unconditionally; Pretui styles the in-range state so it lights up when the engine fills it in, but does not claim or reimplement it), **no virtual scrolling** (fine to a few hundred rows, not 100k), **no column resize or engine pinning** (`@pinFirstColumn` is honest CSS `position: sticky`), and **no FieldDef-backed columns** — the interesting Boxel seam, which needs a CardDef context; Sheet takes plain objects only.

## Accessibility

Governing pattern: APG **Grid** — one tab stop, arrows move a cell at a time without wrapping, Home/End to the row edges, Ctrl+Home/Ctrl+End to the corners, Page Up/Down by a screenful, Enter/F2 into edit mode, Escape out.

**The most important fix is a WCAG 2.1.2 No Keyboard Trap failure in the engine.** The runtime binds Tab unconditionally: with no cell selected it selects the first cell and calls `preventDefault`, so **focus can never leave the grid**. Pretui intercepts `keydown` in the **capture phase** on its own wrapper and lets Tab through whenever no cell is selected — and always inside the header chrome, so the sort buttons are reachable at all. The resulting model is clean and worth stating to users: **Arrow to enter the cell plane, Escape to leave it, Tab to leave the grid.**

Also added: the four `aria-*count/index` properties (5), valid header row structure with `aria-sort` (4), the missing Page/Ctrl keys (7), and a live status line announcing filter and sort results.

Remaining gaps:

- **The grid's name defaults to "Data sheet".** Pass `@label` on every Sheet; two Sheets on a page left on the default share one name.
- **In-range styling exists for a selection that cannot happen** — harmless, but a user told about multi-cell selection will not find it.
- **`@validate` returning false keeps the editor open** and the invalid value visible, but nothing announces *why* it was rejected; there is no message channel (**WCAG 3.3.1/3.3.3**).
- **Every visible row renders**; with no virtualisation, `aria-rowcount` equals the rendered count, which is honest but means large data sets are a performance problem before they are an accessibility one.
- Boolean cells are checkboxes (`aria-checked`) that toggle on Space without an editor, so the new state is announced as the cell's checked state.

## Theming

Every boxel-grid engine token is mapped onto a Pretui token with a light literal fallback, delivered through the inline `style` splat because the engine declares its own palette *on* the grid element. Pretui-owned chrome (the hairline, the depth shadow, the header band) uses `--card`, `--inset`, `--border`, `--line-strong`, `--stripe`, `--hover`, plus `--font-mono` for machine values and the density scale.

Nothing branches on dark; every value is `var(--token, lightLiteral)`. The one thing a season cannot reach is anything boxel-grid hard-codes outside its own variable set — which is exactly why `@chrome='none'` exists.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

> [!WARNING]
> **Name collision.** In shadcn / Radix / MUI, `Sheet` is a **slide-over
> panel**. In Pretui, Sheet is a **spreadsheet**. Agents who type "Sheet"
> for a drawer want **Drawer** (also aliased as **SlideOver**).

| Agent types | Give them |
| --- | --- |
| Sheet (slide-over) | **Drawer** / **SlideOver** |
| Sheet (spreadsheet) | this tile |
| Data table / data grid | **DataTable** / **DataGrid** |
| Excel-like editor | this tile |

Do not rename this component. Do teach the collision in every usage page
and in the catalog brief (already: "Spreadsheet-grade editable grid").
