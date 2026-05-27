exports.shorthands = undefined;

// DB-backed storage for the job-scoped federated-search cache (CS-11278,
// Phase B of CS-11179). Phase A drove eviction off `NOTIFY jobs_finished`
// against an in-memory Map; moving the storage into Postgres makes the cache
// shared across realm-server replicas so horizontal scaling doesn't shred the
// hit rate.
//
// Key shape mirrors the in-memory cache: the outer key is the
// `<jobId>.<reservationId>` job identity stamped on `x-boxel-job-id`, and the
// inner key is the md5 of the canonical `(realms, query, opts)` signature —
// the same digest `JobScopedSearchCache.computeETag` already treats as the
// entry's identity, so matching on the hash is consistent with the existing
// ETag trust model.
//
// UNLOGGED:
//   Pure cache data — losing it on a Postgres crash just means the next
//   federated-search recomputes and re-populates. No historical value, and
//   UNLOGGED bypasses WAL + replication for this hot-write table. (As with
//   job_progress, node-pg-migrate's createTable doesn't expose UNLOGGED, so
//   the table is built with raw SQL.)
//
// Eviction:
//   `clearJob` (driven by the jobs_finished listener) deletes a finished
//   job's rows immediately. The created_at index backs an age-based janitor
//   that sweeps rows a job left behind on a missed NOTIFY — the same
//   missed-NOTIFY backstop the in-memory TTL provided.
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
