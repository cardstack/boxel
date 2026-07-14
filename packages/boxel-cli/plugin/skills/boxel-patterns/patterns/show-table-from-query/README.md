---
validated: source-proven
---

# show-table-from-query — Generic table that takes a Query + realm

**What this gives you:** A reusable Glimmer component that renders any Boxel `Query` result as a sortable **field table** — pass it a `Query`, a realm URL, and the field names to show, and you get a working table with one `<td>` per column. No per-domain table component to write.

**When to use:** Any "list of cards as a field grid" UI. Reports, directories, admin views, dashboards. Anywhere you'd otherwise hand-write a `<table>` with `{{#each}}` and column logic.

**The insight:** A field table needs the **live card instances**, not rendered cards — you read each column's value off the instance (`{{get card col}}`). So this is a `getCards` pattern, **not** a search-results / prerendered one: `@context.searchResultsComponent` and `<PrerenderedCardSearch>` render each result as a whole component (`entry.component`), which has no addressable per-field surface. Reach for `getCards` whenever you need cell-level field access; reach for `@context.searchResultsComponent` when you want to drop in whole rendered cards.

**Recipe shape:**

1. Component signature: `{ Args: { query: Query; realm: string; columns: string[]; headers?: string[]; context?: CardContext } }`.
2. `cards = this.args.context?.getCards(this, () => this.args.query, () => [this.args.realm], { isLive: true })` — `getCards` is only available via the rendering **context**; importing it as a value compiles but explodes at runtime. It returns a SearchResource with `.instances` (reactive `CardDef[]`) and `.isLoading`.
3. Render `{{#each this.cards.instances as |card|}}` → one `<tr>`, and `{{#each @columns as |col|}}<td>{{get card col}}</td>{{/each}}` for the cells.
4. Headers can come from `columns`; or read field metadata from the card type via `getFields`.

**Gotchas:**
- `getCards` comes from `@context`, not an import — `this.args.context?.getCards(...)`. Importing `getCards` as a value throws "getCards is not a function" at runtime.
- For large tables, cache field rendering **by instance** in a `WeakMap<Box, BoxComponent>` (a `FieldRenderer`) so re-renders don't re-create each cell's field component.
- The `on` property on the query is mandatory — see `boxel/references/query-systems.md`.
- Need whole rendered cards instead of a field grid? Use `@context.searchResultsComponent` (see `show-card-list-with-views`).

**Source:** catalog-realm `components/table.gts:33-45` (TableSignature), `components/field-renderer.gts:40-79` (WeakMap cache), `components/grid.gts:16-47` (the grid variant).

**See also:** `automate-linked-to-me-lookup`, `show-card-list-with-views`, `boxel/references/query-systems.md`, `boxel/references/fitted-formats.md`.
