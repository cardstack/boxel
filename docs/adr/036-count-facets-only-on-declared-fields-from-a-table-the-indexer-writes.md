---
status: proposed
date: 2026-11-10
scope:
  - packages/base/card-api.gts
  - packages/base/field-support.ts
  - packages/runtime-common/facet-declarations.ts
  - packages/runtime-common/search-intent.ts
  - packages/runtime-common/index-writer.ts
  - packages/runtime-common/facet-index.ts
  - packages/runtime-common/query-engine/facets.ts
  - packages/runtime-common/query-engine/facet-sql.ts
  - packages/runtime-common/realm.ts
  - packages/runtime-common/helpers/ai.ts
  - packages/postgres/migrations/*facet*.js
  - docs/search.md
  - docs/search-intent.md
---

# 036. Count facets only on fields a type declares, from a table the indexer writes

A facet counts the matches of a search by a field's values. Counting by
reading every match's search doc scales with the number of matches and
re-parses each document, and it lets any query count any path, including
ones no author meant to expose. So a field becomes facetable only when its
type says so, with `search: { facet: true }`, and the indexer writes one row
per facet value into a side table that the search counts. The built-in
facets (card type, realm, created, modified) are declared on the base types
with the same syntax, so the engine has no list of its own. The members and
the declaration are in [Search](../search.md#facets) and
[Search intent](../search-intent.md#facet).

## 1. Decision

### 1.1. A facet is a declared capability

A facet MUST name a field whose type declares `search: { facet: true }`, a
sub-field a compound field type marks as facetable, or an index field that a
base type declares in `static indexFields`. Any other path MUST be refused
with `needs-declaration`, and the message MUST give the declaration to add.
The declaration MUST be a boolean: the bucket shape (values, ranges, date
intervals, stats) comes from the field's type and the query, never from the
declaration.

### 1.2. Built-in facets are declarations on the base types

The card type, the realm, `createdAt` and `lastModified` MUST be facetable
through declarations on `BaseDef`/`CardDef` and `FileDef`, read by the engine
like any author's declaration. The engine MUST NOT keep its own list of
built-in facet paths.

### 1.3. Facets are counted from the facet table

On Postgres, a facet MUST be counted from the facet values the indexer wrote
(`boxel_index_facet_values`), filtered by the search's own condition in the
same snapshot. The engine MUST NOT count a facet by reading the search doc.
The indexer MUST write facet rows only for declared paths. A change to a
module that only changes its facet declarations MUST backfill the table
without re-rendering the realm's cards.

### 1.4. Counting is the same answer, opt-in or not

Declaring a facet MUST NOT change the rows, order or totals of any query.
A facet MUST count every filtered row, before collapse, window and page, by
the rules in [Search](../search.md#facets).

## 2. Rationale

Search engines that serve facets (Typesense, Meilisearch, Algolia,
Elasticsearch, Solr, Vespa) all ask the schema to name the facetable fields,
and all take the bucket shape from the field type and the request. A
declaration bounds what the indexer writes, gives the engine an index it can
count from, and makes a misspelled facet a refusal instead of an empty
count. Facets were new in Query V2, so being strict from the first release
breaks no saved query.

Counting from a side table measured 788 bytes read against 538 MB for the
same facets over a large realm, because the count reads small rows the
filter already narrowed instead of every match's document. Declaring the
built-in facets on the base types keeps one mechanism: a reader learns
facets once, and the engine has no exceptions to keep in step.

## 3. Considered options

- **Declared facets counted from a side table (chosen).**
- **Facet any path, counted from the search doc.** It needs no declaration,
  but the cost grows with every match, and a typo counts nothing.
- **Declarations with shapes (`'values'`, `'range'`, `'date'`).** Drafted and
  dropped: the field type already says which shapes make sense, and the query
  picks one.
- **Per-type partial indexes for declared fields.** Rejected: one index per
  type and field does not scale to a platform with thousands of types.
- **Hard-coded built-in facets in the engine.** Simpler at first, but a
  second mechanism beside declarations, with its own rules for files.

## 4. Remediation

Known gaps are listed in [remediation/036.md](remediation/036.md).
