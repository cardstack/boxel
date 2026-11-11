# Search

The reference for the card query language: every member, operator, option, default, limit and refusal code, what a query returns, and the rules a result is guaranteed to follow. Use it to write a query by hand, to generate one (the AI assistant's search tools take this grammar, described to the model in `packages/runtime-common/helpers/ai.ts`), or to change the engine without changing what saved queries return.

Two companion pages:

- [Search cookbook](search-cookbook.md): what people ask for ("hidden gem", "cheap for its kind", "dupes of this") and the query that answers it.
- [Search intent](search-intent.md): the `search` options a card author declares on fields (roles, facets, ranking signals, typos) and what each changes.

A query runs against a realm's index, so results are only as current as the index: a card that failed to index is not found. In code, `realm.searchIndex.search(query)` searches one realm; over HTTP, `_search` and `_federated-search` take the same query (see [HTTP API](#http-api)). The simplest query is `{}`, every card in the index.

## Search Queries

### The shape of a query

A query is declarative: it says what it wants, never how. The order members are written in never changes the answer, and the engine applies them in one fixed order (see [Evaluation order](#evaluation-order)); [Sets and sequences](#sets-and-sequences) lists the few lists whose order is meaningful. The members are:

| Member     | What it says                                                                                                                                                               | Section                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `type`     | The card type the whole query is about. Every clause inherits it.                                                                                                          | [One type](#one-type-for-the-whole-query-type)         |
| `filter`   | Which cards match.                                                                                                                                                         | [Filters](#filters)                                    |
| `sort`     | How the matches are ordered: fields, `textRelevance`, `near`, `expression` (over every match, or re-ordering the top rows against a comparison set), `blend`, `relevance`. | [Sort Order](#sort-order)                              |
| `let`      | Lists or one card, computed before the query: `$name: { from, … }`, read as `"$name"`.                                                                                     | [`let`](#bindings-let-this-literal)                    |
| `collapse` | Keep the best few of each group.                                                                                                                                           | [`collapse`](#collapsing-to-one-per-group-collapse)    |
| `facets`   | Counts and statistics over every match.                                                                                                                                    | [Facets](#facets)                                      |
| `explain`  | Each result's ranking signals and their shares.                                                                                                                            | [`explain`](#why-a-result-ranks-where-it-does-explain) |
| `select`   | Answer as a table of indexed values instead of entries.                                                                                                                    | [`select`](#a-table-of-values-select)                  |
| `timeZone` | The IANA zone whose calendar decides "today", weeks and day buckets.                                                                                                       | [Time zones](#time-zones)                              |
| `page`     | Which slice of the results, and how the total is counted.                                                                                                                  | [Pagination](#pagination)                              |

Over HTTP the query may also carry `realms` and `federation` ([Federated search](#federated-search)), `scope` ([Result kinds](#result-kinds-and-scope)), `fields` (the entry fieldset) and `cardUrls`. Any other top-level member is refused (`unknown-key`).

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

The older spelling, with an `on` in every clause, still works and is what most examples in the next two sections use. The two spellings differ in how strictly they are read (see [Compatibility](#compatibility-older-and-newer-spellings)): a query in the newer spelling refuses any member the grammar does not have, with the nearest real name.

### Filters

The Query object may have a `filter` property, which controls which cards are included in the result set.

A filter node holds at most one operator, optionally beside `on` (the card type its paths belong to) and `type` (keep only that type and its subtypes). A node with two operators is refused (`conflicting-members`); nest them under `every` or `any`. An empty operator (`{}`, `[]`) is a condition, not "nothing".

- `type`: cards of a card type, its subtypes included. A node with only `type` is every card of the type.
- `eq`: field paths to exact values; several paths in one `eq` must all hold. `null` finds the cards with no value.
- `in`: one field path to a list of accepted values (`in: { color: ['red', 'blue'] }`).
- `range`: field paths to bounds, any of `gt`, `gte`, `lt`, `lte`; a bound is a number or string, never `null`. A date bound may be relative (see [Relative dates](#relative-dates)).
- `any`: at least one nested filter holds.
- `every`: every nested filter holds.
- `not`: the nested filter does not hold (see "A card with no value" below).
- `contains`: field paths to substrings, ignoring case.
- `exists: path` and `missing: path` (newer spelling): the cards with, or without, a value there. Each is an operator of its own; `exists` and `missing` lower to `not: { eq: { path: null } }` and `eq: { path: null }`. On a list, an empty list is missing (see below).
- `matches`: full-text search, the one text-search operator. Its options (`prefix`, `scope`, `fields`, `within`, `typos`), type-ahead among them, are under [Text search](#text-search-matches).
- `pattern`: a glob over a field's whole value, ignoring case, on fields searched by pattern (declared `search: { patterns: true }`, or an `identifier` or `code` role). It is path-aware: `*` is any run of characters within one `/`-separated segment, `?` one character other than `/`, and `**` any run at all, across segments. So `**/components/*.gts` finds the modules directly in any `components` folder and `**/components/**.gts` the ones under it too; a value with no `/` (a SKU, a video id) reads `*` as any run, as before. On SQLite (the browser's index) `*` and `?` cross `/`. See [Globs](#globs-pattern) below.
- `regex`: a POSIX regular expression over the same fields (Postgres only).
- `near`: keeps cards whose `VectorField` is at least `minSimilarity` similar to a target vector (see [Vector search](#vector-search-near)).
- `linkedFrom`: keeps the cards another card links to. `{ linkedFrom: { card: 'https://my.realm/Wishlist/mine', field: 'items' } }` is "in my saved list". `card` is the card's id as an absolute URL (a prefix-form id is refused today); `field` names a `linksTo` or `linksToMany` of that card, dotted through a compound field. The source is read from that card's index entry, so it must be a card instance in the realm being searched; a card in another realm, or one that doesn't exist, links to nothing.

`on` names the card type whose fields a node's paths belong to: it tells a `Company.name` from a `Country.name`. It applies only to the node it is on, not to nested nodes, so in the older spelling each node that names a field carries its own `on`; a top-level `type` ([One type](#one-type-for-the-whole-query-type)) anchors every clause at once. A path is dotted through compound fields and links (`author.firstName`).

**A card with no value.** A comparison with a missing value is neither true nor false, as in SQL, and `not`, `any` and `every` carry that through. So a product with no brand is returned by `eq: { brand: 'Zed' }` no more than by `not: { eq: { brand: 'Zed' } }`; the same holds for `in`, `range` and `contains`. To include the cards with no value, say so: `any: [{ eq: { brand: null } }, { not: { eq: { brand: 'Zed' } } }]`. `eq: { brand: null }` (or `missing: 'brand'`) finds them on their own.

A filter on a list field (a containsMany or linksToMany, or a path through one) holds for a card when some element of the list satisfies it. `eq: { tags: 'red' }` finds the cards with a red tag, and a `range` with two bounds finds the cards with one element inside both. Each filter is its own test of the card, so:

- `not: { eq: { tags: 'red' } }` finds the cards with no red tag, a card with no tags among them.
- `every: [{ eq: { tags: 'red' } }, { eq: { tags: 'blue' } }]` finds the cards tagged both.
- A number in a list compares as a number, so `range: { sizes: { gte: 10 } }` does not match a 5.
- **An empty list is missing.** A list has a value when some element holds one, so `missing: 'tags'` (and `eq: { tags: null }`, a `null` in an `in`, `contains: { tags: null }`) finds a card whose list is empty, null, absent or only nulls, as a facet's `missing: true` counts it, and `exists: 'tags'` finds the cards with at least one element that has a value (an empty string is one). It agrees with `not` above: `not: { eq: { tags: 'red' } }` keeps the cards with an empty list, and `missing` finds them on their own. The host's live matcher reads a list the same way.

Counting a list's elements ("companies with more than 5 departments") is not supported.

#### Globs (`pattern`)

**Files.** Base's `FileDef` declares `url` and `name` `search: { patterns: true }`, so every file type is found by its path and its name: `{ type: GtsFileDef, filter: { pattern: { url: '**/components/*.gts' } } }`, `{ pattern: { name: '*-card.gts' } }`, and across every file type through `FileDef` itself (`type: { module: '@cardstack/base/card-api', name: 'FileDef' }`). A file's `url` is absolute, so a glob on it starts with `**/` (or spells the realm's URL). `regex` reads the same two fields. A file type's other fields are not searched by pattern: a `pattern` or `regex` on one (`content`, or a field a `FileDef` subclass declares `patterns: true`) is refused with `needs-declaration`. To find words in a file's text, use `matches`. The file indexer stamps the two values into the row, so the declaration takes effect when base is indexed again.

**What it costs.** On Postgres a glob first narrows by the row's trigram-indexed pattern text (every pattern field's value), which needs three literal characters in a row (`**/components/*.gts` has `/components/`); the field then decides. A glob with fewer (`*`, `??-*`) can't use the index and tests every row of its type, which is fine for a type of a few thousand rows and slow past that: pair it with another filter that narrows first. A glob with `*` or `?` runs as a regular expression on Postgres, and one too large to compile (100,000 `?`, say) is refused with `limit-exceeded`.

**Why not file content.** A glob on a file's `content` was measured and left out: a selective term over 1,000 large files answers in 3 to 10 ms, but a term most files hold reads every file's text twice (5 to 11 seconds for 1,000 files of about 1 MB), and putting the text in the pattern index makes every path glob read it too (a `**/components/*` glob went from 0.2 ms to 4.5 seconds). `matches` finds words in big documents through the full-text index.

**What a file's `content` holds.** A text file type keeps at most 1 MiB of the file as `content` (code, markdown, plain text and JSON: the first whole lines that fit, cut at a line break, or at a character boundary for one longer line). A CSV keeps its header and its first 1,000 rows (also within 1 MiB); its `columns` and `rowCount` describe the whole file. `lineCount` counts every line. The file itself is always served whole from the realm. So a filter on `content` (an `eq`, a `contains`) finds nothing past the cap, and a preview shows the head of a larger file. Full-text `matches` reads a file's rendered text, which already stopped at its first 400,000 characters, so the cap changes nothing it finds. Before this cap a file kept all of itself; a file larger than the cap answers differently once base is indexed again. The numbers behind the cap: at 1 MiB a file's row is about 255 KB stored and an edit writes it in about 12 ms (20 ms at the 95th percentile); a whole 10 MB CSV took 99 ms an edit and a 100 MB one 890 ms and 29 MB stored, against 3 to 8 ms and 21 KB for its first 1,000 rows.

A filter through a link reads what the linked card put in this card's search doc (its `searchable` or `include` declaration, see [Search intent](search-intent.md#include)). When a linked card changes, every card that links to it is indexed again, so such filters stay correct. Linked cards in a result are loaded when the result is served, not read from the index.

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

A `sort` is a list of sort entries. The first entry orders the results, and each later one only breaks the ties of those before it. A field entry has:

- `by`: a dotted field path, or a general key that needs no type: `lastModified`, `createdAt`, `cardURL`.
- `on`: the card type `by` belongs to. A field path needs a type: its own `on`, a top-level `type`, or (over HTTP and in the newer spelling) the filter's own anchor. Without one it is refused (`sort-needs-type`).
- `direction`: `asc` (the default for a field) or `desc`. Scores (`textRelevance`, `near`, `blend`, `relevance`, `expression`) default to `desc`, best first.
- `missing`: `last` (the default) or `first`, where the cards with no value go.

Rows the sort leaves tied, and every row of a query with no sort, come back in card URL order (byte order), then by row kind. Text sorts follow the database's collation; see [Edge cases](#edge-cases-and-what-is-guaranteed) for how a merged result across realms compares text.

A sort by `cardTitle`, A to Z with untitled cards last (the default), reads a title column the index keeps in order: a page reads the index from the start and stops when it is full, instead of sorting every match. Other title sorts (`desc`, `missing: 'first'`) give the same answers and sort every match.

The other sort entries rank rather than compare a field: `{ by: 'textRelevance' }` (full-text relevance, which needs a positive `matches` term, else `matches-required`), a `near` sort ([Vector search](#vector-search-near)), `blend`, `expression` and `relevance` (below).

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

### Text search (`matches`)

`matches` is the one text-search operator: `{ matches: 'brass lamp' }` matches the cards whose words or rendered markdown hold every word, in Postgres `websearch_to_tsquery` syntax (`"exact phrase"`, `or`, `-excluded`). Words are stemmed in English. Its options sit beside it in the same filter node, and refine what it reads and how its words match:

| Option               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix: true`       | Type-ahead: the last word is unfinished and matches any word that starts with it, so each keystroke can run one query. Every earlier word still matches whole, and a term that ends in a space has no unfinished word.                                                                                                                                                                                                                                                                                          |
| `scope: 'title'`     | Only the card's title, name and alias roles ([search intent](search-intent.md)), stemmed as above.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `prefix` and `scope` | Type-ahead over a card's names: its title and `cardInfo.alternativeNames`. Every word is a prefix of one of their words, in any order, never stemmed. Under a text-relevance sort, titles rank in tiers (below).                                                                                                                                                                                                                                                                                                |
| `fields: [paths]`    | Only those 1 to 8 fields' values: the same stemmed, case-insensitive word match, so `metal` finds "Metal" and `silicone` finds "Silicon". A list field's values all count. A slash, `<` and `>` separate words, in the values and in the term, so `a/b` is two words and markup in a value (`</script>`) never hides the words after it. Computed per card rather than read from an index, so anchor it on a type. Takes no `scope`, `within` or `prefix`. SQLite matches a case-insensitive substring instead. |
| `within: '<field>'`  | The passages of a `PassageField` list instead of the card; the passages that matched come back in `meta.passages`. Takes no `scope`.                                                                                                                                                                                                                                                                                                                                                                            |
| `typos: true`        | Each word also matches its closest spellings in the realm's word list (fields declared `typos: true`; with `scope: 'title'` and `prefix`, the realm's titles and alternative names). A word still being typed takes corrections only once it is three letters or longer. Postgres only.                                                                                                                                                                                                                         |

```js
// type-ahead over the whole card: the last word is unfinished
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

// type-ahead over names: "otto stor" suggests "Ottoman Storage Bench"
let { data: names } = await indexer.search({
  type: productRef,
  filter: { matches: 'otto stor', prefix: true, scope: 'title' },
  sort: [{ by: 'textRelevance' }],
  page: { size: 8 },
});
```

**Type-ahead over names** (`prefix` with `scope: 'title'`) reads a short index of each card's title and alternative names, never its rendered page, so a long definition or transcript can neither match nor slow it. Sorted by text relevance, titles rank in tiers, whatever else the query asks: the title that is exactly what was typed; then a title that starts with the typed words as whole words, the last perhaps in the plural ("lamp" finds "Lamps, Bases & Shades"); then one that only starts with the typed text, inside a longer word ("Lamport on writing"); then one where every typed word starts some title word ("Desk lamp"); then cards matched through their alternative names. Within a tier, the text score orders them. A term with no letters or digits matches nothing.

**Words.** Accents fold everywhere words are matched, in a card's fields, its rendered page, its names and a prefix still being typed: `creme` and `crème` find "Crème", and `cafe` finds "Café". Words are indexed by their English stems, so a word whose stem is shorter than what has been typed (`learni` on the way to `learning`, indexed as `learn`) is matched by dropping up to two letters from the end of the unfinished word. A word being typed that is shorter than three letters matches as a whole word, because a one- or two-letter prefix matches a large share of the index; over names, such a word matches as a prefix once a longer word beside it narrows the term. A query on a type whose rendered markdown is short (a title, a name, a byline) stays fast and ranks by relevance well. Matching across long documents such as transcripts finds every mention, so anchor type-ahead on the types users pick from, or scope it to their names.

Earlier drafts had a separate `typeahead` operator. It is refused (`unknown-key`), with the hint to write `{ matches, prefix: true, scope: 'title' }`, which answers the same.

### Vector search (`near`)

A card can carry an embedding in a vector field (`@cardstack/base/vector`). A vector type names its space: the exact vectorizer and revision, the provider that serves it, and its size, up to 2,000 dimensions. `StandardTextVector` is the default text space (1,024 dimensions); a field of another kind declares its own subclass, and a vector compares only with vectors of the same space. The caller embeds a query's text itself and passes the numbers. Queries reach a vector two ways:

- **Ranking**: a sort entry with a `near` target ranks by cosine similarity to it, most similar first (`direction` defaults to `desc`). Cards with no vector at the path sort last. Each result carries `meta._nearSimilarity` (1 = same direction, -1 = opposite), the way a `textRelevance` sort carries `meta._matchRelevance`. The k most similar cards are a near sort plus `page: { size: k }`.
- **Threshold**: a `near` filter, keyed by the field path like `range`, keeps cards whose vector has at least `minSimilarity` to `to`. Without `minSimilarity` it keeps every card that has a vector of `to`'s dimension there. It nests under `every`/`any`/`not`, so it combines with other filters and with realm policy.

`near` targets are a number array or a vector in its stored form (`{ dims, encoding, scale?, data }`). A plural path (`segments.embedding`) scores a card by its nearest vector. A comparison reads only the vectors stored in the space the field's type declares, wherever the target came from (numbers, a card's vector, an expression's look-alikes), so a vector left in another space, or stored before spaces were recorded, never compares just because its size matches. A target read from a card in another space is refused (`vector-space-mismatch`). On Postgres it needs the pgvector extension; without it a `near` query is refused with an error that says so. The SQLite index (host tests) scores singular paths only.

On Postgres the vectors sit apart from the card rows, in one table partitioned by space, as vector databases keep one index per embedding model and size: a space's partition is made the first time a vector in it is written (the vectors of a space that has none yet wait in a default partition, and move into the space's partition when it is made). A search reads only the partition of the space it compares in, so another field's or another model's vectors cost it nothing. When a type moves a field to another space, each card's vectors move to the new space's partition as the card is indexed again.

A near search runs one of two ways, and the engine chooses, not the database planner. This is two-phase retrieval as Vespa (first and second phase) and Elasticsearch (kNN `num_candidates`, then a rescore) do it, with the exact fallback for small sets that Lucene and Elasticsearch use:

- **Exact.** Every one of the realm's vectors in the field and space is compared at full precision. This is the path when the realm holds no more than 100,000 of them (the threshold, counted and stopping just past it; 50,000 256-d vectors scan in about 16 ms), when they are less than a tenth of the space's vectors (an index walk would pass over mostly other realms' and fields' vectors), when the space has no index, for a near sort that does not lead the sort (or ranks least similar first), and for an unpaged query.
- **Approximate, then exact.** A space's partition gets an HNSW index over a half-precision copy of its vectors (`halfvec`, m 16, ef_construction 64) once it holds more vectors than the threshold: the realm server builds it in the background after the index write that took it past (`CREATE INDEX CONCURRENTLY`, so reads and writes go on), and never drops it. Until the index is ready, every search of the space runs exactly (`reason: 'no-index'`), so answers don't change while it builds. The stored vectors stay full precision. A leading, paged near sort reads the nearest four times as many vectors as the page needs through its last row (at least 100, widened up to 4,000 until they cover that many cards, since a card with many vectors may take several of the nearest) with `ef_search` 100 and pgvector's iterative scan, which applies the realm and field while it walks the graph. The query then compares only those cards' vectors, exactly: every similarity returned is the exact one, and the page is in exact order. Only which cards were candidates is approximate: on 198,532 256-d passage vectors from a video library, 99.7% of the exact top 10 vectors and 97.7% of the exact top 10 cards (cards ranked by their nearest segment). When the page then holds a card without a similarity, the filter may have admitted cards the read left out, and the query runs again exactly.
- A `near` filter with `minSimilarity` reads its candidates the same way (those within the threshold, by half-precision distance with a little slack) and checks each exactly; one that would admit more than 1,000 cards is answered exactly. A near signal inside a `blend` compares only the candidates: the blend still ranks every match, and a card that was not a candidate gets no rank from that signal, as a card with no vector gets none.

`meta.near` says which path ran: `{ path: 'exact' | 'hnsw', candidates, threshold, efSearch?, rescored?, reason? }`, where `candidates` is the count that decided, `rescored` how many cards the approximate read handed on, and `reason` why a search ran exactly (`below-threshold`, `small-share`, `no-index`, `not-leading`, `unpaged`, `too-many-matches`, `filtered-out`). An exact search over more vectors than the threshold, for any reason but a small share, adds the warning `near-exact-scan`; it still runs within the time budget. A deployment can move the threshold and `ef_search` with `BOXEL_VECTOR_EXACT_THRESHOLD` and `BOXEL_VECTOR_EF_SEARCH`.

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

A query may name its card type once, at the top: `{ type: '$REALM/product#Product', filter: { eq: { color: 'Grey' } }, sort: [{ by: 'rating' }] }`.

**Naming a type.** A query is often written where there is no JavaScript to hand it a class (a query-backed field's options, a query saved in card JSON, an HTTP body, the AI tool), so the language names types itself. A type is written `"<module>#<Name>"`: the module, then `#`, then the name it is exported under.

```js
type: '$REALM/product#Product'                    // a module in the query's own realm
type: '@cardstack/catalog/product#Product'        // a registered prefix
type: 'https://my.realm/product#Product'          // the module's URL
type: { module: '$REALM/product', name: 'Product' } // the same type as a code ref
```

The shorthand and the code ref `{ module, name }` are the same type: either is accepted wherever a query takes a type (the top-level `type`, a filter's `type` and `on`, a sort, blend or boost's `on`, a `collapse` or facet `on`, a `let` binding's query, an expression sort's `compare.filter`, a named query's `on`, and in the wire grammar's `item.on`), and the two lower to one query with one signature. A module never holds a `#`, so the name is what follows the last one (the convention `boxel` uses for a card type, `<module>#<Class>`, in its operation commands); it must be an identifier (`Product`, `SaleProduct`). The module is a realm resource identifier ([ADR 002](adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md)): a registered prefix (`@cardstack/catalog/product`), the module's URL, or `$REALM/<path>`; never a bare name or a relative path. Anything else is refused, `invalid-type`, with what is wrong (no `#`, no name after it, a module that names none).

`$REALM/<path>` names the module at that path in the realm the query belongs to, so one query serves in every realm that holds the module, and in every environment:

| Where the query is                                         | `$REALM` is                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| a realm's `_search`                                        | that realm                                                                                                            |
| a query-backed field (`linksTo`/`linksToMany` `{ query }`) | the realm of the card declaring it (as `$REALM` alone is there: see [Query-backed fields](#query-backed-fields-this)) |
| a named query (a declared `query` operation)               | the realm that holds the declaration, wherever the request searches                                                   |
| a `let` binding's query, an expression's `compare.filter`  | the outer query's realm                                                                                               |
| `_federated-search` naming one realm                       | that realm                                                                                                            |
| `_federated-search` naming several realms                  | none: refused, `invalid-type` ("use an absolute or @scope/… module")                                                  |

It resolves once, where the request arrives, to the absolute `{ module, name }`, in its canonical form (a mapped realm's prefix form); the checks, the caches, `explain` and the engine see only that. `$REALM/product#Product`, `{ module: '$REALM/product', name: 'Product' }` and the full URL of the same module are one query. A path that leaves the realm (`$REALM/../x`) is refused. An `eq` or `in` on `id` (or `url`) matches a card written in either form, so two queries that differ only in that spelling are one query (the host's live searches treat them as one). The filter, every sort entry (a `boost` filter included), the collapse, the facets and an expression's `compare.filter` inherit it, so no clause needs its own `on`. A `let` binding's query names its own type. A clause that names a different `on` keeps it. A field sort with no type anywhere is refused (`sort-needs-type`), and so is a field the type does not have (`unknown-field`), with the nearest field name.

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

Ranks are positions, not raw scores, so signals on different scales (text relevance, cosine similarity, timestamps, counts) combine without normalization. A `textRelevance` signal needs a positive `matches` term in the filter, as it does on its own. A blend takes up to 8 signals and cannot nest. Its members are `blend`, `method` (`rrf`), `k` and `direction`; any other (`fusion`, say) is refused (`unknown-key`) with the nearest real one, and so is a member a `near` sort entry does not have. Live queries leave a blend to the server, because it ranks over the whole match set. Across realms, a merged federated blend ranks over every realm's matches together when the realms share the server's index (the union path), and only approximately otherwise (see [Federated search](#federated-search)).

### Ranking by an expression (`expression`)

An `expression` sort entry ranks by a spreadsheet expression over each card's fields, highest first unless `direction` is `asc`. Every expression in a query runs in SQL, in BXL's score profile ([`packages/bxl/docs/score-sql.md`](../packages/bxl/docs/score-sql.md)): numbers, field names, arithmetic, comparisons, and `IF`, `IFERROR`, `IFNA`, `ISBLANK`, `AND`, `OR`, `NOT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `SIGN`, `SQRT`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`, `PI`, `MIN`, `MAX`, `AVERAGE`, `SUM`, `COUNT`, `MEDIAN`, `STANDARDIZE`, `PERCENTRANK_INC`, `COUNTIF` (a number criterion, `3`, `">4"` or `">" & rating`; text, `"Chair"` or `"<>Chair"`, equal ignoring case with no wildcards; or a field, whose number counts the equal numbers and whose text the equal text), `FLOOR`, `CEILING`, `DAYS`, `NOW`, `TODAY` (inside `DAYS`) and `NA`. An expression the profile cannot express, such as one calling a text function (`LEN`, `SEARCH`, `MID`), `LET`, a regression (`LINEST`, `RSQ`) or giving text, is refused with `expression-unsupported`, naming why; there is no other place it runs. A function BXL does not know is `unknown-function`.

One entry takes one of two shapes:

| Entry                                                   | What it orders                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{ expression, direction? }`                            | Every match, like any sort key: it pages, collapses and breaks ties as a field sort does. Each row carries its value as `meta._expression` when the expression leads the sort.                   |
| `{ expression, top?, compare?, direction? }`, the first | Only the first `top` rows (1 to 500; 100 when `compare` is given without `top`) of the order the entries after it give. Inside them rows order by the expression; the rest follow in that order. |

The second shape is how "re-rank the top 100 by how cheap each is for its kind" is written. It reads the way any sort list does: the expression is the first key, it applies only inside the window, and the entries after it choose the window, break its ties and order the rows past it. Pages read the window, then the rows after it: a page that runs past the window is filled from them, and a page that starts past it is in the base order. Each row of the window carries its value as `meta._window` (a row past it carries none) and keeps everything else the query computed for it (`_blendScore`, `_matchRelevance`, `_nearSimilarity`, `_collapseSize`, `_explain`, `_expression`). `meta.window` reports `{ rows, scored }`, how many rows the window held and how many the expression gave a number, with `truncated: true` when the query matched more rows than the window. An entry with `top` or `compare` that is not the first is refused (`expression-placement`), as is `top` or `compare` on a blend signal (`invalid-nesting`).

```js
sort: [
  // the 200 best-rated, re-ordered by where their price falls among their kind
  {
    expression: 'PERCENTRANK_INC(peers.priceMin, priceMin)',
    top: 200,
    compare: { by: 'productType' },
    direction: 'asc',
  },
  { by: 'rating', direction: 'desc' },
];
```

**Blanks and errors** follow Excel's rules. A missing field is 0 in arithmetic and in a comparison, and `IF` on it takes the else branch. `MIN`, `MAX`, `AVERAGE`, `SUM`, `COUNT` and `MEDIAN` skip it. A division by zero, the log of a non-positive number or `NA()` is an error that propagates until `IFERROR` catches it, and `IFERROR` catches only errors, not blanks. In SQL every error is one value, so `IFNA` passes every error through, `NA()` included. A row whose expression ends blank or an error ranks last, or in a window keeps its base-order place after the rows that scored. A value past a double's range (`EXP(1000)`, `1e308 * 10`) refuses the whole query with `limit-exceeded`, since SQL raises rather than giving a row `#NUM!`.

**Comparison sets** (`compare`). The expression can measure a row against a set, by percentile or by ratio, through two names for the fields it mentions:

- `stats.<field>.<count|sum|avg|min|max|median|p10|p25|p75|p90|stdev>`: aggregates over the row's set (percentiles interpolate, `stdev` is the sample deviation). `priceMin / stats.priceMin.median` is a product's price against the median of its kind.
- `peers.<field>`: the set's values as a list, read by a list function (`COUNT`, `SUM`, `MIN`, `MAX`, `AVERAGE`, `MEDIAN`, `PERCENTRANK_INC`, `COUNTIF`); in arithmetic it is refused (`expression-unsupported`). `PERCENTRANK_INC(peers.rating, rating)` is where its rating falls among its kind, 0 to 1.

`compare.filter` names the set (by default, every match of the query, without its page) and inherits the query's `type`; `compare.by` narrows it to the rows sharing the row's value at that path. `compare.near` makes each row's set its own look-alikes in the realm by a vector field: its `k` closest (1 to 100, default 20), at least `minSimilarity` (-1 to 1) similar, with `peers.similarity` holding how alike each is. `compare` takes `near` or `by`, not both (`conflicting-members`), and `k` and `minSimilarity` only with `near`. `peers.` and `stats.` are read only in an entry with `top` or `compare` (`expression-placement` elsewhere). A set reads at most 10,000 rows; past that it describes the first 10,000 its query returns, and `meta.warnings` holds `compare-truncated`, its message giving the rows read and the set's total.

```js
// how much cheaper than the 20 products that look most like it
{ expression: '1 - priceMin / stats.priceMin.median', compare: { near: 'imageEmbedding', k: 20, minSimilarity: 0.75 } }
// its near-identical twin, if it has one, and how much more that costs
{ expression: 'IF(COUNT(peers.priceMin) > 0, MIN(peers.priceMin) - priceMin, NA())', compare: { near: 'imageEmbedding', k: 3, minSimilarity: 0.9 } }
```

Look-alikes are read by a vector field that opts into them: `@field imageEmbedding = contains(ImageEmbedding, { search: { neighbors: true } })`; a field that has not is refused with the declaration to add. Each card's neighbors are read through its space's index (four times `k` of them) and re-scored exactly, keeping the `k` nearest; a smaller realm compares them all. Each lookup stays within the realm, and under a realm policy a neighbor (or a row of `compare.filter`'s set) the grants do not admit is left out.

**How it runs.** All in Postgres: the window is the query read in its base order to `top` rows; the comparison set is read projecting only the fields the expression names; then one statement scores the window, computing each group's `peers.` lists and `stats.` aggregates with SQL aggregates grouped by the row's group (its `compare.by` value, or the row itself for look-alikes), and orders by the value, ties in the base order. Nothing runs on a thread or past a wall clock: the search's time budget and `statement_timeout` bound it like any other statement.

Inside a `blend`, an expression is a signal with a `weight`, ranked over every match; `explain` names it by its text.

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

An expression that isn't a non-empty string is refused (`invalid-expression`), and so is a jq construct outside BXL's query profile (see [Limits](#limits)), naming it. `placement` and a top-level `rerank`, from drafts of this grammar, are refused (`unknown-key`) with the sort entry to write instead. Postgres only.

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

`collapse` keeps the best cards of each group: of the cards that share a value at `by`, only the first `keep` (1 to 10, default 1) by the query's own sort come back. Use it to show one size of a product rather than five, or one card per type. A card with no value at `by` is a group of its own. Each card that comes back carries `meta._collapseSize`, how many matches its group holds (itself and any other kept cards included), so a result can say "and 12 more" without a second query. `meta.page.total` counts what remains, and pages page over it. Facets still count every match, so after a collapse the two disagree: one-per-brand might show 40 results while the Color facet still says "Black (120)", counting every black product including the ones the collapse hid.

`on` names the type whose field `by` is; without it, the filter's anchor (`on` or `type`) is used. A string is shorthand for `{ by }`.

```js
let { data, meta } = await indexer.search({
  filter: { on: productRef, matches: 'running shoe' },
  sort: [{ on: productRef, relevance: true }],
  collapse: { by: 'variantGroup', on: productRef, keep: 1 },
  page: { size: 24 },
});
```

On the wire, `by` goes through `item.` (`collapse: 'item.variantGroup'`) and the type is `item.on`. Live queries leave a collapsed query to the server, since the best of a group is chosen over the whole match set. A merged federated search over realms on one server collapses across them, keeping the higher-ranked copy (see [Federated search](#federated-search)); one that is merged from each realm's answer collapses each realm's results on their own, so two realms may each return a card of the same group.

### Bindings (`let`, `$this`, `$literal`)

A query can name values it computes before it runs and read them anywhere a value goes. There is one syntax for every such value: a binding is declared with its `$` and read as a string, `"$name"` or `"$name.path"`. It is XQuery's `let $sofa := …` then `$sofa/price`, with MongoDB's `$literal` as the escape. `$this`, the card a query-backed field belongs to, is the one binding no query declares: it is there in every field query ([Query-backed fields](#query-backed-fields-this)).

**Declaring.** `let` takes 1 to 4 bindings. Each name is `$` and then letters, digits and underscores (`$topBrands`). A name without its `$` is refused (`invalid-value`, with the name to write), and so are `$this` and `$literal`, which are reserved. Each binding is a query over the same realm (`from`: a `filter`, or in the newer spelling a `type`; optionally a `sort` and a `page: { size }` from 1 to 10,000; no other member), and either:

- `select`, a search-doc path: the binding is the **list** of values at that path across the rows the query finds. A list field contributes each of its values and a link its id; a path through a link (`items.brand.name`) reads only what the link's `searchable` option puts in the search doc.
- `one: true`: the binding is the first **card** the query finds, whole.

**Reading.** A string is a reference exactly when it is `"$name"` or `"$name.path"` and the query's `let` declares `$name` (or it is `$this.path` in a field query). Every other string is text: `"$100"`, `"$25 gift"`, and `"$x.y"` when no `$x` is declared, so what a shopper types is never read as a binding. For the rare text that would read as one (the words `"$sofa.price"` in a query that declares `$sofa`), write `{ "$literal": "$sofa.price" }`: one member, a string, read as written (anything else in it is `invalid-value`). An object `{ "$let": … }`, the form of earlier drafts, is refused (`unknown-key`) with the string to write instead.

- A list is read whole, as the one value of an `in`: `{ "in": { "brand.name": "$topBrands" } }`, in the filter, inside a `boost`, or in a ranking `compare.filter`. Anywhere else (an `eq` value, a `range` bound, inside a list, an `in` with another field beside it) it is refused (`binding-kind`).
- A card is read by path wherever a value goes: an `eq` value, an `in` list or one of its values, a `range` bound, a `matches`, `pattern` or `regex` text, a `near` target in a filter or a sort. In an expression it is `$sofa.priceMin`. A link reads as its id, and a path through it as whatever its `searchable` option put in the search doc. `"$sofa"` alone, or a path on a list, is `binding-kind`.

```js
let { data } = await indexer.search({
  type: productRef,
  let: {
    // the brands of the products the shop rates 4.5 or better
    $topBrands: {
      from: { type: productRef, filter: { range: { rating: { gte: 4.5 } } } },
      select: 'brand.name',
    },
    // one sofa, to find its dupes
    $sofa: {
      from: { type: productRef, filter: { eq: { id: sofaId } } },
      one: true,
    },
  },
  filter: {
    every: [
      { in: { 'brand.name': '$topBrands' } },
      {
        near: {
          imageEmbedding: { to: '$sofa.imageEmbedding', minSimilarity: 0.6 },
        },
      },
      { eq: { productType: '$sofa.productType' } },
      { range: { priceMin: { lt: '$sofa.priceMin' } } },
      { not: { eq: { 'brand.name': '$sofa.brand.name' } } },
    ],
  },
  sort: [
    // how much each one saves, over the 100 most alike
    { expression: 'ROUND($sofa.priceMin - priceMin, 2)', top: 100 },
    { by: 'imageEmbedding', near: '$sofa.imageEmbedding' },
  ],
});
```

**A value that isn't there.** One rule for `$this` and every card binding:

| The reference reads                                        | Under `eq`                                         | As a `range` bound     | Under `in`, `matches`, `pattern`, `regex`, `near` |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------- | ------------------------------------------------- |
| nothing: no card was found (or, for `$this`, no such path) | the query matches no card (a field links none)     | the same               | the same                                          |
| null: the card has no value there                          | the cards with no value there, as `eq: null` finds | that node matches none | the query matches no card                         |

A card binding's search doc leaves an empty field out, so a path the found card has no value at reads null. An empty list under `in` is one of no values, which no card is.

**How each runs.** The engine resolves each binding one way and reports which in `meta.lets`, keyed by its name:

- **Card.** Its query runs first: `{ "$sofa": { "strategy": "card", "found": true } }`.
- **Join.** A list whose `from` is one card by id and whose `select` is a link field's ids (`items.id`), read only by `in`s on `id`, runs as [`linkedFrom`](#filters) in the same statement: `{ "$saved": { "strategy": "join" } }`.
- **List.** Any other list runs its query first, and its values (at most 10,000) stand in for the reference: `{ "$hot": { "strategy": "list", "values": 12 } }`. A list cut short says so: past 10,000 distinct values, or past the 10,000 rows a binding reads when its query matched more and set no `page.size`, the query runs with the first of them, and `meta.warnings` holds `{ code: 'binding-truncated' }`, naming the binding.

**A list read from a log.** A binding whose `from` names a log (`log`, or `logs` as in [Searching a log](#searching-a-log-from--log-)) reads the distinct values at `select` over the log's lines its `filter` (a log filter) keeps: `{ $seen: { from: { log: 'Feed/me.history.jsonl', filter: { eq: { 'what.action': 'seen' } } }, select: 'what.post' } }`, then `filter: { not: { in: { postUri: '$seen' } } }` skips what the reader has seen, in one request. `select` may also be written inside `from`. It holds at most 10,000 values, the most recently written first (by their latest line), and a cut list says so as any list binding does. It reads the log in the card query's snapshot and with its clock, and a log no pass has synced is synced before that snapshot is taken. Under a realm policy, it reads only the lines a log-line grant admits the caller to, and nothing of a log no grant reaches. A binding read from a log is a list: `one: true` is refused.

A binding's query cannot use another binding (`invalid-nesting`), though it may read `$this`. Bindings resolve within each realm a search reaches. Under a realm policy, the grants that scope the caller's query also scope every binding's query, and a `linkedFrom` runs as a binding, so a list never holds anything the caller couldn't search for. Live queries leave a query with bindings to the server. On the wire, `select` and the binding's field paths go through `item.`; a reference's path reads the card's own path, with or without `item.` (`"$sofa.item.priceMin"` is `"$sofa.priceMin"`).

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

A path names a column after itself; a one-member object renames it (`{ brand: 'brand.name' }`). A path through a link reads what the link carries in the search doc, so `brand.name` works when the link's `searchable` reaches it (`searchable: true`); a list, or a path through a list of links, reads as a list. A score the query computes can be a column too: `_blendScore`, `_matchRelevance`, `_nearSimilarity`, `_window`, `_collapseSize`.

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

Ask for `Accept: application/x-ndjson` (or `application/jsonl`, the same format) and the table comes one row a line, each an object keyed by column, then a last `{ "meta": … }` line carrying the same `meta` as the JSON answer (`page.total`, `page.hasMore`), which a table loader such as DuckDB's `read_json` reads as it is.

`select` takes the same filter, sort, `let`, `collapse`, facets and paging as any query, with the same page limit. It needs the query's type, from a top-level `type` or the filter's anchor (`needs-type`). A path the type lacks is `unknown-field`; a path through a link that does not carry it is `not-selectable`; `select` beside `fields` is `select-excludes-fields`, since one answers a table and the other entries. It runs on Postgres only (`needs-postgres`).

Under a realm policy, the rows are the ones the caller's grants admit, as for any search, and a value read through a link shows only where the linked card's own type's grants admit the caller as well: otherwise it reads null (or, in a list, is left out). A `select` value is never wider than what the caller could read card by card.

### Searching a log (`from: { log }`)

An append-only log (a `.jsonl` or `.log` file, written a line at a time with `record`) can be searched line by line without reading the file. Each line is a row of the index, kept in step with the file at the cost of what was added: the realm indexes the lines it appends as it writes them, an index pass reads only the bytes past what is already indexed, and the whole file is read only to rebuild its rows (below). Send the query to the realm's `_search`, or to `_federated-search` with `realms` naming exactly that one realm:

```ts
{
  from: { log: 'TasteProfile/my-taste.history.jsonl' }, // realm-relative, absolute, or @scope/realm/…
  filter: {
    every: [
      { eq: { 'what.action': 'like' } },
      { range: { at: { gte: 'now-7d' } } },
    ],
  },
  sort: [{ by: 'at', direction: 'desc' }],
  page: { size: 50, total: 'capped' },
}
```

The answer is `{ data: [{ line, at, actor, entry }], meta: { page, facets?, log } }`.

**Which lines.** `from` names one log (`{ log }`), several (`{ logs: ['A/x.jsonl', 'B/y.jsonl'] }`, at most 100), or every log in a folder and its subfolders (`{ logs: { under: 'Class/' } }`, realm-relative, at most 100 logs). A query over several reads their lines as one set: each row carries its `file` (the log's URL), `meta.logs` lists the logs read, in URL order, and `file` is a path like `line`, to filter, sort, group or facet by (attendance per day across classes is `group: { by: ['file', 'what.day'] }`). A log named twice is read once.

- **Paths:** `at` (the line's time), `actor` (who the realm stamped as writing it), `line` (its number from 1), `file`, and any path into the entry (`what.action`). A path is names joined by dots, each a letter, `_` or `$` then letters, digits, `_` or `$`; a key with a hyphen or outside ASCII, and a list position, can't be named. A `what` stored as a JSON string holding an object or a list is decoded, so its fields are paths too. A `.log` line is `{ text }`, with its time and actor read from the line.
- **Filters:** `eq`, `in`, `range` (`gt`, `gte`, `lt`, `lte`), `contains` (case-insensitive substring of the text), `exists`, `missing`, `every`, `any` and `not`, read as in a card query. An `eq` or `in` on an entry path is answered by an index. A number `range` bound compares numbers; a text bound compares text in the database's collation.
- **Times.** `at` takes an ISO 8601 time, read as UTC when it names no zone; epoch milliseconds; or a relative date in the card grammar's form (`now`, `now-7d`, `now+1w`, `now-1M/d`: see [Relative dates](#relative-dates), the same rule and the same code, rounded on the calendar of the query's `timeZone` as a card query's are; the zone resolves as a card query's does from the query and the caller, and then the realm's default zone (the `timeZone` its `realm.json` declares), then UTC; a card query's log binding reads its zone). Any other text, `March 7` included, is refused. A line's `at` is answered as an ISO instant in UTC; `record` stamps it to the second.
- **Sort and page:** sort by any path; ties keep file order (by log, then line), whatever the direction, and a line with no value for a key sorts after those with one. The page defaults to 50, at most 1,000: a larger `page.size` is clamped and `meta.warnings` says so (`page-size-clamped`). `page.total` reads as a card search's.
- **`facets`:** count the filtered lines by a path's values, largest first (ties by value), at most 8 facets and one per path. `{ by: 'at' }` counts per day on the query's zone's calendar (UTC unless `timeZone` names another), each labelled with its date, `YYYY-MM-DD`, as a card facet's day bucket is. `size` is a whole number from 1 to 1,000 (default 20). A line with no value is left out of a facet. A log facet needs no declaration: a log's lines have no type that could declare one, so the card facets' opt-in (see [Declaring a facet](#declaring-a-facet)) does not apply to them.
- **`select`:** return only those paths per line, as `{ line, 'what.action': … }` (and `file`, over several logs).
- **`group`:** one row per distinct value of `by` (a path, or up to 8), with up to 32 aggregates over each group's lines: `count` (`true`, or a path to count non-null values), `min`, `max`, `sum`, `avg`, `distinct` (the list of values) and `latest` (the value on the newest line). Rows are `{ group: { <path>: value }, <name>: value }`, sortable by a group path or an aggregate, ties by the group keys ascending; `page.total` counts groups. `select` and `group` don't combine.

**How it is answered.** In this order, whatever order the members are written in:

1. Every member is checked before anything runs; a refused query reads nothing.
2. The clock is read once: every relative time in the query (and in a card query's log binding, the card query's clock) is one instant.
3. The logs are resolved, and what the caller may read of each (below).
4. A log the index holds no rows for yet (one written before the line index existed, or one no index pass has reached) is synced from its file first. It is never answered as empty for want of a pass.
5. In one snapshot of the index: filter, group, count, sort and page; then the facets, over the filtered lines (not the groups, and not the `select`).

**Edge cases and what is guaranteed.**

- **A missing value** follows the SQL rule a card query does: a comparison with no value at its path is neither true nor false, so the line is returned by neither the filter nor its `not`; `eq: { path: null }` finds it. JSON `null` is no value. The rule holds for `actor` (a line no one stamped), for a number `range` (a line whose value there is text, or missing, has no number to compare) and for `contains` (a value that isn't text is read as its JSON text, `7` as `"7"`).
- **A list at a path** matches as a card's list field does: `eq` or `in` with a scalar or an object keeps a line whose list holds an item equal to it, and the `not` of one keeps a line whose list holds none, an empty list included. `eq` with a list value compares the whole list.
- **Freshness.** A line the realm appends (`record`, `appendLine`) is searchable when the append returns: its row is written as it lands. A card query with a log binding is never answered from a search cache, since an append moves no index generation those caches are keyed by. A line added any other way is searchable once the index pass for the change has run, and a log no pass has reached is synced by its first query.
- **What keeping the rows costs.** An append costs its own bytes, however long the log: the index pass after a realm append finds the log no longer than what is indexed and reads nothing, and after any other growth it reads the new bytes and re-reads the last indexed line to check it is unchanged; a trailing line with no newline waits for one. The log's file meta reads only the file's head (for its excerpt) and its tail (for `content`), and counts `lineCount` from the line index, so it costs no more per append than the lines do. (The ranged read of the file meta's head and tail is the host's, and takes effect with the host build that carries it.) The rows are rebuilt from the whole file only when the file shrank, its last indexed line changed, or the realm wrote it other than by appending (a file `update`). An edit made outside the realm, on disk, that leaves the size growing and the last indexed line as it was is not seen until the log is rebuilt.
- **One moment.** The page, its count and its facets read one snapshot (Postgres); two queries are two moments, so paging a log that is being appended to shifts later pages.
- **Sets.** The children of `every` and `any`, the values of `in`, the `facets` and the logs of `from.logs` are sets; `select` paths are a set (a path twice is one column); `sort` and `group.by` are sequences (`group.by`'s order is the rows' order).
- **Logs that aren't there.** A log that does not exist is a 404 (`log-not-found`); an empty log is an empty answer. A folder with no logs is an empty answer. A server that can't read the log's file to sync it answers 409 (`log-not-indexed`).
- **Typed lines.** `linksTo(JSONLFile, { of: ReactionField })` types a log's lines. The operations client checks and normalizes each `record`'s `what` against the FieldDef before it is sent, and the realm does the same when `record` runs (refused as `invalid-params`), so a direct `_operations` invoke is held to the type too. The realm finds the line type from the cards that link the log through such a field: a log linked with one line type is typed by it; a log no card links with `of:`, or one linked with two different line types, has no one type the realm could hold it to, and only the client's check applies. Only `record` stamps `at` and `actor` where the caller cannot reach them; a realm writer's raw `appendLine` or `update` can write any time, actor or shape, which is why a policy grants neither (below).

**Two changes to `JSONLFile` and `LogFile` that are on `main`, made on purpose.** `JSONLFile`'s `record` takes `what` as any JSON value (a `JsonField`; it was a `StringField`), so a structured event is stored as an object and its fields are paths, where it used to be coerced to text; a `what` that is text is stored as text, as before. And the file meta's `content` of a `JSONLFile` or `LogFile` is the last whole lines that fit in 16 KB (`contentTailBytes`), not the whole file, since it is re-read on every append; `lineCount` still counts every line. A card or computed that read a log's `content` for an aggregate reads its tail now: count with a log query instead. Both are pinned by tests (`indexing-test.ts`, `log-policy-http-test.ts`).

**Refusals** carry the card grammar's codes: `unknown-key` (with the nearest name), `invalid-value`, `invalid-page`, `missing-member`, `conflicting-members` (`select` beside `group`, two facets on one path, a path twice in `group.by`, two operators in one filter), `limit-exceeded` and `needs-postgres`; and four of a log's own: `not-supported-for-logs` (a card query's member a log query does not take; see below), `log-not-found` (404), `log-not-indexed` (409) and `log-not-readable` (403). A refusal never echoes a NUL or a lone surrogate the query carried. The one code earlier drafts answered, `invalid-log-query`, is gone.

**Limits.** Nesting 512; 10,000 values in one `in`, and 60,000 compared values in a whole query; 10,000 characters in a `contains`; 64 `sort` keys; 8 facets, each of size 1 to 1,000; 64 `select` paths; 8 `group.by` paths and 32 aggregates; 100 logs; a page of at most 1,000 lines (clamped, with a warning).

**What logs don't support.** A log query is the card grammar over a log's lines, with `group` as its one member of its own. These card query members and filters don't apply to lines, and are refused with `not-supported-for-logs` (not ignored, and not as unknown):

| Card feature                                             | Why, and what to write instead                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `type`, `on`, a filter's type anchor                     | A line has no card type: name the log in `from`.                                      |
| `matches`, `prefix`                                      | Lines have no full-text index: use `contains`.                                        |
| `near`, vector sorts, `blend`, `expression`, `relevance` | Lines have no vectors or ranking signals.                                             |
| an expression sort, `explain`                            | A log query ranks nothing.                                                            |
| `collapse`                                               | Use `group`.                                                                          |
| `let`                                                    | A log query has no bindings; a card query can bind a log (above).                     |
| `linkedFrom`                                             | Lines have no links.                                                                  |
| `fields`, `asData`, `cardUrls`, `scope`, `htmlQuery`     | A line is answered whole, or by `select`.                                             |
| `realms` on a realm's `_search`                          | A log search runs on one realm; the federated route takes `realms` naming exactly it. |

Also not yet: declared log facets (a log whose line type is declared through `lineOf` could opt its fields in, as a card type does); a path with a hyphen, a non-ASCII key or a list position; `range` and `contains` over a list's items (they compare the value at the path); facet options beyond `by` and `size`; label paths; the older spelling (a log query is in the newer spelling only). Pre-computed group aggregates (a likes count kept per post as lines arrive) are a later option; a `group` query counts the lines each time.

**Who may read the lines.** A caller who reads the realm reads every line. A caller the realm's ACL declines reads only what a **log-line grant** in its policy admits them to: a `query` grant on base `JSONLFile` (or `LogFile`, for `.log` files) whose `where` is `.actor == actor()` (optionally with `and actor() != "anonymous"`) admits every signed-in caller to the lines they wrote, of every such log in the realm:

```json
{
  "targetType": {
    "module": "@cardstack/base/jsonl-file-def",
    "name": "JSONLFile"
  },
  "grants": [
    {
      "operation": "query",
      "where": ".actor == actor() and actor() != \"anonymous\""
    },
    { "operation": "record", "where": "actor() != \"anonymous\"" }
  ]
}
```

The search then ANDs `actor = <caller>` into the one condition every statement shares, so rows, `total`, `hasMore`, groups and facets all cover only those lines (a group whose lines are all someone else's is not there), and `meta.policyScopedLogs` names the logs it scoped. A `where` of any other shape is recorded `policy-not-filterable` and admits no one; a caller who isn't signed in is never admitted. With no log-line grant the log is the realm's readers' alone, as before. A `logs` query that names a log the caller may read none of is refused (`log-not-readable`); a folder's such logs are left out, as a realm the caller can't read contributes nothing to a federated search.

The one write a grant reaches on a log is the base types' own `record`, which stamps `at` and `actor`, so "any signed-in user may add a line" is the second grant above. The base `appendLine`, `update` and `delete`, and a read of the log's raw bytes (which hold every caller's lines), are granted to no one, whatever a policy says. Values derived from a log, such as likes per post, belong on cards under card grants (ADR 006, "Log lines").

### Query-backed fields (`$this`)

A `linksTo` or `linksToMany` declared with `{ query }` links the cards its query finds, run for each card that declares it. `$this` is that card, the one [binding](#bindings-let-this-literal) a field query has without declaring it: `$this.<path>` reads a value of the card wherever a value goes (an `eq` value, an `in` list, a `range` bound, a `matches` text, a `pattern`, a `near` target, a `boost` filter, and a `let` binding's query), and a value the card does not have follows the bindings' one rule for a value that isn't there. A value read from the card is text, never a reference, even when it spells one. `$REALM` reads the card's realm, and a type written `$REALM/<path>` (`'$REALM/product#Product'`) names a module in it ([Naming a type](#one-type-for-the-whole-query-type)).

```js
@field sameKind = linksToMany(() => Product, {
  query: {
    filter: {
      every: [
        { eq: { kind: '$this.kind' } },
        { not: { eq: { id: '$this.id' } } },
      ],
    },
  },
});
```

- **Its type.** A clause with no `on`, a `not` included, is anchored on the field's type, so the field links only cards of that type and its count counts only them. A top-level `type` narrows the field to that type, a subtype of the field's: `{ type: saleProductRef, filter: … }`. A type outside the field's finds no cards.
- **A link's id.** `$this.<link>.id` reads the id of the card a `linksTo` links to, in its canonical form ([ADR 002](adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md)), so `{ eq: { id: '$this.pin.id' } }` finds it. On a `linksToMany` it reads the list of ids, for an `in`.
- **A value that isn't there.** A path the card has no value at reads nothing, and the field links no cards rather than every card of its type; the rest is the bindings' table ([Bindings](#bindings-let-this-literal)): a card with no embedding has no neighbors, and `eq` reading null asks for the cards with no value there.
- **Its page.** The field holds a page of its query, not the whole match set: the page it names, or 500 when it names none (at most 2,000). Its `totalMatchCount` counts every match exactly, whatever the page holds, and `isPartial` is `true` when the page holds fewer rows. A rollup reads `totalMatchCount` rather than counting the rows. The default is written into the field's query on every leg, so the answer carries no `default-page-truncated` notice; a development build logs one to the console once per query instead.
- **Refusals.** A field query in the newer spelling is checked as strictly as any other, with the card's values in place: a member the grammar lacks is refused, not ignored. A refused field links no cards, and its relationship's `meta.errors` holds `{ type: 'invalid-query', code, message }`.

### Relative dates

A `range` bound on a date field may be relative: `now`, optionally moved by whole units (`now-30d`, `now+1w`), optionally rounded down to the start of a unit on the query's calendar (`now-30d/d`, `now/M`): UTC unless the query, its caller or its realm names a zone (see [Time zones](#time-zones)). The units are `s`, `m`, `h`, `d`, `w`, `M` (months) and `y`. A week starts on Monday. The bound is read when the query runs, so a saved search for "added this month" stays current. On a `DateField` or `DateTimeField` the bound is compared in the field's own format. On such a field a string that starts like a relative date but is not one (`now-3x`, `now-1`, `now-`, `NOW-30d`, `now/q`) is refused with `invalid-value`, naming the field and the string, in a filter (`range`, `eq`, `in`) and in a facet range bound alike; a word that does not start with `now` (`yesterday`) is still text. On any other field, the same string is literal text. A stored date-time with no zone (`yyyy-MM-ddTHH:mm`) is read as UTC, by bounds, facets and expressions alike; the serializer today writes its local wall time, so data written by a process not running in UTC can be off by that zone's offset until the serializer writes UTC. One query reads the clock once: every relative bound, facet range bound and expression in it sees the same instant.

```js
filter: {
  on: productRef,
  range: { publishedAt: { gte: 'now-30d/d' } },
},
```

### Time zones

A query may name `timeZone`: an IANA zone such as `America/New_York`. It decides calendar boundaries only, where "today", "this week" and a bucket start and end, and never what a stored value means: a date-time with `Z` or an offset is that instant, one with no zone is read as UTC, and a date (`yyyy-MM-dd`) is that calendar day, never shifted. The zone applies to:

- relative dates and their rounding (`now/d`, `now-1w/w`, `now-1M/M`, `now/y`) in filters, `range` bounds and facet range bounds. Moves by `s`, `m` and `h` are elapsed time; moves by `d`, `w`, `M` and `y` and every rounding are on the zone's calendar, so a day may be 23 or 25 hours long at a daylight-saving change. On a date field the bound is the zone's day;
- a facet `interval`: a date-time counts in the zone's day, week (from Monday), month or year, labeled by that bucket's first date there. A date counts in the day it names;
- an expression's dates: `TODAY()` is the zone's midnight and `NOW()` the zone's wall time inside `DAYS()`, so a date and `TODAY()` are whole days apart; `DAY`, `MONTH`, `YEAR`, `WEEKDAY`, `HOUR` and the other date functions read a date-time's wall time in the zone;
- every `let` binding's query, unless it names its own zone.

The zone is resolved once per search, in this order: the query's `timeZone`; the caller's (a federated search over several realms passes UTC); the realm's default, the `timeZone` its config card (`realm.json`) declares; UTC. A federated search over several realms reckons in the query's zone or UTC, never in one realm's default; over one realm it uses that realm's default. A query-backed field is evaluated at index time, with no viewer, so it reckons in its realm's default or UTC. The viewer's zone is never applied on its own: a caller that wants a personal view ("my day") names it, as `withViewerTimeZone(query)` (runtime-common) does with the browser's zone. Business facts, such as a school day or an attendance cutoff, use the realm's zone.

One clock reading per query still holds: the instant is read once, and only calendar math uses the zone. A zone that `Intl` or the database does not know is refused with `invalid-value`, naming it; a realm default that names no zone is ignored, with a warning in the server log, and the realm reckons in UTC. The zone is part of the query's signature, so a cached answer in one zone never serves another. The answer reports the zone it was reckoned in as `meta.timeZone` when the query named one or a zone other than UTC applied; a search reckoned in UTC by default has no `meta.timeZone`, so its answer is what it always was. A facet `interval` in a zone other than UTC runs on Postgres only (`needs-postgres` in the browser's SQLite index).

A rule about a time of day ("late after 08:10") is a wall-clock rule: store it as a local time and a zone, not as an instant, and compare a punch's wall time in that zone.

```js
{
  type: punchRef,
  filter: { range: { at: { gte: 'now/d', lt: 'now+1d/d' } } },
  facets: [{ by: 'at', interval: 'day' }],
  timeZone: 'America/New_York',
}
```

### Facets

The Query object may have a `facets` property: up to 8 counts of what the matched cards hold in one field, counted by the database over every match, not only the page returned. Each facet comes back in `meta.facets[by]` as `{ value, count }` entries, most common first. `by` is a field path, dotted for a compound field; a list field counts each of its values, and a card counts once per distinct value.

#### Declaring a facet

A field is a facet only when its type declares it: `search: { facet: true }` on the field (see [Search intent](search-intent.md#facet)). The index keeps the declared fields' values in a facet table, and every facet is counted from it.

```ts
export class Address extends FieldDef {
  @field city = contains(StringField, { search: { facet: true } });
  @field street = contains(StringField);
}
export class Money extends FieldDef {
  static facetValue = 'currency';
  @field currency = contains(StringField);
  @field amount = contains(NumberField, { search: { facet: true } });
}
export class Order extends CardDef {
  @field status = contains(StringField, { search: { facet: true } });
  @field total = contains(NumberField, { search: { facet: true } });
  @field shipTo = contains(Address, { search: { facet: true } });
  @field price = contains(Money, { search: { facet: true } });
  @field items = containsMany(LineItem, { search: { facet: true } });
  @field buyer = linksTo(() => Person, {
    searchable: true,
    search: { facet: true },
  });
}
// facets: [{ by: 'status' }, { by: 'shipTo.city' }, { by: 'price' }, { by: 'buyer' }, { by: 'buyer.name' }]
```

- A **compound field** declared `facet: true` opts in exactly the subfields its FieldDef declares (`shipTo.city`, not `shipTo.street`). A FieldDef that names `static facetValue = '<subfield>'` makes the compound itself a facet, counted by that subfield (`price` counts currencies).
- A **list of compounds** (`items.sku`) counts a card once when any element holds the value.
- A **link** declared `facet: true` counts the linked cards by id, labeled with their titles. The linked card's own fields (`buyer.name`) are facets when its type declares them, and reach the search doc through the link's `searchable`.
- **Every card and file** also has the index fields base declares, with the same syntax, so an author declares nothing for them:

  ```ts
  // packages/base/card-api.gts
  class BaseDef {
    static indexFields = {
      _type: { search: { facet: true } }, // the row's own type, labeled with its display name
      _realm: { search: { facet: true } }, // the realm URL
      createdAt: { search: { facet: true } }, // dates, read as UTC instants
      lastModified: { search: { facet: true } },
    };
  }
  class CardDef extends BaseDef {
    static indexFields = {
      ...BaseDef.indexFields,
      _cardType: { search: { facet: true } },
    };
  }
  ```

  `_type` counts each row under its own type (a subclass under its own, not its parent's), by the type's code ref key with its display name as `label`: the realm's type summary (`_types`) for the same rows, so one facet query over a mixed search (cards and files) serves a type rail. `_cardType` is a card's type display name, the value `eq: { _cardType }` filters by; files have none. The dates are a monthly histogram unless the query reshapes them. These are index columns, not fields: nothing about them serializes, and a field named `_type` would not be one of them.

- **A file's own fields are not facets** of the card that links it. The card declares what it counts by in a field of its own, usually a computed one that reads the file (see the cookbook's "Facet by something inside a linked file"); `facets: [{ by: 'photo.exif.cameraModel' }]` is refused with `needs-declaration` and that pattern. The link itself (`photo`, declared `facet: true`) counts the files by id.
- **Subclasses** inherit declarations. A facet over a base type may count a field a subclass defines when the subclass declares it; when a type whose cards hold the field doesn't, the facet is refused.

- **One link deep.** A facet reaches through one link (`buyer.name`). A path through two (`brand.country.name`) is refused with `needs-declaration`; the card counts it with a computed field of its own that reads the value through both links, declared a facet.
- **The shape comes from the type.** A number with no `stats`, `ranges` or `interval` counts in range buckets; to count each value of a number (a 1–5 rating), the query says `stats: true`. A date counts by month unless it names an `interval`.
- **Index fields win over a field of the same name.** A type with its own `lastModified` or `createdAt` field still facets the index's column by that name, as a sort does.
- **Asking for facets changes nothing else.** The page, its order and `meta.page.total` (and whether the total is exact or capped) are what the same query without facets answers.
- **Holders that disagree need a type.** A facet over no type (or a base type) whose holder types declare the field as different kinds of value (a number in one, text in another) is refused with `needs-type` unless the query names its shape (`stats: true` counts each stored value as the text it is, the number 10 and the text "10" alike; `ranges` and `interval` count as they say); or anchor the query on one type. Over no type, the facet counts the cards whose rows the facet table holds for it, and the table holds rows only for fields declared facets when the card was indexed: when no holder's type resolves any more (its module is gone, or the row records no type), those rows still count, as plain values. Values a card holds in its search doc with no type recorded are refused with `needs-declaration`, never counted as nothing.

A `by` (or a `measure`'s field) that is not declared is refused with `needs-declaration`, and the message names the field, its type and the declaration to add, for example _facet by "note": the field "note" of Order is not declared as a facet. Facets count only declared fields: add `search: { facet: true }` to its declaration_. A name the type has no field for is `unknown-field`, as in a filter. The SQLite browser index keeps no facet table and refuses facets with `needs-postgres`.

When a module change touches only a type's facet declarations (a field's `search.facet`, a FieldDef's `facetValue`), its cards' facet rows are rewritten from their indexed search docs, with no render; any other change to the module (a template, a role, a field) renders its cards again. The parsed module decides: the write counts as facet-only when the old and new modules' syntax trees are identical once `facet` options in `@field` declarations' `search` objects (and a `search` or options object they leave empty) and `static facetValue` members are taken out; a template's text, whitespace included, counts as a change. This holds for a write that waits for its index pass; a write that returns before its pass (`waitForIndex: false`) renders the dependents as before.

Limits:

- A value longer than 1,024 characters is not kept in the facet table, so it is not counted: no facet counts by a paragraph. The card still counts for its other values, and `missing` counts it as having none if that was its only one.
- `searchable: true` on a link copies the linked card's whole search doc into this card's, which a facet through the link needs; a card with many such links has a larger search doc.
- A search over an index pass's staged rows (a query-backed field read while its realm indexes) counts its facets from the facet table as the last finished pass left it, not from the staged rows.

A facet rail (a list of facet values a person ticks to narrow results) reads `meta.facets` and `meta.facetStats` for the facets it shows and filters with `in` on the same path, with `own: 'ignore'` on each facet so a ticked list keeps its other values.

#### Facet members A link facet's value is the linked card's id, with its title as `label` when the search could return that card itself: one in the realm searched, not deleted, and, for a caller a realm policy scopes, one its grants admit. Any other value keeps its id and count with no label.

| Member          | Effect                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`          | How many values come back (1 to 1,000, default 50).                                                                                                                                                                       |
| `own: 'ignore'` | Counts without the facet's own selection, so a multi-select list keeps its other values while one is picked.                                                                                                              |
| `stats: true`   | Adds count, distinct count and min, max, sum and average (numbers) or min and max (text) in `meta.facetStats[by]`.                                                                                                        |
| `ranges`        | 1 to 50 `{ key?, from?, to? }` buckets, each counting the matches in `[from, to)`, labeled by `key` or `from-to` (`*` for an open end). Not with `interval`.                                                              |
| `interval`      | Counts by `day`, `week` (from Monday), `month` or `year` of a date value, on the query's [time zone](#time-zones)'s calendar (UTC by default); a date counts in the day it names.                                         |
| `prefix`        | Keeps the values that start with it, ignoring case.                                                                                                                                                                       |
| `missing: true` | Adds the count of matches with no value (`meta.facetStats[by].missing`).                                                                                                                                                  |
| `order`         | `count` (most first, the default), `value`, or `measure` (largest first; needs a `measure`). An `interval` facet orders by value unless it names an order.                                                                |
| `measure`       | An aggregate of another number field over the matches holding each value: one of `{ avg }`, `{ min }`, `{ max }`, `{ sum }`, naming the field. It comes back as `measure` on each entry. Not with `ranges` or `interval`. |

A declared field takes its shape from its type when the query names none of `stats`, `ranges` and `interval`: text, a boolean or a link is values with counts, a number is range buckets with stats, and a date or date-time is a monthly histogram with stats.

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

Across realms on the union path, facets are counted once over every realm's matches, exactly. Merged from each realm's answer, counts add up: each realm answers more values than asked for (1.5 × `size` + 10) so the merged top values are right more often, and `meta.facetErrors[by]` bounds how far any merged count may be short. A measure combines too: an average weighted by each realm's count, the smaller min, the larger max, the summed sum.

### Pagination

The Query object may have a `page` property: which slice of the results comes back, and how the total is counted. It takes:

- `number`: the page number, 0-based (default 0).
- `size`: the number of results per page, a whole number. `0` returns no rows and still counts and facets. A negative size is refused in the newer spelling and read as the default in the older one. A card search that names none gets the first 100, which is also the most a card search may ask for. A `_search` or `_federated-search` request that names none gets the first 500, and one that names a size takes up to 2,000, clamped above that: the page then holds 2,000 rows, `page.number` counts pages of 2,000, and `meta.warnings` holds `{ code: 'page-size-clamped' }` with a message naming the size asked for. A query-backed `linksToMany` field that names none takes 500, since it is read as the set it declares. A default page that leaves matches out says so in `meta.warnings` (`default-page-truncated`, below).

- `total`: How much counting the total costs:
  - `capped` counts up to 1,000 (`SEARCH_TOTAL_CAP`) and reports a lower bound past it. It is the default for a newer-spelling query that names a `page`.
  - `exact` counts every match. It is the default for a query in the older spelling, which has always been counted exactly, and for a counts-only page (`size: 0`) in either spelling: a query asking only for the count gets the count.
  - `none` counts nothing: the total is the page's offset plus the rows it returned, and `meta.page.hasMore` says whether more follow.

  A mode the query names wins in either spelling. A page with no next page is always counted exactly, whatever the mode. A query-backed field's search counts exactly unless it says otherwise, since its `totalMatchCount` is read as the full count. `page.exactTotal: true` is another spelling of `total: 'exact'` (from V2's drafts, so it makes a query the newer spelling). `page.generation` is accepted and ignored by the engine.

  **What a page costs.** When the filter tests a field the search doc's index serves (an `eq`, a positive `in` of up to 100 text values, a test through a list), a page with no ranking sort reads the matches through that index first: it counts them (up to the cap, or all of them for `exact`) and takes the page from them in one statement, so its cost follows the number of matches rather than the size of the realm (a 20-value `in` over 50,000 cards: about 1 ms). A filter that admits more than the cap reads the page off the realm's order instead, where the matches fill it quickly, and reports the cap as the total for `capped`. So such a filter costs a read of up to 1,000 matches even with `none`.

The search response includes a `meta` object with pagination information:

- `meta.page.total`: The total number of results across all pages. When `meta.warnings` holds `total-estimated` it is a lower bound: the count stopped at the cap, a broad `matches` term was capped (see "Bounds every query runs under"), or `page.total: 'none'` counted nothing. Show it as "1,000+".
- `meta.page.hasMore`: Whether another page follows this one. A caller that only needs "more" (an infinite list, a "next" button) can send `page.total: 'none'` and read this, which costs no count at all.
- `meta.warnings`: `{ code: 'default-page-truncated', message: 'Returned the first 100 of 2,596 matches; pass page.size or page through the results' }` when the query named no page, a default page applied, and more rows match than it holds (`>= M` when the total is a lower bound). `meta.page.hasMore` is `true` beside it and `meta.page.total` carries the count. A page the query named carries no such notice, whatever it leaves out: it is the page that was asked for. It is distinct from `page-size-clamped`, which answers a size the query did name.

#### Warnings

`meta` holds facts: the page (`total`, `hasMore`), per-realm totals, facet counts, the zone, how a `near` search or a window ran, which realms answered. Anything that left the answer usable but not exactly what was asked is a warning instead, in `meta.warnings`, as `{ code, message, realms? }`, never a flag elsewhere in `meta`. Across realms each warning appears once; `realms` names the realms it came from when not every answering realm gave it. A caller tests the code; the message is for people and may change.

| Code                     | Meaning                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `total-estimated`        | `meta.page.total` is a lower bound: a `capped` page stopped counting at 1,000, a broad `matches` term ranked a capped candidate set, or `page.total: 'none'` counted nothing.   |
| `approximate-order`      | A merged federated answer sorted by a score: each realm scored its own matches, so the order across realms is approximate (ties still break the same way every time).           |
| `default-page-truncated` | The query named no page, and the default page left matches out.                                                                                                                 |
| `page-size-clamped`      | The query named a `page.size` larger than a page holds; the page holds the most it can.                                                                                         |
| `binding-truncated`      | A `let` list binding found more values or rows than a binding holds, so the query ran with the first of them.                                                                   |
| `compare-truncated`      | An expression sort's comparison set held more than 10,000 rows, so `stats.` and `peers.` describe the first 10,000.                                                             |
| `near-exact-scan`        | A `near` search compared every vector of a large field exactly (the reason is in the message and in `meta.near.reason`).                                                        |
| `incomplete`             | A realm a federated search asked did not answer, so the rows and the total cover only the realms that did (`meta.realms` says which). `meta.incomplete: true` is set beside it. |

`meta.incomplete` and a document's `meta.linkClosureTruncated` are older than this list and stay as they are, in both spellings: platform code reads them whatever spelling a query arrived in. Before Query V2 settled, drafts reported a bound total as `meta.page.totalIsEstimate`, a merged order as `meta.approximateOrder`, a cut comparison set as `meta.window.compareTruncated` and a cut binding as `meta.lets[name].truncated`; none of them was ever on a release, and none is sent now.

#### The default pages, and paging past them

A query that names no page never gets every match. Each surface fills in a page of its own, and says so when that page left matches out:

| Surface                                                                | Default page | Most it may ask for            | Where it applies                                                  |
| ---------------------------------------------------------------------- | ------------ | ------------------------------ | ----------------------------------------------------------------- |
| A card's `getCards`, `@context.store.search`                           | 100          | 100 (a larger size is refused) | The host, before the request leaves (`applySearchPageBound`)      |
| A `_search` or `_federated-search` request reading rows (`item`)       | 500          | 2,000 (clamped above)          | The realm server (`applyServerSearchPageBound`), for every caller |
| A query-backed `linksToMany` field                                     | 500          | 2,000 (clamped above)          | Where the field's query is normalized, on every leg               |
| A log search (`from: { log }`)                                         | 50           | 1,000 (clamped above)          | The log query                                                     |
| A prerendered-HTML search (`searchResultsComponent`, no `item` fields) | none         | none                           | Unbounded: the cheap precomputed leg                              |

The host's own searches (the search pane, the AI assistant's search-cards tool) name no page and take the server's 500. A newer-spelling total also stops counting at 1,000 (`page.total: 'capped'`), so a short page over a large realm reports `>= 1,000`.

A card's `getCards` resource carries what a template needs to tell a short page from a short match set: `totalMatchCount` (`meta.page.total`, or `undefined` when no count is known), `hasMore` (another page follows), and `isTruncated` (a default page the query never asked for left matches out, so `meta.warnings` holds `default-page-truncated`). A development build also logs the notice to the console once per query. A card that reduces over `instances` (a count, a sum, a goal computed from activity) while `isTruncated` or `hasMore` is true is reducing over a prefix.

To read every match, name the page and walk it: `page: { size: 100, number: n }` for `n = 0, 1, …` while `hasMore` is true, or until the rows read reach `totalMatchCount`. Sort on a stable key (`cardURL` breaks ties) so a row does not move between pages. For a count alone, `page: { size: 0 }` returns the total and the facets with no rows.

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

## How a query is evaluated

### Evaluation order

The engine applies a query's members in this order, whatever order they are written in:

1. Lower the newer spelling to the older one, and resolve labels to field paths.
2. Resolve each one-card `let` binding, and stand its values in for its references.
3. If the first sort entry is an expression with `top`, run the rest of the query (steps 4 to 10) in the order the other entries give, and re-order its first `top` rows.
4. Resolve each list `let` binding by running its own query, without the outer filter.
5. Filter.
6. Compute ranking values (text relevance, `near` similarity, each `blend` signal's rank, `expression` values) over every row the filter admits, not over the page.
7. Count facets over every row the filter admits: before the collapse, the window and the page.
8. Collapse.
9. Count `meta.page.total` and `hasMore` over the rows the collapse kept.
10. Sort, then cut the page.
11. Build `explain` and the `select` table from the rows of the page.

So facets and the collapsed total can disagree (a facet counts the rows a collapse hid), a `blend` signal's rank is a card's place among every match, and an expression with `top` re-orders the collapsed, sorted rows.

### Sets and sequences

Only these lists are sequences, where order is the meaning:

- the `sort` list: the first key orders, the next breaks its ties;
- the `select` columns, which come back in the order written, after `id`;
- a facet's `ranges`, whose buckets come back in the order written;
- the words of a quoted phrase in `matches`;
- with `prefix: true`, the last word of `matches`, the only one still being typed.

Everything else is a set: the children of `every` and `any`, the values of `in`, the signals of a `blend` (only `explain` lists them in the order written), the entries of `facets`, `let` bindings, unquoted words in `matches` (every word, with `prefix` and `scope: 'title'`), and the members of every object. Writing any of them in another order, or twice, gives the same answer. Two facets on one `by` are one facet, since `meta.facets` and `meta.facetStats` answer by field: their options combine (`{ by: 'price', stats: true }` beside `{ by: 'price', ranges }` counts the ranges and the statistics), and an option the two give different values is refused (`conflicting-members`).

### Edge cases and what is guaranteed

- **A missing value** is returned by neither a comparison nor its `not`, as in SQL; **a list field** matches when some element does, so `not` keeps the cards with an empty list, and an empty (or null, absent, all-null) list is `missing`, never `exists`. Both are spelled out, with the query that includes the missing cards, under [Filters](#filters).
- **A malformed relative date** on a date or date-time field (`now-3x`) is refused with `invalid-value`, in filters, range bounds and facet range bounds; on any other field it is text.
- **Expressions** in a query (a sort `expression`, with or without `top`, and a blend's expression signal) all run in SQL and are held to BXL's query profile, so the same expression is accepted or refused whatever rows the query finds.
- **Dates.** A stored date-time with no zone is read as UTC everywhere a query touches it: a `range` bound, a relative date, a facet `interval` and `NOW()` or `DAYS()` in an expression. Relative dates, `/unit` rounding, facet intervals and an expression's `TODAY()` and date parts are reckoned on the query's [time zone](#time-zones)'s calendar, UTC unless the query, its caller or its realm names one, and a week starts on Monday. A date is a calendar day in every zone. The browser's live matcher reckons relative dates in UTC, so when an answer reports another `meta.timeZone` it leaves a filter holding a relative date to the server.
- **Text order.** A text sort follows the database's collation. A result merged across realms orders text by the `en-US` collation with punctuation ignored, then byte order; it can differ from the database on leading punctuation, a space against a hyphen, symbols and non-Latin scripts, and from SQLite, which orders by bytes.
- **Ties.** Rows a sort leaves tied come back by card URL, then by row kind, so pages laid end to end hold every row once.
- **Across realms.** A merged search over realms that share the server's index runs as one search over all of them and is exact: it answers what one realm holding every realm's cards would. Merged from each realm's answer instead, counts add up; scores each realm computes over its own matches (blend, relevance, text relevance) compare only approximately, and a merged federated `blend` interleaves the realms' rows by position. Such an answer sorted by a score says so with the `approximate-order` warning; its ties are still broken the same way every time. `meta.federation.path` says which way a merged answer came.
- **One moment.** On Postgres every statement of one search reads the index as it stood when the first of them ran: its rows, `meta.page.total` and `hasMore`, its facets, its bindings, its comparison sets, its `near` reads and the passages of its page. A batch of index writes that commits while the search runs is in none of them or, for a search that starts after it, in all of them; a search never answers with rows from before a commit and a count from after. Two searches are two moments, so paging is not a snapshot: a row indexed between the reads of page 1 and page 2 shifts the later pages. On SQLite (the browser's index) a search's statements read the one connection as it stands when each runs.
- **Globs.** On Postgres `*` and `?` never cross a `/` and `**` always does, on every field; a glob is matched against the whole value, ignoring case. A file's text past its `content` cap matches no filter on `content` (see [What a file's `content` holds](#globs-pattern)).
- **Declarative.** The order members, operators, `every`/`any` children and `in` values are written in never changes the rows, their order or their counts, and neither does asking for facets, `explain` or a different `page.total` mode.

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

A refused query is answered with a 400 and `{ errors: [{ status, title, message, code }] }`, `code` being one of the codes under [Refusals](#refusals). On a card, `@context.searchResultsComponent` yields it to its block as `results.refusal` (`{ status, code, message }`), beside `results.errors`, and the realm's `meta.warnings` as `results.warnings`, so a card can say why it has no rows.

#### Checking a query without running it (`?validate`)

`QUERY <realm>/_search?validate` lowers and checks the body as a search would, and runs nothing. A query the search would accept is answered with a 200 and `{ meta: { valid: true, query, select? } }`: `query` is what the engine would receive, in the older spelling, with its type references resolved against the realm and the newer spelling's `page.total` written out. A query the search would refuse gets the same 400 a search gives. It checks what a search checks before it reads the index; a check that needs the realm's definitions or data (a quoted label's field, a `search: false` field, an unsynced log) is made only when the query runs. A log query (`from: { log }`) is refused with `invalid-value`: it is checked when it runs.

### Federated search

A `_federated-search` request names its realms in `realms`, all on the realm server it is sent to. `federation.results` chooses the shape of the answer:

- **`byRealm`** (the default): each realm's rows stay together, paged on their own, as the search sheet shows them in sections. `meta.sections` lists the sections in order, `{ realm, count, score? }`: under a sort that scores rows (relevance, blend, text relevance, `near`), by each realm's best score, with realms that matched nothing last; otherwise in the order asked.
- **`merged`**: one list, ordered by the query's own sort across realms (field sorts included), and paged once. A sort entry with no `direction` goes the way it does in one realm: scores (`expression`, `near`, blend, relevance, text relevance) highest first, fields lowest first. It is answered one of two ways, which `meta.federation.path` names:
  - **`union`**: when every realm the search reads is mounted on this server and they share its index database, the search runs once over all of them, as one statement over their rows inside one read snapshot. Everything is computed over the union of their matches: blend and relevance ranks, text relevance (with word statistics summed over the realms; see below), `near`, totals, facets, `collapse` (across realms: of the copies of one group, the higher-ranked one is kept, ties broken by card URL), expression sorts and `rerank`. So a union of realms A and B answers exactly what one `_search` over a realm holding A's and B's cards answers: the same rows, order, totals, facets and scores. It carries no `approximate-order` warning. Over one realm, the union is that realm's own search: a federated search naming one realm, merged or per realm, returns what `_search` on it returns, through the same engine path.
  - **`merge`**: otherwise (a realm that would not mount, realms on different index databases, a `let` binding read from a log, an expression sort comparing look-alikes with `compare.near`, or a `linkedFrom` under a realm policy), each realm is asked for its first `offset + size` rows, with the values it sorted them by, and the union is sliced to the page. Scores that each realm computes over its own matches (blend, relevance and text relevance) compare only approximately across realms. Under a `rerank`, rows order by their rerank value first, then by the query's sort. Over several realms, a merged answer sorted by a score (`blend`, `relevance`, text relevance, `near`, `expression`, in any sort entry) carries the `approximate-order` warning: the merge keeps each realm's scores as they are, so the order across realms is approximate, while rows the merge leaves tied still come back in one order every time. A field sort compares exactly and carries no warning.

On the union path, each realm's rows are admitted under that realm's own access, decided as for any search: every row of a realm the caller reads outright, and only the rows its grants admit of a realm the caller reaches through its policy (see [A result a policy scoped](#a-result-a-policy-scoped)). The union reads under one admission condition, `realm_url IN (<realms read outright>) OR (realm_url = <scoped realm> AND <its grants>) OR …`, applied to every read of the search (rows, totals, facets and their labels, bindings, comparison sets, near counts), so nothing it counts or ranks reaches a row the caller could not search for. Word statistics are combined by summing: a word's document frequency in the union is the sum of its frequency in each realm, and the union's row count the sum of theirs, which is exactly what one realm holding all the cards would count, since the realms' cards are disjoint. A realm whose statistics are not built yet leaves the union ranking by proximity until they are, as one realm does. When the caller reads some realm only through its policy, the union's word statistics and typo corrections come only from the realms they read outright, so a hidden card shapes no score. `near` compares every vector exactly on the union path (no approximate index read, which takes one realm's nearest candidates), and a target vector in a space some realm's vectors are not in is refused (`vector-space-mismatch`), naming that realm.

`meta.realms[realm].total` on the union path is how many of `meta.page.total` that realm holds, counted from the same conditions in the same snapshot (under `collapse`, the kept rows, each in the realm of the copy kept), so the realms' totals sum to the total; it is left out when the total is itself a bound (`total-estimated`) or not counted. The union is one statement, so it shares one deadline: the per-realm deadline below applies to the whole statement, and when it runs out every realm of the union reports `timeout`.

A search across several realms has no one realm for `$REALM/` to name, so a type written with it is refused there (`invalid-type`); name the module absolutely, by its URL or its `@scope/…` identifier. Over one realm, `$REALM/` is that realm.

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

`meta.realms` reports every realm asked, `{ status, code?, total?, ms? }`, where `status` is `ok`, `refused` (with the refusal `code`), `timeout` or `unavailable`. `ms` is the realm's whole part of the request, in milliseconds: mounting it when this request mounted it, and its search from the moment the fan-out asked for it until its answer was complete (rows, count, facets, link assembly and each entry's rendering). It leaves out only the merge and the response's serialization, which every realm shares. A realm that fails never fails the search; `meta.incomplete` is true when any realm did not answer `ok`. That includes a slow realm: each realm has its own deadline inside the request's time budget (the budget less a tenth of it, at most 2 s, kept for the merge), and a realm that has not answered by then is cut off and reported as `timeout` while the others' rows come back.

### Bounds every query runs under

These hold for every search, whoever runs it (a card's `getCards`, a query-backed field, the host's search pane, a `_search` or `_federated-search` request), with nothing to turn on:

- **A search whose client leaves stops.** When the connection of a `_search` or `_federated-search` request closes before its response is written, the search is cancelled in every realm it was running in: its SQL is cancelled in Postgres (`pg_cancel_backend`), and nothing else is computed for it. A result shared by identical requests in flight together (the live-search cache) is stopped only once every request waiting for it has gone.
- **A broad `matches` term ranks a capped candidate set.** A full-text term reads only the realm searched. Before a paged search runs, each positive `matches` term is probed: how many of the realm's cards it matches on its rendered page and in its fields, counting no further than the cap (`SEARCH_MATCH_CANDIDATE_CAP`, default 1,000). A term within the cap runs as written, so its rows and its total are exact. A term past it (a word nearly every card holds, like "card") takes at most the cap's worth of candidates from each side: its best field matches by rank vector (what a text-relevance sort ranks them by) and the first of the cards that hold it only on their page (which all rank at the same page-only floor). The rest of the query (other filters, the sort, facets, the page) runs over those candidates. Its `meta.page.total` is then the number of candidates that matched, a lower bound, and `meta.warnings` holds `total-estimated`; a federated answer carries it when any realm's does, naming those realms when not every realm gave it. The first page of a text-relevance sort is unchanged; a query sorted another way (say, newest first) orders the candidates rather than every match. A term under `not` is never capped. To count and order every match, ask for it: `page: { size: 20, exactTotal: true }`. Such a search is still held to the time budget.
- **A total is counted up to a cap.** A newer-spelling page's `meta.page.total` counts up to 1,000 matches (`SEARCH_TOTAL_CAP`) unless the query asks for `page.total: 'exact'` or is counts-only (`size: 0`); an older-spelling page counts exactly unless it asks for `capped` (see Pagination); past the cap it is a lower bound, with the `total-estimated` warning. Counting every match of a broad query costs a pass over all of them, for a number a list shows as "1,000+". Facet counts are unaffected.
- **A `matches` term with no word in it matches nothing.** A term made only of stop words and single letters or digits ("a", "the of", "x y") matches no card, and runs no full-text scan to find that out. Beside a real word, a stop word is dropped as before ("the brass" matches "brass"); a single letter beside a real word stays part of the query.
- **Short type-ahead and title substrings are bounded.** A type-ahead word over names (`prefix` with `scope: 'title'`) shorter than three letters already matches as a whole word unless a longer word narrows it, and its index lookup reads only the realm searched. A `contains` on `_title` or `cardTitle` of one or two characters has no trigram to narrow it, so it reads the realm's titles; when more of the realm's cards hold it than the candidate cap, it matches at most the cap's worth of them and the total is flagged as above (`page.exactTotal` counts them all).

### Refusals

A query the grammar refuses gets a 400 whose body carries a code a caller can act on, and a message naming the member, the nearest valid name where there is one, and what to write instead. The shape errors of the HTTP wire form carry a code too: a body that is not an object is `invalid-json` (`invalid-value` for a list), and a member of the wrong kind or shape (`realms`, `cardUrls`, `scope`, `fields`, a path without `item.`) is `invalid-value`.

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

| Code                                                             | Meaning                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown-key`                                                    | A member the grammar does not have; the message names the nearest real one.                                                                                                                                                                                                   |
| `unknown-field`                                                  | A field the type does not have, with the nearest field.                                                                                                                                                                                                                       |
| `invalid-value`                                                  | A member has the wrong kind of value, or one out of range.                                                                                                                                                                                                                    |
| `missing-member`                                                 | Something the query needs is absent.                                                                                                                                                                                                                                          |
| `conflicting-members`                                            | Two members that cannot go together.                                                                                                                                                                                                                                          |
| `limit-exceeded`                                                 | More of something than a query may have (signals in a blend, bindings, facets).                                                                                                                                                                                               |
| `invalid-nesting`                                                | Something placed where it cannot go.                                                                                                                                                                                                                                          |
| `invalid-type`                                                   | A type reference that names no card type: a shorthand with no `#` or name, a module that names none (an `@scope/…` identifier under a prefix no realm or package on the server is registered at, naming no type it can read, among them), or `$REALM/` across several realms. |
| `needs-type`, `sort-needs-type`                                  | A path that needs a type, from `type` or an `on`.                                                                                                                                                                                                                             |
| `mixed-spelling`                                                 | An author's query in the newer spelling that names its type the older way, with `on` on its top filter node; the message gives the rewrite (`{ "type": T, … }`). Refused where the author's query arrives (see Compatibility), not by the server.                             |
| `needs-declaration`                                              | A field or type lacks a declaration the feature needs, such as `search: { neighbors: true }`, or `search: { facet: true }` for a facet.                                                                                                                                       |
| `needs-postgres`                                                 | A feature the SQLite index cannot run.                                                                                                                                                                                                                                        |
| `matches-required`                                               | A text-relevance sort with no `matches` filter to score.                                                                                                                                                                                                                      |
| `engine-only`                                                    | A member only the engine sets.                                                                                                                                                                                                                                                |
| `invalid-expression`, `expression-placement`, `unknown-function` | An expression that is not a string, steps outside BXL's query profile (the message names the construct), is placed where it cannot go (an entry with `top` that is not the first, `peers.` or `stats.` without `top`), or calls a function BXL does not know.                 |
| `expression-unsupported`                                         | An expression BXL's score profile (SQL) cannot express: a text, regression or other function outside it, a value that is text, or `peers.` in arithmetic. The message names what.                                                                                             |
| `binding-kind`                                                   | A binding read as the wrong kind: `"$card"` alone or a path on a list, or a list anywhere but an `in`. (A string naming no declared binding is text, so it is never refused for that.)                                                                                        |
| `vector-space-mismatch`                                          | A `near` target in another vector space than the field is declared in.                                                                                                                                                                                                        |
| `policy-linked-from`                                             | A `linkedFrom` where a realm policy cannot scope it.                                                                                                                                                                                                                          |

A name the query's type does not declare, in an `expression`, is refused with `unknown-field` only when no card of that type in the realm holds a value there: an expression over a base type still reads its subclasses' fields. A query anchored on no type, or on the base card type, reads any search-doc name. A facet's `by` or `measure` must be a declared facet (`needs-declaration` otherwise, see [Declaring a facet](#declaring-a-facet)); over a base type or no type it counts the fields the matched cards' own types declare. A filter on a field declared `search: false` (or inside one) is refused with `needs-declaration`, since the index does not hold it. A regular expression Postgres cannot compile is refused with `invalid-value` (`limit-exceeded` when it is too complex). A rerank whose formula would build a value too large to hold is refused with `limit-exceeded`, and one calling a function BXL lacks with `unknown-function`.
| `invalid-page`, `invalid-json`, `invalid-filter` | A malformed page, body or filter node (`invalid-filter`: an `exists`, `missing` or bare anchor misused). |
| `not-selectable`, `select-excludes-fields` | A `select` path the index does not carry, or `select` beside `fields`. |

### Limits

A query past one of these is refused with `limit-exceeded`. A query in the newer spelling is held to the first column, far past what an app asks for. A query in the older spelling keeps reading as it always did, and is refused only where the database failed on it before (the second column).

| What                                                              | Newer spelling                                           | Older spelling                       |
| ----------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Nesting: objects and lists inside one another, the query included | 512 (a filter of `every`, `any` or `not` about 250 deep) | 2,048 (about 1,000 deep)             |
| Values in one `in` list                                           | 10,000                                                   | 65,000 (Postgres binds 65,535)       |
| Characters in a `matches` term                                    | 10,000                                                   | 99,999                               |
| Entries in `sort`                                                 | 64                                                       | 800 (Postgres selects 1,664 columns) |

Members that came with the newer grammar have one limit in both: an `expression` of at most 200 parts of its syntax tree (each number, field, operator and call is a part, so about 100 terms joined by operators) and 2,000 characters, the parts being the limit that binds first (`limit-exceeded` past either); 8 signals in a `blend`, 8 facets and 8 fields beside `matches`; 50 ranges in a facet; 4 `let` bindings, each reading at most 10,000 rows into a list of at most 10,000 values (cut past that, with `binding-truncated`); 64 `select` columns.

**The query expression profile.** An expression in a query (a sort `expression`, with or without `top`, or a blend's expression signal) runs under BXL's `query` profile, in both spellings and wherever it is placed. It may use spreadsheet functions (`NOW()` and `TODAY()` among them, which read the query's one instant), arithmetic, comparisons, `AND`/`OR`/`NOT`, `&`, field paths (`stats.` and `peers.` in a rerank, a `let` binding's name), and names it binds itself with `LET`. It is refused with `invalid-expression`, the message naming the construct, when it uses a jq pipe (`|`), a stream (`.tags[]`), string interpolation, an object constructor, `def`, `reduce`/`foreach`, an update (`|=`, `+=`), `try`, `label`/`break`, a format (`@base64`), the alternative operator `//`, a free variable (`$ENV`, `$__loc__`), a request or environment context path (`@User`, `@Env`), a call that reads the runtime, the request or the environment (`env`, `input`, `inputs`, `debug`, `error`, `params`, `actor`, …), or `import`/`include`. A bare name is a field, as in a spreadsheet, so a field called `input` is read, not called. Full BXL stays for a card's computed fields.

Some values have a range rather than a count, and are `invalid-value` (`invalid-page` for the page) outside it: `page.number` is a whole number from 0 to 1,000,000,000; a blend's `k` a whole number from 1 to 1,000,000; each component of a `near` target a finite number no larger than 1,000,000,000 either way. A query is plain JSON data: a value or a member name holding a null character or a lone surrogate (text no index can store) is `invalid-value`, a number that is not finite is `invalid-value`, and from an in-process caller a getter, a function, a cycle or any object that is not a plain object or list is `invalid-json`. A relative date that moves past the last date a clock can name (`now+99999999y`) is `invalid-value` when the query runs. A type reference's `module` must be a URL, an `@scope/…` identifier or `$REALM/<path>` (`invalid-type`); `$REALM/` resolves against the query's realm where the request arrives, and is refused across several realms. A code ref relative to a module (`./`, `../`) is left for its caller to resolve; the shorthand takes no relative module.

### Compatibility: older and newer spellings

The rule: a saved query keeps returning what it returns today. A query in the older spelling is read as it always was, with no rewrite; a query in the newer spelling is checked strictly.

**The older spelling is frozen.** It is a compatibility layer for the queries saved before the newer spelling, and nothing more:

- **Exactly main's grammar.** The older spelling is the grammar main had: `filter` (`eq`, `in`, `contains`, `range`, a string `matches`, `type`, `any`, `every`, `not`, each with `on`), `sort` (`by`, `on`, `direction`), `page` (`number`, `size`, `generation`), and `realm`, `realms`, `queryString`, `fields`, `asData`. An older query runs as written, with `{ by: '_matchRelevance' }` the text-relevance sort it always was. Every newer-spelling query lowers to the engine's form (below), which is main's grammar plus the V2 members.
- **Lenient.** It keeps the leniency it always had (the table below), and keeps the older limits where they were looser (see [Limits](#limits)). No new strictness applies to it.
- **Main's answers.** It returns what it returned before Query V2, except for the answers listed below that were wrong, and the documented changes to `matches`, which is interactive text search.
- **No new features.** Everything Query V2 added exists only in the newer spelling, and a query that uses any of it is the newer spelling, read strictly as a whole, with the newer page default (`total: 'capped'`). That covers the new spellings (a top-level `type`, `blend`, `expression`, `boost` and `relevance` sorts, `textRelevance`, `item.` paths, quoted labels) and the new members: `let`, `facets`, `collapse`, `select`, `explain`, `timeZone`, `page.total` and `page.exactTotal`, and the filter operators and options `exists`, `missing`, `near`, `linkedFrom`, `pattern`, `regex`, an object `matches` and its `fields`, `within`, `prefix`, `typos` and `scope`. A feature added from now on is newer-spelling only.

What the older spelling ignores, and never refuses: an unknown member inside a filter node, a sort entry or `page` (`page.cursor`); `page.generation`. What it refuses is only what it always refused (an unknown top-level member, a filter node with no operator, a malformed value), plus what no older query could hold: the drafts' internal sort keys and the top-level `rerank` (`unknown-key`, below), and a query past the limits a database can read (`limit-exceeded`).

So an older query that adds `facets` (or any V2 member) beside its `on` anchors is a newer query from then on: an unknown member it holds, such as `page.cursor`, is refused rather than ignored, and a page that names no `total` counts to 1,000. Its type goes at the top: where an author's query arrives, a newer-spelling query that names its type with an `on` on its top filter node, `{ filter: { on: T, eq: … }, facets: … }`, is refused with `mixed-spelling` and the rewrite, `{ type: T, filter: { eq: … }, facets: … }`. Those places are the host's card searches (`getCards`, `@context.store.search`), the AI assistant's search tools, and a query-backed field's definition. An `on` that anchors one node (inside `any` or `every`, on a sort entry, a facet or `collapse`) is the newer spelling's own and stays. The realm server does not refuse the mixed form: the engine's own form, which every newer query lowers to and which the host sends over the wire, is main's grammar plus the V2 members with `on` on every node, and the server cannot tell it from an author's. What the server enforces is the strict reading of the newer spelling, which such a query gets either way.

A query is in the newer spelling when it holds anything main's grammar did not: a top-level `type`, any V2 member listed above, a filter node that is only `{ on }`, a `blend`, `expression`, `boost` or `relevance` sort, a `textRelevance` sort, or a path written with `item.` or as a quoted label (in itself or in a `let` binding's query). An unknown member is not a V2 member: main ignored one inside a filter node, a sort entry or `page`, and the older spelling still does.

| In the older spelling                                                                               | In the newer spelling                                     |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| An unknown member inside a filter node, a sort entry or `page` is ignored (`page.cursor`, for one). | Refused, `unknown-key`, with the nearest real name.       |
| A negative `page.size` is read as the default.                                                      | Refused, `invalid-page`.                                  |
| `{ by: '_matchRelevance' }` sorts by text relevance.                                                | The same; `textRelevance` is the newer name.              |
| A `page` that names no `total` counts every match (`exact`), as it always did.                      | Counts to 1,000 (`capped`); `size: 0` counts every match. |

A type written as its shorthand (`"<module>#<Name>"`) or with a `$REALM/` module is read in both spellings, and it does not make a query the newer spelling: it reads as the code ref it stands for, and an older query that adopts it is still read as the older spelling. Before the shorthand, a string where a type goes was refused in both, so no saved query changes its answer.

In both, an unknown top-level member is refused, and so is an unknown member of an expression sort entry, `collapse`, a `let` binding, a facet, a blend or a `near` value. A search that names no page gets 100 rows from a card search and 500 from the server in both. Every newer-spelling query lowers (`lowerQuery` in `packages/runtime-common/query-syntax.ts`) to exactly the older-spelling query it means, and runs the same SQL; tests pin that each answers alike.

Some answers did change, because the old ones were wrong. A `not` over a list field used to return every card of the type, including the cards the inner filter matched; it now returns the cards with no matching element. A `range` over a list of numbers used to compare them as text. Two filters on the same list path under one `every` (`every: [{ eq: { tags: 'red' } }, { eq: { tags: 'blue' } }]`, or a caller's filter and a realm policy's grant that both test `teacherIds`) used to need one element to satisfy both, so they found nothing; each is now its own test of the card, and the cards tagged both are found. A `contains` value holding `%` or `_` used to match them as wildcards; it now matches the characters as written. A list filter over strings that hold a quote, a backslash or a newline used to miss them (the list's values were read with their JSON escapes); it now matches them. A stored date-time with no zone used to be read in the database session's zone, so on a server whose session zone is not UTC a date range or a relative date could shift; it is now read as UTC everywhere a query touches it. See the list-field rules under Filters and Dates under the evaluation rules.

Drafts of the newer spellings used the engine's internal sort keys. A request or a query-backed field that uses one is refused (`unknown-key`), with a message naming the key and where it is. Rewrite it as:

| Old                                       | New                                  |
| ----------------------------------------- | ------------------------------------ |
| `{ by: '_blend', of: [...] }`             | `{ blend: [...] }`                   |
| `{ by: '_expr', expr: '…' }`              | `{ expression: '…' }`                |
| `{ by: '_when', when: <filter>, weight }` | `{ boost: <filter>, weight }`        |
| `{ by: '_relevance', … }`                 | `{ relevance: true \| { weights } }` |
| `{ "$let": "name" }`                      | `"$name"`, declared as `$name`       |
| `{ "$let": "name", "path": "path" }`      | `"$name.path"`                       |

`{ by: 'textRelevance' }` is the newer name for `{ by: '_matchRelevance' }`; both work, and the per-result response field `meta._matchRelevance` keeps its name.

Earlier V2 drafts called an expression `formula` (a sort key) and `expr`, chose where it ran with `placement`, and re-ranked with a top-level `rerank: { expression, top, compare }`. All are refused now (`unknown-key`, with the spelling to write): write `expression`, the same word cards use in `computeVia: expression(…)`, and re-rank with the sort entry `{ expression, top, compare }` first in `sort`.

### A result a policy scoped

Permissions apply to a whole realm, and a realm policy only widens them, for a caller the permissions would refuse ([ADR 006](adr/006-grant-realm-permissions-per-realm-and-widen-them-only-with-a-policy.md)). A caller who can read a realm searches all of it; a caller who can't sees only the rows the policy's grants admit, and every binding, comparison set and `select` value is scoped the same way.

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

## Where it lives in the code

| Piece                                                       | File (under `packages/`)                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Types, `assertQuery` and every grammar refusal              | `runtime-common/query.ts`                                                                                       |
| Newer spelling, lowering and labels                         | `runtime-common/query-syntax.ts`                                                                                |
| Engine sort keys authors may not write (`_blend`, `_expr`…) | `runtime-common/internal-sort-keys.ts`                                                                          |
| The HTTP wire grammar, `select`, federation and the merge   | `runtime-common/search-entry.ts`                                                                                |
| The engine's public class and the module map                | `runtime-common/index-query-engine.ts`                                                                          |
| The evaluation order (`_search`)                            | `runtime-common/query-engine/search-pipeline.ts`                                                                |
| SQL for filters (pass 1) and field paths (pass 2)           | `runtime-common/query-engine/filter-compiler.ts`, `expression-resolver.ts`                                      |
| Text search, typos, word statistics, passages               | `runtime-common/query-engine/text-search.ts`                                                                    |
| Sorts, relevance, blends; windows (`top`)                   | `runtime-common/query-engine/sort-order.ts`, `sort-window.ts`                                                   |
| Facets, `let`, pages and totals, `select`                   | `runtime-common/query-engine/facets.ts`, `bindings.ts`, `paging.ts`, `columns.ts`                               |
| What Postgres runs and SQLite does not                      | `runtime-common/query-engine/dialect.ts`                                                                        |
| Every query member, its spelling and description            | `runtime-common/query-grammar.ts`                                                                               |
| `near` search and its exact or HNSW path                    | `runtime-common/vector-query.ts`                                                                                |
| Expressions in SQL (the score profile)                      | `runtime-common/formula-sql.ts`, `bxl/src/bxl/sql/score.ts`                                                     |
| Page sizes, total and candidate caps, time budget           | `runtime-common/search-bounds.ts`                                                                               |
| The schema the AI assistant's search tools send the model   | `runtime-common/helpers/ai.ts` (`QueryField`), used by `host/app/tools/search-cards.ts` and `search-entries.ts` |

Tests that pin the guarantees on this page, in `realm-server/tests/`: `query-evaluation-order-integration-test.ts` (evaluation order), `query-declarative-order-integration-test.ts` (sets and sequences), `query-edge-cases-integration-test.ts` and `query-invariants-integration-test.ts` (missing values, list fields, ties, pages, totals), `query-refusals-test.ts` and `query-error-codes-test.ts` (refusals and codes), `query-recorded-gaps-integration-test.ts` (known gaps, and rules pinned but not yet decided), `cross-realm-search-cases-test.ts` (federation), `ranking-edge-cases-integration-test.ts`, `text-search-cases-integration-test.ts` and `vector-search-test.ts`. A change that alters what one of them pins changes what saved queries return, and needs a decision first.
