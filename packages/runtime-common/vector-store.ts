import { param, type CardExpression, type Expression } from './expression.ts';
import type { DBAdapter } from './db.ts';
import { PgVectorStore } from './vector-store-pg.ts';

// The vector store: where a near search reads the vectors it compares, and
// the only place that knows how a database holds them.
//
// Practice: a vector database behind a narrow, vendor-neutral interface, as
// LangChain's and LlamaIndex's `VectorStore` abstractions keep retrieval code
// apart from the store that serves it (pgvector, Qdrant, Elasticsearch).
// Boxel's mapping: the query engine and the index writer ask this interface
// for SQL fragments and reads; `vector-store-pg.ts` answers them with
// pgvector, and `SqliteVectorStore` below answers them for the browser's
// SQLite index. Where Boxel diverges: a near search is part of one SQL
// statement with the rest of the query (filters, facets, paging), so the
// interface hands back expressions to splice into that statement rather
// than running a separate vector query and joining in application code.

// Every default of approximate near search, in one place, each with where it
// came from. `setVectorSearchSettings` overrides them (tests; a deployment
// sets BOXEL_VECTOR_EXACT_THRESHOLD and BOXEL_VECTOR_EF_SEARCH).
export interface VectorSearchSettings {
  // Below this many of a realm's vectors in one field and space, a near
  // search scans them exactly; above it, it reads an approximate index.
  // Lucene and Elasticsearch make the same switch (an exact search when the
  // filtered set is small). An exact scan of 50,000 256-d vectors takes
  // about 16 ms here (so about 35 ms at this threshold), which is fast
  // enough that answers at a realm's scale stay exact; the index serves
  // larger spaces. A space's partition gets its index only once it holds
  // more than this many vectors (`PgVectorStore.buildIndexes`).
  exactThreshold: number;
  // Below this share of its space's vectors, a realm's vectors in a field
  // are scanned exactly too, however many: the index walk would pass over
  // most of what it reads, skipping other realms' and fields' vectors.
  // Measured on the orb stack's 248,000-vector space: a realm holding 4% of
  // it read its top 10 in 40 ms through the index against 4 ms exactly; one
  // holding 15% in 10 ms against 86 ms.
  minShare: number;
  // The HNSW search beam (pgvector's `hnsw.ef_search`, default 40).
  // Measured on 50,000 256-d passage vectors: 100 gives 98.5%
  // recall@10 against exact search at 1.7 ms a query.
  efSearch: number;
  // HNSW build settings: graph degree and build beam. pgvector's defaults
  // (16 and 64), measured above.
  m: number;
  efConstruction: number;
  // Approximate candidates read for a page, before exact re-scoring: at
  // least `rescoreFactor` times the rows the page needs (through its last
  // row), and at least `minRescore`. Elasticsearch's kNN search reads
  // `num_candidates` (default 1.5 x k) before its rescore; Vespa re-ranks a
  // first phase's top hits. A wider net is cheap here: the re-scoring reads
  // only the candidates' own vectors.
  rescoreFactor: number;
  minRescore: number;
  // The most candidates one approximate read takes (a page whose cards hold
  // many vectors each may need several reads, each four times the last).
  // Past it the search is exact. pgvector's iterative scans stop at
  // `hnsw.max_scan_tuples` (20,000) anyway.
  maxRescore: number;
  // The most cards an approximate near filter admits before it is answered
  // exactly instead: a threshold that admits more is not a nearest-neighbour
  // question.
  filterCandidates: number;
  // How far a half-precision distance may sit from the full-precision one,
  // so a vector at the edge of a filter's `minSimilarity` is still a
  // candidate for the exact check (half precision keeps about three
  // significant digits).
  halfPrecisionSlack: number;
}

function envNumber(name: string): number | undefined {
  let raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  let n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export const VECTOR_SEARCH_DEFAULTS: Readonly<VectorSearchSettings> = {
  exactThreshold: envNumber('BOXEL_VECTOR_EXACT_THRESHOLD') ?? 100_000,
  minShare: 0.1,
  efSearch: envNumber('BOXEL_VECTOR_EF_SEARCH') ?? 100,
  m: 16,
  efConstruction: 64,
  rescoreFactor: 4,
  minRescore: 100,
  maxRescore: 4_000,
  filterCandidates: 1_000,
  halfPrecisionSlack: 0.005,
};

let settings: VectorSearchSettings = { ...VECTOR_SEARCH_DEFAULTS };

export function vectorSearchSettings(): Readonly<VectorSearchSettings> {
  return settings;
}

// Overrides some settings; with no argument, restores the defaults.
export function setVectorSearchSettings(
  overrides?: Partial<VectorSearchSettings>,
) {
  settings = { ...VECTOR_SEARCH_DEFAULTS, ...(overrides ?? {}) };
}

export interface NearTarget {
  // the vector field's path, without list brackets (`segments.embedding`)
  fieldPath: string;
  dims: number;
  // the target vector as a '[…]' literal
  literal: string;
  // the space the target was read in, for a target read from a stored card
  targetSpace?: string;
  // the space the field is declared in
  declaredSpace?: string;
  // When an approximate read chose them: the only cards (by URL) whose
  // vectors are compared, each exactly.
  candidates?: string[];
}

// The vectors an approximate read found nearest a target, in a realm, a
// field and a space: by URL, with the approximate distance, nearest first.
export interface NearCandidateRequest {
  realmURL: string;
  fieldPath: string;
  space: string;
  // the target as a '[…]' literal
  literal: string;
  k: number;
  // keep only vectors within this cosine distance (a filter's threshold)
  maxDistance?: number;
  // the search's read snapshot, when the read is part of one
  reader?: DBAdapter;
}

export interface VectorStore {
  readonly kind: 'pg' | 'sqlite';
  // Whether this database holds vectors at all.
  available(): Promise<boolean>;
  // A near filter's predicate on the card row `i`: the card has a vector at
  // the path of the target's size and, given `minSimilarity`, at least that
  // cosine similarity to the target.
  nearFilterCondition(
    target: NearTarget,
    minSimilarity: number | undefined,
  ): CardExpression;
  // The joins a near sort or blend signal adds, under `alias`, and the
  // card's cosine similarity to the target (its nearest vector at the path,
  // NULL when it has none), aggregated over the card's group.
  nearSimilarity(
    alias: string,
    target: NearTarget,
  ): { joins: CardExpression; similarity: CardExpression };
  // The spaces a field's vectors of one size are stored in, in one realm.
  spacesOf(
    realmURL: string,
    fieldPath: string,
    dims: number,
  ): Promise<string[]>;
  // The size of a field's vectors in a realm.
  fieldDims(realmURL: string, fieldPath: string): Promise<number | undefined>;
  // Each source card's nearest cards by one field (`compare.near`).
  lookalikes(
    request: LookalikeRequest,
  ): Promise<{ src: string; nb: string; sim: number }[]>;
  // How many vectors a card holds per field and space.
  vectorCounts(
    url: string,
  ): Promise<{ fieldPath: string; space: string; count: number }[]>;
  // A card's single (non-list) vectors, with their spaces.
  oneCardVectors(
    realmURL: string,
    url: string,
    reader?: DBAdapter,
  ): Promise<StoredVector[]>;
  // A `select` column holding a card's vectors at a field.
  vectorColumn(fieldPath: string, list: boolean, alias: string): string;
  // Whether a space's vectors have an approximate (nearest-neighbour) index,
  // with the settings it reads them by.
  nearIndex(space: string): Promise<boolean>;
  // About how many vectors a space holds in all, the planner's estimate
  // (undefined when there is none yet).
  spaceSize(space: string): Promise<number | undefined>;
  // How many vectors a realm holds in one field and space, counting no
  // further than `limit`.
  countVectors(opts: {
    realmURL: string;
    fieldPath: string;
    space: string;
    limit: number;
  }): Promise<number>;
  // The vectors nearest a target by the approximate index.
  nearCandidates(
    request: NearCandidateRequest,
  ): Promise<{ url: string; distance: number }[]>;
  // Gives each space a home before vectors are written in it (a partition,
  // in Postgres). Runs outside the writer's transaction.
  ensureSpaces(spaces: string[]): Promise<void>;
  // Records that vectors were written in these spaces, inside the writer's
  // transaction; `buildIndexes`, after it commits, looks at them.
  noteVectorWrites(spaces: string[]): void;
  // Builds the approximate index of each noted space (and each of
  // `spaces`) whose vectors now number more than the exact threshold. The
  // index writer starts it after a commit and does not wait for it. Resolves
  // when every build asked for so far has finished; never rejects.
  buildIndexes(spaces?: string[]): Promise<void>;
  // Index writes: remove the rows `condition` selects; add `rows`.
  deleteVectors(condition: Expression): Expression;
  insertVectors(rows: VectorRow[]): Expression;
}

export interface LookalikeRequest {
  realmURL: string;
  fieldPath: string;
  dims: number;
  declaredSpace: string | undefined;
  // the cards whose look-alikes are read
  sourceUrls: string[];
  // how many neighbours to read per card
  k: number;
  // the neighbours a card may have, when a filter or a grant narrows them
  allowed: Set<string> | undefined;
  // read through the space's approximate index, then re-scored exactly
  approximate: boolean;
  // the search's read snapshot, when the read is part of one
  reader?: DBAdapter;
}

export interface StoredVector {
  fieldPath: string;
  space: string;
  // the components as a '[…]' literal
  components: string;
}

export interface VectorRow {
  realmURL: string;
  url: string;
  type: string;
  fieldPath: string;
  itemId: string;
  ordinal: number;
  space: string;
  sourceHash: string | undefined;
  components: ArrayLike<number>;
}

function needsPostgres(): never {
  throw new Error('vectors are stored only on Postgres with pgvector');
}

// SQLite (the browser index the host tests run on) has no vector type, so it
// scores the search doc's own "vec:[…]" string with json_each. That is a
// fallback for small test indexes, not for real data: it is always exact.
export class SqliteVectorStore implements VectorStore {
  readonly kind = 'sqlite' as const;

  async available(): Promise<boolean> {
    return false;
  }

  nearFilterCondition(
    target: NearTarget,
    minSimilarity: number | undefined,
  ): CardExpression {
    let jsonPath = `$.${target.fieldPath}`;
    return [
      'json_array_length(substr(json_extract(i.search_doc,',
      param(jsonPath),
      '), 5)) =',
      param(target.dims),
      ...(minSimilarity == null
        ? []
        : [
            'AND',
            ...sqliteCosineSimilarity(jsonPath, target.literal),
            '>=',
            param(minSimilarity),
          ]),
    ];
  }

  nearSimilarity(
    _alias: string,
    target: NearTarget,
  ): { joins: CardExpression; similarity: CardExpression } {
    return {
      joins: [],
      similarity: [
        'MAX(',
        ...sqliteCosineSimilarity(`$.${target.fieldPath}`, target.literal),
        ')',
      ],
    };
  }

  // SQLite keeps no vector table: there is nothing stored to read.
  async spacesOf(): Promise<string[]> {
    return [];
  }
  async fieldDims(): Promise<number | undefined> {
    return undefined;
  }
  async lookalikes(): Promise<never> {
    needsPostgres();
  }
  async vectorCounts() {
    return [];
  }
  async ensureSpaces(): Promise<void> {}
  noteVectorWrites(): void {}
  async buildIndexes(): Promise<void> {}
  async nearIndex(): Promise<boolean> {
    return false;
  }
  async countVectors(): Promise<number> {
    return 0;
  }
  async spaceSize(): Promise<number | undefined> {
    return undefined;
  }
  async nearCandidates(): Promise<never> {
    needsPostgres();
  }
  async oneCardVectors(): Promise<StoredVector[]> {
    return [];
  }
  vectorColumn(): string {
    needsPostgres();
  }
  deleteVectors(): Expression {
    needsPostgres();
  }
  insertVectors(): Expression {
    needsPostgres();
  }
}

// SQLite's stand-in for pgvector: the cosine similarity between the
// search doc's "vec:[…]" string at `jsonPath` and `target` (a '[…]' literal),
// as a scalar subquery. NULL when the doc has no vector there.
function sqliteCosineSimilarity(
  jsonPath: string,
  target: string,
): CardExpression {
  return [
    '(SELECT SUM(a.value * b.value) / (sqrt(SUM(a.value * a.value)) * sqrt(SUM(b.value * b.value))) FROM json_each(substr(json_extract(i.search_doc,',
    param(jsonPath),
    '), 5)) AS a JOIN json_each(',
    param(target),
    ') AS b ON a.key = b.key)',
  ];
}

const stores = new WeakMap<DBAdapter, VectorStore>();

// The store for a database, one per adapter.
export function vectorStoreFor(dbAdapter: DBAdapter): VectorStore {
  let store = stores.get(dbAdapter);
  if (!store) {
    store =
      dbAdapter.kind === 'pg'
        ? new PgVectorStore(dbAdapter)
        : new SqliteVectorStore();
    stores.set(dbAdapter, store);
  }
  return store;
}
