## Query Essentials

### The three failure modes that produce empty results

These are the rules in priority order — the first one is the trap most people fall into when writing a query for the first time.

#### 1. To match ALL cards of a type, use `filter: { type: ref }` — NOT `filter: { on: ref }`

`on` is a SCOPE that goes inside a predicate (`eq`, `contains`, `range`, etc.). It tells the predicate which card type its field paths refer to. **`on` is not a filter by itself.** Writing `filter: { on: ref }` with no predicate gives the indexer nothing to match — every query like this returns zero results.

```ts
import { codeRef, type Query } from '@cardstack/runtime-common';
// @ts-expect-error import.meta is host-supported
const here: string = import.meta.url;

const meetRef = codeRef(here, './meet', 'Meet');

// ❌ WRONG — `on` is a scope, not a filter; this returns zero rows
const wrong: Query = {
  filter: { on: meetRef },
};

// ✅ CORRECT — CardTypeFilter selects every card of that type
const right: Query = {
  filter: { type: meetRef },
};

// ✅ Also correct when you need additional predicates
const filtered: Query = {
  filter: {
    every: [
      { type: meetRef },
      { on: meetRef, eq: { meetLevel: 'Sectional' } },
    ],
  },
};
```

Rule of thumb: `on` appears *inside* `eq` / `contains` / `range` / `not` / `every` / `any`, never as the only key under `filter`.

#### 2. Custom sort fields require `on: ref` — only three field names work without it

Only `lastModified`, `createdAt`, and `cardURL` are valid sort keys without a scope (see `generalSortFields` in `~/Projects/boxel/packages/runtime-common/index-query-engine.ts`). Every other sort field — `lastName`, `dates.start`, `name`, anything custom — needs `on: ref` in the sort expression, or the query is rejected.

```ts
// ❌ Rejected — `lastName` isn't a generalSortField
sort: [{ by: 'lastName', direction: 'asc' }];

// ✅ Sort on a custom field — `on` REQUIRED
sort: [{ by: 'lastName', on: swimmerRef, direction: 'asc' }];

// ✅ Generic field — no `on` needed
sort: [{ by: 'lastModified', direction: 'desc' }];
```

#### 3. Build refs with `codeRef(here, path, name)`, not raw URL constructions

`codeRef` from `@cardstack/runtime-common` resolves the path against `here = import.meta.url` and returns the canonical `{ module, name }` shape. Hand-rolled `{ module: new URL('./x', import.meta.url).href, name: '...' }` works but is verbose and error-prone (especially when you forget the `.href` and pass a `URL` object).

```ts
import { codeRef, realmURL, type Query } from '@cardstack/runtime-common';

// @ts-expect-error import.meta is host-supported
const here: string = import.meta.url;

const meetRef = codeRef(here, './meet', 'Meet');
const realms = this.args.model?.[realmURL]
  ? [this.args.model[realmURL]!.href]
  : [];
```

Also: `realmURL` is a Symbol exported from `runtime-common` — import it directly. Don't write `Symbol.for('realmURL')`; that gives you a *different* Symbol that doesn't match what the host injected.

### Path rule (.gts vs JSON)

- **In .gts files (queries):** Use `./` — you're in the same directory as the module.
- **In JSON files (`adoptsFrom`):** Use `../` — instances live in folders, need to navigate up.
- `./` means "same directory" when resolved with `import.meta.url`.

### Filter types and composition

`AnyFilter`, `EveryFilter`, `NotFilter`, `EqFilter`, `InFilter`, `ContainsFilter`, `RangeFilter`, `MatchesFilter`, `CardTypeFilter` — see the boxel monorepo's `packages/runtime-common/query.ts` for the exact shapes.

- `type`: match all cards adopting from a type (the `CardTypeFilter`; the only filter that does NOT use `on`).
- `eq`, `in`, `contains`, `range`, `matches`: predicates over fields; each must include `on` (or be inside a clause that supplies it implicitly, like a query-backed `linksToMany`).
- `any`: OR union.
- `every`: AND union.
- `not`: negation.

### Verified-working composition patterns

These shapes have been confirmed against a live realm + indexer (not just inferred from source). Use as templates when composing queries:

```ts
// 1. "All of this type, filtered by an equality predicate"
{ every: [{ type: ref }, { on: ref, eq: { status: 'active' } }] }

// 2. "All of this type, filtered by membership"
{ every: [{ type: ref }, { on: ref, in: { stage: ['draft', 'review'] } }] }

// 3. "All of this type, filtered by a range"
{ every: [{ type: ref }, { on: ref, range: { dueDate: { gte: '2026-01-01' } } }] }

// 4. "All of this type, filtered by a substring match on a string field"
{ every: [{ type: ref }, { on: ref, contains: { cardTitle: 'launch' } }] }
```

Custom-field sorts need `on: ref` inside the sort entry:

```ts
sort: [{ by: 'dueDate', on: ref, direction: 'asc' }]
```

Only `lastModified`, `createdAt`, and `cardURL` are general sort fields that can omit `on:`.

### Validate query shapes with a realm-native lab card

For query-heavy work, build a tiny **validation lab card** in the target realm that renders one `@context.searchResultsComponent` section per query shape you depend on. Run it in browser QA and assert that each section shows non-empty results. This is more reliable than static code inspection because it exercises the host search component, realm indexing, card-reference resolution, and child-card render formats all together — the four places query bugs actually surface.

Common gates:

- The expected number of rows shows up per section.
- Each rendered child card has the right `cardTitle` / preview content (sanity check that the type ref + on ref are pointing at the right CardDef).
- Sort order is stable across reloads.

### Selecting all + filtering, the canonical example

```ts
const query: Query = {
  filter: {
    every: [
      { type: codeRef(here, './product', 'Product') },
      { on: codeRef(here, './product', 'Product'), eq: { status: 'active' } },
    ],
  },
  sort: [
    { by: 'price', on: codeRef(here, './product', 'Product'), direction: 'asc' },
  ],
};
```

**Defining query-backed fields:**
```ts
@field shirts = linksToMany(Shirt, {
  query: {
    filter: {
      // implicit clause merged during execution: on: { module: Shirt.module, name: 'Shirt' }
      eq: { size: '$this.profile.shirtSize' },
    },
    realm: '$REALM',
    sort: [
      {
        by: 'updatedAt',
        direction: 'desc',
      },
    ],
    page: { size: 12 },
  },
});

@field profile = linksTo(Profile, {
  query: {
    filter: {
      eq: { primary: true },
    },
    // `linksTo` takes the first matching card (post-sort) or null when no results.
  },
});
```

**When to use what to query cards:**
- Efficient display-only → `@context.searchResultsComponent` (the newer `<SearchResults>` surface; older builds used `PrerenderedCardSearch`)
- Need data manipulation → `getCards`
- Treat query result as a field → query-backed fields

### ⚠️ Legacy `@isLive={{true}}` is expensive — default it OFF

This applies to the older `<PrerenderedCardSearch>` surface. `<PrerenderedCardSearch @isLive={{true}}>` subscribes to realm change events. Every card create/edit/delete anywhere in the realm fires a re-fetch. On a dashboard with 4 sections, editing an unrelated card triggers 4× re-fetches per autosave — heavy CPU use that can make other tabs (including edit forms) feel sluggish even though the card-store itself is local-first in-memory.

The default behavior without `@isLive` is "fetch on mount, refetch when `@query` or `@realms` change." That's correct for ~95% of dashboards.

Use `@isLive={{true}}` only when the section needs to reflect changes the user makes in *another* tab without manually refreshing (a live results ticker during an event, a notifications inbox, etc.). Don't default it on. (New work should prefer `@context.searchResultsComponent`, which has no `@isLive` arg — liveness is handled by the surface.)

**Query-backed relationship vs explicit linked composition:**

| Situation | Prefer |
|---|---|
| The app owner curates the exact list/order manually (playlist, selected demos, hand-picked recipe plan) | Plain `linksToMany` with explicit JSON relationships |
| The app should discover cards from the realm by status/date/owner/type | `linksToMany(Target, { query })` |
| You need a reverse lookup such as "all Tasks whose project points to this Project" | `linksToMany(Target, { query })` with `eq: { 'project.id': '$this.id' }` |
| You only need display HTML for a dashboard and not model objects | `@context.searchResultsComponent` (older builds used `<PrerenderedCardSearch>`) |
| The filter depends on local UI state or needs live updates while the card is open | `this.args.context.getCards(...)` in the component |

If a brief says "use queries", do not satisfy it with explicit `linksToMany` alone. Include at least one query-backed field, a `@context.searchResultsComponent` section, or a component-level `getCards` call.

For benchmark-style coverage, exercise both common query surfaces across the set:

- **Schema query:** `linksToMany(Target, { query })` plus `computeVia` rollups over the materialized relationship.
- **Display query:** `@context.searchResultsComponent` in an isolated dashboard section when the card only needs rendered results, not model objects. (The older `<PrerenderedCardSearch>` surface still works but is superseded.)

## `@context.searchResultsComponent` — entry-rooted result lists

The newer display surface for a list of results (the `<SearchResults>` component). Declare an **`entry`-rooted** query and render the yielded entries; each `entry.component` renders itself — prerendered HTML (inert, hydrated lazily on interaction) or a live card — so the card never branches on which.

**When to use what to query cards** (this is a **cost** decision — the display surface is cheap, the instance getters hydrate every row; see the pattern `show-list-prefer-prerendered`):
- Display a list of results (cards or files) → `@context.searchResultsComponent`. Prerendered HTML, hydrated lazily per row. **Default for anything you only render.**
- Need the instances in JS (read / manipulate / mutate) → `getCards` / `getCardCollection` (reactive) or `@context.store.search` (imperative). These trigger server `loadLinks` + serialization + Store hydration for every matching row — reserve for genuine read/mutate, and scope to the current realm (`this.args.model?.[realmURL]?.href`), not the whole federation.
- Treat a query result as a field → query-backed fields (`linksTo` / `linksToMany` with a `query`).

```gts
import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

class BlogPost extends CardDef {
  static isolated = class Isolated extends Component<typeof BlogPost> {
    get query(): SearchEntryWireQuery {
      // Build the entry query from an ordinary query, then add realms.
      return {
        ...searchEntryWireQueryFromQuery({
          filter: {
            on: { module: new URL('./author', import.meta.url).href, name: 'Author' },
            eq: { status: 'active' },
          },
          sort: [{ by: 'title', direction: 'asc' }],
        }),
        realms: ['https://my-realm.example/'], // realm URLs to search
      };
    }

    <template>
      <@context.searchResultsComponent @query={{this.query}} @mode='hover' as |results|>
        {{#each results.entries key='id' as |entry|}}
          <entry.component />
        {{else}}
          {{if results.isLoading 'Loading…' 'No results'}}
        {{/each}}
      </@context.searchResultsComponent>
    </template>
  };
}
```

- `@query` — an `entry`-rooted query (`SearchEntryWireQuery`). Build it from a normal query with `searchEntryWireQueryFromQuery`, then set `realms` (and optionally `page`). Changing it re-runs the search.
- `@mode` — hydration of prerendered rows on interaction: `'none'` (stay inert), `'hover'` (default), `'click'`, `'touch'`.
- Yields `results`: `results.entries` (each `entry` exposes `.component`, `.id`, `.isError`, plus `.displayName` / `.iconHtml` for a row with no HTML yet), `results.isLoading`, `results.meta` (`{ page: { total } }`), and `results.errors`.

> boxel-skills prefers `@context.searchResultsComponent` (above) as the display surface for new work. `@context.prerenderedCardSearchComponent` / `<PrerenderedCardSearch>` is the older surface it supersedes. The pattern library still uses `PrerenderedCardSearch` in places, so the contrast is captured below; a tree-wide migration to `searchResultsComponent` is a separate follow-up.

## Legacy: `PrerenderedCardSearch`

Still works, but superseded by `@context.searchResultsComponent` — prefer that surface for new work. `PrerenderedCardSearch` takes a legacy `@query` (an ordinary `Query`, not entry-rooted), plus `@format`, `@realms`, and `@isLive` as separate args, and yields through **named blocks** (`<:loading>` / `<:empty>` / `<:response as |cards|>`) where each yielded card exposes `.url` / `.component`:

```hbs
<PrerenderedCardSearch
  @query={{this.toWatchQuery}}
  @realms={{this.realmHrefs}}
  @format='fitted'
>
  <:loading>Loading…</:loading>
  <:response as |cards|>
    {{#each cards key='url' as |card|}}
      {{card.component}}
    {{/each}}
  </:response>
</PrerenderedCardSearch>
```

Contrast with `@context.searchResultsComponent`, which takes a single entry-rooted `@query` (build with `searchEntryWireQueryFromQuery`, carry `realms`/`format` inside the query), a single block `as |results|`, and yields `entry.component` / `entry.id` rather than `card.url` / `card.component`. The query-filter shapes (`eq`, `every`, `on`-scoped sorts, `page`, and the three silent-zero-rows failure modes above) are identical across both surfaces — only the component contract differs.

Prerender covers `embedded`, `fitted`, `atom`, `head` only (no isolated). For isolated, use `getCards` and render the card via its own component.
```
