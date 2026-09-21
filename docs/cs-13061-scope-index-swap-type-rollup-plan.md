# CS-13061 — Stop recomputing the whole realm's type summary on every index swap

## Goal

`Batch.done()` publishes an index pass inside one transaction. Its first step,
`updateRealmMeta()`, rebuilds `realm_meta.value` — the realm's per-type summary
that feeds the `_types` endpoint and CardsGrid's sidebar — by aggregating over
every live row of the realm in `boxel_index_working`, twice (once for
`instance`, once for `file`). It does that no matter how little the pass
changed, so a one-card edit pays a full-realm rollup.

Make the rollup's cost proportional to what the pass actually moved.

## What the measurement says

Measured on staging (`boxel_index_working`, read-only session, 2026-09-21).
The database was under a concurrent load test throughout — ~70 CPU-bound
backends — so the absolute numbers are inflated. Both arms of every A/B below
were measured in the same session minutes apart, so the ratios hold even though
the milliseconds do not transfer to an idle server.

One user realm — 4,455 rows in all, of which 2,150 are live `instance` rows
across 57 distinct leaf types (see CS-13061 for which realm):

| Variant                                         | Plan                                         | Execution    |
| ----------------------------------------------- | -------------------------------------------- | ------------ |
| today: `count(DISTINCT i.url)`                  | GroupAggregate over a Sort of all 2,150 rows | 667–1,081 ms |
| `count(i.url)`                                  | HashAggregate, no sort                       | **4.3 ms**   |
| today's aggregate, scoped to one adoption chain | GroupAggregate, same heap scan               | 4.0 ms       |

The cost is the sort, not the scan. A bare `ORDER BY (types->>0), url` over the
same rows — no aggregate at all — costs 762 ms, while the heap scan that feeds
it costs 3.4 ms. The sort keys are a ~90-character type URL and a
~110-character row URL, both sharing long prefixes within a realm, so the
`en_US.UTF-8` collation comparison cannot use abbreviated keys and degrades to a
full-length `strcoll` on every comparison. A synthetic sort of 2,150 URLs that
diverge early costs 20 ms; the same strings under `COLLATE "C"` cost 1.9 ms.

The sort exists only because of `DISTINCT`, and the `DISTINCT` cannot change an
answer: `boxel_index_working`'s primary key is `(url, realm_url, type)`, and the
query fixes `realm_url` and `type` with equality predicates, so `url` is already
unique within every group. Checked directly across three staging realms and both
channels — no group where `count(DISTINCT url) <> count(url)`.

Scoping the aggregate to the touched adoption chains, on its own, does not avoid
the scan: the plan still reads all 2,009 heap blocks and discards 2,045 rows at
the filter. It only shrinks what the aggregate processes.

## Approach

Three changes, smallest and most load-bearing first.

1. **Drop the redundant `DISTINCT`** in `#fetchTypeSummary`. One token, no
   semantic change, and on the evidence above it is the difference between a
   full collation sort of the realm and a hash aggregate.

2. **Scope the recompute to the types the pass moved.** When
   `typeSetIsComplete`, compute the summary for `touchedTypes` only and merge
   those entries over the prior generation's `realm_meta.value`, which
   `carryForwardRealmMeta()` already knows how to read. When it does not hold,
   fall back to today's full recompute — the same polarity `bumpAllTypes`
   already uses three lines later, so absence keeps reading as "unknown".

   The merge happens in SQL rather than in JS. `realm_meta.value`'s order comes
   from `ORDER BY MAX(display_names->>0) ASC NULLS LAST`, which is the
   database's collation; reproducing it in a JS comparator would change the
   order the sidebar renders on Postgres and would make "byte-identical to a
   full recompute" depend on matching glibc. Unioning the scoped aggregate with
   the carried-forward entries and letting the database order the result keeps
   that property exactly, per adapter.

3. **An index on the leaf type** — `boxel_index_working (realm_url, type,
(types->>0))` — was measured and left out. It is the only thing that would
   let the scoped aggregate read the touched types' rows rather than scanning
   the realm, so without it acceptance's "does not scan the whole realm's
   working set" is not met literally: the realm-wide _sort and aggregation_ go
   away, the realm-wide sequential _read_ stays.

   It did not earn the write cost. Reproduced locally on a 2,150-row realm with
   the same shape as the realm above (Postgres 16, `en_US.UTF-8`, idle machine):

   | Variant                             | Plan                                   | Execution |
   | ----------------------------------- | -------------------------------------- | --------- |
   | today                               | GroupAggregate over a full sort        | 38.8 ms   |
   | no `DISTINCT`                       | HashAggregate                          | 2.7 ms    |
   | no `DISTINCT`, scoped               | HashAggregate over a filtered seq scan | 1.2 ms    |
   | no `DISTINCT`, scoped, + leaf index | HashAggregate over an index scan       | 0.4 ms    |

   So the index buys 0.8 ms per channel on a realm this size. Against that, 3,000
   upserts over existing rows cost 271–292 ms without it and 440–560 ms with it
   — and every write the indexer makes touches `types`, so every write pays.
   That is a poor trade in a change whose purpose is to make writes faster. It
   also needs a migration plus a regenerated SQLite schema file that gains
   nothing, since the schema converter drops indexes and the host runs on
   SQLite. Worth revisiting if a realm's row count grows enough to make the
   remaining scan matter; the numbers above are the ones to re-measure against.

## Assumptions

- `#touchedTypes` holds full adoption chains, so it always contains the leaf
  (`types->>0`) of both the chain a row lands on and the chain it left. Each
  channel's recompute over those keys therefore covers every group whose count
  could have moved, including a type whose last instance was deleted — its
  recompute returns no row, and the merge drops the stale entry.
- `typeSetIsComplete` is the right gate: it is exactly the question "did this
  pass read the prior chain of every URL it promotes", which is what makes
  `#touchedTypes` a complete account of what moved.
- The prior value may still be in the legacy bare-array shape, so the merge
  normalizes it through `normalizeRealmMetaValue` before partitioning.

## Target files

- `packages/runtime-common/index-writer.ts` — `#fetchTypeSummary`,
  `updateRealmMeta`, `carryForwardRealmMeta`.
- `packages/host/tests/unit/index-writer-test.ts` — the suite that already
  exercises `realm_meta` and `fetchCardTypeSummary`.

## Testing notes

The failure mode is a silently wrong type summary, not an error, so the tests
assert the value rather than the timing:

- A merged pass produces the same `realm_meta.value` as a full recompute of the
  same state — the acceptance criterion, asserted directly.
- A pass that deletes the last instance of a type drops that type's entry.
- A card that changes what it adopts from moves its count off the old type and
  onto the new one.
- A pass where `typeSetIsComplete` is false still recomputes in full.
