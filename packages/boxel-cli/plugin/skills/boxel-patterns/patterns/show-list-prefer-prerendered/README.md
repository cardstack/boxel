---
validated: source-proven
---

# show-list-prefer-prerendered — Render display lists via the prerendered stream, not hydrated instances

**What this gives you:** A default for any card that *shows a list of other cards* — render the prerendered `@context.searchResultsComponent` stream, and reserve the instance-hydrating getters (`getCards` / `getCardCollection` / `store.search`) for the rows you genuinely read or mutate. The cheap path scales to large realms without a per-row server round-trip.

**When to use:** Every list / grid / feed / roster / directory / search-result UI whose job is to *display* cards. Reach for this decision before you write the query — it's the one that keeps a browse view from silently becoming an N-round-trip hydration.

**The insight:** The card-facing search APIs split by **cost**, and the ergonomic-sounding ones are the expensive ones:

| Surface | What it returns | Cost | Use it for |
|---|---|---|---|
| `@context.searchResultsComponent` (base `CardList` / `CardsGrid` wrap it) | A stream of prerendered `entry` rows — inert HTML, hydrated lazily only when a row is interacted with | **Cheap.** No server `loadLinks`, no serialization, no Store hydration until a row is opened | Any list you only look at |
| `getCards` / `getCardCollection` (reactive) · `@context.store.search` (imperative) | Live `CardDef` instances | **Expensive.** Server `loadLinks` + serialization + Store hydration for *every* matching row — including rows the user never opens | Genuine read / mutate: reading a field off each row, editing, computing a rollup |

Rendering an `entry` costs a prerendered-HTML fetch; hydrating an instance costs a full round-trip *per card*. A display list of a few hundred cards is a few hundred hydrations you never needed. The right shape is: render the stream, and resolve a **single** live instance only when a row is actually opened.

## Recipe shape

Build an entry-rooted query from an ordinary `Query` with `searchEntryWireQueryFromQuery`, scope it to the realm the card lives in (via the `realmURL` Symbol), and hand it to `@context.searchResultsComponent`. Each yielded `entry.component` renders itself, so the template never branches on prerendered-vs-live.

```gts
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// @ts-expect-error import.meta is host-supported
const here: string = import.meta.url;

get listQuery(): SearchEntryWireQuery {
  let realm = this.args.model?.[realmURL]?.href;
  return {
    ...searchEntryWireQueryFromQuery({
      filter: { type: codeRef(here, './contact', 'Contact') },
      sort: [{ by: 'cardTitle', direction: 'asc' }],
    }),
    realms: realm ? [realm] : [],   // current realm only
  };
}
```

```hbs
<@context.searchResultsComponent @query={{this.listQuery}} @mode='hover' as |results|>
  {{#each results.entries key='id' as |entry|}}
    <li><entry.component /></li>
  {{else}}
    <li>{{if results.isLoading 'Loading…' 'No results'}}</li>
  {{/each}}
</@context.searchResultsComponent>
```

The full worked contrast — the cheap default plus the commented "only when you need the instances" getter, scoped to the current realm — is in `example.gts`.

**When a data-getter is genuinely needed, scope it to the current realm.** If the template really does read a field off each row or mutate it, use a hydrating getter — but pass the **current realm** (`this.args.model?.[realmURL]?.href`) as the only search realm, not the whole federation. Hydrating one realm's worth of rows is bounded; hydrating every reachable realm is not. `realmURL` is the Symbol the host injects — import it from `@cardstack/runtime-common`; `Symbol.for('realmURL')` gives you a different Symbol that won't match (see `boxel/references/query-systems.md`).

**Gotchas:**
- "I need to sort / filter the list" is **not** a reason to hydrate — the query does sorting and filtering server-side; the prerendered stream reflects it. You only need instances for values the query can't express (cross-field computation in JS) or for mutation.
- If you need one field per row in a *table* (cell-level access), that genuinely needs instances — use `getCards` and see `show-table-from-query`. A whole rendered card per row does not.
- This is defense-in-depth guidance, not enforcement. It's a nudge toward the cheap path; nothing stops a card from hydrating a display list — which is exactly why the default has to be stated.

**Source:** `boxel-catalog/components/card-list.gts`, `boxel-catalog/components/grid.gts` (the `@context.searchResultsComponent` list surface); the cost split follows the host's search-API contract documented in `boxel/references/query-systems.md`.

## See also

- `show-card-list-with-views` — the lower-level reusable grid built on `@context.searchResultsComponent` (card / strip / grid views).
- `show-table-from-query` — the counterpart for when you *do* need instances: cell-level field access via `getCards`.
- `app-card-home-with-search` — the home CardDef that composes one prerendered search section per CardDef in a family.
- `boxel/references/query-systems.md` — "When to use what to query cards", the `realmURL` scoping rule, and the entry-rooted query shape.
