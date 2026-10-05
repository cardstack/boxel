## What it is

The record listing an agent means by "data table": sortable headers, per-column filters, a column switcher, row selection, expandable detail rows, pinned columns, paging and density, over a plain `<table>`. It is the fourth of the kit's row-drawing things, and the other three are worth naming because the wrong one is a common reach. **Table** is the markup primitive: you write the `<tr>`s. **DataGrid** is the read-only structured grid, args in and rows out, with no toolbar and no view state. **Sheet** is the spreadsheet — editable cells, a real `role='grid'`, the boxel-grid engine. When the pane is too narrow for columns, the same rows go into **List** with **Item** rows, which share this component's selection model and load chrome.

Not built, and not stubbed: virtualization (the kit already has one windowing engine in **AssetGrid**; page instead), tree data (**Tree** is the kit's tree; `<:expanded>` covers per-row detail), multi-column sort, column resize and drag-reorder, and server-side filtering as a mode (hold `@filters` yourself, feed them into `@loadKey`, and let `@load` return the narrowed set).

## The contract

```
@columns                              — DataColumn[]: key, label, value?, sortable?, align?, mono?, width?, pin?, fixed?, hidden?, alwaysVisible?, filter?
@rows? | @dataSource?                 — the records (either spelling); OR
@load?, @loadKey?                     — an async loader, re-run when the key changes
@key?                                 — (row, index) => RowKey; pass it
@caption?, @label?                    — a real <caption>, or a name for the scroll region
@size?                                — xs|s|m|l|xl; sm/md/lg/small/medium/large/middle accepted
@sortable?, @sort?, @defaultSort?, @onSortChange?, @comparator?
@selectionMode?                       — none|single|multi
@selected?, @defaultSelected?, @onSelectionChange?
@visibleColumns?, @defaultVisibleColumns?, @onVisibleColumnsChange?, @columnMenu?
@filters?, @defaultFilters?, @onFiltersChange?
@expandedKeys?, @defaultExpandedKeys?, @onExpandedChange?
@pageSize?, @page?, @defaultPage?, @onPageChange?
@rowLabel?                            — (row, index) => the row's accessible name
@striped?, @stickyHeader?, @minWidth?
@busy? | @loading?                    — aria-busy without replacing the rows
@placeholder?, @itemNoun?, @emptyTitle?, @emptyMessage?, @loadingLabel?, @skeletonRows?
<:cell as |text row col|>             — one block for every column; switch on col.key
<:expanded as |row|>                  — supplying it turns on the expander column
<:actions as |row|>                   — the row's Menu or IconButton
<:toolbar> <:empty> <:loading> <:error>
```

**Every view axis is controlled or uncontrolled by the same rule.** Sort, selection, visibility, filters, expansion and page each take a value, a `default*` seed and an `on*Change` callback. Passing the value makes the axis controlled and the component stops writing its own copy; leaving it out lets the component keep state and still report every change. There is no separate flag that switches modes.

**Pass `@key`.** Without it the row's identity is its index, and a listing sorts. The index handed to the key function is absolute across pages, so even the index fallback does not let selection leak from page 1 to page 2, but a keyed row is the only one that survives a sort.

**The `<:cell>` block's first parameter is the printed value**, already through `@placeholder` (`null`, `undefined` and `''` print as the placeholder; booleans as Yes/No). The row is the second parameter, fully typed, so a template never narrows `unknown`. The block is invoked for every column; branch on `col.key`.

**Filtering happens before sorting and before selection.** Two `DataSource` machines are stacked: the loader owns load state, the table owns sort and selection over rows that are already filtered, so select-all means "every row you can see" and a sort never disagrees with a filter. A text filter is a case-insensitive contains match over the printed value; an options filter is a multi-select over a fixed set; `filter.match(row, value)` replaces either. A filter change resets to page 1.

**Pinning is declared, never measured.** A pinned column and every pinned column before it must declare `width`; offsets are summed from those declared widths. A pinned column that follows an unmeasurable one is left unpinned rather than laid on top of it. Ant's `fixed: true` is accepted and means `pin: 'start'`.

**The toolbar earns its space.** It renders only when there is a `<:toolbar>` block, a filterable column, a hideable column, or a current selection. A selectable table with nothing selected has no bar.

## Prior art

**shadcn's Data Table** is a recipe, not a component: TanStack Table plus the Table primitives, Pagination, DropdownMenu and Checkbox, assembled per project. **Ant `Table`** is the enterprise maximalist: `sorter`, `filters`, `rowSelection`, `expandable`, `fixed`, `scroll`, `pagination`. **MUI `DataGrid`** is a product with its own licence tiers. **Tremor `Table`** and **Mantine `Table`** are presentational. **React Aria `Table`** is the accessibility reference and takes on `role='grid'` in full.

What this component fixes, read against that corpus:

- **Sort reaches assistive technology.** shadcn, Mantine and Tremor emit no `aria-sort` at all; Ant sets it only on the active column; MUI only if the caller passes `sortDirection`. Here every sortable `<th>` carries `aria-sort`, `none` when it is not the active one, so the header row says which columns can be sorted as well as which one is. The sort control is a real `<button>`, not Ant's `tabindex='0'` `<th>` or MUI's `<span>` dressed as one, and it carries a visually hidden mirror that names the next state ("sorted ascending — activate to sort descending").
- **Every `<th>` has `scope='col'`.** shadcn's, Mantine's and Tremor's do not.
- **Row selection state is on the row.** The corpus uses `data-state`, a class, or `data-selected`; MUI's docs put `role='checkbox'` on the `<tr>`, which makes the row's cells presentational. Here the `<tr>` carries `aria-selected` and `data-selected`, and the operable control stays a real per-row checkbox with its own name.
- **The scroll container has a tab stop.** MUI's `TableContainer` is `overflow: auto` with no `tabindex` and no role, so a wide table cannot be scrolled from the keyboard; Tremor and shadcn ship the same. Here it is a named `role='region'` in the tab sequence.
- **Filtered-empty is its own state.** shadcn renders one "No results." for an empty dataset and for filters that matched nothing. Here the second is a distinct state with a Clear filters action; the first is **DataShell**'s empty state.
- **Filters live in the toolbar.** Ant hides each column's filter behind a funnel icon inside the `<th>`, which puts a second control in the sort cell and leaves the active filter invisible. Here every filterable column gets a labelled toolbar control, and the affected `<th>` is marked `data-filtered`.
- **Select-all covers the whole filtered set**, and its accessible name says so ("Select all 24 lots"). shadcn and Ant scope it to the page and add a second "select all N" affordance.
- **No window media queries.** Density and the rest respond to the component's own box.

Where it is thinner: **`role='grid'` is not claimed**, deliberately, so there is no arrow-key cell travel, no `aria-rowindex` and no roving tabindex — the browser's native table navigation and the document tab order are what you get, and the kit's full grid role lives in **Sheet**. No multi-column sort, no column resize, no drag-reorder, no virtualization, no tree rows. Ant's header-cell filter popovers, `rowSelection.getCheckboxProps`, `summary` rows and `expandable.expandRowByClick` have no equivalent.

## Accessibility

Governing pattern: a native `<table>` with the APG **Sorted Table** conventions layered on. `role='grid'` is not claimed, so the APG Grid keyboard contract does not apply and no cell-level focus management is attempted.

What the component does, from its rendered markup and its tests:

- **Every header cell is `<th scope='col'>`.** A sortable one carries `aria-sort` in all three states (`none`, `ascending`, `descending`); a column with `sortable: false` carries no `aria-sort` and renders no button. `@caption` renders a real `<caption>`.
- **The sort control is a `<button>`** whose text includes a hidden hint naming the state it will move to.
- **Selectable rows carry `aria-selected`** (`'false'` before anything is picked); a non-selectable table carries no `aria-selected` anywhere. Each row's checkbox or radio is named by `@rowLabel` — pass it, or the name is "Row N". Single-select radios share one `name`, so the browser enforces the single choice.
- **Select-all is a genuinely mixed checkbox** (`indeterminate` set as a property, so `aria-checked='mixed'` follows) and is named with the count it covers.
- **The expander is a `<button>`** with `aria-expanded`, `aria-controls` resolving to the detail `<tr>`'s id, and an `aria-label` built from the row's name ("Expand Gyokuro").
- **The scroll box is `role='region'`** with an `aria-label` (from `@label`, falling back to `@caption`, then "Table") and `tabindex='0'`.
- **A `role='status'` live region** announces the settled count: "6 of 24 lots", "3 lots", or "No lots". It is rendered empty at first and filled only from settled load state, so a filter keystroke that re-queries announces once when the results land. Paging composes **Pagination**, whose current page carries `aria-current='page'`.
- **`@busy` sets `aria-busy`** and dims the scroll box without replacing the rows, so focus and scroll position survive.

The caller's failures to avoid: a `<:cell>` that puts an interactive control in a cell relies on document tab order, which is correct for a table without `role='grid'` but means a long page of buttons is a long Tab sequence; a `<:actions>` trigger needs its own `aria-label` (the usage page shows "Actions for …"); and the meaning of a row must not depend on `@striped` or the selection tint alone — the selected row also gets a rule down its inline start, so it reads in greyscale.

## Theming

Consumed directly: `--foreground`, `--muted-foreground`, `--card`, `--border`, `--primary`, `--primary-foreground`, `--ring`, `--radius`, `--radius-surface`, `--inset`, `--hover`, `--stripe`, `--line-strong`, `--input`, `--field`, `--font-mono`, `--font-sans`, `--text-ui-md`, `--text-ui-sm`, `--track-ui`, `--track-eyebrow`, `--space-2` … `--space-5`, `--pretui-shadow-hairline`, `--pretui-control-rest`, `--pretui-control-border`, `--pretui-edge-highlight`, `--pretui-selected`, `--pretui-dur-snap`, `--pretui-ease-snap`, `--pretui-z-sticky`, `--pretui-z-sticky-header`.

Its own knobs: `--pretui-dt-pick-w` (2.6em), `--pretui-dt-exp-w` (2.2em) and `--pretui-dt-act-w` (3em) are the widths of the selection, expander and actions columns. The template stamps `data-pick`, `data-detail` and `data-actions` on the root and the stylesheet resolves `--pretui-dt-lead` and `--pretui-dt-tail` from them, which is how a pin offset computed in JS can add the control columns without knowing whether they exist. `--pretui-dt-min-w` is set from `@minWidth`.

Density is one axis: `@size` sets the root `font-size` and every internal dimension is in `em`, so a season retunes the whole table by retuning `--text-ui-md`. Header cells are the eyebrow voice (mono, uppercase, `--track-eyebrow`) on `--inset`. Coarse pointers get 44px rows and 20px checkboxes; `prefers-reduced-motion` removes the chevron transition.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| TanStack / Ant / shadcn | Pretui |
| --- | --- |
| `columns` / `accessorKey` / `header` | `@columns` with `key` / `label` / `value` |
| `data` / `dataSource` | `@rows` (`@dataSource` accepted) |
| `sorting` / `onSortingChange` | `@sort` / `@onSortChange` |
| `rowSelection` / `onRowSelectionChange` | `@selected` / `@onSelectionChange` + `@selectionMode` |
| `columnVisibility` | `@visibleColumns` / `@onVisibleColumnsChange` |
| `columnFilters` | `@filters` / `@onFiltersChange` |
| `pagination` | `@pageSize` / `@page` / `@onPageChange` |
| Ant `expandable` | `<:expanded as \|row\|>` |
| Ant `fixed` | `pin` on the column (`fixed: true` accepted) |
| Ant `size` / density | `@size` |
| `getRowId` | `@key` |
| empty / loading | `<:empty>` / `<:loading>` / `@busy` |
