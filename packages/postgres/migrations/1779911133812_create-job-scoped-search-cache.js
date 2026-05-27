exports.shorthands = undefined;

// Shared storage for the job-scoped federated-search cache. Each row holds one
// search-response body computed during one indexing job; keeping it in Postgres
// rather than process memory lets every realm-server replica share the same
// entries so horizontal scaling doesn't fragment the hit rate.
//
// The outer key is the `<jobId>.<reservationId>` job identity stamped on
// `x-boxel-job-id`; the inner key is the md5 of the canonical
// `(realms, query, opts)` signature — the same digest
// `JobScopedSearchCache.computeETag` emits as the entry's validator, so
// matching on the hash is consistent with the ETag protocol.
//
// UNLOGGED:
//   Pure cache data — losing it on a Postgres crash just means the next
//   federated-search recomputes and re-populates. No historical value, and
//   UNLOGGED bypasses WAL + replication for this hot-write table.
//   (node-pg-migrate's createTable doesn't expose UNLOGGED, so the table is
//   built with raw SQL.)
//
// Eviction:
//   `clearJob` (driven by the jobs_finished NOTIFY listener) deletes a finished
//   job's rows immediately. The created_at index backs an age-based janitor
//   that sweeps rows a job left behind on a missed NOTIFY.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNLOGGED TABLE job_scoped_search_cache (
      job_id          varchar     NOT NULL,
      inner_key_hash  varchar     NOT NULL,
      result          text        NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, inner_key_hash)
    );
    CREATE INDEX job_scoped_search_cache_created_at_idx
      ON job_scoped_search_cache (created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS job_scoped_search_cache;`);
};
