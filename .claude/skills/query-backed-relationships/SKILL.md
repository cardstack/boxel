---
name: query-backed-relationships
description: How to declare and size a query-backed `linksTo` / `linksToMany` — the `{ query }` form of a relationship, which resolves by running a search instead of holding authored links. Covers what the field actually holds (a bounded page, not the whole match set), how to opt into a larger page, why a count-shaped rollup should read `totalMatchCount` instead of the rows, when `eager: false` is right, and when the field is the wrong tool and `@context.searchResultsComponent` is the right one. Use when writing or reviewing a card that declares a query-backed field, when a rollup over one reports a number that looks wrong, or when choosing between a query field and a search component.
---

# Query-backed relationships

A `linksTo` / `linksToMany` declared with a `query` resolves by running a
search, rather than holding links someone authored:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: { filter: { eq: { 'classroom.id': '$this.id' } } },
});
```

The field then reads like any other relationship — `this.everyActivity` is an
array of `Activity` instances — and stays current as matching cards are written.

**The one thing to internalize: the field holds a bounded page of its query, not
the whole match set.** Everything below follows from that.

## What the field actually holds

A query-backed field resolves through a page-bounded search. Declare no page and
it takes the default ceiling (`SERVER_MAX_SEARCH_PAGE_SIZE`, 500). A query
matching more than that settles holding the first 500, in sort order.

This is not an error state and nothing throws. The field is simply holding a
prefix, and it says so through its status:

```ts
import { getRelationshipMembershipState } from '@cardstack/base/card-api';

let { membership, totalMatchCount, isPartial } = getRelationshipMembershipState(
  this,
  'everyActivity',
);
```

|                   | means                                                      |
| ----------------- | ---------------------------------------------------------- |
| `membership`      | the rows the field is holding (`undefined` until resolved) |
| `totalMatchCount` | how many instances the query **matches**, page or no page  |
| `isPartial`       | `true` when membership falls short of that count           |

`isLoaded` says membership is _settled_, which a truncated set also is — so
`isLoaded` alone is not permission to trust a reduction over the rows.
`isPartial` is.

`totalMatchCount` is `undefined` — never `0` — when the count is unknown: the
field hasn't resolved, or one of the realms it targets failed and took its share
of the count with it. Do not read `?? 0` and treat that as an answer.

## Sizing a field

### If you need a count, don't hold the rows

This is the most common mistake. A rollup that reduces over the field:

```ts
// WRONG once the match count passes the ceiling — silently counts the page
@field activityCount = contains(NumberField, {
  computeVia: function (this: Classroom) {
    return this.everyActivity.length;
  },
});
```

`totalMatchCount` comes from the search's own `COUNT(*)`, which no page ever
bounds. Read it and the ceiling stops mattering:

```ts
@field activityCount = contains(NumberField, {
  computeVia: function (this: Classroom) {
    let { totalMatchCount } = getRelationshipMembershipState(
      this,
      'everyActivity',
    );
    return totalMatchCount ?? 0;
  },
});
```

The same applies to "are there any?" — `totalMatchCount > 0` beats
`this.everyActivity.length > 0`, which is right only by luck when the field is
truncated to a non-empty page.

Any _other_ aggregate — a sum, an average, a max over a field of the matches —
genuinely needs the rows, so it needs a page big enough to hold them, and it
should check `isPartial` before publishing a number.

### If you need the rows, declare the page you need

Declaring a page is the opt-in. It is honored up to
`SERVER_ABSOLUTE_MAX_PAGE_SIZE` (2000, env-tunable) everywhere the field
resolves — the indexer's expansion, a peer realm's `_search`, and the client's
live refresh:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: {
    filter: { eq: { 'classroom.id': '$this.id' } },
    page: { size: 1500 },
  },
});
```

**Do not declare a page above the maximum.** The two legs disagree about it, so
the field half-works: the indexer clamps to the maximum (a field's page is read
on every index of every instance, so an over-large one must not make the card
unindexable), but the client sends the page as authored on a live refresh and
`_search` answers that with a 400. You get a field that resolves from the
indexer's seed and then errors when a matching card is written. Stay at or below
the maximum.

**Ask for what you need, not for the maximum.** The page is a cost paid on every
resolution of every instance: rows are serialized into the owner's document, and
each one's own query fields resolve in the next layer of the same pass. A field
sized 2000 "just in case" pays for 2000 whenever it resolves.

### If the match set is genuinely unbounded, this is the wrong tool

A field that can only ever hold a bounded prefix is a poor fit for "show the user
everything matching this". For a **displayed** list, reach for the search
component instead — it runs on the prerendered-HTML leg, which the page bounds
don't apply to, and it pages lazily:

```hbs
<@context.searchResultsComponent @query={{this.query}} as |results| />
```

See the `search` skill for that surface. Rule of thumb: a query-backed field is
for a relationship the card _reasons over_; a search component is for a list the
card _renders_.

## `eager: false`

Query-backed fields resolve when their owner card loads, so a rollup over one is
current without anything having read the field. Opt out when the query is
expensive and rarely read, and it resolves on first access instead:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: { filter: { eq: { 'classroom.id': '$this.id' } } },
  eager: false,
});
```

Cost of opting out: until something reads the field, its status reports
`isLoading: false`, `isLoaded: false`, and no membership — and it holds no
realm-event subscription, so it won't refresh when matching cards are written.

## Singular query-backed `linksTo`

A `linksTo` with a query surfaces the query's **first** match — its page is
forced to size 1 by design. Sort deliberately, because "first" is whatever the
sort says:

```ts
@field mostRecentActivity = linksTo(() => Activity, {
  query: {
    filter: { eq: { 'classroom.id': '$this.id' } },
    sort: [{ by: 'createdAt', direction: 'desc' }],
  },
});
```

Its status reports a one-element membership, and `totalMatchCount` is
`undefined` / `isPartial` is `false` — the matches behind it are the field
working as declared, not a shortfall.

## Things that will bite you

- **A query field is not an index dependency.** A card the query merely
  _matches_ is deliberately not a dependency of the card holding the query —
  making it one would turn every write in a realm into an invalidation of every
  card whose query might match it. So the index never refreshes a rollup over a
  query field; the app is where the number is right. A consumer reading the
  search doc without loading the card (`boxel search`, an assistant) gets
  whatever the index last wrote.
- **Interpolation resolves against serialized attributes.** `$this.id` and
  `$this.someField` read the owner's own data. A path walking through a
  `linksTo` is not validated at compile time and may not resolve.
- **`$REALM`** interpolates the owner's realm. Absent an explicit `realm` /
  `realms`, the query targets the realm holding the instance.
- **A cross-realm field is only as complete as its realms.** A realm that
  errors contributes its error and no rows; the field keeps the realms that did
  answer, and `totalMatchCount` goes `undefined` because the count is no longer
  knowable.

## Where this lives

| concern                                                | file                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Field declaration + `getRelationshipMembershipState`   | `packages/base/card-api.gts`, `packages/base/field-support.ts` |
| Client-side resolution, seeding                        | `packages/base/query-field-support.ts`                         |
| Query normalization + `$this` / `$REALM` interpolation | `packages/runtime-common/query-field-utils.ts`                 |
| Indexer-side expansion + match count                   | `packages/runtime-common/realm-index-query-engine.ts`          |
| Page bounds                                            | `packages/runtime-common/search-bounds.ts`                     |
