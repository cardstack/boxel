---
validated: source-proven
---

# show-count-tiles-from-query — live dashboard count tiles from query metadata

**What this gives you:** Clickable dashboard tiles and badges that show live counts without rendering every matching card.

**When to use:** Overview dashboards, admin consoles, catalog home pages, inboxes, workflow boards, and any app card that needs "Products 77", "Open issues 12", "Pending orders 4", or similar summary counts. Use this before reaching for `getCards()` just to count records.

**The insight:** `@context.searchResultsComponent` yields `results.meta` alongside the entries. A query with `page: { size: 1, number: 0 }` transfers only one rendered result but still gives you `results.meta.page.total`. The dashboard renders that total as the tile value and simply never renders `results.entries`.

Use the current query shape:

```ts
const taskRef = codeRef(here, './task', 'Task');

const openTaskCountQuery: Query = {
  filter: {
    every: [{ type: taskRef }, { on: taskRef, eq: { status: 'Open' } }],
  },
  page: { size: 1, number: 0 },
};
```

For all cards of a type, use `filter: { type: taskRef }`. Do not use `filter: { on: taskRef }`; `on` scopes predicates and is not a type filter.

**Gotchas:**

- Search-entry queries are live by default, which is great for operational dashboards but keeps a subscription open per tile — be mindful when putting many count tiles on one page.
- Never render `results.entries` for count-only tiles; you only want `results.meta.page.total`. Rendering every card defeats the purpose.
- If the tile navigates to a filtered section, use the exact same predicate in the count query and destination list query so the number and list agree.
- Custom field predicates and sorts need `on: ref`; the top-level all-of-type filter is the only part that uses `type: ref`.
- Pair with shimmer loading states when the dashboard is a first screen.

**Source:** `realms-staging.stack.cards/ctse/annual-cicada/northwind-dashboard.gts:387-456`, `realms-staging.stack.cards/ctse/annual-cicada/northwind-dashboard.gts:693-960`, `realms-staging.stack.cards/ctse/familiar-turkey/BSL-STUDY.md:553-558`, `realms-staging.stack.cards/ctse/familiar-turkey/BSL-STUDY.md:6570-6578`.

**See also:** `show-card-list-with-views`, `show-table-from-query`, `boxel/references/query-systems.md`.
