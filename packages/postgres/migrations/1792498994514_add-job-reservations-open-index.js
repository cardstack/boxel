// Partial index over the open reservations, the ones with no `completed_at`.
// Every claim of a job, and every check of whether a job is running, asks for
// the reservations that are still open and unexpired:
// `completed_at IS NULL AND locked_until > NOW()`, often for one `job_id`.
// `job_reservations` accumulates: a finished reservation is never pruned, and
// only a realm teardown deletes anything. Without this, that question reads
// the whole table on each claim, as a parallel scan, so the queue's database
// cost grows with every job ever run.
//
// Partial on `completed_at IS NULL` so the index stays proportional to the
// reservations in flight rather than to their history, and a reservation
// leaves the index when it completes. `job_id` leads so that a lookup for one
// job is an index probe; `locked_until` follows so that the expiry test is
// answered from the index.
//
// CONCURRENTLY avoids locking queue writes during the build in production; it
// cannot run inside a transaction, hence noTransaction(). node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure.
//
// An interrupted CONCURRENTLY build leaves an INVALID index under the target
// name, which the planner ignores, and `IF NOT EXISTS` would treat that
// leftover as done. The CREATE is therefore preceded by an unconditional DROP,
// so that a retry builds the index again.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS job_reservations_open_job_id_locked_until_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY job_reservations_open_job_id_locked_until_idx
      ON job_reservations (job_id, locked_until)
      WHERE completed_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS job_reservations_open_job_id_locked_until_idx;`,
  );
};
