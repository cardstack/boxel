# Querying a field that exists in one version and not another

**Status:** decided and implemented (2026-08-11). The engine change is in
`packages/runtime-common/index-query-engine.ts`; the wire knob is
`onMissingField` on the search query; the report is `meta.skippedFilters`.

---

## 0. The question

A Boxel realm can hold several Versions of the same card type at once, and a
query can name them all at once — that is the whole point of a range:

```jsonc
{
  "item.on": { "module": ".../northwind/records@*/index", "name": "Invoice" },
  "eq": { "item.currency.code": "DEM" },
}
```

`records@1.x` has `currency` as a field you read as `currency.code`.
`records@2.0.0` flattened it to a bare string. So the range expands into a
union of branches, and one branch names a path the other branch's schema does
not have.

The engine used to **throw**, and the realm returned **HTTP 500**. One shape
break made every query mentioning the moved field fail, including for the five
invoices that still have it.

The two obvious fixes are both wrong:

|                            | failure                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Throw**                  | A perfectly good question about five invoices dies because a sixth invoice is newer. Version skew is not a user error.                                     |
| **Match nothing, quietly** | "Which invoices are in DEM?" → _"none"_, when the truth is _"none **that I looked at**"_. A wrong answer that looks like an answer is worse than an error. |

So the question is not "lenient or strict". It is: **what does the system do
when it cannot evaluate part of a question, and how does the asker find out?**

---

## 1. Prior art

This is a well-trodden problem. The pattern across the field is sharp.

### Strict-by-default systems all have exactly one schema

BigQuery, Salesforce SOQL, OData and GraphQL reject an unknown field name at
analysis time. They can afford to, because there is one authoritative schema
per table/type, so an unknown name is _necessarily_ a mistake. None of them are
a counter-example for us; they simply don't have our problem.

GraphQL is worth a second look, though, because it _does_ have heterogeneous
results — and its answer is **inline fragments**: `... on Type { field }`. When
the shape varies, GraphQL makes the caller state, per type, which fields it
wants. That is precisely the "explicit union" escape hatch (§4 below), and it
is the sanctioned mechanism, not a workaround.

### Heterogeneous-corpus systems are all lenient

- **MongoDB** — a query on a missing field simply doesn't match; `{f: null}`
  matches both an explicit null and an absent field, and `$exists` is the
  explicit knob when you need to tell them apart.
- **Snowflake VARIANT** — `col:path.to.field` returns NULL for a missing key,
  never an error. `OBJECT_HAS_KEY` is the existence knob. Note the tradeoff
  Snowflake accepts: NULL conflates _absent_ with _present-and-null_.
- **XPath / XQuery / JSONPath** — a path that matches nothing yields the empty
  sequence.
- **SPARQL / RDF** — open-world by construction. A triple pattern that doesn't
  match yields no binding; `OPTIONAL` makes it non-eliminating. Absence of a
  fact is never evidence of its falsity.
- **Postgres table inheritance** — `SELECT * FROM parent` exposes only the
  parent's columns. Child-only columns are _invisible_, not an error. Classic
  OO query languages (OQL and friends) did the same for polymorphic extents: a
  query over a supertype extent may only mention supertype properties. This is
  our case almost exactly, and its answer is "the supertype query sees the
  supertype's fields" — not "the query fails".

### The warehouses solve the _storage_ half properly, which we should copy separately

- **Apache Iceberg** assigns each column a permanent integer **field ID**.
  Rename is metadata-only; every existing data file still resolves because the
  engine matches on ID, not name. A column missing from an old file reads NULL.
  But note Iceberg's own caveat: _existing queries using the old column name
  will fail_. Field IDs fix data compatibility, **not query-text
  compatibility** — which is the half we are dealing with here.
- **Avro schema resolution** has `aliases`: the reader schema declares that
  `label` was once `description`, and the correspondence is stated **once, in
  the schema**, instead of in every query. This is the right long-term answer
  for a _rename_, and it is listed as future work in §6.

### Elasticsearch is the closest match, and gives us the shape of the answer

ES has spent a decade on exactly this, across multiple mechanisms:

- **`ignore_unmapped`** on queries and sorts, and **`unmapped_type`** on sorts:
  per-request knobs for "this field isn't in this index's mapping".
- **ES|QL `unmapped_fields`**, whose values are `DEFAULT`, `NULLIFY` and
  `LOAD`. The documentation is explicit about the partially-mapped case — a
  field mapped in some indices and not others, i.e. our case exactly — and
  under the **default**, "documents from indices where the field is not mapped
  return `null`". Tolerant is the default; the escalation is opt-in.
- **Partial search results**: when some shards fail, ES returns **HTTP 200**
  with the results it has, plus `_shards.failed` and a `failures[]` array
  naming what broke. `allow_partial_search_results: false` turns that into a
  failure instead.

That last one is the load-bearing idea. **Succeed, and report what you could
not do.** It is what separates responsible leniency from the silent-wrong-answer
failure every lenient store gets criticized for.

### And SQL already settled the composition question

SQL's three-valued logic — `TRUE` / `FALSE` / `UNKNOWN` — defines exactly how an
unevaluable predicate combines: `UNKNOWN OR TRUE` is `TRUE`, `UNKNOWN AND FALSE`
is `FALSE`, and critically **`NOT UNKNOWN` is `UNKNOWN`**, not `TRUE`. Every
analyst already knows this truth table.

### One more piece of prior art, in this repo

`packages/runtime-common/instance-filter-matcher.ts` — the client-side matcher
that produces instant results before the server answers — **already implements
three-valued logic**. Its `MatchResult` is `'match' | 'no-match' |
'unresolvable'`, and `combineAnd` / `combineOr` / `negate` implement the SQL
truth table, including `negate('unresolvable') === 'unresolvable'`.

So the SQL engine was the _outlier_. Bringing it into line with the matcher was
not inventing a semantics; it was removing a divergence.

---

## 2. The decision

> **A field path that resolves on at least one type the query names is a real
> field. Where it does not resolve, that branch of the query is UNKNOWN, and
> the skip is reported. A field path that resolves on _no_ type the query names
> is a mistake, and the query fails.**

The second sentence is the part the prior art does not have, and it is what
makes the first sentence safe. MongoDB and Snowflake cannot distinguish a typo
from version skew, because a query there names no type set — so `invoiceNumbr`
quietly matches nothing forever. Our queries carry their own type anchor, so we
_can_ tell the difference:

- `item.invoiceNumbr` over `records@*` — no Version has it → **it's a typo** → fail.
- `item.currency.code` over `records@*` — 1.x has it, 2.0.0 doesn't → **it's version skew** → answer for 1.x, report the 2.0.0 skip.

This gives the most successful default (the common question gets its answer)
without the failure mode that makes leniency dangerous (the typo still fails
loudly, and the partial answer is never silent).

### UNKNOWN is spelled `NULL`, so SQL does the composition

The skipped predicate compiles to `NULL::boolean`, not `FALSE`. That single
choice buys the entire truth table from the database, and it gets the hard case
right for free:

- Under `any`: `NULL OR TRUE` is `TRUE` — a branch that _can_ answer still
  contributes its rows.
- Under `not`: `NOT NULL` is `NULL` — a type we could not evaluate is **not**
  swept into the negation. Asking for "invoices **not** in DEM" never hands back
  2.x invoices on the grounds that we failed to look.

Had we used `FALSE`, `NOT FALSE` would be `TRUE` and every negated query would
silently _gain_ rows it never tested. Silent loss is a smaller lie than silent
gain, and `NULL` refuses both.

### The knob

`onMissingField` on the search query:

| value     | behavior                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `"skip"`  | **default.** Types that cannot answer sit the predicate out; every skip is named in `meta.skippedFilters`. |
| `"error"` | Any unanswerable predicate fails the whole query with HTTP 400.                                            |

`"error"` is the precision setting — for an analytic or reconciliation caller
that would rather see nothing than see part of the picture. It is the direct
analogue of `allow_partial_search_results: false`.

A path no type in the query has fails under **both** settings.

### The report

```jsonc
"meta": {
  "page": { "total": 1 },
  "skippedFilters": [
    { "path": "currency.code",
      "type": { "module": ".../northwind/records@2.0.0/index", "name": "Invoice" },
      "reason": "nonexistent-field",
      "message": "Your filter refers to a nonexistent field \"currency.code\" on type …" }
  ]
}
```

`reason` is one of `nonexistent-field`, `not-searchable`, `query-backed`. The
key is omitted entirely when nothing was skipped, so the ordinary single-type
response is byte-identical to before.

### And the status codes are honest now

A filter naming a field no type in the query has used to come back **HTTP 500
"unexpected exception in realm"**. It is a malformed request and now returns
**HTTP 400** with the message. Same for a filter that crosses a non-searchable
relationship.

---

## 3. What it costs

Nothing on the common path. The reconciler counts the distinct types among the
compiled filter's field predicates and **returns immediately unless there are at
least two**. A single-type query — every query that does not mention a package
range — pays one array scan, does zero extra definition lookups, and behaves
bit-for-bit as it did before. Where it does engage, it probes each distinct
`(type, path)` pair exactly once, concurrently.

---

## 4. What this does _not_ do

**A version range unifies a type across versions. It does not migrate a schema
across them** — and it should not pretend to. Where the shape survived, one
field path is enough. Where the shape moved, only the caller knows that
`lines[].description` and `items[].label` are the same idea, and the caller
states it — the GraphQL inline-fragment answer:

```jsonc
{
  "any": [
    {
      "item.on": { "module": ".../records@^1.0.0/index", "name": "Invoice" },
      "eq": { "item.lines.description": "Onboarding workshop" },
    },
    {
      "item.on": { "module": ".../records@^2.0.0/index", "name": "Invoice" },
      "eq": { "item.items.label": "Onboarding workshop" },
    },
  ],
}
```

Note this explicit union is _itself_ reconciled: each branch's `on` gates its own
type, so neither branch is skipped and no warning is emitted. Stating the
correspondence is the way to get a complete answer with no caveats attached.

And full-text `matches` spans a shape break unaided, because it never names a
field — which is why it needs none of this machinery.

---

## 5. Measured behavior

Against the atlas realm, `northwind/records` at `1.0.1` / `1.2.0` / `2.0.0`
(2.0.0 renames `lines[].description` → `items[].label`, flattens `currency`,
adds `billTo`), seven invoices across four apps:

```
range item.dueOn > 2026-08-01  @ *   200  invoice-4, ng-invoice-1, ng-invoice-2
                                          (surviving field still unifies, no warning)

eq item.currency.code = DEM    @ *   200  invoice-2
                                          skipped currency.code on records@2.0.0
eq item.currency.code = DEM    @ ^1  200  invoice-2            (same answer, no skip)

eq item.lines.description      @ *   200  invoice-1, legacy-invoice-1
                                          skipped lines.description on records@2.0.0
eq item.items.label            @ *   200  ng-invoice-1
                                          skipped items.label on records@1.2.0, @1.0.1

not(eq item.currency.code=DEM) @ *   200  invoice-1, invoice-3, invoice-4, legacy-invoice-1
not(eq item.currency.code=DEM) @ ^1  200  invoice-1, invoice-3, invoice-4, legacy-invoice-1
                                          ^ IDENTICAL: negation does not claim the
                                            2.x rows it could not evaluate

eq item.invoiceNumbr           @ *   400  nonexistent field "invoiceNumbr"
eq item.invoiceNumbr        @ 1.2.0  400  nonexistent field "invoiceNumbr"
                                          ^ a typo is a typo at every scope

onMissingField:"error" + currency.code
                               @ *   400  nonexistent field "currency.code" on @2.0.0
onMissingField:"lenient"             400  onMissingField must be "skip" or "error"

matches "Onboarding"           @ *   200  invoice-1, legacy-invoice-1, ng-invoice-1
                                          (three Versions, two majors, no warning)
```

---

## 5a. Federation was swallowing the refusal — fixed

The reconciler was correct at the realm, and then federation threw the answer
away. `fanOutRealmSearch` (search-utils.ts) ran the per-realm calls under
`Promise.allSettled` and dropped every rejection with a `console.error`, so a
query that FAILED came back as an empty success:

```
                                         before          after
_federated-search  tolerant, moved field   200 total=1     200 total=1 skipped=1
_federated-search  STRICT,   moved field   200 data:[]     400 nonexistent field "currency.code"
_federated-search  tolerant, TYPO          200 data:[]     400 nonexistent field "invoiceNumbr"
/atlas/_search     (direct, either mode)   correct         unchanged
```

Note the third row. It is not only the strict knob: a **plain typo** was silently
empty through federation too. The single most important guarantee in §2 — that a
path no type can answer FAILS rather than matching nothing — held at the realm
and was then discarded one layer up. Every client goes through
`_federated-search`, so in practice that guarantee did not exist.

**The rule.** _"This realm is unavailable"_ — a timeout, a dead replica, a 5xx —
is a property of that realm, and one such realm must not sink a federated
search: still swallowed and logged. _"Your question is malformed"_ is a property
of the QUERY, which is identical on every realm, so the first such rejection is
the answer for the whole federation: rethrown, and mapped to **400** by
`handle-search.ts`.

`isClientQueryError` decides which is which, structurally — an HTTP-ish 4xx
`status`, or a known error `name` — rather than by `instanceof`. Two reasons: on
the client fan-out the error crosses a process boundary and arrives as a plain
`Error` carrying `status`, and importing the engine's error classes into
search-utils would create an import cycle with the code that throws them.
`FilterRefersToNonexistentTypeError` is deliberately NOT in the set: it is
already answered as an empty result inside `_search`, so it never rejects, and
adding it would turn a working case into a failure.

This changes behavior for every federated search, not just this feature: a
malformed query that previously returned an empty 200 now returns 400 with the
reason. That is the correction, but it can surface previously-hidden bad queries
elsewhere as newly-visible errors.

## 6. Future work, in priority order

1. **Field aliases, the Avro way.** `@field items = containsMany(Charge, {
wasNamed: ['lines'] })` would let 2.0.0 declare the rename once, in the
   schema, so `item.lines.description` resolves across the break and no caller
   restates the correspondence. This is the real fix for renames; the skip
   report is the right behavior for everything else (fields genuinely added or
   removed), which aliases can never cover.
2. **Surface `skippedFilters` in the UI.** The data is on every response; the
   card search UI should show "2 of 3 versions could not be searched on
   `currency.code`" rather than leaving it to an API consumer.
3. **`meta.skippedFilters` on the live/optimistic path.** The client matcher
   already computes `unresolvable` internally but does not report it, so an
   instant result set can quietly differ from the server's until reconciliation.
