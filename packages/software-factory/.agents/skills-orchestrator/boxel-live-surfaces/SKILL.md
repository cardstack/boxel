---
name: boxel-live-surfaces
description: Live, self-updating card lists via @context.searchResultsComponent — the SearchEntryWireQuery contract, query traps, clickable tiles, and live activity feeds. Use when a card needs to list other cards in the realm (home/dashboard sections, feeds, grids) or when a search section renders nothing.
---

# Boxel Live Surfaces

`@context.searchResultsComponent` is the preferred way for a card to render
a live list of other cards. It re-runs as the realm changes — new instances
appear automatically, and the host prerenders each result so the card never
loads every model into memory.

Fuller worked examples live in `references/`:

- `references/app-card-home-with-search.md` — the Home/app-card pattern (one live section per CardDef in a family).
- `references/live-activity-feed-card.md` — append-only activity/log feed recipe.

## The wire-query contract (get this wrong → silent empty render)

`@context.searchResultsComponent` consumes a **WIRE query, not a plain
`Query`**. Build it with `searchEntryWireQueryFromQuery(query)` from
`@cardstack/runtime-common`, then attach:

- `realms: [<realm url>]` — an **array**; there is no `realm` key.
- the display format via `filter.eq.htmlQuery = { eq: { format: 'fitted' } }`.

Invoke it in **block form** (`as |results|`), iterate `results.entries`, and
render `<entry.component />` inside a parent-sized cell. **A plain Query
passed to a self-closed `<@context.searchResultsComponent @query={{q}} />`
renders NOTHING, silently.**

```gts
import { cached } from '@glimmer/tracking';
import {
  codeRef,
  realmURL,                       // the Symbol — NEVER Symbol.for('realmURL')
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// @ts-expect-error import.meta is supported by the Boxel host
const here: string = import.meta.url;

// inside the Component class:
get taskRef() { return codeRef(here, './task', 'Task'); }
get realms(): string[] {
  const url = this.args.model?.[realmURL];
  return url ? [url.href] : [];   // [] while loading — never query unscoped
}
get tasksQuery(): Query {
  const ref = this.taskRef;
  return {
    filter: { type: ref },        // type, not bare `on` — see traps below
    sort: [{ by: 'dueDate', on: ref, direction: 'asc' }],
  };
}
@cached
get tasksWireQuery(): SearchEntryWireQuery {
  const q = searchEntryWireQueryFromQuery(this.tasksQuery);
  return {
    ...q,
    realms: this.realms,
    filter: {
      ...q.filter,
      eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
    },
  };
}
```

```gts
<ul class='cells'>
  <@context.searchResultsComponent @query={{this.tasksWireQuery}} @mode='hover' as |results|>
    {{#if results.isLoading}}<li>Loading…</li>{{/if}}
    {{#each results.entries key='id' as |entry|}}
      <li class='cell'><entry.component /></li>
    {{else}}
      <li>No tasks yet.</li>
    {{/each}}
  </@context.searchResultsComponent>
</ul>
```

## The three query traps (each silently returns zero rows)

1. **`filter: { type: ref }` to select all cards of a type.** Never
   `filter: { on: ref }` — `on` is a scope for predicates, not a filter on
   its own. `{ on: ref }` with no predicate returns zero rows.
2. **Custom-field sorts require `on: ref`.** Only `lastModified`,
   `createdAt`, and `cardURL` are valid sort keys without `on`. Sorting on
   any custom field — the sort expression MUST include `on: ref`.
3. **Use `codeRef(here, path, name)`, not raw URL construction.** And
   import `realmURL` as a Symbol from `@cardstack/runtime-common` — don't
   write `Symbol.for('realmURL')` (it produces a different Symbol that
   doesn't match what the host injected).

## Realm-scoped and bounded — always

Every card-owned query MUST be realm-scoped and bounded. A missing or empty
realm argument falls back to querying **every available realm**. Default to
the current card's realm (via the `realmURL` Symbol), do not start the query
until that realm is known (return `[]` and let `results.isLoading` show),
and cap general-purpose hydration at a sensible page size.

## Counts without hydration

For KPI/funnel numbers, put `page: { size: 1 }` on the wire query and read
`results.meta.page.total` — one row of HTML, full count.

## `@cached` the wire-query getters

Decorate wire-query getters with `@cached` so SearchResults keeps ONE live
subscription per section instead of resubscribing on every re-render.

## Making tiles clickable

| Mode | What enables click | Mechanism |
|---|---|---|
| **Interact / Code** (in-app) | `{{@context.cardComponentModifier ...}}` on the tile's container | Pushes the card onto the Boxel app's card stack |
| **Host** (published site) | `<a href={{entry.id}}>` transparent overlay inside a `position: relative` cell | Plain browser navigation |

Always wire one of these — otherwise the tiles render beautifully and do
nothing on click. Use the **overlay** pattern for Host mode, never
`<a><entry.component /></a>` wrapping (the height-100% chain through the
card chrome breaks silently and fitted cards collapse to zero height). In
monitor-style cards use
`this.args.viewCard(url, 'isolated', { openCardInRightMostStack: true })` —
never `<a href>` (full-page navigation drops the surface).

## Churn warning — live means LIVE

Every live section re-runs on **EVERY index change in the realm** — any card
created, edited, or deleted. A realm that is written every few seconds (sync
loops, log writers, autosave-heavy edit forms) makes every section flash its
loading state continuously. Keep high-frequency writers out of the realm the
dashboard watches, prefer showing stale results over a loading state during
revalidation, keep the number of live sections per card modest, and use
`@mode='none'` (prerendered HTML, no hover hydration — cheaper) for
read-only sections; `@mode='hover'` for browsable grids.

## The store.search unhydrated-linksTo trap

Cards returned by store search APIs have **unhydrated `linksTo` fields** —
reading `card.someLink.title` gives you nothing. To reach a linked card's
data from a search result, fetch the card-source JSON document and read
`relationships.<field>.links.self` to get the linked card's URL, then load
that card explicitly.
