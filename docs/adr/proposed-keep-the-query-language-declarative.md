---
status: proposed
date: 2026-11-08
scope:
  - packages/runtime-common/query.ts
  - packages/runtime-common/query-grammar.ts
  - packages/runtime-common/query-syntax.ts
  - packages/runtime-common/binding-reference.ts
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/query-engine/**
  - packages/runtime-common/realm-index-query-engine.ts
  - packages/runtime-common/search-entry.ts
  - packages/runtime-common/search-entry-union.ts
  - packages/runtime-common/realm-union.ts
  - packages/runtime-common/vector-query.ts
  - packages/runtime-common/log-query.ts
  - packages/runtime-common/instance-filter-matcher.ts
  - packages/realm-server/handlers/handle-search.ts
  - packages/host/app/utils/search/**
  - docs/search.md
---

# Keep the query language declarative, so the order a query is written in never changes its answer

A Boxel query says what it wants, never how to get it. The engine applies a
query's parts in one fixed order that the query cannot change, and the order
in which the query writes its members, children, values and bindings never
changes the rows, their order, their counts or any value it returns. Ranking
is part of the sort, each ability has one spelling, and one search reads one
snapshot of the index. Queries are saved in realms, rewritten by the platform
(lowering, policy composition, label resolution, federation) and written by
agents, so a query's meaning has to survive every rewrite that reorders it.
The order, and the lists that carry meaning by position, are in
[Search](../search.md#how-a-query-is-evaluated).

## 1. Decision

### 1.1. Sets are sets

The answer to a query MUST NOT depend on the order in which it writes the
members of an object, the children of `every` and `any`, the values of `in`,
the signals of a `blend`, its `facets`, its `let` bindings, or the unquoted
words of a text term. Writing a set member twice MUST give the same answer as
writing it once, or MUST be refused when the two copies differ (two facets on
one `by`).

Only the lists that [Search](../search.md#sets-and-sequences) names as
sequences MAY carry meaning by position. A new list that carries meaning by
position MUST be added to that section in the change that adds it.

### 1.2. One fixed evaluation order

The engine MUST apply a query's parts in the order that
[Search](../search.md#evaluation-order) defines. A new feature MUST take one
place in that order. The language MUST NOT gain a construct whose position in
the query decides when it runs, such as steps or a pipeline.

### 1.3. Ties are broken the same way everywhere

Rows that a sort leaves tied, and every row of a query with no sort, MUST come
back in card URL byte order, then by row kind. This MUST hold on every index
adapter, in a federated union, and in a result merged across servers.

### 1.4. Asking for more does not change the answer

Asking for facets, `explain`, `select`, a different `page.total` mode, or
another page MUST NOT change the rows, their order, or their counts. A page
MUST only select a slice of the one ordered answer.

### 1.5. One search reads one snapshot

On Postgres, every statement of one search (rows, totals, facets, bindings,
per-realm totals) MUST read one snapshot of the index, so a write that lands
during the search shows in all of its parts or in none. Paging is not a
snapshot: two pages are two searches.

### 1.6. Ranking is a sort

Every ranking (text relevance, vector similarity, a `blend`, a boost, an
expression) MUST be a sort entry. Re-ordering the best rows by an expression
MUST be an expression sort entry with `top` or `compare` (a window), first in
`sort`, reported in `meta.window`. The language MUST NOT gain a ranking stage
outside `sort`. Every expression MUST compile to SQL, and an expression SQL
cannot run MUST be refused with a code, never answered on another evaluator.

### 1.7. One spelling for each ability

The newer spelling MUST have one way to write each ability. A binding is
declared with its `$` in `let` and read as the string `'$name.path'`; a
string is a reference only when it names a declared binding (or `$this` in a
field query), and `{ "$literal": … }` escapes text that would read as one.
Type-ahead is `matches` with `prefix: true`. A draft spelling that was removed
before release (`rerank`, `placement`, `typeahead`, `{ "$let" }`) MUST be
refused with the spelling to write.

### 1.8. A federated search answers as one search where it can

A federated search over realms that one server mounts on one database MUST
run as one search over their union, so its order, totals, facets and ranking
are exact. A merge across servers MAY be approximate, and MUST say so with a
warning (`approximate-order`, `total-estimated`). A federated search that
names one realm MUST return the same rows, order, totals and facets as
`_search` on that realm, through the same engine path.

## 2. Rationale

The platform rewrites queries before it runs them. The newer spelling lowers
to the engine form, a realm policy wraps a caller's filter in its grants,
`linkedFrom` becomes a binding under a policy, labels resolve to paths, and a
federated search rewrites the page for each realm. Each rewrite is correct
only if it may reorder and regroup what it touches. A language in which order
carries meaning would make every rewrite a semantic change.

Agents write many of these queries. An agent that reorders the children of
an `any` should not change what the query finds. Caches and query-backed
fields key a query by its content, which is sound only when two orderings of
one query mean the same thing. A fixed order also lets the engine choose its
own plan: push a filter into an index, read a binding once, count facets in a
separate pass.

Ranking as a sort keeps one place that decides order, so paging, totals and
collapse follow one rule. A window in SQL has no thread, no wall clock and no
second evaluator to disagree with the database. One spelling per ability
gives agents one thing to learn and reviewers one thing to read. One snapshot
keeps a page's rows, its total and its facet counts from contradicting each
other while the realm is being indexed. A union on one server costs one
statement, and it is the only way to rank across realms exactly.

## 3. Considered options

- **A declarative language with one fixed evaluation order (chosen).**
- **Steps or a pipeline**, where each stage reads the one before. It was
  drafted and withdrawn: every platform rewrite would have to preserve stage
  order, and one request could be written in many orders with different
  answers.
- **A top-level `rerank` stage run on a worker thread.** It was built and
  replaced: it was a second evaluator with its own clock, and its paging and
  totals needed rules of their own.
- **First match wins in `any`.** It makes the children's order part of the
  answer, and it differs from SQL `OR`.
- **Ties in whatever order the database returns.** Cheaper, but pages laid
  end to end would skip or repeat rows, and two adapters would disagree.
- **Always merge per-realm answers.** Simple, but ranking and totals across
  realms are then approximate even when one database holds every realm.

## 4. Remediation

Known gaps are listed in [remediation/proposed-keep-the-query-language-declarative.md](remediation/proposed-keep-the-query-language-declarative.md).
