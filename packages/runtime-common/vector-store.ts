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
  oneCardVectors(realmURL: string, url: string): Promise<StoredVector[]>;
  // A `select` column holding a card's vectors at a field.
  vectorColumn(fieldPath: string, list: boolean, alias: string): string;
  // Gives each space a home before vectors are written in it (a partition,
  // in Postgres). Runs outside the writer's transaction.
  ensureSpaces(spaces: string[]): Promise<void>;
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
