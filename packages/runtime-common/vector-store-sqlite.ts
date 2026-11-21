import { param, type CardExpression, type Expression } from './expression.ts';
import type { NearTarget, StoredVector, VectorStore } from './vector-store.ts';

// The SQLite index's vector store; the dialect picks it
// (query-engine/dialect.ts).

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
