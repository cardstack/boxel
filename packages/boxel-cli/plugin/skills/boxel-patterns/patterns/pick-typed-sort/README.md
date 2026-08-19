---
validated: source-proven
---

# pick-typed-sort — Typed SortMenu with exported Sort constants

**What this gives you:** A `SortMenu` dropdown component, typed `SortOption` interface, and a vocabulary of named `Sort` constants (`sortByCardTitleAsc`, `sortByMostRecent`, etc.) cards can share. Browse views become a one-line `<SortMenu @options={{SORT_OPTIONS}} @onSort={{this.setSort}} @selected={{this.activeSort}} />`.

**When to use:** Any browse/list view that needs user-driven sort. Catalog listings, table headers, search results.

**The insight:** `Sort` is a real type from `@cardstack/runtime-common`. Building a sort menu by passing structured `Sort` constants instead of strings:
- Each option is a `{ id, displayName, sort: Sort }` triple.
- The actual `Sort` array references the field via `{ on: { module, name }, by, direction }`.
- `baseRRI('card-api')` resolves the base-realm module URL so `cardTitle` works as a sort field.

This replaces ad-hoc string sort keys with typed, refactorable references.

**Recipe shape:**

```ts
import { type Sort, baseRRI } from '@cardstack/runtime-common';

export const sortByCardTitleAsc: Sort = [
  {
    on: { module: baseRRI('card-api'), name: 'CardDef' },
    by: 'cardTitle',
    direction: 'asc',
  },
];

export interface SortOption {
  id: string;
  displayName: string;
  sort: Sort;
}

const SORT_OPTIONS: SortOption[] = [
  { id: 'title-asc',  displayName: 'Title A→Z',  sort: sortByCardTitleAsc },
  { id: 'title-desc', displayName: 'Title Z→A',  sort: [{ ...sortByCardTitleAsc[0], direction: 'desc' }] },
];
```

**Gotchas:**
- The `on` reference points at the schema that owns the field. For `cardTitle` it's `CardDef`; for your custom field it's your CardDef subclass.
- `baseRRI('card-api')` is the canonical helper — don't hand-construct base-realm URLs.
- The host actually runs the sort during indexing, so `Sort` constants must match indexed fields.

**Source:** `boxel-catalog/components/sort.gts`.

**See also:** `show-card-list-with-views`, `boxel/references/query-systems.md`.
