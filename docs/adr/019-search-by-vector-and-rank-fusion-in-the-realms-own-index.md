---
status: proposed
date: 2026-11-05
scope:
  - packages/base/vector.gts
  - packages/runtime-common/vector-index.ts
  - packages/runtime-common/serializers/vector.ts
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/index-writer.ts
  - packages/runtime-common/instance-filter-matcher.ts
  - packages/runtime-common/query.ts
  - packages/postgres/migrations/*vector*.js
  - packages/postgres/scripts/schema-dump.sh
  - scripts/pg-container.sh
  - packages/realm-server/tests/scripts/test-pg-config.sh
---

# 019. Search by vector and rank fusion in the realm's own index

A card can carry embeddings in a `VectorField`. A realm search can filter on
them (`near`), sort by them (a `near` sort), and fuse several rankings into one
order (the `_blend` sort, reciprocal rank fusion). All of it runs in the index
the realm already searches: Postgres with the pgvector extension where it is
available, and the search doc's own vectors in the browser's SQLite index. This
record says where vectors live, what happens on a database without pgvector,
and why rank fusion is part of the query language rather than something each
caller builds.

## 1. Decision

### 1.1. Where vectors live

A `VectorField` value MUST be stored in the card's search doc, as the marked
string form its serializer writes. On Postgres, the index writer MUST also copy
each value into `boxel_index_vectors`, one row per card, field path and position,
when an index batch is promoted. Vectors MUST NOT become a column of
`boxel_index` or `boxel_index_pending`.

### 1.2. pgvector is optional

The migration that creates `boxel_index_vectors` MUST succeed on a database
where pgvector is missing or can't be created, by creating nothing. On such a
database the index writer MUST skip the vector copy, and a `near` filter or
sort MUST be refused with an error that names the missing extension. It MUST
NOT silently return unranked results.

### 1.3. The browser index scores from the search doc

The SQLite index MUST score `near` from the vectors in the search doc, so that a
query means the same thing on both adapters.
`instance-filter-matcher.ts` MUST mirror the `near` sort. It MUST leave `near`
filters and `_blend` sorts to the server, because a client holding part of the
match set can't rank against the whole of it.

### 1.4. Exact search by default

A `near` query SHOULD use exact cosine distance, with no approximate (HNSW or
IVF) index. An approximate index MAY be added as a partial expression index
per dimension once a realm's vector count makes exact search too slow.

### 1.5. The caller supplies the query vector

A `near` term MUST carry the target vector. The realm MUST NOT call an
embedding model while it answers a search. A caller embeds its question first,
for example through a card operation that uses a shared key.

### 1.6. Rank fusion is a sort

Combining rankings (text relevance, vector similarity, recency, an engagement
count) SHOULD be expressed as a `_blend` sort in the query. Callers SHOULD NOT
fetch several result lists and fuse them on the client.

### 1.7. The test database has pgvector

Tests that touch the vector index MUST run on a Postgres image that ships
pgvector, so CI fails, not skips, when vector search breaks.

## 2. Rationale

Cards already search through the realm's index, under the realm's permissions
and policy. Running vector search there means a `near` query obeys the same
permissions and policy, combines with every other filter in one statement, and
needs no second store to keep in sync. pgvector isn't a trusted extension, so
creating it needs a superuser (`rds_superuser` on RDS), and not every
environment has it. The migration therefore can't require it. pgvector is
open source and offered by most managed Postgres services, so it is not an
extension only one provider offers (ADR 003 §1.3). Keeping vectors
in a side table leaves the index tables, and their pending twins, unchanged.
Exact search over about 200k 256-dimension vectors takes about 45 ms, and an
HNSW index would make every index write slower and give approximate results
that a filter can't narrow well. Reciprocal rank fusion needs every signal's
rank over the whole match set, which only the server has.

## 3. Considered options

- **pgvector in the realm's Postgres, optional (chosen).** One index, one set
  of permissions, one query, and nothing breaks where pgvector is absent.
- **A separate vector database.** A second store to keep in step with
  indexing, outside the realm's permissions and policy, and a query that can't
  join the rest of the filter.
- **A `vector` column on `boxel_index`.** That would put the pgvector type in
  the index tables and their pending twins, and every database would then need
  pgvector.
- **Embedding the query inside the realm.** The realm would need a model key
  on every search path, and the cost would fall on whoever runs the realm, not
  whoever asks.
- **Rank fusion in each client.** Each client fetches several pages and gets a
  different, page-bounded answer.

## 4. Consequences

Turning vector search on where it was off means installing pgvector, running
the migration's SQL by hand (it is idempotent), and reindexing the realms whose
cards carry vectors. A local `boxel-pg` container created before the pgvector
image keeps working without vectors until it is recreated.

## 6. Sources

- `packages/postgres/migrations/1793862385000_add-boxel-index-vectors.js`
- `packages/runtime-common/vector-index.ts`
- `packages/runtime-common/index-query-engine.ts`
- `packages/realm-server/tests/vector-search-test.ts`
- `docs/search.md`

## 7. Remediation

Known gaps are listed in [remediation/019.md](remediation/019.md).
