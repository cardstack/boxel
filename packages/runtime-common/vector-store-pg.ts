import { logger } from './log.ts';
import {
  param,
  separatedByCommas,
  type CardExpression,
  type Expression,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { hasVectorIndex } from './vector-index.ts';
import { spaceDimensions } from './vector-space.ts';
import type {
  LookalikeRequest,
  NearTarget,
  StoredVector,
  VectorRow,
  VectorStore,
} from './vector-store.ts';

const log = logger('vector-store-pg');

// The partition a space's vectors live in: a readable prefix (the
// vectorizer's name and the size) and a hash of the whole space, since a
// space is free text. The migration that partitioned the table names the
// existing spaces' partitions the same way; `boxel_vector_spaces` records
// each name, and is what every read goes by.
const partitionNameSql = `'boxel_index_vectors_'
  || left(coalesce(nullif(trim(both '_' FROM regexp_replace(
       lower(split_part(split_part($1::text, '@', 1), ' ', 1)),
       '[^a-z0-9]+', '_', 'g')), ''), 'space'), 18)
  || '_' || $2::int || '_' || left(md5($1::text), 8)`;

const DEFAULT_PARTITION = 'boxel_index_vectors_default';

// A string as a SQL literal, for DDL (which takes no bind parameters).
// Standard-conforming strings are on, so doubling quotes is the whole escape.
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

  // Whether the table is partitioned by space, with its catalog. A table
  // from before the partitioning migration is not, and every space then
  // shares it. Probed every half minute: the migration runs at startup, but
  // a database migrated under a running process is seen soon after.
  #partitionedAt = 0;
  #partitioned: Promise<boolean> | undefined;
  #isPartitioned(): Promise<boolean> {
    if (!this.#partitioned || Date.now() - this.#partitionedAt > 30_000) {
      this.#partitionedAt = Date.now();
      this.#partitioned = this.#dbAdapter
        .execute(
          `SELECT to_regclass('boxel_vector_spaces') IS NOT NULL
              AND EXISTS (SELECT 1 FROM pg_partitioned_table
                           WHERE partrelid = to_regclass('boxel_index_vectors')) AS partitioned`,
        )
        .then((rows) => Boolean(rows[0]?.partitioned))
        .catch(() => false);
    }
    return this.#partitioned;
  }

  // The spaces that have a partition, by space.
  #spaces = new Map<string, { partition: string; dims: number | null }>();
  async #loadSpaces() {
    let rows = await this.#dbAdapter.execute(
      'SELECT space, partition_name, dims FROM boxel_vector_spaces',
    );
    this.#spaces = new Map(
      rows.map((row) => [
        String(row.space),
        {
          partition: String(row.partition_name),
          dims: row.dims == null ? null : Number(row.dims),
        },
      ]),
    );
  }

  // Gives each space its own partition before vectors are written in it.
  // Runs in a transaction of its own, before the index writer's swap writes
  // any vector: attaching a partition locks the DEFAULT partition, which a
  // swap that had already written vectors would hold. Creation is
  // serialized by an advisory lock and is a no-op for a space that already
  // has one, so writers in several processes may race to create the same
  // space. A space whose partition can't be made in time (`lock_timeout`)
  // is written into the DEFAULT partition, where every read still finds it,
  // and moved out the next time its partition is created.
  async ensureSpaces(spaces: string[]): Promise<void> {
    let wanted = [...new Set(spaces)].filter(
      (space) => !this.#spaces.has(space),
    );
    if (wanted.length === 0 || !(await this.#isPartitioned())) {
      return;
    }
    await this.#loadSpaces();
    for (let space of wanted) {
      if (this.#spaces.has(space)) {
        continue;
      }
      try {
        await this.#createPartition(space);
      } catch (e) {
        log.warn(
          `could not create the vector partition for "${space}"; its vectors stay in the default partition: ${(e as Error).message}`,
        );
      }
    }
    await this.#loadSpaces();
  }

  async #createPartition(space: string) {
    let dims = spaceDimensions(space) ?? 0;
    await this.#dbAdapter.withTransaction(
      async (q) => {
        await q([`SET LOCAL lock_timeout = '2s'`]);
        await q([
          `SELECT pg_advisory_xact_lock(hashtext('boxel_index_vectors partitions'))`,
        ]);
        let [known] = await q([
          'SELECT partition_name FROM boxel_vector_spaces WHERE space =',
          param(space),
        ]);
        if (known) {
          return;
        }
        let [named] = await this.#dbAdapter.execute(
          `SELECT ${partitionNameSql} AS name`,
          { bind: [space, dims] },
        );
        let name = String(named.name);
        if (!/^[a-z0-9_]+$/.test(name)) {
          throw new Error(`unexpected partition name ${name}`);
        }
        // A table of the parent's shape, filled with any rows of the space
        // that landed in the DEFAULT partition, then attached: attaching
        // locks the parent only against other DDL, where creating the table
        // as a partition would lock out every read and write of the parent.
        await q([`CREATE TABLE ${name} (LIKE boxel_index_vectors)`]);
        let [hasDefault] = await q([
          `SELECT to_regclass('${DEFAULT_PARTITION}') IS NOT NULL AS present`,
        ]);
        if (hasDefault?.present) {
          await q([
            `WITH moved AS (DELETE FROM ${DEFAULT_PARTITION} WHERE space =`,
            param(space),
            `RETURNING *) INSERT INTO ${name} SELECT * FROM moved`,
          ]);
        }
        await q([
          `ALTER TABLE boxel_index_vectors ATTACH PARTITION ${name} FOR VALUES IN (${sqlLiteral(space)})`,
        ]);
        await q([
          'INSERT INTO boxel_vector_spaces (space, partition_name, dims) VALUES (',
          param(space),
          ',',
          param(name),
          ',',
          param(dims || null),
          ')',
        ]);
      },
      { label: `vector partition for ${space}` },
    );
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
  // The field path and dimension are inlined, checked. The settings are for
  // an HNSW index: the iterative scan keeps reading it until enough rows of
  // this realm turn up.
  async lookalikes(
    request: LookalikeRequest,
  ): Promise<{ src: string; nb: string; sim: number }[]> {
    let { realmURL, fieldPath: field, dims, k: fetchK, allowed } = request;
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
