# Search

The Realm object has a `searchIndex` property, which in turn as a `search(...)` method. This is the method used to issue queries and get search results (card instance JSON-API representations) from the realm index.

Note that search results are only as good as the most recent index, so if indexing is not working, or some cards are failing to be indexed, you may not get the results you expect.

## Search Queries

The `SearchIndex#search(...)` method has one required argument, a search query. The simplest query is an empty object (`{}`), which returns all cards in the index.

### Filters

The Query object may have a `filter` property, which controls which cards are included in the result set.

- `type`: allow specification of a particular card type. Also includes descendant cards in this card's adoption chain.
- `eq`: allows specifying a card with a specific field value
- `in`: a field value that is one of a list (`in: { color: ['red', 'blue'] }`)
- `range`: allows specifying a card with a field value that is gt, gte, lt, or lte a specific value. A date bound may be relative (see [Relative dates](#relative-dates)).
- `any`: allows an "OR" union of other filters
- `every`: allows an "AND" union of other filters
- `not`: allow negating another filter
- `contains`: allows you to specify a card that has a field value containing a specific value.
- `matches`: full-text search over each card's rendered markdown, in Postgres `websearch_to_tsquery` syntax (`"exact phrase"`, `or`, `-excluded`). Options:
  - `prefix: true` for type-ahead (see [Type-ahead](#type-ahead-prefix)).
  - `scope: 'title'` searches only the card's title, name and alias roles.
  - `within: '<field>'` searches the passages of a `PassageField` list instead, and reports the passages that matched in `meta.passages`.
  - `typos: true` also matches the closest words of the realm's fields declared `typos: true` (Postgres only).
  - `fields: ['material', 'brand.name']` searches only those fields' values: the same stemmed, case-insensitive word match, so `metal` finds "Metal" and `silicone` finds "Silicon". A list field's values all count. It is computed per card rather than read from an index, so anchor it on a type. It takes no `scope`, `within` or `prefix`. SQLite matches a case-insensitive substring instead.
- `typeahead`: every word is a prefix of a word of the card's title or alternative names, in any order, never stemmed. Takes `typos: true` too.
- `pattern`: a glob (`*`, `?`) over a field's whole value, ignoring case, on fields searched by pattern (declared `search: { patterns: true }`, or an `identifier` or `code` role).
- `regex`: a POSIX regular expression over the same fields (Postgres only).
- `near`: keeps cards whose `VectorField` is at least `minSimilarity` similar to a target vector (see [Vector search](#vector-search-near)).

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

### Type-ahead (`prefix`)

A `matches` filter with `prefix: true` treats the query's last word as unfinished: it matches any word that starts with it, so each keystroke can run one query. Every earlier word still has to match whole, and a query that ends in a space has no unfinished word.

```js
let { data: suggestions } = await indexer.search({
  filter: { on: talkRef, matches: 'martin kleppm', prefix: true },
  sort: [
    {
      by: '_blend',
      of: [
        { by: '_matchRelevance' },
        { on: talkRef, by: 'views', weight: 0.5 },
      ],
    },
  ],
  page: { size: 8 },
});
```

Words are indexed by their English stems, so a word whose stem is shorter than what has been typed (`learni` on the way to `learning`, indexed as `learn`) is matched by dropping up to two letters from the end of the unfinished word. A query on a type whose rendered markdown is short (a title, a name, a byline) stays fast and ranks by relevance well. Matching across long documents such as transcripts finds every mention, so anchor type-ahead on the types users pick from. An unfinished word shorter than three letters matches as a whole word, because a one- or two-letter prefix matches a large share of the index.

### Vector search (`near`)

A card can carry an embedding in a `VectorField` (`@cardstack/base/vector`; Qwen3-Embedding-8B at 1024 dimensions by default, any size up to 2,000 through a subclass that sets `dimensions` and `embeddingModel`). Queries reach it two ways:

- **Ranking**: a sort entry with a `near` target ranks by cosine similarity to it, most similar first (`direction` defaults to `desc`). Cards with no vector at the path sort last. Each result carries `meta._nearSimilarity` (1 = same direction, -1 = opposite), the way a `_matchRelevance` sort carries `meta._matchRelevance`. The k most similar cards are a near sort plus `page: { size: k }`.
- **Threshold**: a `near` filter, keyed by the field path like `range`, keeps cards whose vector has at least `minSimilarity` to `to`. Without `minSimilarity` it keeps every card that has a vector of `to`'s dimension there. It nests under `every`/`any`/`not`, so it combines with other filters and with realm policy.

`near` targets are a number array or a vector in its stored form (`{ dims, encoding, scale?, data }`). A plural path (`segments.embedding`) scores a card by its nearest vector. Search is exact. On Postgres it needs the pgvector extension; without it a `near` query is refused with an error that says so. The SQLite index (host tests) scores singular paths only.

```js
let { data: nearest } = await indexer.search({
  filter: {
    every: [
      { on: momentRef, eq: { topic: 'ml' } },
      {
        on: momentRef,
        near: { embedding: { to: target, minSimilarity: 0.5 } },
      },
    ],
  },
  sort: [{ on: momentRef, by: 'embedding', near: target }],
  page: { size: 10 },
});
```

In a query-backed field, `near` interpolates like any value, so "related moments" is a declared query. A source card with no embedding resolves to no cards:

```js
@field related = linksToMany(() => Moment, {
  query: {
    filter: { not: { eq: { id: '$this.id' } } },
    sort: [{ by: 'embedding', near: '$this.embedding' }],
    page: { size: 10 },
  },
});
```

### Blended ranking (`_blend`)

A `_blend` sort fuses several ranking signals into one order with reciprocal rank fusion. Each card scores `sum(weight / (k + rank))` over the signals it has a value for, with each signal ranked over every card the filter admits. `of` takes any other sort entries: text relevance (`_matchRelevance`), a `near` sort, a general field such as `createdAt` (recency), or a card field such as a view count (engagement). Each signal ranks best first, meaning highest value first unless the entry says `direction: 'asc'`. A card with no value for a signal (no vector, no text match, an empty field) gets nothing from that signal, rather than a last place. `weight` (default 1) scales a signal; `k` (default 60) controls how sharply a top rank beats the next one. Results carry `meta._blendScore`.

```js
let { data: ranked } = await indexer.search({
  filter: {
    any: [
      { on: momentRef, matches: 'pasta recipe' },
      {
        on: momentRef,
        near: { embedding: { to: target, minSimilarity: 0.5 } },
      },
    ],
  },
  sort: [
    {
      by: '_blend',
      of: [
        { by: '_matchRelevance' },
        { on: momentRef, by: 'embedding', near: target, weight: 2 },
        { by: 'createdAt', weight: 0.5 },
        { on: momentRef, by: 'views', weight: 0.5 },
      ],
    },
  ],
  page: { size: 10 },
});
```

A negative `weight` inverts a signal, as in `_relevance`: it ranks the other way round with the weight's size, so `{ on: productRef, by: 'unitsSold30d', weight: -1 }` favours the least sold, and a negative `near` signal favours the least similar.

A `_when` signal is a "should" clause: `{ by: '_when', when: <filter>, weight }` lifts the cards the filter admits without dropping the rest. Every match ties for first place in it, so each gains `weight / (k + 1)` and a card that doesn't match gains nothing. With a negative weight it lifts the cards that don't match. `when` is any filter; on the wire its field paths go through `item.` and it takes the query's anchor when it names none. `_when` ranks only inside a `_blend`.

```js
sort: [
  {
    by: '_blend',
    of: [
      { by: '_matchRelevance' },
      {
        by: '_when',
        when: { on: productRef, eq: { material: 'Leather' } },
        weight: 1.5,
      },
      {
        by: '_when',
        when: { on: productRef, range: { returnRate: { gt: 0.1 } } },
        weight: -1,
      },
    ],
  },
];
```

Ranks are positions, not raw scores, so signals on different scales (text relevance, cosine similarity, timestamps, counts) combine without normalization. A `_matchRelevance` signal needs a positive `matches` term in the filter, as it does on its own. A blend takes up to 8 signals and cannot nest. Live queries leave a blend to the server, because it ranks over the whole match set. Across realms, ranks are per realm, so a federated blend orders only approximately.

### Relevance (`_relevance`)

A `_relevance` sort ranks by search intent. It blends text relevance (weighted by the search roles of the fields that matched) with the ranking signals the type declares (`search: { rank: 'popularity' }` and the like: `popularity`, `quality`, `recency`, `priority`). Given `near`, it also blends in the similarity of the type's vector field as the `meaning` signal. It compiles to a `_blend`, so results carry `meta._blendScore`.

`weights` re-weights signals by name. Unnamed signals take their defaults: `text` and `meaning` 1, the rest 0.5. A weight of 0 drops a signal, and a negative weight inverts it (least popular first).

```js
sort: [
  {
    by: '_relevance',
    on: productRef,
    near: queryVector,
    weights: { text: 0.6, meaning: 1.5, quality: 0.5, popularity: 0 },
  },
];
```

### Collapsing to one per group (`collapse`)

`collapse` keeps the best cards of each group: of the cards that share a value at `by`, only the first `keep` (default 1) by the query's own sort come back. Use it to show one size of a product rather than five, or one card per type. A card with no value at `by` is a group of its own. `meta.page.total` counts what remains, and pages page over it. Facets still count every match.

`on` names the type whose field `by` is; without it, the filter's anchor (`on` or `type`) is used. A string is shorthand for `{ by }`.

```js
let { data, meta } = await indexer.search({
  filter: { on: productRef, matches: 'running shoe' },
  sort: [{ by: '_relevance', on: productRef }],
  collapse: { by: 'variantGroup', on: productRef, keep: 1 },
  page: { size: 24 },
});
```

On the wire, `by` goes through `item.` (`collapse: 'item.variantGroup'`) and the type is `item.on`. Live queries leave a collapsed query to the server, since the best of a group is chosen over the whole match set. Across realms each realm collapses its own results, so two realms may each return a card of the same group.

### Relative dates

A `range` bound on a date field may be relative: `now`, optionally moved by whole units (`now-30d`, `now+1w`), optionally rounded down to the start of a unit in UTC (`now-30d/d`, `now/M`). The units are `s`, `m`, `h`, `d`, `w`, `M` (months) and `y`. A week starts on Monday. The bound is read when the query runs, so a saved search for "added this month" stays current. On a `DateField` or `DateTimeField` the bound is compared in the field's own format. Any other string is a literal bound.

```js
filter: {
  on: productRef,
  range: { publishedAt: { gte: 'now-30d/d' } },
},
```

### Facets

The Query object may have a `facets` property: up to 8 counts of what the matched cards hold in one field, counted by the database over every match, not only the page returned. Each facet comes back in `meta.facets[by]` as `{ value, count }` entries, most common first. `by` is a field path, dotted for a compound field; a list field counts each of its values. A link facet's value is the linked card's id, with its title as `label`.

| Member          | Effect                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`          | How many values come back (default 50, at most 1000).                                                                                                                                    |
| `own: 'ignore'` | Counts without the facet's own selection, so a multi-select list keeps its other values while one is picked.                                                                             |
| `stats: true`   | Adds count, distinct count and min, max, sum and average (numbers) or min and max (text) in `meta.facetStats[by]`.                                                                       |
| `ranges`        | Counts the matches in each `[from, to)` bucket, labelled by `key` or `from-to` (`*` for an open end).                                                                                    |
| `interval`      | Counts by `day`, `week` (from Monday), `month` or `year` of a date value.                                                                                                                |
| `prefix`        | Keeps the values that start with it, ignoring case.                                                                                                                                      |
| `missing: true` | Adds the count of matches with no value (`meta.facetStats[by].missing`).                                                                                                                 |
| `order`         | `count` (the default), `value`, or `measure`.                                                                                                                                            |
| `measure`       | An aggregate of another number field over the matches holding each value: one of `{ avg }`, `{ min }`, `{ max }`, `{ sum }`, naming the field. It comes back as `measure` on each entry. |

A field declared `search: { facet }` takes its shape from the declaration when the query names none of `stats`, `ranges` and `interval`: a number facet is range buckets with stats, and a date facet is a monthly histogram with stats.

```js
facets: [
  {
    by: 'brand.name',
    measure: { avg: 'priceMin' },
    order: 'measure',
    size: 20,
  },
];
// meta.facets['brand.name'] → [{ value: 'Acme', count: 12, measure: { avg: 84.5 } }, …]
```

Across realms, counts add up. A measure combines too: an average weighted by each realm's count, the smaller min, the larger max, the summed sum.

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

### A result a policy scoped

`meta.policyScopedRealms` lists the realms whose rows in the result the server decided by more than the query the caller sent:

- every realm the caller cannot read outright. What such a realm contributes is its policy's to decide: the rows a grant admits, or none. The realm is listed either way, so the list does not tell a caller whether they hold a grant there.
- every realm a declared query (one naming an `operation`) searched, since the server answers it with its own resolution of the declaration.

A client that reconciles a result with cards it already holds, as the host's live search does with local creates and edits, may drop a row of a listed realm that no longer matches, and must never add one the server did not return: a matching card the client holds may be one the policy withheld. Realms that are not listed reconcile freely. The list names realms and nothing else. It never carries the filter a grant composed, the rule that matched, or a count of what was withheld. When no realm is listed, the key is absent.

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
- `_isCardInstanceFile` — stamped `true` only on a card `.json`'s file row; the dedup key (`eq: false` keeps everything else).
- `{ type: <BaseDef> }` — BaseDef terminates both kinds' type chains, so a BaseDef-anchored type filter matches every row and composes with other conditions.

Any other field key narrows the result to a single kind. `_cardType` (the card type's display name) is a card-only synthetic — file rows never carry it — which makes it a kind discriminator in mixed queries (`not: { eq: { _cardType: null } }` is a cards-only filter) but a poor mixed sort key: every file sinks to the NULLS-LAST tail.

When does a BaseDef anchor beat `scope: 'all'`? `scope` is query-global — it pins the row kind for the whole request — while `{ type: <BaseDef> }` is a filter node, composable inside the tree: one branch of an `any:` can span both kinds while a sibling branch is card-typed, or it can intersect with another type condition under `every:`. If the whole query wants both kinds, `scope: 'all'` is the spelling; the BaseDef anchor is for kind-spanning _within_ a filter composition.

`_`-prefixed top-level keys are reserved for these synthetics — the query engine resolves them by name before any field-definition lookup, so a user-defined field with a colliding name would silently get the synthetic's semantics (see `runtime-common/search-doc-keys.ts`).
