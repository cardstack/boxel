// An approximate nearest-neighbour index on each space's vectors.
//
// Every partition of `boxel_index_vectors` (one per space, see the
// partition-boxel-index-vectors-by-space migration) gets an HNSW index over a
// half-precision copy of its vectors:
//
//   CREATE INDEX <partition>_hnsw ON <partition>
//     USING hnsw ((embedding::halfvec(<dims>)) halfvec_cosine_ops)
//     WITH (m = 16, ef_construction = 64)
//
// The stored vectors stay full precision; the engine reads candidates
// through the index and re-scores them exactly (runtime-common/vector-query.ts),
// and only for a realm with more than a few thousand vectors in the field's
// space; smaller ones are scanned exactly. m and ef_construction are
// pgvector's defaults. Measured on 50,000 of OnTube's 256-d vectors: 12 s to
// build with 4 parallel workers and 512 MB of maintenance_work_mem, 40 MB of
// index, 1.7 ms a top-10 at ef_search 100 with 98.5% recall@10. The engine
// builds the index itself when it makes a new space's partition; this builds
// it for the partitions that already exist.
//
// CONCURRENTLY, so writes to a partition go on while its index is built,
// which cannot run inside a transaction, hence noTransaction(). An
// interrupted build leaves an INVALID index, which the engine never reads
// (it checks `indisvalid`); running this again drops and rebuilds it, and
// leaves a valid one alone. A space with more than 4,000 dimensions (past
// what an HNSW index on halfvec covers), or a pgvector older than 0.7 (no
// halfvec), keeps exact search only. Nothing happens where there is no
// vector catalog (no pgvector).

const MAX_DIMS = 4000;

async function partitions(pgm) {
  let [ready] = await pgm.db.select(
    `SELECT to_regclass('boxel_vector_spaces') IS NOT NULL AS catalog,
            EXISTS (SELECT 1 FROM pg_type WHERE typname = 'halfvec') AS halfvec`,
  );
  if (!ready || !ready.catalog || !ready.halfvec) {
    return [];
  }
  let rows = await pgm.db.select(
    `SELECT s.partition_name AS partition, s.dims, i.indisvalid AS valid
       FROM boxel_vector_spaces AS s
       JOIN pg_class AS p ON p.relname = s.partition_name AND p.relkind = 'r'
       LEFT JOIN pg_class AS c
         ON c.relname = s.partition_name || '_hnsw' AND c.relkind = 'i'
       LEFT JOIN pg_index AS i ON i.indexrelid = c.oid
      ORDER BY s.partition_name`,
  );
  return rows.filter((row) => /^[a-z0-9_]+$/.test(row.partition));
}

exports.up = async (pgm) => {
  pgm.noTransaction();
  let todo = (await partitions(pgm)).filter(
    (row) =>
      row.valid !== true &&
      Number.isInteger(row.dims) &&
      row.dims > 0 &&
      row.dims <= MAX_DIMS,
  );
  if (todo.length === 0) {
    return;
  }
  pgm.sql(`SET maintenance_work_mem = '512MB'`);
  pgm.sql(`SET max_parallel_maintenance_workers = 4`);
  for (let { partition, dims, valid } of todo) {
    if (valid === false) {
      pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${partition}_hnsw`);
    }
    pgm.sql(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${partition}_hnsw ON ${partition} USING hnsw ((embedding::halfvec(${dims})) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
  }
  pgm.sql(`RESET max_parallel_maintenance_workers`);
  pgm.sql(`RESET maintenance_work_mem`);
};

exports.down = async (pgm) => {
  pgm.noTransaction();
  for (let { partition } of await partitions(pgm)) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${partition}_hnsw`);
  }
};
