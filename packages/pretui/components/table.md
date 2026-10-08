## What it is

**DataGrid's shell without its engine.** You write the `<tr>`/`<th>`/`<td>` markup; the component supplies the surface, an optional `<caption>`, the mono header band over the column headers (sticky inside a height-bounded wrapper, see below), zebra striping, hover, the scroll container and the rounded hairline edge. Reach for it when the cells need arbitrary content and there is no uniform row shape to declare — a component API reference, a comparison matrix, a table whose cells hold controls. If your data _is_ a list of records with known columns, use **DataGrid**, which gives you sorting and selection for free. For key/value pairs about one record, **KeyValue**.

It was added for the freestyle dogfood pass, when composite tables like the Component API table needed to wear the same cloth as DataGrid without inheriting its data-driven machinery.

## The contract

```
@caption?   — the table's name, rendered as a real <caption>
@labelledBy? — id of an on-screen element that names the table (aria-labelledby on the <table>)
@label?     — the name when it is nowhere on screen (aria-label on the <table>)
<:caption>  — a rich caption; wins over @caption
<:head>   <:body>
Element: HTMLDivElement
```

**The caption.** `@caption` renders a `<caption>` as the table's first child, where HTML requires it, so the table is named by it ("table, Lots in the warehouse"). The `<:caption>` block renders into the same `<caption>` and keeps its markup; if both are given, the block wins, the way a block wins over its arg on Notification, AlertDialog and Card. The caption is set in the caption role in the muted ink, above the header band. When the name is already on screen — a section heading right above the table — give that element an id and pass it as `@labelledBy`, which lands as `aria-labelledby` on the `<table>` itself, so the name can't drift from the heading. Keep `@label` for a name that is nowhere on screen; it lands as `aria-label` on the `<table>`. `...attributes` go on the wrapper `<div>`, so an `aria-label` or `aria-labelledby` passed as an attribute names the wrapper, not the table; use the args. A caption wins over both: with either caption present, neither attribute is set. `@labelledBy` wins over `@label`, as `aria-labelledby` does over `aria-label`, so only one name is ever set.

**`@label` and `@labelledBy` name the `<table>`, which deliberately differs from DataTable.** DataTable's `@label` names its scroll region (a `role='region'` box with a tab stop) and sits alongside its caption: the caption names the table, the label names the region. Table has no such region — its wrapper is a plain `<div>` — so the only thing left to name is the `<table>`, and a caption already does that. Hence `@label` and `@labelledBy` here are the caption's stand-ins rather than a second name, and are dropped when a caption renders.

The one non-obvious thing: **the yielded cells are styled partly through `:deep()`.** The component renders `<thead>` and `<tbody>` itself, so the inherited properties sit on those two elements and flow into your cells: the mono header voice, its ink and `nowrap` on `thead`, and top alignment on `tbody`. What the browser's `th` rule overrides (weight, alignment) and what doesn't inherit (padding, height, backgrounds, row rules, the sticky position) has to reach into content the component did not render, so `.pretui-table :deep(thead th)`, `:deep(td)`, `:deep(tbody th)`, `:deep(tbody tr:nth-child(even) td)` and `:deep(tbody tr:hover td)` (and their `th` twins) do that work. This is a legitimate, narrow use of the escape hatch — the alternative would be a `<Table.Row>`/`<Table.Cell>` component pair, which buys type safety at the cost of the "just write a table" affordance the component exists to provide.

**The header band is scoped to `thead`.** Only the column headers in `<:head>` get the sticky mono band; the header voice is set on `thead`, so it never reaches the body. A row header — `<th scope='row'>` in `<:body>` — wears the body-cell rules instead: the cell padding, the row rule, zebra and hover, top alignment and start alignment, keeping the browser's bold `th` weight. So a matrix with row headers needs no override to undo the band.

Practical consequence: **your `<th>` and `<td>` get the house styling automatically, and you cannot easily opt out of it.** A cell that needs different padding needs its own class and a higher-specificity rule from the call site.

## Prior art

**shadcn `Table`** is the closest analogue — `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableCaption`, each a styled element, with zero behaviour. **Web Awesome** ships no table at all. **React Aria Components `Table`** is the opposite pole: a full collection API with selection, sorting and resizing, and no way to just hand it markup.

Pretui differs from shadcn on one axis and it is the interesting one: **shadcn gives you seven components, Pretui gives you three blocks.** shadcn's approach types every part and lets each be styled independently; Pretui's means a table is `<Table><:head><tr>…</tr></:head><:body>…</:body></Table>`, with `<:caption>` standing in for `TableCaption`, with native elements throughout — nothing to import, nothing to learn, and native table semantics you cannot accidentally lose by nesting a `<div>` in a `<tbody>`.

The improvement over both: it **reads the boxel theme contract**, so a hand-built table follows whatever theme the card wears — surface, header band, zebra, hover, type roles and spacing ladder — with no season tokens and no literal fallbacks. DataGrid still reads the Pret season tokens and fixed metrics for the same parts, so the two differ outside a season: Table's header is set in the label role at the label size, DataGrid's in a fixed 10px eyebrow.

The cost, stated plainly: no sorting, no selection, no virtualisation, no column definitions, and no way to add them without switching components.

## Accessibility

Governing pattern: APG **Table**, whose keyboard interaction section reads "Not applicable" — every focusable element inside is an ordinary tab stop. That is the correct pattern for this component, and it is the caller's job to honour it.

**Almost all of the accessibility here is yours, not the component's.** It renders `<table>`, `<thead>` and `<tbody>` and nothing else, so:

- **You must supply `scope="col"` / `scope="row"`** on header cells. The component adds nothing.
- **You must supply a name** if the table needs one: `@caption` or `<:caption>` for a visible `<caption>`, `@labelledBy` with the id of the heading when the name is already on screen, or `@label` when it is nowhere on screen. Don't write a `<caption>` into `<:head>`: it would land inside `<thead>`, which is invalid.
- **You must supply `aria-sort`** if you build sortable headers, and the `aria-live` announcement that goes with a sort.
- **If your cells contain widgets**, you are in APG **Grid** territory, and this component gives you none of it — no roving tabindex, no arrow navigation, no `role="grid"`. That is the point at which you should stop and use a real grid.

Component-level gaps:

- **The scroll container has no `tabindex="0"`.** `overflow-x: auto` on a wide table means a keyboard-only user cannot scroll it without tabbing through cells, which fails WCAG **2.1.1** for a table of static text. One attribute fixes it, and it would fix DataGrid too.
- **Sticky headers with no `scroll-margin`** can obscure a focused cell in a vertically scrolled table (WCAG **2.4.11 Focus Not Obscured**).
- `vertical-align: top` on the body (inherited by every cell) is a good default for mixed-height content and worth knowing about before you fight it.

## Theming

Everything comes from the boxel theme contract:

- **Surfaces and ink:** `--card` with `--card-foreground` (the wrapper, which cells inherit), `--inset` with `--foreground` (the header band), `--muted-foreground` (the caption), `--stripe` (zebra), `--hover` (row hover, on devices that hover).
- **Rules and edge:** `--border` (row rules and the outer hairline), `--border-strong` (header underline), `--radius`.
- **Type:** `--boxel-font-size-xs` (the table), the caption role (`--boxel-caption-font-size`, `-font-weight`, `-line-height`, `-letter-spacing`), the label role for the header band (`--boxel-ui-label-font-size`, `-font-weight`, `-letter-spacing`), and `--font-mono` for its family.
- **Spacing:** `--boxel-sp-2xs` (block padding of the caption and cells) and `--boxel-sp-xs` (inline padding of the caption, header and cells, so their text shares one start edge).

The header band's height is `--pretui-table-head-height` (1.875rem), declared on `.pretui-table`. **The header only sticks inside a wrapper that scrolls vertically.** `overflow: auto` makes the wrapper the header's scroll container, and with no height limit it never scrolls, so the header leaves with the rows. Set `--pretui-table-max-height` on the table (or an ancestor) to bound the wrapper, for example `--pretui-table-max-height: 24rem`; the rows then scroll under a header that stays put. Unset, it is `none` and the table is as tall as its rows. `--stripe` must be distinguishable from both `--card` and `--hover`, or zebra and hover collapse into each other.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

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
