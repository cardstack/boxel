exports.shorthands = undefined;

// Drop the job-scoped per-instance wire-format cache. Prerender `_federated-
// search` no longer runs the `loadLinks` relationship-assembly pass at all (it
// returns the matching result ids and the host re-resolves each card from
// card+source), so the only code that ever read or wrote this table is gone.
// Nothing else references it — it would otherwise be a table, a janitor timer,
// and a NOTIFY-listener participant that no path touches.
exports.up = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS job_scoped_instance_cache;`);
};

// Recreate the table as it was (UNLOGGED cache keyed by `<jobId>.<reservationId>`
// + instance url) so the migration is reversible. node-pg-migrate's createTable
// can't express UNLOGGED, so build it with raw SQL.
exports.down = (pgm) => {
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
};
