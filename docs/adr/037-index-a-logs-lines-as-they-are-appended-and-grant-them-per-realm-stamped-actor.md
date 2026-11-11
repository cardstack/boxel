---
status: proposed
date: 2026-11-10
scope:
  - packages/base/log-lines.ts
  - packages/runtime-common/log-line-index.ts
  - packages/runtime-common/log-line-partitions.ts
  - packages/runtime-common/log-line-typing.ts
  - packages/runtime-common/log-query.ts
  - packages/runtime-common/card-operations/log-line-policy.ts
  - packages/runtime-common/card-operations/policy.ts
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/log-search.ts
  - packages/realm-server/handlers/realm-destruction-utils.ts
  - packages/postgres/migrations/*log-lines*.js
  - docs/search.md
---

# 037. Index a log's lines as they are appended, and grant them per realm-stamped actor

An append-only log (a `.jsonl` or `.log` file) holds the events a realm
records: a feed's reactions, a class's attendance. A query filters, sorts,
counts and facets a log's lines as rows, so the lines are indexed in
`boxel_log_lines`, partitioned by realm. Indexing must cost what was
appended, never the whole log, and a line must be searchable when its append
returns. Many callers write one log, and a file grant is all or nothing, so a
realm policy grants a log's lines per line, on the actor the realm stamped,
and never grants the raw file or an edit to it. The log query and its
limits are in [Search](../search.md#searching-a-log-from--log-).

## 1. Decision

### 1.1. Lines are rows, partitioned by realm

A log's lines MUST be indexed as rows of `boxel_log_lines`, partitioned by
realm. A realm's partition MUST be created on its first log write or query,
outside the index write's transaction. A log query MUST read only its own
realm's partition, and deleting a realm MUST drop its partition.

### 1.2. Indexing costs what was appended

When the realm appends to a log (`record`, `appendLine`), it MUST insert the
appended lines' rows itself, right after the append, without reading the
log, so the lines are searchable when the append returns. Any other growth
MUST be read from the indexed offset on. A full resync MUST happen only when
nothing is indexed, the file shrank, the last indexed line changed, or the
realm rewrote the file other than by appending. The log's content hash MUST
be chained (the previous hash folded with the appended bytes' hash), so an
append never re-reads the log to fingerprint it. The cost of an append MUST
NOT grow with the log's length.

### 1.3. A log-line grant admits a caller to the lines they wrote

A `query` grant in a rule on base `JSONLFile` or `LogFile` is a grant on the
lines of every such log in the realm. Its `where` MUST compare the line's
realm-stamped actor with the caller (`.actor == actor()`, optionally with
`actor() != "anonymous"`); any other shape MUST be recorded
`policy-not-filterable` and admit no one. For a caller the realm's
permissions decline, the log search MUST AND `actor = <caller>` into the one
condition every statement shares, before grouping, counting, faceting and
paging, so rows, totals, groups, facets and a card query's log binding cover
only the caller's lines. The answer MUST mark the logs it scoped
(`meta.policyScopedLogs`). A caller who is not signed in has no lines of
their own and MUST NOT be admitted.

### 1.4. Only the realm-stamped actor is trusted

`record` MUST compose the line's time from the realm's clock and its actor
from the authenticated caller, where the payload cannot reach them. The one
write a grant MAY reach on a log is that `record`. The base `appendLine`,
`update` and `delete` on a log, and a read of its raw bytes, MUST be granted
to no one, whatever a policy says. A grant MUST name a type and compare the
stamped actor, never a log's path or a value the line's writer chose.

### 1.5. Aggregates belong to cards

A value derived from a log that others may read (likes per post, a streak)
SHOULD live on a card, under that card's grants, not in a grant on the log's
lines.

## 2. Rationale

A log is read by query far more often than it is read whole, and it grows
one line at a time, so rows indexed as the lines arrive serve both. Before
write-through, every append re-read and re-hashed the whole file: hundreds of
kilobytes per event on a busy log, growing without bound. The realm already
knows the bytes it appended and where they landed, so it can index them for
free. Partitions keep one realm's lines out of another's scans and make
deleting a realm a cheap drop.

The per-line grant follows from ADR 006: a policy only widens what the
realm's permissions grant. The realm's writers can still write any line; a
caller a policy admits can read and append only their own. The actor is the
one value on a line the realm writes, so it is the one value a grant can
trust.

## 3. Considered options

- **Rows written through on append, partitioned by realm (chosen).**
- **Re-read and re-hash the log on every append.** It was the first design,
  and its cost grew with the log.
- **One unpartitioned table.** Every realm's queries share one index, and a
  realm's deletion is a large delete.
- **A file-read grant that admits a log query on the file.** All or nothing,
  so viewers' lines cannot be kept apart.
- **A row filter on any line field.** The writer chooses those values, so a
  grant on them is a grant to whoever writes the right value.

## 4. Remediation

Known gaps are listed in [remediation/037.md](remediation/037.md).
