---
name: query-backed-relationships
description: 'Use when declaring or reviewing a query-backed `linksTo`/`linksToMany` — the `{ query }` form that resolves by running a search instead of holding authored links. Covers the one thing that surprises everyone (the field holds a bounded page of its query, not the whole match set), reading `totalMatchCount` instead of counting rows, declaring a larger page, `eager: false`, and when the field is the wrong tool. Activates on "count the linked cards", "inverse relationship", "linksToMany with a query", a rollup whose number looks too low or stuck, and "why does my field only have 500 items".'
boxel:
  kind: skill
---

# Query-backed relationships

_The `{ query }` form of a relationship, and the bounded page nobody expects._

A `linksTo` / `linksToMany` declared with a `query` resolves by running a search
rather than holding links someone authored:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: { filter: { eq: { 'classroom.id': '$this.id' } } },
});
```

It then reads like any other relationship — `this.everyActivity` is an array of
`Activity` instances — and stays current as matching cards are written. This is
the "inverse side" of a link: derived from a filter instead of stored on the
card.

**The one thing to internalize: the field holds a bounded page of its query, not
the whole match set.** Everything below follows from that.

## ⚠️ The silent trap: counting rows

A rollup that reduces over the field is wrong the moment the match count passes
the page ceiling — and nothing throws, nothing warns in the card, and the number
looks entirely plausible:

```ts
// WRONG. Silently counts the page, not the matches.
@field activityCount = contains(NumberField, {
  computeVia: function (this: Classroom) {
    return this.everyActivity.length;
  },
});
```

A classroom with 600 activity updates reports 500. Read the count off the
field's status instead — it comes from the search's own `COUNT(*)`, which no page
ever bounds:

```ts
import { getRelationshipMembershipState } from '@cardstack/base/card-api';

@field activityCount = contains(NumberField, {
  computeVia: function (this: Classroom) {
    let { totalMatchCount } = getRelationshipMembershipState(
      this,
      'everyActivity',
    );
    // Returned as-is. `undefined` means the count is unknown (see below), and
    // leaving the field empty says that; `?? 0` would render a confident nought
    // over a set nobody counted.
    return totalMatchCount;
  },
});
```

The ceiling then stops mattering for this field entirely — no rows are held to
count. Same for "are there any?": `(totalMatchCount ?? 0) > 0` reads a genuine
zero and an unknown alike as "none", so where that difference matters, branch on
`totalMatchCount === undefined` first. Either way it beats
`this.everyActivity.length > 0`, which is right only by luck once the field is
truncated.

Any _other_ aggregate — a sum, an average, a max over a field of the matches —
genuinely needs the rows, so it needs a page big enough to hold them **and**
should check `isPartial` before publishing a number. See
[`bxl-authoring`](../bxl-authoring/SKILL.md) §7 for aggregating over an inverse
in BXL.

## Reading the field's status

```ts
let { membership, isLoading, isLoaded, totalMatchCount, isPartial } =
  getRelationshipMembershipState(this, "everyActivity");
```

|                   | means                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `membership`      | one `RelationshipState` per row the field holds (`undefined` until resolved) |
| `isLoading`       | a fetch or search is in flight — bind this to a spinner                     |
| `isLoaded`        | membership is settled                                                       |
| `totalMatchCount` | how many instances the query **matches**, page or no page                   |
| `isPartial`       | `true` when membership falls short of that count                            |

`membership` is per-slot resolution state, not the cards themselves — read
`this.everyActivity` for those. Each entry says whether its slot resolved, and
to what; the states and how to traverse them safely are in
[`boxel/references/defensive-link-traversal.md`](../boxel/references/defensive-link-traversal.md).

Two traps in that table:

- **`isLoaded` is not permission to trust a reduction.** A truncated set is
  settled too. `isPartial` is the one that licenses it.
- **`totalMatchCount` absent means unknown, never zero.** The field hasn't
  resolved, or one of the realms it targets failed and took its share of the
  count with it. A genuine empty match reports `0`. Don't let `?? 0` collapse
  those two into one answer where the difference matters.

For the spinner pattern and the observe-only rule (`isLoading` never _starts_
the load — the template must render the field too), see
[`boxel/references/relationship-loading-state.md`](../boxel/references/relationship-loading-state.md).

## Sizing the page

**Default:** a field declaring no page takes the default ceiling (500). A query
matching more settles holding the first 500, in sort order, with
`isPartial: true`.

**To opt into more, declare the page you need.** It is honored up to a hard
maximum (2000) everywhere the field resolves:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: {
    filter: { eq: { 'classroom.id': '$this.id' } },
    page: { size: 1500 },
  },
});
```

Above the maximum the page clamps to the maximum and the realm logs that it did,
so you get 2000 rows and `isPartial: true` rather than an error — a field's page
is read on every index of every instance of that card, so an over-large one must
never make the card unindexable.

**Ask for what you need, not for the maximum.** The page is a cost paid on every
resolution of every instance: the rows are serialized into the owner's document,
and each one's _own_ query fields resolve in the next layer of the same pass. A
field sized 2000 "just in case" pays for 2000 every time it resolves.

## When the field is the wrong tool

A field that can only ever hold a bounded prefix is a poor fit for "show the
user everything matching this". For a **displayed** list, reach for the search
component — it runs on the prerendered-HTML leg, which the page ceiling doesn't
apply to, and it pages lazily:

```hbs
<@context.searchResultsComponent @query={{this.query}} as |results| />
```

Its `results.meta.page.total` is the same true count `totalMatchCount` gives
you. See the count-tile and table patterns in
[`boxel-patterns`](../boxel-patterns/SKILL.md).

> **Rule of thumb:** a query-backed field is for a relationship the card
> _reasons over_; a search component is for a list the card _renders_.

## `eager: false`

A query-backed field resolves when its owner card loads, so a rollup over one is
current without anything having read the field. Opt out when the query is
expensive and rarely read, and it resolves on first access instead:

```ts
@field everyActivity = linksToMany(() => Activity, {
  query: { filter: { eq: { 'classroom.id': '$this.id' } } },
  eager: false,
});
```

Cost of opting out: until something reads the field it reports
`isLoading: false`, `isLoaded: false`, no membership — and it holds no
realm-event subscription, so it won't refresh when matching cards are written.

## Singular query-backed `linksTo`

A `linksTo` with a query surfaces the query's **first** match; its page is
forced to size 1 by design. So its `sort` is load-bearing — "first" is whatever
the sort says:

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

## Interpolation

`$this.<path>` reads the owner's own serialized attributes; `$REALM`
interpolates the owner's realm. Absent an explicit `realm` / `realms`, the query
targets the realm holding the instance.

A path that walks through a `linksTo` is not validated when the field is
declared, because interpolation resolves against serialized attributes — so it
may simply not resolve at runtime.

## Things that will bite you

- **A query field is not an index dependency.** A card the query merely
  _matches_ is deliberately not a dependency of the card holding the query —
  making it one would turn every write in a workspace into an invalidation of
  every card whose query might match it. So the index never refreshes a rollup
  over a query field: the app is where the number is right, and a consumer
  reading the search doc without loading the card gets whatever the index last
  wrote. [`bxl-authoring`](../bxl-authoring/SKILL.md) §7 covers the staleness
  consequences for aggregates.
- **A cross-realm field is only as complete as its realms.** A realm that errors
  contributes its error and no rows; the field keeps the realms that answered,
  and `totalMatchCount` goes `undefined` because the count is no longer
  knowable.
- **Don't filter or sort on a rollup over an inverse.** It's a display value,
  not a promptly-correct index-time fact.
