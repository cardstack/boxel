---
validated: source-proven
---

# show-card-list-with-views — Generic CardsGrid with view selector

**What this gives you:** A reusable list/grid component that takes a `Query` + realms + a view name (`'card' | 'strip' | 'grid'`) and renders results via `@context.searchResultsComponent`. Live-updating, fitted-format rendering, view-toggleable.

**When to use:** Browse views of any kind — catalog listings, search results, "all my projects", filter results. Anywhere you'd otherwise hand-roll `getCards` + `{{#each}}` + manual loading states.

**The insight:** The host injects `searchResultsComponent` into the card context. Build a `SearchEntryWireQuery` from your legacy `Query` with `searchEntryWireQueryFromQuery`, fold in the realms to search and the fitted format, then hand that to `<@context.searchResultsComponent>`. It yields `{ entries, isLoading }`; each `entry` renders as `<entry.component />`. Wrap in your own `<ul class='{{view}}-view'>` so CSS handles the layout per view.

**Recipe shape:**

```ts
import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: string[];
    selectedView: 'card' | 'strip' | 'grid';
    context?: CardContext;
  };
}

export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  get searchQuery(): SearchEntryWireQuery {
    let q = searchEntryWireQueryFromQuery(this.args.query);
    return {
      ...q,
      realms: this.args.realms,
      filter: {
        ...q.filter,
        eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
      },
    };
  }

  <template>
    <ul class='cards {{@selectedView}}-view'>
      <@context.searchResultsComponent @query={{this.searchQuery}} @mode='hover' as |results|>
        {{#if results.isLoading}}Loading...{{/if}}
        {{#each results.entries key='id' as |entry|}}
          <li class='{{@selectedView}}-view-container'>
            <entry.component class='card' />
          </li>
        {{/each}}
      </@context.searchResultsComponent>
    </ul>
  </template>
}
```

**Gotchas:**
- Search-entry queries are live by default — the grid stays up to date as cards in the realm change. There is no `@isLive` flag to drop for snapshot semantics.
- The fitted format (set via `htmlQuery: { eq: { format: 'fitted' } }`) works for ~all card types if they implement it (they should — see `boxel/references/fitted-formats.md`).
- The view name is just a CSS class — your stylesheet decides what `.card-view`, `.strip-view`, `.grid-view` look like.
- Pair with `<ViewSelector>` from `@cardstack/boxel-ui/components` for the user-facing view toggle.

**Source:** `boxel-catalog/components/grid.gts`, `boxel-catalog/components/card-list.gts`.

**See also:** `show-list-prefer-prerendered` (why this cheap surface is the default over hydrating getters), `pick-typed-sort`, `show-table-from-query`, `boxel/references/query-systems.md`, `boxel/references/fitted-formats.md`.
