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
import {
  vectorSearchSettings,
  type LookalikeRequest,
  type NearCandidateRequest,
  type NearTarget,
  type StoredVector,
  type VectorRow,
  type VectorStore,
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

// pgvector's HNSW index covers up to 4,000 dimensions of `halfvec` (2,000 of
// `vector`).
const MAX_HALFVEC_INDEX_DIMS = 4_000;

// The approximate index on a space's partition. It indexes a half-precision
// copy of each vector (`embedding::halfvec(N)`, about half the size of a
// full-precision index, measured at 40 MB per 50,000 256-d vectors); the
// stored vector stays full precision, and every candidate is re-scored
// against it.
export function hnswIndexName(partition: string): string {
  return `${partition}_hnsw`;
}

function hnswIndexDdl(partition: string, dims: number): string {
  let { m, efConstruction } = vectorSearchSettings();
  return `CREATE INDEX IF NOT EXISTS ${hnswIndexName(partition)} ON ${partition} USING hnsw ((embedding::halfvec(${dims})) halfvec_cosine_ops) WITH (m = ${m}, ef_construction = ${efConstruction})`;
}

// The settings an approximate read runs under, for its transaction only. A
// failed SET aborts the whole transaction in Postgres, so they go in a
// savepoint: on a pgvector without iterative scans (before 0.8) the
// savepoint is rolled back and the read runs as a plain index scan, which
// may return fewer rows than it asks for.
async function hnswSettings(
  q: (expression: Expression) => Promise<unknown>,
  efSearch: number,
) {
  await q(['SAVEPOINT hnsw_settings']);
  try {
    await q(['SET LOCAL hnsw.iterative_scan = relaxed_order']);
    await q([`SET LOCAL hnsw.ef_search = ${Math.round(efSearch)}`]);
    await q(['RELEASE SAVEPOINT hnsw_settings']);
  } catch {
    await q(['ROLLBACK TO SAVEPOINT hnsw_settings']);
  }
}

// Only these cards' vectors: the candidates an approximate read chose.
function amongCandidates(alias: string, urls: string[] | undefined) {
  return urls
    ? [
        `AND ${alias}.url IN (SELECT jsonb_array_elements_text(CAST(`,
        param(JSON.stringify(urls)),
        'AS jsonb)))',
      ]
    : [];
}

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
// Partitions: the table is partitioned by space (one partition per
// embedding model and size, as Elasticsearch and OpenSearch keep one index
// per model and dimension), so a search reads only its space's pages, and
// each partition carries its own HNSW index over a half-precision copy of its
// vectors. A read is bounded by realm, card type, field and item within the
// partition; the iterative scan applies those filters while it walks the
// graph, so a realm sharing a space with a larger one still gets its full
// page.
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

  // The spaces that have a partition, by space, and whether its HNSW index
  // is ready (an index still being built concurrently is not).
  #spaces = new Map<
    string,
    {
      partition: string;
      dims: number | null;
      indexed: boolean;
      rows: number | undefined;
    }
  >();
  #spacesAt = 0;
  async #loadSpaces() {
    let rows = await this.#dbAdapter
      .execute(
        `SELECT s.space, s.partition_name, s.dims,
                max(p.reltuples) AS rows,
                COALESCE(bool_or(i.indisvalid AND i.indisready), false) AS indexed
           FROM boxel_vector_spaces AS s
           LEFT JOIN pg_class AS p
             ON p.relname = s.partition_name AND p.relkind = 'r'
           LEFT JOIN pg_class AS c
             ON c.relname = s.partition_name || '_hnsw' AND c.relkind = 'i'
           LEFT JOIN pg_index AS i ON i.indexrelid = c.oid
          GROUP BY s.space, s.partition_name, s.dims`,
      )
      .catch(() => []);
    this.#spacesAt = Date.now();
    this.#spaces = new Map(
      rows.map((row) => [
        String(row.space),
        {
          partition: String(row.partition_name),
          dims: row.dims == null ? null : Number(row.dims),
          indexed: Boolean(row.indexed),
          // -1 until the partition is first analyzed
          rows:
            row.rows != null && Number(row.rows) >= 0
              ? Number(row.rows)
              : undefined,
        },
      ]),
    );
  }

  async #space(space: string) {
    if (Date.now() - this.#spacesAt > 30_000) {
      if (!(await this.#isPartitioned())) {
        this.#spaces = new Map();
        this.#spacesAt = Date.now();
        return undefined;
      }
      await this.#loadSpaces();
    }
    return this.#spaces.get(space);
  }

  async spaceSize(space: string): Promise<number | undefined> {
    return (await this.#space(space))?.rows;
  }

  async nearIndex(space: string): Promise<boolean> {
    let info = await this.#space(space);
    return Boolean(info?.indexed && info.dims);
  }

  // A bounded count, read through the partition's (realm_url, field_path,
  // space) index, and cached briefly: a realm's size changes only when it is
  // indexed.
  #counts = new Map<string, { at: number; n: Promise<number> }>();
  async countVectors(opts: {
    realmURL: string;
    fieldPath: string;
    space: string;
    limit: number;
  }): Promise<number> {
    let key = `${opts.realmURL} ${opts.fieldPath} ${opts.space} ${opts.limit}`;
    let cached = this.#counts.get(key);
    if (!cached || Date.now() - cached.at > 30_000) {
      let info = await this.#space(opts.space);
      cached = {
        at: Date.now(),
        n: this.#dbAdapter
          .execute(
            `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${info?.partition ?? 'boxel_index_vectors'} WHERE realm_url = $1 AND field_path = $2 AND space = $3 LIMIT $4) AS s`,
            {
              bind: [opts.realmURL, opts.fieldPath, opts.space, opts.limit],
            },
          )
          .then((rows) => Number(rows[0]?.n ?? 0))
          .catch(() => 0),
      };
      this.#counts.set(key, cached);
    }
    return cached.n;
  }

  // The vectors nearest the target, read from the space's partition through
  // its HNSW index, nearest first by half-precision distance. Bounded to the
  // realm and field; with `maxDistance`, to vectors within it. The iterative
  // scan keeps walking the graph until `k` rows pass those filters (or it
  // reaches pgvector's `hnsw.max_scan_tuples`).
  async nearCandidates(
    request: NearCandidateRequest,
  ): Promise<{ url: string; distance: number }[]> {
    let info = await this.#space(request.space);
    if (!info?.indexed || !info.dims) {
      throw new Error(`the space "${request.space}" has no vector index`);
    }
    let half = `halfvec(${info.dims})`;
    let distance: Expression = [
      `(v.embedding::${half} <=> CAST(`,
      param(request.literal),
      `AS ${half}))`,
    ];
    let k = Math.max(1, Math.round(request.k));
    let rows = await this.#dbAdapter.withTransaction(async (q) => {
      await hnswSettings(q, Math.max(vectorSearchSettings().efSearch, 1));
      return await q([
        'SELECT v.url AS url,',
        ...distance,
        `AS distance FROM ${info!.partition} AS v WHERE v.realm_url =`,
        param(request.realmURL),
        'AND v.field_path =',
        param(request.fieldPath),
        ...(request.maxDistance == null
          ? []
          : ['AND', ...distance, '<=', param(request.maxDistance)]),
        'ORDER BY',
        ...distance,
        `LIMIT ${k}`,
      ]);
    });
    return rows.map((row) => ({
      url: String(row.url),
      distance: Number(row.distance),
    }));
  }

  // Gives each space its own partition, with its approximate index, before
  // vectors are written in it.
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
        // Its approximate index, built while the table is still small and
        // its own. A pgvector without `halfvec` (before 0.7), or a size past
        // what the index covers, leaves the space exact-only.
        if (dims > 0 && dims <= MAX_HALFVEC_INDEX_DIMS) {
          await q(['SAVEPOINT hnsw_index']);
          try {
            await q([hnswIndexDdl(name, dims)]);
            await q(['RELEASE SAVEPOINT hnsw_index']);
          } catch (e) {
            await q(['ROLLBACK TO SAVEPOINT hnsw_index']);
            log.warn(
              `the vectors of "${space}" have no approximate index: ${(e as Error).message}`,
            );
          }
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
      ...amongCandidates('nvf', target.candidates),
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
  // leaves NULL for a card with no vector at the path. Every vector compared
  // is scored exactly, at full precision: all of a field's vectors in the
  // realm and space, or, after an approximate read, the candidates' own.
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
        ...amongCandidates(alias, target.candidates),
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

  // Each source card's nearest cards by one field, in its realm and space,
  // nearest first. Exact, or, given `approximate`, read through the space's
  // HNSW index (a wider net, `rescoreFactor` times `k`) and then re-scored
  // exactly, keeping the `k` nearest by full-precision similarity.
  async lookalikes(
    request: LookalikeRequest,
  ): Promise<{ src: string; nb: string; sim: number }[]> {
    let { realmURL, fieldPath, dims, k, allowed } = request;
    let info =
      request.approximate && request.declaredSpace
        ? await this.#space(request.declaredSpace)
        : undefined;
    let partition = info?.indexed ? info.partition : undefined;
    let table = partition ?? 'boxel_index_vectors';
    let settings = vectorSearchSettings();
    let fetchK = partition
      ? Math.max(k * settings.rescoreFactor, settings.minRescore)
      : k;
    let half = `::halfvec(${dims})`;
    let order = partition
      ? `v.embedding${half} <=> s.embedding${half}`
      : 'v.embedding <=> s.embedding';
    let pairs = await this.#dbAdapter.withTransaction(async (q) => {
      if (partition) {
        await hnswSettings(q, Math.max(settings.efSearch, fetchK));
      }
      return await q([
        `SELECT s.url AS src, n.url AS nb, n.sim AS sim
           FROM ${table} AS s
           CROSS JOIN LATERAL (
             SELECT c.url, 1 - (c.embedding <=> s.embedding) AS sim
               FROM (
                 SELECT v.url, v.embedding
                   FROM ${table} AS v
                  WHERE v.field_path =`,
        param(fieldPath),
        'AND v.dims =',
        param(dims),
        `AND v.realm_url = s.realm_url AND v.url <> s.url
                    AND v.type = 'instance' AND v.space = s.space`,
        ...(allowed
          ? [
              'AND v.url IN (SELECT jsonb_array_elements_text(',
              param(JSON.stringify([...allowed])),
              '::jsonb))',
            ]
          : []),
        `ORDER BY ${order}
                  LIMIT ${fetchK}
               ) AS c
              ORDER BY c.embedding <=> s.embedding
              LIMIT ${k}
           ) AS n
          WHERE s.field_path =`,
        param(fieldPath),
        'AND s.dims =',
        param(dims),
        'AND s.ordinal = 0',
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
