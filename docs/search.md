# Search

The Realm object has a `searchIndex` property, which in turn as a `search(...)` method. This is the method used to issue queries and get search results (card instance JSON-API representations) from the realm index.

Note that search results are only as good as the most recent index, so if indexing is not working, or some cards are failing to be indexed, you may not get the results you expect.

## Search Queries

The `SearchIndex#search(...)` method has one required argument, a search query. The simplest query is an empty object (`{}`), which returns all cards in the index.

### The shape of a query

A query is declarative: it says what it wants, and the engine chooses the order in which to do it. No member means something different because of where it sits in the object or in a list, and there is no ordered pipeline form. The members are:

| Member     | What it says                                                                                      | Section                                                    |
| ---------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `type`     | The card type the whole query is about. Every clause inherits it.                                 | [One type](#one-type-for-the-whole-query-type)             |
| `filter`   | Which cards match.                                                                                | [Filters](#filters)                                        |
| `sort`     | How the matches are ordered: fields, `textRelevance`, `near`, `expression`, `blend`, `relevance`. | [Sort Order](#sort-order)                                  |
| `let`      | Lists or one card, computed before the query and read with `{ "$let": … }`.                       | [`let`](#lists-computed-first-let)                         |
| `collapse` | Keep the best few of each group.                                                                  | [`collapse`](#collapsing-to-one-per-group-collapse)        |
| `rerank`   | Re-order the top rows by any Excel expression, optionally against a comparison set.               | [`rerank`](#re-ranking-the-top-with-any-expression-rerank) |
| `facets`   | Counts and statistics over every match.                                                           | [Facets](#facets)                                          |
| `explain`  | Each result's ranking signals and their shares.                                                   | [`explain`](#why-a-result-ranks-where-it-does-explain)     |
| `select`   | Answer as a table of indexed values instead of entries.                                           | [`select`](#a-table-of-values-select)                      |
| `page`     | Which slice of the results. A query that names none gets 50.                                      | [Pagination](#pagination)                                  |

Over HTTP the query also carries `realms`, and across several realms `federation` (see [Federated search](#federated-search)).

A typical query names its type once and lets every clause inherit it:

```js
{
  type: productRef,
  filter: {
    every: [
      { matches: 'brass lamp' },
      { range: { priceMin: { lte: 50 } } },
    ],
  },
  sort: [{ blend: [{ by: 'textRelevance' }, { by: 'rating', weight: 0.5 }] }],
  facets: [{ by: 'brand.name', size: 10 }],
  page: { size: 24 },
}
```

For what people ask for and the query that answers it ("hidden gem", "cheap for its kind", "dupes of this"), see the [search cookbook](search-cookbook.md).

The older form, with an `on` in every clause, still works and is what most examples in the next two sections use. Unknown members are refused rather than ignored, with the nearest real name (see [Refusals](#refusals)).

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
- `linkedFrom`: keeps the cards another card links to. `{ linkedFrom: { card: 'https://my.realm/Wishlist/mine', field: 'items' } }` is "in my saved list". `field` names a `linksTo` or `linksToMany` of that card, dotted through a compound field. The source is read from that card's index entry, so it must be a card instance in the realm being searched; a card in another realm, or one that doesn't exist, links to nothing.

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
      blend: [
        { by: 'textRelevance' },
        { on: talkRef, by: 'views', weight: 0.5 },
      ],
    },
  ],
  page: { size: 8 },
});
```

Accents fold everywhere words are matched, in a card's fields, its rendered page, a prefix still being typed and `typeahead`: `creme` and `crème` find "Crème", and `cafe` finds "Café". Words are indexed by their English stems, so a word whose stem is shorter than what has been typed (`learni` on the way to `learning`, indexed as `learn`) is matched by dropping up to two letters from the end of the unfinished word. A query on a type whose rendered markdown is short (a title, a name, a byline) stays fast and ranks by relevance well. Matching across long documents such as transcripts finds every mention, so anchor type-ahead on the types users pick from. An unfinished word shorter than three letters matches as a whole word, because a one- or two-letter prefix matches a large share of the index.

### Vector search (`near`)

A card can carry an embedding in a `VectorField` (`@cardstack/base/vector`; Qwen3-Embedding-8B at 1024 dimensions by default, any size up to 2,000 through a subclass that sets `dimensions` and `embeddingModel`). Queries reach it two ways:

- **Ranking**: a sort entry with a `near` target ranks by cosine similarity to it, most similar first (`direction` defaults to `desc`). Cards with no vector at the path sort last. Each result carries `meta._nearSimilarity` (1 = same direction, -1 = opposite), the way a `textRelevance` sort carries `meta._matchRelevance`. The k most similar cards are a near sort plus `page: { size: k }`.
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

### One type for the whole query (`type`)

A query may name its card type once, at the top: `{ type: productRef, filter: { eq: { color: 'Grey' } }, sort: [{ by: 'rating' }] }`. The filter, every sort entry and the collapse inherit it, so no clause needs its own `on`. A clause that names a different `on` keeps it. A field sort with no type anywhere is refused (`sort-needs-type`), and so is a field the type does not have (`unknown-field`), with the nearest field name.

A field may be written as its path, with or without `item.`, or as a label in any case and spacing: `PriceMin`, `"Units Sold 30d"` and `Brand.Name` resolve to `priceMin`, `unitsSold30d` and `brand.name` against the type.

`exists: path` keeps the cards with a value there, and `missing: path` those without one. On a field sort, `missing: 'first'` puts the cards with no value first (they go last by default).

### Blended ranking (`blend`)

A `blend` sort fuses several ranking signals into one order with reciprocal rank fusion. Each card scores `sum(weight / (k + rank))` over the signals it has a value for, with each signal ranked over every card the filter admits. The list takes any other sort entries: text relevance (`textRelevance`), a `near` sort, a general field such as `createdAt` (recency), a card field such as a view count (engagement), an `expression` and a `boost`. Each signal ranks best first, meaning highest value first unless the entry says `direction: 'asc'`. A card with no value for a signal (no vector, no text match, an empty field) gets nothing from that signal, rather than a last place. `weight` (default 1) scales a signal; `k` (default 60) controls how sharply a top rank beats the next one. Results carry `meta._blendScore`.

```js
let { data: ranked } = await indexer.search({
  type: momentRef,
  filter: {
    any: [
      { matches: 'pasta recipe' },
      { near: { embedding: { to: target, minSimilarity: 0.5 } } },
    ],
  },
  sort: [
    {
      blend: [
        { by: 'textRelevance' },
        { by: 'embedding', near: target, weight: 2 },
        { by: 'createdAt', weight: 0.5 },
        { by: 'views', weight: 0.5 },
      ],
    },
  ],
  page: { size: 10 },
});
```

A negative `weight` inverts a signal, as in `relevance`: it ranks the other way around with the weight's size, so `{ by: 'unitsSold30d', weight: -1 }` favors the least sold, and a negative `near` signal favors the least similar.

A `boost` is a "should" clause: `{ boost: <filter>, weight }` lifts the cards the filter admits without dropping the rest. Every match ties for first place in it, so each gains `weight / (k + 1)` and a card that doesn't match gains nothing. With a negative weight it lifts the cards that don't match. A boost ranks only inside a `blend`, and takes the query's type when its filter names none.

```js
sort: [
  {
    blend: [
      { by: 'textRelevance' },
      { boost: { eq: { material: 'Leather' } }, weight: 1.5 },
      { boost: { range: { returnRate: { gt: 0.1 } } }, weight: -1 },
    ],
  },
];
```

Ranks are positions, not raw scores, so signals on different scales (text relevance, cosine similarity, timestamps, counts) combine without normalization. A `textRelevance` signal needs a positive `matches` term in the filter, as it does on its own. A blend takes up to 8 signals and cannot nest. Live queries leave a blend to the server, because it ranks over the whole match set. Across realms, each realm ranks its own matches, so a merged federated blend orders only approximately (see [Federated search](#federated-search)).

### Ranking by an expression (`expression`)

An `expression` sort ranks by a spreadsheet expression over each card's fields: `{ expression: 'rating / LN(priceMin + 1)' }`, highest first unless `direction` is `asc`. The engine places it:

- **In SQL, over every match**, when the expression is in BXL's score profile ([`packages/bxl/docs/score-sql.md`](../packages/bxl/docs/score-sql.md)): numbers, field names, arithmetic, comparisons and `IF`, `IFERROR`, `ROUND`, `LN`, `LOG10`, `SQRT`, `POWER`, `MIN`, `MAX`, `AVERAGE`, `DAYS`, `NOW` and the like. It orders the whole set, pages and collapses like any sort.
- **Over the top window** (the query's first 500 rows), when it uses a function the profile does not (text, statistical, financial): the realm runs it there with every Excel function, as a `rerank` does. `placement: 'top'` asks for this placement, and `placement: 'sql'` insists on the first; an expression that cannot run as SQL is then refused.

Both places follow Excel's rules for blanks and errors, so an expression ranks the same wherever it runs. A missing field is 0 in arithmetic and in a comparison, and `IF` on it takes the else branch. `MIN`, `MAX` and `AVERAGE` skip it. A division by zero or the log of a non-positive number is an error that propagates until `IFERROR` catches it, and `IFERROR` catches only errors, not blanks. A card whose expression ends blank or an error ranks last. A value too large for SQL makes the realm run the expression over the top window rather than fail the search.

An expression over the top window re-ranks what the rest of the query found, so it must be the first sort key, and it is refused beside a `collapse` or a `rerank` of the query's own (`expression-placement`, saying why the expression is there). An expression that isn't a non-empty string is refused (`invalid-expression`), and so is a function BXL does not know (`unknown-function`), naming it.

`meta.expression` says where it ran (`{ "placement": "sql" }`, or `"top"` with the `reason`), and each result carries its value as `meta._expression`. Inside a `blend`, an expression is a signal with a `weight`; it runs in SQL only, so one that cannot is refused (`expression-placement`). `explain` names it by its text.

```js
sort: [
  {
    blend: [
      { by: 'textRelevance' },
      { expression: 'IFERROR(wishlistCount / unitsSold30d, 0)', weight: 1.5 },
    ],
  },
];
```

Postgres only.

### Re-ranking the top with any expression (`rerank`)

An expression in SQL can use only the functions Postgres can compute. `rerank` is the second layer: the query ranks as it would (filter, sort, `let`, `collapse`), the realm takes its first `top` rows (default 100, at most 500), evaluates a BXL expression over each row's fields with every Excel function (text, statistical and financial ones included) in BXL's sandbox, and orders those rows by the value, highest first unless `direction` is `asc`. A spreadsheet expression there follows the same rules for blanks and errors as an `expression` in SQL. A row whose expression gives no number (an error, a missing field) keeps its place after the ones that do. Pages read the re-ranked window, then the rows after it in the query's own order: a page that runs past the window is filled from them, and a page that starts past it keeps the query's order. A row after the window carries no `_rerank`. Each re-ranked row carries `meta._rerank`, and `meta.rerank` reports the window and how many rows got a number. A re-ranked row keeps everything else the query computed for it: `_blendScore`, `_matchRelevance`, `_nearSimilarity`, `_collapseSize`, `_explain`, and an `expression` sort's `_expression` (with `meta.expression` still `{ "placement": "sql" }`). A `rerank` is not the query's expression, so it adds no `meta.expression` of its own; only an `expression` placed over the top window reports `"top"`.

**Where it runs, and its time limit.** An expression Postgres can compute is scored in Postgres over the window's rows (`meta.rerank.ran` is `sql`), with its bindings and comparison sets read the same way. Any other runs on a pool of threads beside the realm server (`ran: 'thread'`; `RERANK_THREADS`, default 2), never on its event loop. Scoring has 1 second, including any wait for a free thread. A rerank that runs out of time ranks nothing: the window keeps the query's order, no row carries a value, and `meta.warnings` holds `{ code: 'rerank-timeout' }`. A thread still scoring at the limit is stopped. To stay inside it, narrow the query, lower `top`, or use functions Postgres can compute.

```js
rerank: { expression: 'IF(ISNUMBER(SEARCH("organic", title)), 1.2, 1) * rating', top: 200 }
```

**Comparison sets.** An expression can measure a row against a set, by percentile or by ratio. `compare.filter` names the set (by default, every match of the query), and `compare.by` narrows it to the rows sharing the row's value at that path, such as its own product type. The expression reaches the set through two names, for the fields it mentions:

- `stats.<field>.<count|sum|avg|min|max|median|p10|p25|p75|p90|stdev>`: aggregates over the whole set, computed when the query runs. `priceMin / stats.priceMin.median` is a product's price against the median of its kind.
- `peers.<field>`: the set's values as a list (at most 2,000 per group), for any Excel function. `PERCENTRANK_INC(peers.rating, rating)` is where its rating falls among its kind, 0 to 1.

A set reads at most 10,000 rows. Past that, `stats.` and `peers.` describe the first 10,000 the set's query returns, and `meta.rerank.compareTruncated` gives `{ rows, total }`. `meta.rerank.peersTruncated` says a group's `peers.` list was cut to 2,000 values; its `stats.` still cover the whole group. `meta.rerank.truncated` says the query matched more rows than the window, so the rows past it keep the query's order.

```js
rerank: {
  expression: 'PERCENTRANK_INC(peers.rating, rating)',
  compare: { by: 'productType' },
  top: 200,
}
```

**Look-alikes.** `compare.near` makes each row's comparison set its own nearest cards in the realm by a vector field: its `k` closest (default 20, at most 100), at least `minSimilarity` similar. `peers` and `stats` then describe those neighbors, and `peers.similarity` holds how alike each is. This is how a product is compared with the products that look like it, rather than with its whole category:

```js
rerank: {
  // how much cheaper than the 20 products that look most like it
  expression: '1 - priceMin / stats.priceMin.median',
  compare: { near: 'imageEmbedding', k: 20, minSimilarity: 0.75 },
}
// its near-identical twin, if it has one, and how much more that costs
rerank: {
  expression: 'IF(COUNT(peers.priceMin) > 0, MIN(peers.priceMin) - priceMin, 0)',
  compare: { near: 'imageEmbedding', k: 3, minSimilarity: 0.9 },
}
```

Look-alikes are read through a nearest-neighbor index, which a vector field opts into: `@field imageEmbedding = contains(ImageEmbedding, { search: { neighbors: true } })`. The first lookup by a declared field builds one HNSW index for that field and dimension, concurrently; until it is ready, lookups scan exactly. A field that has not opted in is refused with the declaration to add, and keeps exact `near` search and no index. The index is approximate (about 98% of the exact neighbors on a real catalog), which suits a comparison set; `near` filters and sorts stay exact. Each lookup stays within the realm. Under a realm policy, a neighbor the grants do not admit is left out. Postgres with pgvector only.

Aggregates a card stores, such as a category's median price, are fields like any other (`category.medianPrice`, when the link is searchable). Under a realm policy, the grants that scope the caller's query also scope `compare.filter`. A comparison set runs on Postgres only.

### Why a result ranks where it does (`explain`)

With `explain: true`, every result of a query sorted by a `blend` or `relevance` carries `meta._explain`: the first blend's fused score, its `k`, and each signal's part in it.

```json
{
  "score": 0.0397,
  "k": 60,
  "signals": [
    {
      "signal": "text",
      "weight": 1,
      "value": 0.42,
      "rank": 2,
      "contribution": 0.0161
    },
    {
      "signal": "popularity",
      "weight": 0.5,
      "value": 812,
      "rank": 1,
      "contribution": 0.0082
    },
    {
      "signal": "when",
      "weight": 1.5,
      "value": 1,
      "rank": 1,
      "contribution": 0.0246
    },
    {
      "signal": "recency",
      "weight": -0.5,
      "inverted": true,
      "value": null,
      "rank": null,
      "contribution": 0
    }
  ]
}
```

`signal` names a `relevance` signal (`text`, `popularity`, `quality`, `recency`, `priority`, `meaning`), `when` for a `boost`, or the field a signal sorts by. `rank` is the card's place for that signal over every match, not just the page, so the contributions add up to `score`. A signal the card has no value for has no rank and contributes nothing. `inverted` marks a negative weight. The ranks are computed in the same statement as the search, so asking costs two extra columns per signal.

### Relevance (`relevance`)

A `relevance` sort ranks by search intent. It blends text relevance (weighted by the search roles of the fields that matched) with the ranking signals the type declares (`search: { rank: 'popularity' }` and the like: `popularity`, `quality`, `recency`, `priority`). Given `near`, it also blends in the similarity of the type's vector field as the `meaning` signal. It compiles to a blend, so results carry `meta._blendScore`.

Its value re-weights signals by name (`true` keeps every default). Unnamed signals take their defaults: `text` and `meaning` 1, the rest 0.5. A weight of 0 drops a signal, and a negative weight inverts it (least popular first).

```js
sort: [
  {
    on: productRef,
    near: queryVector,
    relevance: { text: 0.6, meaning: 1.5, quality: 0.5, popularity: 0 },
  },
];
```

### Collapsing to one per group (`collapse`)

`collapse` keeps the best cards of each group: of the cards that share a value at `by`, only the first `keep` (default 1) by the query's own sort come back. Use it to show one size of a product rather than five, or one card per type. A card with no value at `by` is a group of its own. Each card that comes back carries `meta._collapseSize`, how many matches its group holds (itself and any other kept cards included), so a result can say "and 12 more" without a second query. `meta.page.total` counts what remains, and pages page over it. Facets still count every match, so after a collapse the two disagree: one-per-brand might show 40 results while the Color facet still says "Black (120)", counting every black product including the ones the collapse hid.

`on` names the type whose field `by` is; without it, the filter's anchor (`on` or `type`) is used. A string is shorthand for `{ by }`.

```js
let { data, meta } = await indexer.search({
  filter: { on: productRef, matches: 'running shoe' },
  sort: [{ on: productRef, relevance: true }],
  collapse: { by: 'variantGroup', on: productRef, keep: 1 },
  page: { size: 24 },
});
```

On the wire, `by` goes through `item.` (`collapse: 'item.variantGroup'`) and the type is `item.on`. Live queries leave a collapsed query to the server, since the best of a group is chosen over the whole match set. Across realms each realm collapses its own results, so two realms may each return a card of the same group.

### Lists computed first (`let`)

A query can name values it computes before it runs, in the manner of a FLWOR `let`, and read them in its filter. Each binding is a query over the same realm (`from`: a `type` or filter, optionally a sort and a `page.size` of at most 1,000, in the same grammar as the query itself) and a search-doc path (`select`) whose values, across the rows that query finds, become the list. A list field contributes each of its values and a link its id; a path through a link (`items.brand.name`) reads only what the link's `searchable` option puts in the search doc.

A reference to a binding is an object, `{ "$let": "name" }`, never a string. An `in` reads a list whole with it, in the filter or inside a `boost`. Any string is a literal, `"$"` or not, so a shopper typing `"$25 gift"` is never read as a binding.

```js
let { data, meta } = await indexer.search({
  type: productRef,
  let: {
    // the brands of the products the shop rates 4.5 or better
    topBrands: {
      from: { type: productRef, filter: { range: { rating: { gte: 4.5 } } } },
      select: 'brand.name',
    },
  },
  filter: { in: { 'brand.name': { $let: 'topBrands' } } },
});
```

The engine resolves each binding one of two ways and reports which in `meta.lets`:

- **Join.** A binding whose `from` is one card by id and whose `select` is a link field's ids (`items.id`), read only by `in`s on `id`, runs as [`linkedFrom`](#filters) in the same statement: `{ "saved": { "strategy": "join" } }`.
- **List.** Any other runs its query first, and its values (at most 1,000) stand in for the reference: `{ "hot": { "strategy": "list", "values": 12 } }`.

**One card.** A binding with `one: true` in place of `select` is the first card its query finds, whole. The query reads that card's values with `{ "$let": "name", "path": "priceMin" }` wherever a value goes: an `eq` value, a `range` bound, a `near` target in a filter or a sort. A `rerank` expression reads the card under the binding's name (`name.path`). A link reads as its id, and a path through it as whatever its `searchable` option put in the search doc. A path the card has no value at reads null, as does every path when the query finds no card; an `eq` then finds the cards with no value, and a `range` bound or `near` target that reads null matches nothing. `meta.lets` reports `{ "strategy": "card", "found": true }`.

```js
// dupes of one sofa: its look, its kind, under its price, from another brand
let sofa = (path) => ({ $let: 'sofa', path });
let { data } = await indexer.search({
  type: productRef,
  let: {
    sofa: {
      from: { type: productRef, filter: { eq: { id: sofaId } } },
      one: true,
    },
  },
  filter: {
    every: [
      {
        near: {
          imageEmbedding: { to: sofa('imageEmbedding'), minSimilarity: 0.6 },
        },
      },
      { eq: { productType: sofa('productType') } },
      { range: { priceMin: { lt: sofa('priceMin') } } },
      {
        any: [
          { eq: { 'brand.name': null } },
          { not: { eq: { 'brand.name': sofa('brand.name') } } },
        ],
      },
    ],
  },
  sort: [{ by: 'imageEmbedding', near: sofa('imageEmbedding') }],
  collapse: 'brand.name',
  rerank: { expression: 'ROUND(sofa.priceMin - priceMin, 2)' },
});
```

A reference names a binding of the right kind, or the query is refused: `unknown-binding` for a name `let` doesn't declare (with the nearest declared name), and `binding-kind` for `{ "$let" }` on a one-card binding or `{ "$let", "path" }` on a list. A binding's query cannot use another binding, and a query takes at most 4. Bindings resolve within each realm a search reaches. Under a realm policy, the grants that scope the caller's query also scope every binding's query, and a `linkedFrom` runs as a binding, so a list never holds anything the caller couldn't search for. Live queries leave a query with bindings to the server. On the wire, `select` and the binding's field paths go through `item.`; a reference's `path` reads the card's own path, with or without `item.`.

### A table of values (`select`)

`select` answers a query as a table instead of entries: the values at the paths it names, read straight from each row's search doc, so nothing is loaded or rendered. `id` is always the first column.

```js
{
  type: productRef,
  filter: { range: { priceMin: { lt: 100 } } },
  sort: [{ by: 'unitsSold30d', direction: 'desc' }],
  select: ['itemId', 'title', 'priceMin', 'brand.name', { category: 'category.path' }],
  page: { size: 2000 },
}
```

A path names a column after itself; a one-member object renames it (`{ brand: 'brand.name' }`). A path through a link reads what the link carries in the search doc, so `brand.name` works when the link declares `search: { include: ['name'] }` (or a `searchable` route reaches it); a list, or a path through a list of links, reads as a list. A score the query computes can be a column too: `_blendScore`, `_matchRelevance`, `_nearSimilarity`, `_rerank`, `_collapseSize`.

```json
{
  "columns": ["id", "itemId", "title", "priceMin", "brand.name", "category"],
  "rows": [
    [
      "https://…/Product/B07…",
      "B07…",
      "Brass desk lamp",
      64,
      "Lumen",
      "Home > Lighting"
    ]
  ],
  "meta": { "page": { "total": 1322 } }
}
```

Ask for `Accept: application/x-ndjson` (or `application/jsonl`, the same format) and the table comes one row a line, each an object keyed by column, then a last `{ "meta": … }` line, which a table loader such as DuckDB's `read_json` reads as it is.

`select` takes the same filter, sort, `let`, `collapse`, `rerank`, facets and paging as any query, with the same page limit. It needs the query's type, from a top-level `type` or the filter's anchor (`needs-type`). A path the type lacks is `unknown-field`; a path through a link that does not carry it is `not-selectable`; `select` beside `fields` is `select-excludes-fields`, since one answers a table and the other entries. It runs on Postgres only (`needs-postgres`).

Under a realm policy, the rows are the ones the caller's grants admit, as for any search, and a value read through a link shows only where the linked card's own type's grants admit the caller as well: otherwise it reads null (or, in a list, is left out). A `select` value is never wider than what the caller could read card by card.

### Relative dates

A `range` bound on a date field may be relative: `now`, optionally moved by whole units (`now-30d`, `now+1w`), optionally rounded down to the start of a unit in UTC (`now-30d/d`, `now/M`). The units are `s`, `m`, `h`, `d`, `w`, `M` (months) and `y`. A week starts on Monday. The bound is read when the query runs, so a saved search for "added this month" stays current. On a `DateField` or `DateTimeField` the bound is compared in the field's own format. Any other string is a literal bound.

```js
filter: {
  on: productRef,
  range: { publishedAt: { gte: 'now-30d/d' } },
},
```

### Facets

The Query object may have a `facets` property: up to 8 counts of what the matched cards hold in one field, counted by the database over every match, not only the page returned. Each facet comes back in `meta.facets[by]` as `{ value, count }` entries, most common first. `by` is a field path, dotted for a compound field; a list field counts each of its values. A link facet's value is the linked card's id, with its title as `label` when the search could return that card itself: one in the realm searched, not deleted, and, for a caller a realm policy scopes, one its grants admit. Any other value keeps its id and count with no label.

| Member          | Effect                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`          | How many values come back (default 50, at most 1000).                                                                                                                                    |
| `own: 'ignore'` | Counts without the facet's own selection, so a multi-select list keeps its other values while one is picked.                                                                             |
| `stats: true`   | Adds count, distinct count and min, max, sum and average (numbers) or min and max (text) in `meta.facetStats[by]`.                                                                       |
| `ranges`        | Counts the matches in each `[from, to)` bucket, labeled by `key` or `from-to` (`*` for an open end).                                                                                     |
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

Across realms, counts add up. Each realm answers more values than asked for (1.5 × `size` + 10) so the merged top values are right more often, and `meta.facetErrors[by]` bounds how far any merged count may be short. A measure combines too: an average weighted by each realm's count, the smaller min, the larger max, the summed sum.

### Pagination

The Query object may have a `page` property, which controls pagination of search results. This allows you to retrieve results in smaller chunks for better performance and user experience.

The `page` object has the following properties:

- `number`: The page number (0-based indexing)
- `size`: The number of results per page. A query that names none gets the first 50, whoever runs it: a card's `getCards`, a host search, or a `_search` or `_federated-search` request. Name a size for more: a card search takes up to 100, and a request to the server up to 2,000, clamped above that. A query-backed `linksToMany` field that names none takes 500, since it is read as the set it declares.

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

### Federated search

A `_federated-search` request names its realms in `realms`, all on the realm server it is sent to. `federation.results` chooses the shape of the answer:

- **`byRealm`** (the default): each realm's rows stay together, paged on their own, as the search sheet shows them in sections. `meta.sections` lists the sections in order, `{ realm, count, score? }`: under a sort that scores rows (relevance, blend, text relevance, `near`), by each realm's best score, with realms that matched nothing last; otherwise in the order asked.
- **`merged`**: one list, ordered by the query's own sort across realms (field sorts included), and paged once. Each realm is asked for its first `offset + size` rows and the union is sliced to the page. Scores that each realm computes over its own matches (blend, relevance and text relevance) compare only approximately across realms. A sort entry with no `direction` goes the way it does in one realm: scores (`expression`, `near`, blend, relevance, text relevance) highest first, fields lowest first. Under a `rerank`, rows order by their rerank value first, then by the query's sort.

```js
{
  realms: [catalogRealm, myRealm],
  federation: { results: 'merged' },
  type: productRef,
  filter: { matches: 'brass lamp' },
  sort: [{ by: 'priceMin' }],
  page: { size: 24 },
}
```

`meta.realms` reports every realm asked, `{ status, code?, total?, ms? }`, where `status` is `ok`, `refused` (with the refusal `code`), `timeout` or `unavailable`. A realm that fails never fails the search; `meta.incomplete` is true when any realm did not answer `ok`.

### Refusals

A query the grammar refuses gets a 400 whose body carries a code a caller can act on, and a message naming the member, the nearest valid name where there is one, and what to write instead:

```json
{
  "errors": [
    {
      "status": "400",
      "title": "Invalid Query",
      "code": "unknown-key",
      "message": "…"
    }
  ]
}
```

| Code                                                             | Meaning                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `unknown-key`                                                    | A member the grammar does not have; the message names the nearest real one.                                    |
| `unknown-field`                                                  | A field the type does not have, with the nearest field.                                                        |
| `invalid-value`                                                  | A member has the wrong kind of value, or one out of range.                                                     |
| `missing-member`                                                 | Something the query needs is absent.                                                                           |
| `conflicting-members`                                            | Two members that cannot go together.                                                                           |
| `limit-exceeded`                                                 | More of something than a query may have (signals in a blend, bindings, facets).                                |
| `invalid-nesting`                                                | Something placed where it cannot go.                                                                           |
| `invalid-type`                                                   | A type reference that names no card type.                                                                      |
| `needs-type`, `sort-needs-type`                                  | A path that needs a type, from `type` or an `on`.                                                              |
| `needs-declaration`                                              | A field or type lacks a declaration the feature needs, such as `search: { neighbors: true }`.                  |
| `needs-postgres`                                                 | A feature the SQLite index cannot run.                                                                         |
| `matches-required`                                               | A text-relevance sort with no `matches` filter to score.                                                       |
| `engine-only`                                                    | A member only the engine sets.                                                                                 |
| `invalid-expression`, `expression-placement`, `unknown-function` | An expression that is not a string, cannot run where the query puts it, or calls a function BXL does not know. |
| `unknown-binding`, `binding-kind`                                | A `{ "$let" }` reference to a binding that does not exist, or of the wrong kind.                               |
| `policy-linked-from`                                             | A `linkedFrom` where a realm policy cannot scope it.                                                           |
| `invalid-page`, `invalid-json`, `invalid-filter`                 | A malformed page, body or filter node.                                                                         |
| `not-selectable`, `select-excludes-fields`                       | A `select` path the index does not carry, or `select` beside `fields`.                                         |

### Upgrading from the old keys

Queries written before V2 used the engine's internal sort keys. A request or a query-backed field that uses one is now refused (`unknown-key`), with a message naming the key and where it is. Rewrite it as:

| Old                                       | New                                  |
| ----------------------------------------- | ------------------------------------ |
| `{ by: '_blend', of: [...] }`             | `{ blend: [...] }`                   |
| `{ by: '_expr', expr: '…' }`              | `{ expression: '…' }`                |
| `{ by: '_when', when: <filter>, weight }` | `{ boost: <filter>, weight }`        |
| `{ by: '_relevance', … }`                 | `{ relevance: true \| { weights } }` |
| `{ by: '_matchRelevance' }`               | `{ by: 'textRelevance' }`            |
| `"$name"` in an `in`                      | `{ "$let": "name" }`                 |
| `"$name.path"`                            | `{ "$let": "name", "path": "path" }` |
| `page.cursor`                             | removed; page by `number`            |

The per-result response field `meta._matchRelevance` keeps its name.

Earlier V2 drafts called an expression `formula` (a sort key) and `expr` (in `rerank`). Both are refused now; write `expression`, the same word cards use in `computeVia: expression(…)`.

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
