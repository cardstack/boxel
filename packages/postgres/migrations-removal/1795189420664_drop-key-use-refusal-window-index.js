// Drops `key_uses_refusal_window_idx`, which keys every collapsed refusal row
// (any row with a `refusal_window`) without its run. Each kind of refusal row
// has an index of its own: an interactive one
// `key_uses_refusal_window_interactive_idx` (no `run_id`), a run's
// `key_uses_refusal_window_run_idx`, which keys the run too. Every insert of a
// refusal names one of their predicates. While the older index exists it is a
// plain unique check to a run's refusal, so one that matches another row's
// identity in the same minute (from another run, or a concurrent identical
// refusal of the same run that loses the race to insert the row) is refused
// by it and goes unrecorded.
//
// CONCURRENTLY keeps `key_uses` writable while the index goes, since every
// `callApi` writes to it; it can't run in a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure.
//
// `down()` rebuilds the index as it was defined. Two runs' identical refusals
// in one minute are two rows, which that index refuses, so where such rows
// exist the build fails and leaves an INVALID index under the name; the DROP
// that precedes the CREATE clears it on a retry, once those rows are folded or
// removed.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_idx`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_idx`);
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY key_uses_refusal_window_idx
      ON key_uses (
        share_id, key_id, md5(realm_url), md5(operation), md5(caller), mode,
        code, status, host, refusal_window
      ) NULLS NOT DISTINCT
      WHERE refusal_window IS NOT NULL
  `);
};
