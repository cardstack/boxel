exports.shorthands = undefined;

// Shared storage for the job-scoped per-instance wire-format cache. Each row
// holds one card's fully-assembled JSON:API resource (its `pristine_doc` plus
// its populated query-field umbrellas) computed once during one indexing job
// and reused for every later occurrence of that instance within the job — as a
// search result, a per-URL card GET, or a linked target of another card. Like
// the federated-search cache it lives in Postgres so every realm-server replica
// shares the same entries.
//
// Key: the outer `job_id` is the `<jobId>.<reservationId>` job identity stamped
// on `x-boxel-job-id` (a job can re-run under a new reservation, and committed
// `boxel_index` may move between runs, so the reservation must be part of the
// key); the inner key is the instance URL. Correctness rests on `boxel_index`
// being frozen for a job's lifetime (the writer touches `boxel_index_working`
// until the final swap), so a per-instance entry is stable within the job and
// no cross-entry invalidation is needed.
//
// UNLOGGED: pure cache data — losing it on a Postgres crash just means the next
// assembly recomputes and re-populates. No historical value, and UNLOGGED
// bypasses WAL + replication for this hot-write table. (node-pg-migrate's
// createTable doesn't expose UNLOGGED, so the table is built with raw SQL.)
//
// Eviction: a finished job's rows are dropped by the jobs_finished NOTIFY
// listener; the created_at index backs an age-based janitor that sweeps rows a
// job left behind on a missed NOTIFY — the same lifecycle as
// job_scoped_search_cache.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNLOGGED TABLE job_scoped_instance_cache (
      job_id      varchar     NOT NULL,
      url         varchar     NOT NULL,
      result      text        NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, url)
    );
    CREATE INDEX job_scoped_instance_cache_created_at_idx
      ON job_scoped_instance_cache (created_at);
  `);

  // Clear the federated-search cache on rollout. Both caches now sit on the
  // prerender search/GET assembly path; dropping any warm search-cache rows
  // here guarantees a clean slate so no entry predating this change is served
  // alongside the new per-instance path. Safe and cheap: entries are
  // job-scoped and transient, so there is no warm state worth preserving.
  pgm.sql(`TRUNCATE job_scoped_search_cache;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS job_scoped_instance_cache;`);
};
