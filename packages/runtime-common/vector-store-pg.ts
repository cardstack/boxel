import { logger } from './log.ts';
import {
  param,
  separatedByCommas,
  type CardExpression,
  type Expression,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { hasVectorIndex } from './vector-index.ts';
import type {
  LookalikeRequest,
  NearTarget,
  StoredVector,
  VectorRow,
  VectorStore,
} from './vector-store.ts';

const log = logger('vector-store-pg');

// Vectors in Postgres, with pgvector.
//
// Practice: pgvector's `vector` type and its cosine distance operator `<=>`
// (similarity is `1 - <=>`), read exactly by a scan, or approximately
// through an HNSW graph index (Malkov and Yashunin, 2016), with pgvector
// 0.8's iterative index scans (`hnsw.iterative_scan`) so a filtered read
// keeps walking the graph until enough rows pass the filter.
// Boxel's mapping: one table, `boxel_index_vectors`, holds every card's
// vectors, one row per (card, field path, list item), each with the full
// space string (vector-space.ts) it was made in. The engine never compares
// two spaces, so every read here is bounded by space as well as by realm,
// field and size.
//
// Everything specific to Postgres and pgvector is in this file: the SQL that
// reads and writes the table, the casts, the index DDL, and the `SET LOCAL`
// settings. The query engine and the index writer reach it through the
// vendor-neutral `VectorStore` interface (vector-store.ts).

// The spaces a field's vectors of one size are stored in, in one realm
// (`VectorQuery#spacesOf`). Exported for the test that pins its plan.
export const spacesOfSql = `SELECT DISTINCT space FROM boxel_index_vectors WHERE realm_url = $1 AND field_path = $2 AND dims = $3 LIMIT 8`;

// Restricts a vector-table alias to a space, when there is one.
function spaceEquals(alias: string, space: string | undefined): Expression {
  return space == null ? [] : [`AND ${alias}.space =`, param(space)];
}

export class PgVectorStore implements VectorStore {
  readonly kind = 'pg' as const;
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  available(): Promise<boolean> {
    return hasVectorIndex(this.#dbAdapter);
  }

  // An uncorrelated IN rather than a correlated EXISTS: under AND the
  // planner makes it a semi-join, and under OR (`any`) a hashed SubPlan
  // that scans the vectors once instead of once per candidate row.
  nearFilterCondition(
    target: NearTarget,
    minSimilarity: number | undefined,
  ): CardExpression {
    return [
      '(i.realm_url, i.url, i.type) IN (SELECT nvf.realm_url, nvf.url, nvf.type FROM boxel_index_vectors AS nvf WHERE nvf.field_path =',
      param(target.fieldPath),
      'AND nvf.dims =',
      param(target.dims),
      ...spaceEquals('nvf', target.targetSpace),
      ...spaceEquals('nvf', target.declaredSpace),
      ...(minSimilarity == null
        ? []
        : [
            'AND (nvf.embedding <=> CAST(',
            param(target.literal),
            'AS vector)) <=',
            param(1 - minSimilarity),
          ]),
      ')',
    ];
  }

  // One LEFT JOIN per near sort or signal, on the card's row and the field
  // path; MAX folds a plural field's vectors into the card's nearest one, and
  // leaves NULL for a card with no vector at the path. Exact: every row the
  // filter admits is scored.
  nearSimilarity(
    alias: string,
    target: NearTarget,
  ): { joins: CardExpression; similarity: CardExpression } {
    return {
      joins: [
        `LEFT JOIN boxel_index_vectors AS ${alias} ON ${alias}.realm_url = i.realm_url AND ${alias}.url = i.url AND ${alias}.type = i.type AND ${alias}.field_path =`,
        param(target.fieldPath),
        `AND ${alias}.dims =`,
        param(target.dims),
        ...spaceEquals(alias, target.targetSpace),
        ...spaceEquals(alias, target.declaredSpace),
      ],
      similarity: [
        `MAX(1 - (${alias}.embedding <=> CAST(`,
        param(target.literal),
        'AS vector)))',
      ],
    };
  }

  async spacesOf(
    realmURL: string,
    fieldPath: string,
    dims: number,
  ): Promise<string[]> {
    let rows = await this.#dbAdapter.execute(spacesOfSql, {
      bind: [realmURL, fieldPath, dims],
    });
    return rows.map((row) => String(row.space ?? ''));
  }

  // The size of a field's vectors in a realm, from any one of them.
  async fieldDims(
    realmURL: string,
    fieldPath: string,
  ): Promise<number | undefined> {
    let [dimsRow] = await this.#dbAdapter.execute(
      'SELECT dims FROM boxel_index_vectors WHERE realm_url = $1 AND field_path = $2 LIMIT 1',
      { bind: [realmURL, fieldPath] },
    );
    return dimsRow ? Number(dimsRow.dims) : undefined;
  }

  // Each source card's nearest cards by one field, in its realm and space.
  // The field path and dimension are inlined, checked, so the planner
  // matches the partial index; the iterative scan keeps reading the index
  // until enough rows of this realm turn up.
  async lookalikes(
    request: LookalikeRequest,
  ): Promise<{ src: string; nb: string; sim: number }[]> {
    let { realmURL, fieldPath: field, dims, k: fetchK, allowed } = request;
    void this.#ensureNeighborIndex(field, dims);
    let vec = `::vector(${dims})`;
    let pairs = await this.#dbAdapter.withTransaction(async (q) => {
      // A failed SET aborts the whole transaction in Postgres, so the
      // settings go in a savepoint: on an older pgvector, which has neither,
      // the savepoint is rolled back and the read runs as a plain index scan,
      // which may return fewer.
      await q(['SAVEPOINT hnsw_settings']);
      try {
        await q(['SET LOCAL hnsw.iterative_scan = relaxed_order']);
        await q([`SET LOCAL hnsw.ef_search = ${Math.max(40, fetchK * 2)}`]);
        await q(['RELEASE SAVEPOINT hnsw_settings']);
      } catch {
        await q(['ROLLBACK TO SAVEPOINT hnsw_settings']);
      }
      return await q([
        `SELECT s.url AS src, n.url AS nb, n.sim AS sim
           FROM boxel_index_vectors AS s
           CROSS JOIN LATERAL (
             SELECT v.url, 1 - (v.embedding${vec} <=> s.embedding${vec}) AS sim
               FROM boxel_index_vectors AS v
              WHERE v.field_path = '${field}' AND v.dims = ${dims}
                AND v.realm_url = s.realm_url AND v.url <> s.url
                AND v.type = 'instance' AND v.space = s.space`,
        ...(allowed
          ? [
              'AND v.url IN (SELECT jsonb_array_elements_text(',
              param(JSON.stringify([...allowed])),
              '::jsonb))',
            ]
          : []),
        `ORDER BY v.embedding${vec} <=> s.embedding${vec}
              LIMIT ${fetchK}
           ) AS n
          WHERE s.field_path = '${field}' AND s.dims = ${dims} AND s.ordinal = 0`,
        ...spaceEquals('s', request.declaredSpace),
        'AND s.realm_url =',
        param(realmURL),
        'AND s.url IN (',
        ...request.sourceUrls.flatMap((url, i) =>
          i ? [',', param(url)] : [param(url)],
        ),
        ')',
      ]);
    });
    return (pairs as Record<string, unknown>[]).map((p) => ({
      src: String(p.src),
      nb: String(p.nb),
      sim: Number(p.sim),
    }));
  }

  // The nearest-neighbour index for one declared vector field and
  // dimension: an HNSW index over that slice of boxel_index_vectors, built
  // once, concurrently, the first time a search asks for look-alikes by it.
  // Until it is valid, lookups scan exactly.
  #neighborIndexes = new Map<string, Promise<void>>();
  #ensureNeighborIndex(field: string, dims: number): Promise<void> {
    let key = `${field}:${dims}`;
    let pending = this.#neighborIndexes.get(key);
    if (pending) return pending;
    let slug = field
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 30);
    let name = `boxel_index_vectors_nb_${slug}_${dims}`;
    pending = (async () => {
      try {
        let [existing] = await this.#dbAdapter.execute(
          `SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1`,
          { bind: [name] },
        );
        if (existing && existing.valid) return;
        if (existing) {
          await this.#dbAdapter.execute(
            `DROP INDEX CONCURRENTLY IF EXISTS ${name}`,
          );
        }
        await this.#dbAdapter.execute(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON boxel_index_vectors USING hnsw ((embedding::vector(${dims})) vector_cosine_ops) WHERE field_path = '${field}' AND dims = ${dims}`,
        );
      } catch (e) {
        this.#neighborIndexes.delete(key);
        log.warn(
          `could not build the neighbour index ${name}: ${(e as Error).message}`,
        );
      }
    })();
    this.#neighborIndexes.set(key, pending);
    return pending;
  }

  // How many vectors a card holds per field and space.
  async vectorCounts(
    url: string,
  ): Promise<{ fieldPath: string; space: string; count: number }[]> {
    let rows = await this.#dbAdapter.execute(
      `SELECT field_path, space, count(*) AS n FROM boxel_index_vectors WHERE url = $1 AND type = 'instance' GROUP BY field_path, space`,
      { bind: [url] },
    );
    return rows.map((row) => ({
      fieldPath: String(row.field_path),
      space: String(row.space),
      count: Number(row.n),
    }));
  }

  // A card's single (non-list) vectors, with their spaces.
  async oneCardVectors(realmURL: string, url: string): Promise<StoredVector[]> {
    let rows = await this.#dbAdapter.execute(
      `SELECT field_path, space, embedding::text AS components FROM boxel_index_vectors WHERE realm_url = $1 AND url = $2 AND type = 'instance' AND item_id = ''`,
      { bind: [realmURL, url] },
    );
    return rows.map((row) => ({
      fieldPath: String(row.field_path),
      space: String(row.space ?? ''),
      components: String(row.components),
    }));
  }

  // A `select` column holding the card's own vectors at a field, each with
  // its space (and, inside a list, its item id), in item order.
  vectorColumn(fieldPath: string, list: boolean, alias: string): string {
    let match = `v.realm_url = i.realm_url AND v.url = i.url AND v.type = i.type AND v.field_path = '${fieldPath.replace(/'/g, "''")}'`;
    return list
      ? `, ANY_VALUE((SELECT jsonb_agg(jsonb_build_object('item', v.item_id, 'space', v.space, 'values', v.embedding::text::jsonb) ORDER BY v.ordinal, v.item_id) FROM boxel_index_vectors AS v WHERE ${match})) AS "${alias}"`
      : `, ANY_VALUE((SELECT jsonb_build_object('space', v.space, 'values', v.embedding::text::jsonb) FROM boxel_index_vectors AS v WHERE ${match} AND v.item_id = '' LIMIT 1)) AS "${alias}"`;
  }

  // Index writes. `condition` selects the rows of the URLs being re-derived.
  deleteVectors(condition: Expression): Expression {
    return ['DELETE FROM boxel_index_vectors WHERE', ...condition];
  }

  insertVectors(rows: VectorRow[]): Expression {
    let values: Expression[] = rows.map((v) => [
      '(',
      param(v.realmURL),
      ',',
      param(v.url),
      ',',
      param(v.type),
      ',',
      param(v.fieldPath),
      ',',
      param(v.itemId),
      ',',
      param(v.ordinal),
      ',',
      param(v.space),
      ',',
      param(v.sourceHash ?? null),
      ',',
      param(v.components.length),
      ', CAST(',
      param(`[${Array.from(v.components).join(',')}]`),
      'AS vector))',
    ]);
    return [
      'INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, item_id, ordinal, space, source_hash, dims, embedding) VALUES',
      ...(separatedByCommas(values) as Expression),
    ];
  }
}
