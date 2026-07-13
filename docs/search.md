# Search

The Realm object has a `searchIndex` property, which in turn as a `search(...)` method. This is the method used to issue queries and get search results (card instance JSON-API representations) from the realm index.

Note that search results are only as good as the most recent index, so if indexing is not working, or some cards are failing to be indexed, you may not get the results you expect.

## Search Queries

The `SearchIndex#search(...)` method has one required argument, a search query. The simplest query is an empty object (`{}`), which returns all cards in the index.

### Filters

The Query object may have a `filter` property, which controls which cards are included in the result set.

- `type`: allow specification of a particular card type. Also includes descendant cards in this card's adoption chain.
- `eq`: allows specifying a card with a specific field value
- `range`: allows specifying a card with a field value that is gt, gte, lt, or lte a specific value
- `any`: allows an "OR" union of other filters
- `every`: allows an "AND" union of other filters
- `not`: allow negating another filter
- `contains`: allows you to specify a card that has a field value containing a specific value.

- `on`: may be used with `eq`,`range` and `every` to limit results to a particular card type. `on` provides the card type context for a field. This is how we can disambiguate, for example, between a `Company.name` field and a `Country.name` field. Simply providing a predicate to filter by the `name` field isnt enough. You need to say which card's name field you want to filter by -- this is the function of `on`.

Nested fields may be specified using a dot (`.`) notation.

Boxel's ability to filter containsMany and linksToMany fields is quite limited currently. Say for instance we have a card Company with a Department field that is a linksToMany field. There would be no easy way to express a filter that returns all the companies that have more than 5 departments. Better support for plural field predicate filtering is something we would like to improve in the future.

A note about the efficiency around linked fields in search results: Currently, the search index doesn't cache linked fields. Those are, for the time being, considered volatile and will be loaded at the time the search request is made. When we build up the search doc for a card with nested fields we will accurately reflect that as well as the dependent cards. When the dependent cards are updated, we invalidate the all the cards that consume them and rebuild their search docs -- so searches will be correct. We don't, however, cache the JSON API documents for these cards in the index -- rather we cache just the JSON API resource (i.e. without the `included` part of the JSON API document). When serving the card search results from the realm, we reconstruct the included part of the JSON API document each time.

#### Examples

```js
let { data: matching } = await indexer.search({
  filter: {
    type: { module: `https://my.realm/article`, name: 'Article' },
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    on: { module: `https://my.realm/post`, name: 'Post' },
    range: { views: { lte: 10, gt: 5 }, 'author.posts': { gte: 1 } },
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    on: { module: `https://my.realm/booking`, name: 'Booking' },
    eq: { 'hosts.firstName': 'Arthur' },
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    on: { module: `https://my.realm/article`, name: 'Article' },
    not: { eq: { 'author.firstName': 'Carl' } },
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    any: [
      {
        on: { module: `https://my.realm/article`, name: 'Article' },
        eq: { 'author.firstName': 'Kafka' },
      },
      {
        on: { module: `https://my.realm/book`, name: 'Book' },
        eq: { 'author.firstName': 'Kafka' },
      },
    ],
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    on: {
      module: `https://my.realm/post`,
      name: 'Post',
    },
    every: [
      { eq: { cardTitle: 'Card 1' } },
      { not: { eq: { 'author.firstName': 'Cardy' } } },
    ],
  },
});
```

```js
let { data: matching } = await indexer.search({
  filter: {
    on: { module: `https://my.realm/person`, name: 'Person' },
    contains: { firstName: 'Carl' },
  },
});
```

### Sort Order

The Query object may have a `sort` property, which controls the order in which results are returned.

A `sort` is an array property value where each item is an object that consists of `on`, `by`, and optionally `direction`. The array is the order in which the sort is applied.

- `on`: The card type being sorted
- `by`: The field name to be sorted on. Nested fields may be supported using a dot (`.`) notation.
- `direction`: `asc` or `desc`, default is `asc`

#### Examples

```js
let { data: matching } = await indexer.search({
  sort: [
    {
      by: 'author.firstName',
      on: { module: `https://my.realm/article`, name: 'Article' },
      direction: 'desc',
    },
  ],
  filter: { type: { module: `https://my.realm/post`, name: 'Post' } },
});
```

```js
let { data: matching } = await indexer.search({
  sort: [
    {
      by: 'editions',
      on: { module: `https://my.realm/book`, name: 'Book' },
      direction: 'desc',
    },
    {
      by: 'author.lastName',
      on: { module: `https://my.realm/book`, name: 'Book' },
    },
  ],
  filter: { type: { module: `https://my.realm/book`, name: 'Book' } },
});
```

### Pagination

The Query object may have a `page` property, which controls pagination of search results. This allows you to retrieve results in smaller chunks for better performance and user experience.

The `page` object has the following properties:

- `number`: The page number (0-based indexing)
- `size`: The number of results per page. If not provided, there is no default size and will just behave like a regular search.

The search response includes a `meta` object with pagination information:

- `meta.page.total`: The total number of results across all pages

#### Examples

```ts
// Get the first page with 10 results
let { data: matching, meta } = await indexer.search({
  filter: {
    type: { module: `https://my.realm/article`, name: 'Article' },
  },
  page: {
    number: 0,
    size: 10,
  },
});
```

```ts
// Get the second page
let { data: matching, meta } = await indexer.search({
  filter: {
    type: { module: `https://my.realm/article`, name: 'Article' },
  },
  page: {
    number: 1,
    size: 10,
  },
  sort: [
    {
      by: 'cardTitle',
      on: { module: `https://my.realm/article`, name: 'Article' },
      direction: 'asc',
    },
  ],
});
```

## HTTP API

The TypeScript API described above is exposed by the realm server over HTTP as the `entry` API: `/_search` at a realm root (a single realm) and `/_federated-search` on the realm server (across realms). Both speak the `entry` wire query — build one from an ordinary `Query` with `searchEntryWireQueryFromQuery` — sent as the request body with the `QUERY` method. An Accept header of `application/vnd.card+json` must be sent.

### Example

```ts
import {
  searchEntryWireQueryFromQuery,
  type Query,
} from '@cardstack/runtime-common';

let query: Query = {
  filter: {
    on: {
      module: `https://my.realm/person`,
      name: 'Person',
    },
    eq: {
      firstName: 'Van Gogh',
    },
  },
};

let response = await request
  .post(`/_search`)
  .set('Accept', 'application/vnd.card+json')
  .set('Content-Type', 'application/json')
  .set('X-HTTP-Method-Override', 'QUERY')
  .send(searchEntryWireQueryFromQuery(query, { fields: ['item'] }));
```

The response is an `entry` collection document: each entry resolves to prerendered HTML (the fast path) or a live serialization, and `fields: ['item']` asks for the full card/file serialization in `included`.

### Result kinds and `scope`

The index holds two row kinds: card instances and files (a card's `.json` is dual-indexed — it appears as both an `instance` row and a `file` row that share the same URL). A search spans both kinds by default.

Select which kinds a query returns with the `scope` member (default `'all'`):

- `scope: 'cards'` — card instances only.
- `scope: 'files'` — file rows only (including a card `.json`'s file row).
- `scope: 'all'` — both kinds. This returns **both** rows of a dual-indexed card `.json`. To keep each card once (drop the duplicate `.json` file row) add the dedup filter `excludeCardInstanceFileRows()` — i.e. `eq: { _isCardInstanceFile: false }`.

`scope` pins the row kind directly, independent of the filter, so it works with any filter shape. Prefer it over discriminating kind through a `{ type: … }` anchor.

```ts
// Card instances only, across realms:
searchEntryWireQueryFromQuery(query, { fields: ['item'], scope: 'cards' });
```

### The mixed-search key contract

Cards and files carry non-overlapping fields, so a filter that names a card field narrows to cards by construction, and a FileDef-typed filter narrows to files. A mixed (`scope: 'all'`) query can filter and sort across both kinds only through the keys both row kinds carry:

- `matches` — full-text search over both kinds' content.
- `_title` — the row's display title (a card's `cardTitle`, a file's name); usable in `contains` and `sort`.
- `_cardType` — the card type's display name.
- `_isCardInstanceFile` — stamped `true` only on a card `.json`'s file row; the dedup key (`eq: false` keeps everything else).
- `{ type: <BaseDef> }` — BaseDef terminates both kinds' type chains, so a BaseDef-anchored type filter matches every row and composes with other conditions.

Any other field key narrows the result to a single kind.
