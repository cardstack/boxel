## What it is

The records table: columns declared as data, rows as objects, with sortable headers, zebra striping, hover, sticky headers and optional row selection. Reach for it whenever you are showing a homogeneous list of records and the columns are known. If you need custom markup in every cell and no data-driven machinery, use **Table**, which is this component's shell as a yieldable primitive — same cloth, no engine. For a handful of label/value pairs about _one_ record, use **KeyValue**; for a spreadsheet with editing, use **Sheet**.

## The contract

```
@columns: { key, label, num?, mono?, align?, sortable? }[]
@rows: Record<string, any>[]
@rowKey? (default 'id')
@selectable?, @defaultSort?: { key, dir }
@onSortChange?(sort | null), @onSelectedChange?(keys)
<:cell as |row, column|>   — optional per-cell override
```

**Sort cycles through three states, not two:** ascending → descending → **unsorted**. Most tables trap you in a sort once you start; this one lets you get back to the source order, and `@onSortChange` receives `null` for that state. Small, and correct.

\*\*The `num` and `mono` flags are declared on a column, not per cell: numeric columns get tabular figures and right alignment, mono columns get the mono face. Declaring this on the column means every cell agrees, which is the thing hand-built tables lose first.

`<:cell>` is an override, not a requirement — omit it and cells print `row[column.key]`.

Selection is internal state published through `@onSelectedChange`; there is no controlled selection arg, so selection is uncontrolled only.

## Prior art

**React Aria Components `Table`** renders a real `<table>` with `role="grid"`, and exposes `selectionMode`, `selectionBehavior`, `sortDescriptor`/`onSortChange`, `Column isRowHeader`/`allowsSorting`/width props, `ResizableTableContainer`, drag-and-drop hooks, and `keyboardNavigationBehavior: 'arrow' | 'tab'`. **AG Grid** is the enterprise reference — virtualisation, pinning, grouping, aggregation. **shadcn** has no grid at all: `Table` is styled semantic markup and the behaviour is a TanStack recipe layered on top.

Pretui sits deliberately at the small end, and the choice of **APG Table over APG Grid is the right one**: the Grid pattern (arrow-key cell navigation, Ctrl+Space/Shift+Space selection, F2 edit mode, a single tab stop) exists for tables whose cells contain widgets, and paying its cost for a read-mostly records list makes the table _harder_ to use, not easier. APG's Table pattern lists its keyboard interaction as "Not applicable" — every focusable thing is a normal tab stop — and that is what this is.

Where it improves on the small-end competition: sorting, selection, sticky headers, zebra and the numeric/mono typographic system all arrive from a column declaration, where shadcn gives you none of it.

Two implementation choices worth flagging as weaknesses rather than differences:

- **The sort comparator is a raw `>`/`<` on the cell value.** No locale-aware string collation (so accented names sort wrongly), no numeric coercion for numeric strings, no stable handling of `null`/`undefined`. `Intl.Collator` would fix the first two in a line.
- **Rows are keyed by `@index`, not by `@rowKey`.** `{{#each this.sorted key='@index'}}` means a sort discards DOM identity for every row — the opposite of what `@rowKey` was declared for, and it forces a full re-render (and loses any in-cell DOM state) on every sort. This looks like an oversight; `key=this.rowKey` is the fix.

## Accessibility

Governing pattern: APG **Table** (not Grid — see above). Structure is a real `<table>`/`<thead>`/`<tbody>`/`<th>`/`<td>`, which is most of the battle.

Gaps, in rough order of severity:

- **No `aria-sort` on the sorted header.** The component tracks sort state and reflects it as `data-sort` for styling, but the ARIA property that tells a screen-reader user which column is sorted and in which direction is absent. The only signal is a `↑`/`↓` glyph appended to the header button's text, which is announced inconsistently across readers. This is the clearest single fix, and `data-sort` already holds the value.
- **No `scope="col"` on header cells.** Browsers infer column scope for a simple single-row `<thead>`, so this usually works — but it is one attribute and it removes the guesswork.
- **No accessible name for the table.** There is no `<caption>` and no `aria-label` arg, so a page with three tables announces three unnamed tables.
- **The select-all checkbox has no indeterminate state.** When some rows are selected it shows unchecked, which misrepresents the state. `Checkbox` in this kit has no indeterminate support either, so this is a shared gap — and select-all is precisely the pattern `aria-checked="mixed"` exists for.
- **Row checkboxes are all labelled "Select row".** In a fifty-row table, fifty identical labels. They should name the row (`Select {{row.name}}`), which the component has the data to do.
- **Sorting changes the row order with no announcement.** A `role="status"` region saying "sorted by Name, ascending" is what React Aria does; nothing here announces.
- **`user-select: none` on headers** blocks selecting header text, which is a minor but real cost with no upside for a button-containing header.
- Sticky headers plus `overflow: auto` mean the table can scroll horizontally; there is no `tabindex="0"` on the scroll container, so a keyboard-only user cannot scroll a wide table without tabbing through its cells (WCAG 2.1.1).

## Theming

`--card` (table surface), `--inset` (header band), `--line-strong` (header underline), `--border` (row rules), `--stripe` (zebra), `--hover` (row hover), `--muted-foreground` and `--foreground` (header ink, resting and sorted), `--font-mono` and `--track-eyebrow` (the mono eyebrow header voice), `--text-ui-md`.

Header type is a hard-coded 10px uppercase mono — the kit's eyebrow voice — and is not tokenised, so a season cannot resize it. A season **must** define `--stripe` distinctly from both `--card` and `--hover`, or zebra striping and hover become indistinguishable and the row you are pointing at stops being obvious.

## React ecosystem

Closest to React Aria `TableView` / a read-only Ant Table. Interactive
listing UX (sort + row selection + column visibility + pagination) is
**DataTable**. Spreadsheet editing is **Sheet**.
