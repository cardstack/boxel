---
name: index-query-engine
description: Architecture of the index query engine (`packages/runtime-common/index-query-engine.ts`) — the two-pass pipeline that compiles a `Query` filter tree into SQL that runs identically on Postgres and SQLite, plus the invariants every change must preserve (deferred expression nodes, cardinality-driven json_tree confinement, filter polarity, the shared table-valued alias semantics, synthetic search-doc keys, and the client-side parity contract with `instance-filter-matcher.ts`). Use when editing or reviewing the query engine, adding a filter operator or synthetic key, changing how field paths compile, or debugging why a query behaves differently across adapters or between server and local search.
---

# Index query engine — architecture

The engine (`packages/runtime-common/index-query-engine.ts`) ingests a `Query`
(filter tree + sort + page, defined in `query.ts`) and compiles it to one SQL
statement that must run identically on **Postgres and SQLite**. Everything
about its design follows from two constraints:

1. **Field semantics live in card definitions**, which resolve asynchronously
   (`DefinitionLookup` — a cache read, or a module prerender on a miss). SQL
   can't be produced until the schema walk happens.
2. **SQLite is the floor.** No arrays, no `unnest`, no `@>` containment, no
   `ANY_VALUE`, single-expression `COUNT(DISTINCT …)`. Plural (`containsMany`
   / `linksToMany`) traversal therefore uses `json_tree()` — the lowest common
   denominator — and Postgres mirrors it with a custom `jsonb_tree()` function
   so one generated query shape serves both.

## The pipeline

```
Query (filter tree)
  │  filterCondition()            stage 0 — sync tree expansion
  ▼
CardExpression                    tokens + DEFERRED schema-dependent nodes
  │  makeExpression()             pass 1 — async, definition-driven
  ▼
Expression                        only strings, params, resolved nodes
  │  expressionToSql()            pass 2 — mechanical rendering (expression.ts)
  ▼
SQL text + binds  ──sqlite──▶  SqliteAdapter.adjustSQL() text rewrites
```

**Stage 0** (`filterCondition` and the per-operator builders) converts the
filter tree into a `CardExpression`: a flat token array of SQL strings,
`param()` bind markers, and deferred nodes. This is where a predicate is
separated into **left side / operator / right side**:

- left = `fieldQuery(path, onRef, …)` — the dotted field path, to become a
  JSON accessor;
- operator = a literal (`=`, `IS NULL`, `ILIKE`, `IN (…)`, range operators);
- right = `fieldValue(path, [param(v)], onRef, …)` — deferred so the leaf
  field's serializer can format the bind (`formatQuery`);
- the whole predicate wraps in `fieldArity({ type, path, value, … })`, which
  defers the plural-vs-singular decision.

**Pass 1** (`makeExpression`) resolves the deferred node kinds against
definitions. Each handler walks the dotted path segment-by-segment with
`walkFilterFieldPath`, resolving a `FieldDefinition` per hop (`getFieldDef`
chases each segment's `fieldOrCard` code ref) and tagging plural segments with
`[]` in the traveled path:

- `handleFieldArity` — if the walk crossed a plural segment, ANDs the
  predicate with the **query-path confinement predicate**:
  `tableValuedTree(…).fullkey LIKE '$.friends[%].bestFriend.name'`. This is
  what pins `json_tree()`'s recursive expansion to exactly the intended path
  (see the worked example in the comment above `handleFieldArity`).
  `usePluralContainer` trims the trailing `[]` so null checks target the array
  container itself; `pluralValue` supplies the JSON-null-aware comparison.
- `handleFieldQuery` — builds the left accessor. The forward (`enter`) walk
  detects the first plural hop and switches the whole left side to the tree
  alias; only if no plural was hit does the backward (`exit`) walk assemble
  `search_doc -> 'a' ->> 'leaf'`. Numeric leaves get a pg-only `::numeric`
  cast (SQLite's `->>` preserves JSON types).
- `handleFieldValue` — runs the bind value through the leaf field's serializer
  so it compares in indexed form.
- `handleJsonContainsQuery` — promotes a positive-polarity singular string
  `eq` to a `JsonContains` node (pg: GIN-servable `search_doc @> '{…}'::jsonb`;
  sqlite: plain `->`/`->>` extraction); other leaves degrade to `->>` equality.

Pass 1 also enforces **searchability**: filter paths (never sort paths) are
walked with the queried card's `searchable` routes, and crossing an
unannotated `linksTo`/`linksToMany` (except a bare `.id` hop) or a
query-backed relationship raises `FilterRefersToNonsearchableFieldError`
instead of silently matching nothing.

**Pass 2** (`expressionToSql` in `expression.ts`) is purely mechanical: params
become `$n` binds; table-valued nodes dedupe into a map (`each_<column>`,
`tree_<column>_<fieldPath>`) rendered as nonce-numbered aliases, with the
`CROSS JOIN LATERAL …` clauses spliced into the FROM clause at the
`__TABLE_VALUED_FUNCTIONS__` placeholder; `dbExpression` nodes pick their
pg/sqlite branch.

## The two-adapter split

Structural differences are handled **in-band** (a `dbExpression` branch, a
per-kind `param`, or a resolved node rendered per adapter — `JsonContains` is
the precedent to copy when a predicate needs genuinely different SQL per
adapter). Surface-syntax differences are patched by **text rewrites** in
`SqliteAdapter.adjustSQL` (`packages/host/app/lib/sqlite-adapter.ts`):
`jsonb_tree(`→`json_tree(`, `jsonb_array_elements_text(`→`json_each(`,
`ANY_VALUE(` stripped via balanced-paren scan, `CROSS JOIN LATERAL`→`CROSS
JOIN`, `ILIKE`→`LIKE`, `.text_value`/`.jsonb_value`→`.value`,
`= 'null'::jsonb`→`IS NULL`, `COLLATE "POSIX"` dropped. If you emit new SQL
through the shared path, check whether adjustSQL needs to learn it — and
prefer a resolved node over a new text rewrite when the shapes diverge.

## Semantics to keep in mind

**Fan-out + GROUP BY = existential predicates.** Table-valued functions fan
each index row into one row per JSON element; `WHERE` filters those; `GROUP BY
i.url` keeps any url with ≥1 surviving row. So every predicate that references
a table-valued alias means "some element satisfies this".

**All references to the same column share ONE alias** (pass 2 dedupes by
column/path). Consequences for `types` conditions specifically:

- `every([{type: A}, {type: B}])` requires a _single element_ equal to both —
  unsatisfiable for distinct types, even though a card's `types` chain
  contains both. Positive type conditions do not AND-compose.
- `not: {type: X}` means "some element ≠ X", which nearly every row satisfies
  — it does **not** exclude instances of X.
- A row whose `types` is empty or null vanishes from any query that references
  the alias in _any_ branch (the cross join produces zero rows for it), even
  under `OR`/`NOT`. Errored instances can lack `types`.

Don't build features that depend on type-condition composition without first
changing `typeCondition` to a self-contained membership predicate (pg
`types @> '["key"]'::jsonb`, sqlite `EXISTS (SELECT 1 FROM json_each(types)
WHERE value = ?)` — a resolved node, per the `JsonContains` pattern).

**Filter polarity.** `not` flips the tracked polarity, and the `@>`
containment rewrite for `eq` applies only at positive polarity: on an absent
path `->>` yields SQL NULL while `@>` yields FALSE, and `NOT NULL` vs `NOT
FALSE` diverge. Any new operator that offers an index-servable rewrite must
make the same polarity distinction.

**Synthetic search-doc keys.** Some queryable keys are not card fields — they
are stamped into `search_doc` at index time (e.g. `_cardType`, `_title`) and
resolved by the shim in this module's `getField` fallback. `eq: null` on such
a key compiles to `IS NULL`, which _matches_ rows that lack the key — mind
that when a key is stamped on only some row kinds.

**Dual-read.** Reads LEFT JOIN `prerendered_html` (`ph`) 1:1 on the primary
key; a present `ph` row is authoritative for HTML/markdown columns even when
NULL (`dualReadColumn`), and the effective error state spans both channels
(`effectiveHasError`). The join never fans out the `GROUP BY`.

## The client-parity contract

`runtime-common/instance-filter-matcher.ts` is this engine's client-side
mirror: the host's live search (`SearchResource.displayedInstances` in
`host/app/resources/search.ts`) evaluates the same `Filter`/`Sort` against
hydrated instances for immediate results, then reconciles the server response
— and it **removes** a server result that evaluates locally to `no-match`
(only `unresolvable` is trusted to the server). Therefore:

- A new filter operator must be added to the matcher, or excluded in its
  `isClientEvaluable` so queries using it fall back to server-only evaluation.
- A new synthetic key must get a matcher-side shim producing the value the
  index stamps (or evaluate as `unresolvable`), or every local instance
  returns `no-match` and reconciliation blanks correct server results.
- Serializer/`formatQuery` changes must stay mirrored — the matcher formats
  filter values through the same card-api serializers on purpose.

Treat `index-query-engine.ts` and `instance-filter-matcher.ts` as one
contract: a semantic change to either ships with its counterpart in the same
change.

## Key files

- `packages/runtime-common/index-query-engine.ts` — stage 0 + pass 1
- `packages/runtime-common/expression.ts` — node kinds + pass 2
- `packages/runtime-common/query.ts` — `Query`/`Filter` types + assertions
- `packages/runtime-common/definitions.ts` — `FieldDefinition`, `getFieldDef`
- `packages/host/app/lib/sqlite-adapter.ts` — `adjustSQL` text rewrites
- `packages/runtime-common/instance-filter-matcher.ts` — client-side mirror
- `packages/host/tests/unit/index-query-engine-test.ts` — engine behavior tests
