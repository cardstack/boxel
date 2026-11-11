---
status: proposed
date: 2026-11-05
scope:
  - packages/base/vector.gts
  - packages/base/vectorizer.gts
  - packages/base/Vectorizer/**
  - packages/base/card-api.gts
  - packages/host/app/routes/render/meta.ts
  - packages/runtime-common/vector-space.ts
  - packages/runtime-common/vector-query.ts
  - packages/runtime-common/vector-store.ts
  - packages/runtime-common/vector-store-pg.ts
  - packages/runtime-common/vector-index-writer.ts
  - packages/runtime-common/vector-sidecar.ts
  - packages/runtime-common/definitions.ts
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/query-engine/**
  - packages/runtime-common/instance-filter-matcher.ts
  - packages/runtime-common/search-entry.ts
  - packages/postgres/migrations/*vector*.js
  - docs/search.md
---

# 034. Search vectors in the realm's own index, exactly until a space is large, and never across spaces

A card carries embeddings in vector fields, and a realm search filters on
them (`near`), sorts by them, and blends them with other rankings, in the
index the realm already searches: Postgres with pgvector, under the realm's
permissions and policy, in one statement with the rest of the query. A
search compares exactly until a space holds more than 100,000 vectors, so
answers at realm scale are exact. An embedding means something only next to embeddings from the same model,
revision and serving host, at the same size. Two vectors of the same length
from different models still produce a cosine similarity, and it looks as
plausible as a real one. So every vector field type names its space in full,
as static properties of the type, and a search compares a field only with
vectors stored in the space its type declares. A newer model ships as a new
type. The space format and the storage layout are in
[Search](../search.md#vector-search-near).

## 1. Decision

### 1.1. The space is a static property of the field type

A vector field's space MUST be the static `vectorizer` (an exact id with its
revision, never an alias or `latest`), `provider` and `dimensions` of its
field type, combined as `vectorSpace()` combines them. It MUST NOT be read
from a card's data, a realm's configuration, or a query. A plain
`VectorField` names no vectorizer, and its space is its size alone.

A vector field type of a kind (`TextVectorField`, `MultimodalVectorField`,
`SuppliedVectorField`) that leaves part of its space out MUST be refused when
its module loads (`needs-vectorizer`).

### 1.2. A type's space never changes

Once a type's space is published, its `vectorizer`, `provider` and
`dimensions` MUST NOT change. A new model, revision, provider or size MUST
ship as a new type.

### 1.3. Every stored vector records its space

The index MUST record the space of every vector it stores. Storage MUST be
keyed or partitioned by space, so that a search reads only the vectors of the
space it compares in.

### 1.4. Comparison stays inside one space

A `near` filter, a `near` sort, a look-alike and a blend signal MUST compare a
field only with the vectors stored in the space its type declares. A vector
stored in another space MUST NOT be compared, whatever its size. A target read
from a card carries its space, and MUST be refused with
`vector-space-mismatch` when that space differs. A target given as numbers is
taken to be in the declared space.

### 1.5. Search does not embed

A realm MUST NOT call an embedding model while it answers a search. The
caller supplies the target vector. When the platform vectorizes a card's
fields, it MUST do so through an adapter (ADR 003 §1.2), and it MUST NOT
store a vector under a space whose provider is not the one that produced it.

### 1.6. Vectors live in the realm's index, partitioned by space

Vectors MUST be stored in the realm server's Postgres, in a table
partitioned by space, beside the index and never as a column of
`boxel_index`. A `near` query MUST run in the same statement as the rest of
the query, under the same permissions and policy. Where pgvector is missing,
the migrations MUST still succeed, and a `near` query MUST be refused with an
error that names the extension, never answered unranked.

### 1.7. Exact until a space is large

A comparison MUST be exact while the space's partition holds no more than
the exact threshold (100,000 vectors by default,
`BOXEL_VECTOR_EXACT_THRESHOLD`). Past it, the server MUST build the space's
approximate (HNSW) index lazily, in the background after the index write
that crossed the threshold, without blocking reads or writes, and MUST NOT
drop it. Until the index is ready the search MUST stay exact, so an answer
does not change while it builds. Every similarity returned MUST be the exact
one, and `meta.near` MUST say which path ran.

## 2. Rationale

Embeddings from different models live in unrelated coordinate systems, and
the same model can differ between serving hosts in quantization or
truncation. A comparison across spaces returns numbers, not an error, so the
only protection is to never make one. The provider is part of the space for
that reason.

The space is a property of the type, not of the data, because a query must
know it before it reads any row. During a reindex that moves a field to a new
type, a realm holds vectors in both spaces. A space read from the data would
change with whichever card was indexed last. A space read from the type is
the same throughout, and the stale vectors are simply not read.

A type whose space never changes makes the guarantee checkable. A stored
vector's space either matches its type's or is stale. One storage partition
per space gives each model its own approximate index, and a search pays
nothing for other models' vectors.

Exact search over 50,000 256-dimension vectors takes about 16 ms, so a
realm-sized space does not need an approximate index, and an exact answer
is one a filter can narrow without losing rows. Building the index only
once a space is large keeps index writes cheap for every other realm.

The caller embeds a search's text because embedding costs money and needs a
key. The realm answering the search should not pay for it, and a search path
should not depend on a provider being up.

## 3. Considered options

- **The space as static properties of the type (chosen).**
- **Compare any two vectors of the same size.** This was the first design. It
  silently compares unrelated models.
- **Record the space per vector and check it at query time only.** The
  query then has no space to check against until it reads data, and a
  realm in the middle of a reindex holds two.
- **Let the query name the space.** It trusts every caller, and a field's
  vectors could then be compared in a space they were never written in.
- **Model aliases such as `latest`.** An alias silently moves every stored
  vector into a new space without a reindex.
- **Leave the provider out of the space.** It makes a type portable across
  hosts that serve the same model, at the price of comparing vectors that
  may differ by host. Portability is instead a new type with its own
  provider.
- **One vector table with no partitions.** Each search would scan every
  model's vectors.
- **A separate vector database.** A second store to keep in step, outside
  the realm's permissions, and a query that cannot join the rest of the
  filter.
- **An HNSW index from the first vector.** Every write pays for it, and
  small spaces get approximate answers they do not need.

## 4. Remediation

Known gaps are listed in [remediation/034.md](remediation/034.md).
