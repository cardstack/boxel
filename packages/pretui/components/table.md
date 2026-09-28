## What it is

**DataGrid's shell without its engine.** You write the `<tr>`/`<th>`/`<td>` markup; the component supplies the surface, the sticky mono header band, zebra striping, hover, the scroll container and the rounded hairline edge. Reach for it when the cells need arbitrary content and there is no uniform row shape to declare — a component API reference, a comparison matrix, a table whose cells hold controls. If your data _is_ a list of records with known columns, use **DataGrid**, which gives you sorting and selection for free. For key/value pairs about one record, **KeyValue**.

It was added for the freestyle dogfood pass, when composite tables like the Component API table needed to wear the same cloth as DataGrid without inheriting its data-driven machinery.

## The contract

```
<:head>   <:body>
Element: HTMLDivElement
```

That is the entire API. No args at all.

The one non-obvious thing: **the yielded markup is styled through `:deep()`.** Because you supply the `<th>` and `<td>` elements, the component's scoped stylesheet has to reach into content it did not render, so `.pretui-table :deep(th)`, `:deep(td)`, `:deep(tbody tr:nth-child(even) td)` and `:deep(tbody tr:hover td)` do the work. This is a legitimate, narrow use of the escape hatch — the alternative would be a `<Table.Row>`/`<Table.Cell>` component pair, which buys type safety at the cost of the "just write a table" affordance the component exists to provide.

Practical consequence: **your `<th>` and `<td>` get the house styling automatically, and you cannot easily opt out of it.** A cell that needs different padding needs its own class and a higher-specificity rule from the call site.

## Prior art

**shadcn `Table`** is the closest analogue — `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableCaption`, each a styled element, with zero behaviour. **Web Awesome** ships no table at all. **React Aria Components `Table`** is the opposite pole: a full collection API with selection, sorting and resizing, and no way to just hand it markup.

Pretui differs from shadcn on one axis and it is the interesting one: **shadcn gives you seven components, Pretui gives you two blocks.** shadcn's approach types every part and lets each be styled independently; Pretui's means a table is `<Table><:head><tr>…</tr></:head><:body>…</:body></Table>` with native elements throughout — nothing to import, nothing to learn, and native table semantics you cannot accidentally lose by nesting a `<div>` in a `<tbody>`.

The improvement over both: it is **visually identical to DataGrid by construction**, not by convention. The two share the same header band, the same zebra token, the same row rules and the same edge, so a hand-built table and a generated one sit side by side without a seam. In most kits, the "styled table" and the "data grid" drift apart within a release.

The cost, stated plainly: no sorting, no selection, no virtualisation, no column definitions, and no way to add them without switching components.

## Accessibility

Governing pattern: APG **Table**, whose keyboard interaction section reads "Not applicable" — every focusable element inside is an ordinary tab stop. That is the correct pattern for this component, and it is the caller's job to honour it.

**Almost all of the accessibility here is yours, not the component's.** It renders `<table>`, `<thead>` and `<tbody>` and nothing else, so:

- **You must supply `scope="col"` / `scope="row"`** on header cells. The component adds nothing.
- **You must supply a `<caption>` or an `aria-label`** if the table needs a name. There is no arg and no slot for one — a `<caption>` can be placed in `<:head>` only by writing it before the `<tr>`, which is valid HTML but easy to get wrong.
- **You must supply `aria-sort`** if you build sortable headers, and the `aria-live` announcement that goes with a sort.
- **If your cells contain widgets**, you are in APG **Grid** territory, and this component gives you none of it — no roving tabindex, no arrow navigation, no `role="grid"`. That is the point at which you should stop and use a real grid.

Component-level gaps:

- **The scroll container has no `tabindex="0"`.** `overflow-x: auto` on a wide table means a keyboard-only user cannot scroll it without tabbing through cells, which fails WCAG **2.1.1** for a table of static text. One attribute fixes it, and it would fix DataGrid too.
- **Sticky headers with no `scroll-margin`** can obscure a focused cell in a vertically scrolled table (WCAG **2.4.11 Focus Not Obscured**).
- `vertical-align: top` on cells is a good default for mixed-height content and worth knowing about before you fight it.

## Theming

`--card` (surface), `--inset` (header band), `--line-strong` (header underline), `--border` (row rules and the outer hairline), `--stripe` (zebra), `--hover` (row hover), `--muted-foreground` (header ink), `--radius`, `--font-mono`, `--track-eyebrow`, `--text-ui-md`.

Identical to **DataGrid**'s set by design — if a season retunes one, both move together. The 10px uppercase mono header and the 8px/10px cell padding are hard-coded. As with DataGrid, `--stripe` must be distinguishable from both `--card` and `--hover`, or zebra and hover collapse into each other.

## React ecosystem

Four listing surfaces — do not collapse them:

| Job                               | Tile                         |
| --------------------------------- | ---------------------------- |
| Markup `<table>`                  | **Table** (this)             |
| Read-only structured grid         | **DataGrid**                 |
| Record listing (sort/select/page) | **DataTable** stub           |
| Spreadsheet editor                | **Sheet** — not shadcn Sheet |

shadcn `Table` is this tile. shadcn `Data Table` (TanStack recipe) is
the **DataTable** stub.
