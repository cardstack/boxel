---
name: unified-search
description: The supported search surface across the platform is the v2 `search-entry` API — realm endpoints `/_search-v2` + `/_federated-search-v2`, the host resource `getSearchEntriesResource`, the `<SearchResults>` component (provided to cards as `@context.searchResultsComponent`), and the `RenderableSearchEntryLike` row view-model. The four legacy endpoints (`/_search`, `/_federated-search`, `/_search-prerendered`, `/_federated-search-prerendered`) plus `<PrerenderedCardSearch>` / `getPrerenderedSearch` / `@context.prerenderedCardSearchComponent` / the `SearchContent`→`SearchResultSection`→`ItemButton` tree / `PrerenderedCardLike` are deprecated compat kept working over the same engine. Use whenever adding a new search/query call site, choosing which search API to call, reviewing or refactoring search code, or writing a card that lists/queries other cards — reach for v2, never the deprecated surfaces.
---

# Unified search — the v2 `search-entry` API

The platform once ran two parallel search stacks — a live-card one (`/_search`,
`/_federated-search`) and a prerendered-HTML one (`/_search-prerendered`,
`/_federated-search-prerendered`) — each with its own endpoint, wire shape, host
resource, and component. They are now **one engine** exposed as the **v2
`search-entry` API**. A `search-entry` is a heterogeneous result: the engine
prefers prerendered HTML (the fast path) and falls back to a live serialization
per row. **The governing invariant: a consumer never assumes whether a result
came back as prerendered HTML or a live card — it renders the entry transparently.**

The four legacy endpoints and the host/card surfaces that fed them still work,
but only as a **compat layer over the same engine**. They are `@deprecated` and
removed once every consumer is on v2. **Always reach for v2 below; never
introduce a new call site on a deprecated surface.**

## Reach for v2 — quick map

| When you need to… | Use (v2) | Do NOT use (deprecated) |
| --- | --- | --- |
| Search from the realm / over HTTP | `/_search-v2`, `/_federated-search-v2` | `/_search`, `/_federated-search`, `/_search-prerendered`, `/_federated-search-prerendered` |
| Fetch results in a host resource | `getSearchEntriesResource` (`host/app/resources/search-entries`) | `getPrerenderedSearch` (`resources/prerendered-search`) |
| Render a result list in host UI | `<SearchResults>` (`host/app/components/card-search/search-results`) | `<PrerenderedCardSearch>`; the `SearchContent` → `SearchResultSection` → `ItemButton` tree |
| Render a result list from a **card** | `@context.searchResultsComponent` | `@context.prerenderedCardSearchComponent` |
| Type a single result row | `RenderableSearchEntryLike` (`runtime-common/search-results-component`) | `PrerenderedCardLike` / `PrerenderedCardData` (`runtime-common/prerendered-card-search`) |
| Get instances programmatically | `StoreService.search(query, realms?)` → `CardDef[]` | — |
| Get raw wire data (host only) | `StoreService.searchEntries(query, realms?)` | — |

## Realm server / API

- v2 lives on `/_search-v2` (single realm — `Realm.searchEntriesResponse`) and
  `/_federated-search-v2` (realm-server — `handleSearchV2`). They emit the
  `search-entry` document natively (heterogeneous `html` / `item` results).
- The four legacy endpoints are thin adapters over the same engine, frozen at
  their original contracts. Treat them as read-only history; route new work and
  new tests through v2.

## Host

- **Resource:** `getSearchEntriesResource(parent, () => query)` → a reactive
  `{ entries, isLoading, meta, errors }`; subscribes per realm and re-issues on
  invalidation. It supersedes `getPrerenderedSearch` (and the live
  `SearchContent` tree's hand-rolled fetching).
- **Component:** `<SearchResults @query=… as |results| />` renders the
  heterogeneous stream — prerendered HTML inert (lazily hydrated) or a live card.
  Used block-less it renders the default stream itself. It supersedes both
  `<PrerenderedCardSearch>` and the `SearchContent` → `SearchResultSection` →
  `ItemButton` rendering tree.
- **Programmatic split (`StoreService`):** `search` returns **instances only**
  (hydrates full serializations into the Store); `searchEntries` returns the
  **raw wire format** (host-only — the cards-facing `Store` interface omits it).
  Commands (`SearchCardsByQueryCommand`, `SearchAndChooseCommand`, …) ride
  `search` → instances.

## Cards — using search via `@context`

A card that lists or queries other cards renders results through the v2
component the host provides on `@context`: **`@context.searchResultsComponent`**
(not the deprecated `@context.prerenderedCardSearchComponent`). The card never
branches on prerendered-vs-live — `entry.component` resolves that.

```gts
import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// `@query` is a `search-entry`-rooted v2 query (`SearchEntryWireQuery`).
// Build one from an ordinary v1 `Query` with `searchEntryWireQueryFromQuery`,
// then add `realms` / `page` / a `fields[search-entry]` fieldset as needed.
get query(): SearchEntryWireQuery {
  return {
    ...searchEntryWireQueryFromQuery({
      filter: { on: this.authorRef, eq: { status: 'ready' } },
      sort: [{ by: 'title', direction: 'asc' }],
    }),
    realms: this.realms,
  };
}
```

```hbs
<@context.searchResultsComponent @query={{this.query}} @mode='none' as |results|>
  {{#each results.entries key='id' as |entry|}}
    <entry.component />   {{!-- html inert | live card; the consumer never branches --}}
  {{else}}
    {{#if results.isLoading}}<LoadingIndicator />{{else}}<p>No results</p>{{/if}}
  {{/each}}
</@context.searchResultsComponent>
```

Yielded `results`:

- `results.entries` — `RenderableSearchEntryLike[]`. Each `entry` exposes
  `entry.component` (the ready-to-render component — inert HTML or live card,
  owns lazy hydration), `entry.id` (the card/file URL), `entry.isError`,
  `entry.displayName` / `entry.iconHtml` / `entry.name` (the deduped type
  descriptor, resolvable without loading the instance), and the raw
  `entry.html?` / `entry.item?` branches for custom rendering.
- `results.isLoading`, `results.meta` (`{ page: { total } }`), `results.errors`.

`@mode` is the hydration gesture for HTML-backed rows — `none` (stay inert),
`hover` (default), `click`, `touch`. It is host UX only, never on the wire; a
fully-live row ignores it. Hydration is always lazy-on-interaction — never eager.

For raw HTML strings / field-limited data / the page doc, a **host** consumer
reaches past the component to `StoreService.searchEntries`; a **card** cannot
(the boundary is codified at the type level — cards get instances or rendered
HTML, never the raw wire format).

## Why it's shaped this way

One engine, one query vocabulary, one heterogeneous result. Prerendered HTML is
the preferred fast path (orders of magnitude cheaper than a live card); a result
lacks HTML only transiently (the prerender channel briefly lags the search-doc
index, plus render errors), so the live-serialization fallback self-heals as
HTML lands. `<SearchResults>` / `entry.component` hide the split so no consumer —
host UI or card author — ever forks on prerendered-vs-live.
