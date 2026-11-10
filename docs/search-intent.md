# Search intent

A card author says what each field is and how people look for it. The index
derives everything else from that: how a field ranks in full-text search,
what it suggests while someone types, how it is counted in a facet, and what
a `relevance` sort blends in. Authors never name an index, a weight letter,
or a storage choice. The framework can change those without touching a card.

This page is the reference for the field options, the card-level defaults, and
the query features that read them. Query basics are in [Search](search.md).

## For card authors

- **Nothing is required.** Every option is optional, and every field type has a
  default (see [Defaults](#defaults)). A card with no `search` options is
  searchable, ranked by its type's defaults.
- **Add a hint when the default is wrong for the field's meaning:** a string
  that is really an id (`role: 'identifier'`), a text field that should rank
  low (`role: 'note'`), a number that says how popular a card is
  (`rank: 'popularity'`), a field people filter a list by (`facet: true`), or a
  field that should not be searchable at all (`search: false`).
- **Queries get shorter.** With hints in place, a search pane is
  `{ matches: q }` sorted by `{ relevance: true }`, a shelf is a `relevance`
  sort with signal weights, and facets come back labeled and bucketed, with no
  hand-written `blend` sorts or id-to-name lookups.
- **Write the intent, not the mechanism.** If you find yourself wanting an
  option that names how something is stored, that's a gap in this vocabulary.
  Raise it rather than work around it.

## Field options

Every option goes in the field's `search` member. Options are checked where
the field is declared, so a misspelled role or option fails the module:

```ts
@field event = contains(StringField, { search: { role: 'label', facet: true } });
```

| Option      | Values                                                                                         | Says                                                   |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `role`      | `title`, `name`, `alias`, `summary`, `keywords`, `label`, `body`, `note`, `identifier`, `code` | What this text is to the card                          |
| `facet`     | `true`, or `'values'`, `'range'`, `'date'` to override the shape                               | People narrow results by this field                    |
| `rank`      | `popularity`, `recency`, `quality`, `priority`                                                 | This number or date says how good or fresh the card is |
| `typos`     | `true`                                                                                         | A misspelling should still find it                     |
| `patterns`  | `true`                                                                                         | People search it with wildcards or patterns            |
| `include`   | field names of the linked card (links only)                                                    | Which of the linked card's fields describe this card   |
| `neighbors` | `true` (on a `VectorField`)                                                                    | Each card is compared with its own look-alikes         |
| `search`    | `false` (instead of an object)                                                                 | Don't index this field                                 |

The validator also accepts `chunks`, `appendOnly` and `language`. They have no
effect on indexing.

### `role`

A role sets the weight its words carry in full-text ranking. The render
groups the card's words by tier, and the index stores them as a weighted
full-text vector beside the rendered markdown's (which ranks lowest), so a
word in a title outranks the same word repeated in a long body. A compound
field's role passes to its subfields that declare none.

| Role         | Ranks      | Also                                                   |
| ------------ | ---------- | ------------------------------------------------------ |
| `title`      | top        | Type-ahead reads the card's title                      |
| `name`       | top        | A person's or thing's name                             |
| `alias`      | top        | Another name the card goes by                          |
| `summary`    | high       |                                                        |
| `keywords`   | high       |                                                        |
| `label`      | high       | A value from a small set (a category, a status)        |
| `body`       | low        |                                                        |
| `note`       | low        |                                                        |
| `code`       | low        | Searched by pattern (`pattern`, `regex`) by default    |
| `identifier` | not ranked | Kept out of the full-text vectors; searched by pattern |

A field with no role is plain text, ranked between the high and the low
roles. Every field stays filterable by value (`eq`, `in`, `range`) whatever
its role.

### `facet`

`facet: true` takes its shape from the field's type: a string, a list of
strings or a link gives values with counts; a number gives range buckets with
stats; a date gives a histogram with stats; a boolean gives true and false
with counts. A link's value is the linked card's id, with the card's title
beside it as `label` when the search could return that card itself. Use
`'values'`, `'range'` or `'date'` only to override the shape, for example
`facet: 'values'` on a 1–5 rating, or `facet: 'date'` on a number that holds
a timestamp. A number facet with no `ranges` gets up to ten buckets of a
round width across its values' span. A date may be an ISO date string or a
number of seconds or milliseconds since the epoch; its histogram is monthly
unless the query names an `interval`.

### `rank`

A ranking signal for the `relevance` sort (see [Ranking](#ranking)).
Several fields may share a signal; the card-level `rank` names the main one.

### `include`

On a `linksTo` or `linksToMany`, the linked card's fields to copy into this
card's search doc, for example `include: ['name']`. Fields not listed stay
with the linked card, so a card with many links keeps a small search doc.

The link keeps its id beside the included fields: `topics: [{ id, name }]`.
A filter may cross the link into an included field (`topics.name`) or its
`id`, and a `select` may read them. Any other path through the link is
refused, since the search doc doesn't carry it. A result or facet value
renders the linked card by its prerendered HTML, by id, so a search never
hydrates linked cards to display them.

Only the indexed card's own links include, one level deep. The included
values are the linked card's as it indexes them, and the linked card is a
dependency, so renaming it reindexes the cards that link to it.

### `neighbors`

On a `VectorField`, `neighbors: true` keeps a nearest-neighbor index of its
vectors, so a `rerank` can compare each card with its own look-alikes
(`compare.near`). A vector field without it still answers `near` searches,
exactly, with no index to maintain on every write.

### Large values

On Postgres, when a card's search doc is large, the index writer moves each
large value (a long string, a long list) out of the row into a side table.
Filters still see it. A short list at the top of the doc stays inline, so
list filters keep their index. Authors declare nothing for this.

### Without any hints

Every card is searchable without a single hint, and the search pane stays
fast on any realm, whatever its cards hold:

- **Field words come from defaults.** The title and `cardInfo.name` rank
  top; `summary`, `keywords` and alternative names high; every other text
  field in the middle; TextArea and Markdown fields as body.
- **Type words.** A card's type name and its ancestors' names are words of
  the card, at summary weight, and part of its type-ahead text: "alice
  employee" finds the Employee titled Alice though "employee" is nowhere in
  its data.
- **Matching reads the full words, ranking a small vector.** Every field word
  is in the card's match vector, and its rendered page is in another.
  Ranking reads only the card's rank vector: titles, names and aliases;
  summaries, keywords, labels and type names; and the start of plain and body
  text, capped to stay inline in the row. Ranking thousands of matches never
  reads a large value.
- **Type-ahead ranks by title.** A `typeahead` term ranks the title that is
  what was typed first, then titles that start with it, then titles with
  every typed word as a word prefix, then matches through alternative names
  or type words; the rank vector orders within a tier. The pane's Relevance
  sort (`{ by: 'textRelevance' }`, then the most recently changed) is its
  default whenever there is a term.
- **Exact by default.** The pane matches whole stemmed words, word prefixes in
  type-ahead, and title substrings. Typo tolerance (`typos`) is a UI's
  opt-in, never the pane's default.

## Card-level defaults

```ts
class Talk extends CardDef {
  static searchDefaults = {
    title: 'talkTitle', // the field with role 'title', when it isn't cardInfo.name
    rank: { popularity: 'views', recency: 'lastWatched' },
    wordStatistics: true,
  };
}
```

The member is `searchDefaults`, not `search`: a card may already declare an
`@operation static search` (a saved search). A subclass's `searchDefaults`
merges over its parent's, member by member, and `rank` signal by signal.

- `title` gives the named field the `title` role.
- `rank` names the main field for each signal.
- `wordStatistics: true` keeps per-word counts for the type's cards, so its
  text relevance weighs rare words above common ones, saturates repetition and
  normalizes for length. Without it a type ranks by word proximity. It is
  opt-in because the realm maintains the counts.

## Defaults

| Field type                                  | Default                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `cardInfo.name`                             | `role: 'title'`                                                                   |
| `cardInfo.alternativeNames`                 | `role: 'alias'`                                                                   |
| `cardInfo.summary`                          | `role: 'summary'`                                                                 |
| `cardInfo.keywords`                         | `role: 'keywords'`, `facet: true`                                                 |
| `cardInfo.notes`                            | `role: 'note'`                                                                    |
| `cardTitle`, `cardDescription`              | `role: 'title'`, `role: 'summary'`                                                |
| `StringField` (and lists of it)             | Plain text, ranked between high and low                                           |
| `TextAreaField`, `MarkdownField`            | `role: 'body'`                                                                    |
| `CSSField`                                  | `role: 'code'`                                                                    |
| `EmailField`, `PhoneField`, URL fields      | `role: 'identifier'`                                                              |
| `MaybeBase64Field`, `CssImportField`        | `role: 'identifier'`                                                              |
| `NumberField`, `DateField`, `DateTimeField` | Filterable and sortable; no signal, no facet                                      |
| `BooleanField`                              | Filterable                                                                        |
| `VectorField`                               | Found by similarity (`near`)                                                      |
| `PassageField` lists                        | Searched passage by passage (`matches … within`), never in the card's own vectors |
| `linksTo`, `linksToMany`                    | Filterable by id; nothing included                                                |

## Precedence

When options conflict, the first of these wins:

1. The field's own `search` option, including one redeclared in a subclass.
2. The card's `static searchDefaults.title`, nearest class first.
3. The role of a containing field (a `containsMany` of segments declared
   `role: 'body'` makes each segment's text body text).
4. The default for the field's type (a field type's own `static
searchDefaults`).
5. The platform's own keys (the title, `_typeahead` and the other underscore
   keys), which no option changes.

`search: false` beats everything below it. A subclass turns a field back on
by redeclaring it. A card's `id` and `cardTitle` stay in the search doc
whatever they declare.

## Passages and vectors

A card holds its passages (a transcript's segments, a book's chapters) as a
`containsMany` of a `PassageField` subclass, which carries `start`, `end` and
`text` and whatever else a passage needs, such as an embedding. The index
keeps each passage's text searchable on its own. `{ matches: '…', within:
'segments' }` finds the card by any passage, ranks it by its best passage,
and reports the passages that matched in `meta.passages`.

A card's embedding goes in a `VectorField`. The caller embeds the query and
passes the vector as `near`: to a `near` sort or filter, or beside a
`relevance` sort, which then blends similarity in as the `meaning` signal.
See [Vector search](search.md#vector-search-near).

## Queries

These read the options above. Every member is optional.

### Ranking

| Syntax                                                             | Does                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `sort: [{ relevance: true }]`                                      | Text relevance by role, blended with the declared `rank` signals |
| `sort: [{ relevance: { text, popularity, recency, meaning, … } }]` | Re-weights signals by name; a negative weight inverts one        |
| `sort: [{ relevance: true, near: vector }]`                        | Adds similarity as the `meaning` signal                          |
| `sort: [{ blend: [...] }]`                                         | Full control: any fields, any direction (reciprocal rank fusion) |

A `relevance` sort reads the declarations of the type in its `on`, or else the
type the filter is anchored on. It compiles to a `blend` of: text relevance,
when the filter has a positive `matches` term; the first field of each
declared `rank` signal (the card's `searchDefaults.rank` choice first); and,
given `near`, the type's first `VectorField` as `meaning`. Default weights are
`text: 1`, `meaning: 1`, and `0.5` for each rank signal; `0` drops a signal.
Each result carries the fused score in `meta._blendScore`. A `relevance` sort
with nothing to rank by (no term and no declared signal) is refused. A `blend`
cannot contain a `relevance` sort. See [Relevance](search.md#relevance-relevance)
and [Blended ranking](search.md#blended-ranking-blend).

### Text

| Syntax                                       | Does                                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `{ matches: 'crdt' }`                        | Full-text search, ranked by role                        |
| `{ matches: 'crdt', prefix: true }`          | The last word matches as a prefix                       |
| `{ typeahead: 'kleppm' }`                    | Type-ahead over titles and alternative names            |
| `{ matches: 'kleppman', typos: true }`       | Typo-tolerant                                           |
| `{ matches: 'crdt', scope: 'title' }`        | Only title, name and alias roles                        |
| `{ matches: 'metal', fields: ['material'] }` | Only the values of these fields                         |
| `{ matches: '…', within: 'segments' }`       | Passage search, reported in `meta.passages`             |
| `{ pattern: { slug: 'intro-*' } }`           | Glob, on fields with `patterns` or an `identifier` role |
| `{ regex: { slug: '^intro-' } }`             | Regex, on the same fields                               |

A card matches by its rendered markdown or by its fields' role-weighted words,
so a field the card doesn't render still matches. With `prefix`, the word
still being typed matches as a prefix only against the card's field words;
against the rendered page it matches whole. A page carries its template's own
words (a heading on every card of the type), so a prefix there would match
every card of the type, and a prefix scan over every rendered page in the
realm is slow. Words are stemmed in English: Postgres keeps some acronyms
whole, so `crdt` doesn't match "CRDTs" (`prefix` or `typos` covers that).

The member is `scope`, not `in`: `in` is the membership filter operator, and a
node holding both would read as two operators.

`typos` widens each word to the closest words of the realm's word list, which
holds every card's title and alternative names (its type-ahead text) and the
words of fields declared `typos: true`. Trigram similarity nominates
candidates; a correction is kept only within the word's edit budget (none
under four letters, one edit up to seven, two from eight; a swapped pair of
letters is one edit), and a word the list already holds is matched as typed.
Every word must still match, as one of its alternatives.

`{ typeahead: 'ownrship in prac', typos: true }` does the same for
type-ahead: each word keeps its prefix match and also matches its
corrections whole, so a fully typed misspelling finds the word it meant.

`pattern` is a glob over the field's whole value, ignoring case: `*` is any
run of characters and `?` one character. `regex` is a POSIX regular
expression, Postgres's `~`, case-sensitive. Both are refused on a field that
isn't searched by pattern (`patterns: true`, or an `identifier` or `code`
role, including the Email, Phone and URL defaults), and both use a trigram
index over the pattern fields' values to narrow the rows first.

On SQLite (the browser index the host tests use), `typos` matches the words as
typed, `matches` reads the markdown alone, and `regex` is refused.

A card indexed before its type's rank vector existed ranks lowest, and has no
pattern values or listed words, until it is reindexed.

### Facets

A facet is `facets: [{ by, size }]`; counts come back in
`meta.facets[by]`, stats and totals in `meta.facetStats[by]`.

| Member                                           | Does                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| `by`, `size`                                     | Values with counts, top first                             |
| `own: 'ignore'`                                  | Counts the facet without its own selection (multi-select) |
| `stats: true`                                    | Min, max, average, sum and distinct count                 |
| `measure: { sum \| avg \| min \| max: path }`    | A metric per value                                        |
| `interval: 'day' \| 'week' \| 'month' \| 'year'` | Date histogram                                            |
| `ranges: [{ to }, { from, to }, { from }]`       | Range buckets                                             |
| `prefix: 'kle'`                                  | Only values starting with it (searching a facet's values) |
| `missing: true`                                  | Adds the count of matches with no value                   |
| `order: 'count' \| 'value' \| 'measure'`         | Value order                                               |

A faceted field's declared shape applies when the query names none of
`stats`, `interval` or `ranges`. On Postgres, a paged search counts a plain
values facet in the page's own statement; a facet with any other member, or a
declared range or date shape, runs its own queries over the same match set.
`own: 'ignore'` leaves out every filter node that constrains only `by`
(keeping its type anchor). Range labels are `key`, or `from-to` with `*` for
an open end; date buckets are labeled by their first day (weeks start on
Monday, in UTC). `meta.facetStats[by]` holds `count` and `distinct`, then
`values`, `min`, `max`, `sum` and `avg` over numbers or `min` and `max` over
text, `missing` when asked, and `order` when the counts are not sorted by
count. Across realms, counts add up, and `meta.facetErrors[by]` bounds how far
any merged count may be short. See [Facets](search.md#facets).

### Results

| Syntax                       | Does                                                      |
| ---------------------------- | --------------------------------------------------------- |
| `meta.page.total`            | Exact total; paged searches count in the page's statement |
| `collapse: { by, on, keep }` | The best `keep` results per value; totals count groups    |

See [Collapsing to one per group](search.md#collapsing-to-one-per-group-collapse).

## Example: a library of recorded talks

```ts
export class TranscriptSegment extends PassageField {
  @field speaker = contains(StringField);
}

export class Talk extends CardDef {
  static searchDefaults = {
    title: 'talkTitle',
    rank: { popularity: 'views', recency: 'lastWatched' },
  };
  @field slug = contains(StringField, {
    search: { role: 'identifier', patterns: true },
  });
  @field talkTitle = contains(StringField, { search: { role: 'title' } });
  @field event = contains(StringField, {
    search: { role: 'label', facet: true },
  });
  @field abstract = contains(StringField, {
    search: { role: 'summary', typos: true },
  });
  @field speakers = containsMany(StringField, {
    search: { role: 'name', facet: true, typos: true },
  });
  @field duration = contains(NumberField, { search: { facet: true } });
  @field views = contains(NumberField, {
    search: { rank: 'popularity', facet: true },
  });
  @field lastWatched = contains(NumberField, {
    search: { rank: 'recency', facet: 'date' },
  });
  @field editorNote = contains(StringField, { search: { role: 'note' } });
  @field recordingPath = contains(StringField, { search: false });
  @field segments = containsMany(TranscriptSegment);
  @field topics = linksToMany(() => Topic, {
    search: { include: ['name'], facet: true },
  });
}
```

A search pane over these is:

```js
{ filter: { on: Talk, matches: q }, sort: [{ relevance: true }], page: { size: 20 },
  facets: [{ by: 'event', own: 'ignore' }, { by: 'duration' }, { by: 'topics' }] }
```

Titles and speakers outrank abstracts, popular and recently watched talks
rise, the event list keeps its other values while one is picked, duration
comes back as buckets, and topics come back as ids labeled with their titles.
A misspelled speaker still matches with `typos: true` on the term. To find the
moment in a talk where something was said, search its passages:

```js
{ filter: { on: Talk, matches: q, within: 'segments' }, sort: [{ relevance: true }] }
```

`meta.passages` lists, for each result, the segments that matched with their
`start` and `end`, so the player can open at that moment.
