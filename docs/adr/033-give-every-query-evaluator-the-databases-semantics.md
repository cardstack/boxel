---
status: proposed
date: 2026-11-09
scope:
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/query-engine/**
  - packages/runtime-common/time-zone.ts
  - packages/runtime-common/instance-filter-matcher.ts
  - packages/runtime-common/search-entry.ts
  - packages/runtime-common/formula-sql.ts
  - packages/runtime-common/log-query.ts
  - packages/runtime-common/query.ts
  - packages/runtime-common/query-syntax.ts
  - packages/runtime-common/serializers/date.ts
  - packages/runtime-common/serializers/datetime.ts
  - packages/bxl/src/bxl/sql/**
  - packages/bxl/src/formulajs/**
  - packages/host/app/lib/sqlite-adapter.ts
  - packages/postgres/migrations/**
  - scripts/pg-container.sh
  - packages/realm-server/tests/scripts/**
  - docs/search.md
---

# 033. Give every query evaluator the database's semantics for missing values, dates and text order

A query is answered by more than one evaluator: Postgres, the browser's
SQLite index, the client's instance matcher during live-query
reconciliation, the merge of a federated result, and the log query engine. They must agree, or a card appears and disappears
as a page refreshes, and a merged page differs from each realm's own. The
reference is the Postgres engine, at Postgres 16 with pgvector 0.8 or later.
Three rules decide most disagreements: a
missing value follows SQL's three-valued logic, a stored date-time with no
zone reads as UTC, and text orders by the database's collation. The
guarantees, and the differences that remain, are in
[Search](../search.md#edge-cases-and-what-is-guaranteed).

## 1. Decision

### 1.1. Postgres is the reference

The answer the Postgres engine gives defines a query's meaning. Every other
evaluator MUST give the same answer, or MUST leave the query to the server.
Where an evaluator cannot match it, the difference MUST be listed in
[Search](../search.md#edge-cases-and-what-is-guaranteed).

Realm servers MUST run Postgres 16 or later with the pgvector extension 0.8
or later. The test database MUST be the same, so a test of a Postgres-only
path fails rather than skips. The browser's SQLite index MAY answer a subset,
and MUST refuse the rest with `needs-postgres`.

### 1.2. A missing value is unknown

A comparison with a missing value MUST be neither true nor false, as in SQL.
`not`, `every` and `any` MUST carry an unknown result through. So neither a
comparison nor its `not` returns a card with no value at that path. A query
that wants such cards MUST say so, with `missing` or `eq: null`. A filter on a
list field MUST match when some element matches, and an empty list MUST
count as missing.

### 1.3. Dates are read in UTC

A stored date, or a stored date-time that names no zone, MUST be read as UTC
wherever a query reads it: a filter, a sort, a relative date, a facet
interval, and an expression. Its reading MUST NOT depend on the database
session's time zone, the server's, or the browser's. A value written to the
index without a zone MUST be written in UTC, so that the zone of the process
that indexed a card never changes what it stores. Relative dates and their
rounding, facet intervals, and an expression's TODAY() and date parts MUST
be reckoned on the calendar of the query's time zone, with weeks starting on
Monday. The zone is the query's `timeZone` (an IANA name), else the
caller's, else the realm's default, else UTC; a federated search over
several realms uses one zone, the query's or UTC. The zone decides calendar
boundaries only: it MUST NOT change what a stored value means, so a stored
instant stays that instant and a stored date stays that calendar day. Every
evaluator MUST reckon in the same zone, or leave the query to the server.

### 1.4. Text orders by the database's collation

A sort on a text field MUST follow the database's default collation. The card
URL tiebreak MUST be byte order (`COLLATE "POSIX"`). An evaluator outside the
database MUST order text by the one approximation that
[Search](../search.md#edge-cases-and-what-is-guaranteed) documents, with a
fixed locale, never the locale of the process it runs in.

## 2. Rationale

Live queries are answered twice. The server answers, and the client matches
the cards it holds against the same filter to update the page before the
server's next answer. When the two disagree, a card flickers in and out. A
federated page is answered by each realm and merged, and a merge that orders
differently from the realms drops or repeats rows at page boundaries. So one
evaluator has to be the reference, and the others follow it. Postgres is the
one that answers every query on a realm server.

Three-valued logic is what SQL already does, so the Postgres engine gets it
without extra work, and queries that ran before Query V2 already answer this
way (ADR 032). The cost is that `not` is not the complement of a comparison.
The docs show the query that includes the missing cards.

A zoneless date-time has no instant until something supplies a zone. If the
database session, the server, or the browser supplied it, the same query
would answer differently in two deployments, or for two viewers. Realm
servers run in many places (ADR 004), so the zone is fixed, and UTC is the one
that every evaluator has.

Which day an instant falls on is a different question from what instant a
value names. Real apps ask it in a place's calendar: an attendance punch at
03:30 UTC on November 10 is November 9 in New York. So the calendar is the
query's, named once and resolved once per search, while the reading of
stored values stays fixed. A query that names no zone, in a realm that
declares none, reckons in UTC and answers as before (ADR 032).

The database's collation sorts text as people expect, and an index can serve
it. Choosing it keeps every saved sort's answer (ADR 032). The cost falls on
evaluators outside the database, which have no copy of its tables, so the one
approximation and its known differences are written down.

## 3. Considered options

- **Postgres as the reference, with three fixed rules (chosen).**
- **Two-valued logic, where `not` is the complement.** It is simpler to
  explain, but it changes the answer of every saved `not` over a field some
  cards leave empty.
- **Read zoneless date-times in the session's or the viewer's zone.** The
  answer would depend on where the server runs, or who is looking.
- **Byte order (`C`) for all text.** It is the same in every evaluator and
  cheap to merge, but it puts "Zebra" before "apple", and it changes saved
  sorts.
- **An ICU collation named in every query.** It needs ICU in every Postgres
  (ADR 003 §1.3), an index for each collation, and it changes saved sorts.
- **Let each evaluator follow its platform.** That is the disagreement this
  ADR exists to remove.

## 4. Remediation

Known gaps are listed in [remediation/033.md](remediation/033.md).
