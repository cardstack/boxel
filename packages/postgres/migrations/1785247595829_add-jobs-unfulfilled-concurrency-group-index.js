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
// cannot run inside a transaction, hence noTransaction().

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_unfulfilled_concurrency_group_idx
      ON jobs (concurrency_group)
      WHERE status = 'unfulfilled';
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    DROP INDEX CONCURRENTLY IF EXISTS jobs_unfulfilled_concurrency_group_idx;
  `);
};
