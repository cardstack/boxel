// Partial index over the queue's live rows, keyed by concurrency group. A
// realm's readiness check asks whether its index lane holds any outstanding
// work — `status = 'unfulfilled' AND concurrency_group = 'indexing:<realm>'` —
// and answers that on every poll of a public endpoint. `jobs` accumulates:
// finished rows are never pruned, and only a realm teardown deletes anything.
// Without this the common answer (no such row) reads the whole table, because
// a LIMIT cannot short-circuit a match that isn't there.
//
// Partial on `unfulfilled` so the index stays proportional to the queue's live
// depth rather than to its history, and a row leaving the queue leaves the
// index with it.
//
// CONCURRENTLY avoids locking queue writes during the build in production; it
// cannot run inside a transaction, hence noTransaction(). node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure.
//
// An interrupted CONCURRENTLY build — the gated migration task is bounded and
// stopped on timeout, so a slow build can be killed mid-flight — leaves an
// INVALID index under the target name, which the planner ignores. `IF NOT
// EXISTS` matches on relation name alone and would treat that leftover as
// done, so the index would carry write overhead forever while serving no read.
// The CREATE is therefore preceded by an unconditional DROP, making retries
// self-healing.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS jobs_unfulfilled_concurrency_group_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY jobs_unfulfilled_concurrency_group_idx
      ON jobs (concurrency_group)
      WHERE status = 'unfulfilled';
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS jobs_unfulfilled_concurrency_group_idx;`,
  );
};
