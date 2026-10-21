// Partial index over the open reservations, the ones with no `completed_at`.
// Every claim of a job, and every check of whether a job is running, asks for
// the reservations that are still open and unexpired:
// `completed_at IS NULL AND locked_until > NOW()`, often for one `job_id`.
// `job_reservations` accumulates: a finished reservation is never pruned, and
// only a realm teardown deletes anything. Without this, that question reads
// the whole table on each claim, as a parallel scan, so the queue's database
// cost grows with every job ever run.
//
// Partial on `completed_at IS NULL`, so a reservation leaves the index when it
// completes and the finished history stays out of it. A reservation whose
// worker died before completing it never gets a `completed_at` and stays in
// the index, so `locked_until` leads: the claim's `locked_until > NOW()` is a
// range over the index that reads only unexpired entries, not every open one.
// `job_id` follows so that a check for one job is answered from the index
// alone; `job_reservations_job_id_index` serves that lookup too.
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
    `DROP INDEX CONCURRENTLY IF EXISTS job_reservations_open_locked_until_job_id_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY job_reservations_open_locked_until_job_id_idx
      ON job_reservations (locked_until, job_id)
      WHERE completed_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS job_reservations_open_locked_until_job_id_idx;`,
  );
};
