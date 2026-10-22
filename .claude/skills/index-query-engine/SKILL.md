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
  predicate with the **query-path anchor** that confines `json_tree()`'s
  recursive expansion to exactly the intended path. This is the engine's most
  nuanced mechanism — see the dedicated section below.
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
become `$n` binds; table-valued nodes dedupe into a map keyed
`tree_<column>_<fieldPath>` rendered as nonce-numbered aliases, with the
`CROSS JOIN LATERAL …` clauses spliced into the FROM clause at the
`__TABLE_VALUED_FUNCTIONS__` placeholder; `dbExpression` nodes pick their
pg/sqlite branch.

## Plural paths: `json_tree` and the query-path anchor

`->`/`->>` navigation cannot cross an array of unknown length, so any path
that traverses a plural field routes through a `json_tree` table function.
SQLite's is built-in; Postgres's `jsonb_tree(data, root_path)` is a custom
recursive-CTE function (defined in the initial migration in
`packages/postgres/migrations/`) returning `(fullkey, jsonb_value,
text_value, level)` — deliberately emitting the **same `fullkey` dialect**
as SQLite (`$.friends[0].bestFriend.name`: array hops bracketed, object hops
dotted). That shared dialect is what lets one anchor pattern serve both
adapters.

Worked example — `friends` is `linksToMany`, filter
`{ eq: { 'friends.bestFriend.name': 'Mango' } }`:

1. The pass-1 walk tags plural segments, yielding the traveled path
   `friends[].bestFriend.name`, and roots the tree at the smallest prefix
   containing the fan-out: `trimPathAtFirstPluralField` → `$.friends`.
2. `json_tree` enumerates **every** node beneath that root — one row each for
   `$.friends`, `$.friends[0]`, `$.friends[0].name`,
   `$.friends[0].bestFriend`, `$.friends[0].bestFriend.name`,
   `$.friends[1]`… A value predicate alone (`tree.text_value = $1`) would
   therefore match 'Mango' appearing _anywhere_ under `$.friends` — a
   friend's own `name`, a nickname field, any depth.
3. `handleFieldArity` ANDs the **anchor**: `tree.fullkey LIKE
'$.friends[%].bestFriend.name'` — the traveled path with each `[]`
   rewritten to `[%]` (`convertBracketsToWildCards`), so any array index
   passes but the key sequence must match exactly. The conjunction reads:
   "∃ a tree row at exactly this path shape whose value matches".

```sql
SELECT url, ANY_VALUE(pristine_doc) AS pristine_doc
FROM boxel_index AS i
CROSS JOIN LATERAL jsonb_tree(i.search_doc, '$.friends') AS friends0_tree
WHERE (i.is_deleted = FALSE OR i.is_deleted IS NULL)
  AND ( friends0_tree.text_value = $1                            -- value
        AND friends0_tree.fullkey LIKE '$.friends[%].bestFriend.name' ) -- anchor
GROUP BY i.url
```

**One alias, two references.** The left side (`handleFieldQuery` emits
`tree.text_value`) and the anchor (`handleFieldArity` emits `tree.fullkey`)
both create `tableValuedTree(column, rootPath, fieldPath, …)` nodes, and pass
2 dedupes them by `tree_<column>_<fieldPath>` — so they collapse into a
single `CROSS JOIN LATERAL` and are guaranteed to test the **same tree row**.
This is why `handleFieldQuery` computes its `rootPluralPath` to line up with
`handleFieldArity`'s: if the two emitted different `(column, fieldPath)`
pairs they would get separate joins, and the anchor would no longer confine
the value test.

**Consequences of that dedup key** (the full dotted field path):

- Two predicates on the _same_ path share one alias and evaluate per tree
  row: `every` of `friends.name = 'Mango'` and `friends.name = 'Ringo'`
  matches nothing, even for a card that has both friends: each surviving
  tree row is one friend's `name` node, and no single node has both names.
  Type conditions don't behave this way — they are per-row membership
  predicates with no alias (see "Semantics to keep in mind").
- Predicates on _different_ leaf paths get separate tree functions and fan
  out as a cartesian product: `friends.name = 'Mango' AND friends.age = 5`
  means "some friend named Mango AND some friend aged 5" — **not necessarily
  the same friend**. Element-correlated predicates across a plural hop are
  not expressible today.

**Null checks anchor at the container** (`usePluralContainer`). For
`eq`/`in`/`contains` null on a path whose leaf is plural, there may be no
element rows at all, so the anchor is redirected at the array node itself:
`trimTrailingBrackets` drops the trailing `[]` (interior plurals keep their
`[%]`), and the tree's seed row — `jsonb_tree` emits the root node as its
first row — is what the anchor then matches. The comparison switches from
text extraction to `pluralValue`: `tree.jsonb_value = 'null'::jsonb` (JSON
null; adjustSQL rewrites this to `tree.value IS NULL` for SQLite). This is
also what `FieldQuery.useJsonBValue` selects: `jsonb_value` for these
JSON-typed comparisons, `text_value` for string predicates (SQLite maps both
to `json_tree`'s single `.value` column).

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

**Type conditions are per-row membership, not a shared alias.** A `type` (or
`on`) condition is deferred to pass 1 as a `TypeCondition` node, and
`handleTypeCondition` resolves it to an `any` of `types-contains` predicates
(`typesContains`), one per membership key — the ref as given plus its
canonical defining-module ref, since rows stamp `types` with the canonical
key. Each predicate is a self-contained scalar test against the row's own
`types` column; it joins nothing, so it never fans the row out and never
shares an alias with another condition. `expressionToSql` renders it per
adapter, with the key as a bind parameter rather than inlined SQL text:

- Postgres: `COALESCE(i.types, '[]'::jsonb) @> $n::jsonb`, bound to `["<key>"]`
- SQLite: `EXISTS (SELECT 1 FROM json_each(COALESCE(i.types, '[]')) WHERE value = ?)`, bound to `<key>`

So type conditions compose like ordinary boolean predicates:

- `every([{type: A}, {type: B}])` is a true intersection — it matches a row
  whose `types` chain contains both A and B (e.g. an instance of B where B
  extends A).
- `not: {type: X}` is a true exclusion — it drops every row whose `types`
  contains X. That is every instance of X and of X's subclasses, since
  `types` is the full ancestor chain. For a file, that chain starts at the
  class whose extraction succeeded. When the extension's FileDef fails to
  extract (e.g. a `.png` that isn't a PNG), the extractor falls back up the
  class chain, and the row is indexed as the nearest ancestor that succeeded
  (`RasterImageDef`). That row matches `{type: ImageDef}` and is dropped by
  `not: {type: ImageDef}`, but it does not match `{type: PngDef}`.
- The `COALESCE` keeps a row whose `types` is null a definite FALSE rather
  than SQL NULL, so `not: {type: X}` keeps such a row instead of dropping it.
  Errored instances can lack `types`; under this predicate they behave as
  "member of nothing" in every branch.

**The Postgres expression is pinned to a GIN index.**
`boxel_index_types_containment_idx` and
`boxel_index_working_types_containment_idx` (migration `1784272066344`) are
`jsonb_path_ops` GIN indexes on exactly `COALESCE(types, '[]'::jsonb)`.
Postgres uses an expression index only when the query's left operand
structurally matches the indexed expression, so any semantic change to the
`COALESCE` wrapper in the `types-contains` branch of `expression.ts`
un-indexes every type filter unless a migration moves the index expression
with it. Aliasing and whitespace don't matter; the wrapper and the `@>`
operator do.

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

**The HTML channel.** Reads LEFT JOIN `prerendered_html` (`ph`) 1:1 on the
primary key; `ph` is the sole home of rendered output — the HTML formats,
markdown (the FTS `matches` predicate reads `ph.markdown`), the deps carrying
scoped-CSS URLs, and the rendering generation. A row with no `ph` row reads
them as NULL: no rendering exists yet, so it has no full-text membership
either. `icon_html` stays on `boxel_index` (the icon renders in the index
visit). The effective error state spans both channels (`effectiveHasError`).
The join never fans out the `GROUP BY`.

## The client-parity contract

`packages/runtime-common/instance-filter-matcher.ts` is this engine's client-side
mirror: the host's live search (`SearchResource.displayedInstances` in
`packages/host/app/resources/search.ts`) evaluates the same `Filter`/`Sort`
against
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
