// A `key_uses` row of an automation's call names the run that made it
// (`run_id`, an `automation_runs` id), so a run's key uses can be read back
// with the run, through `key_uses_run_idx`. Interactive uses leave it null.
// It is not a foreign key: a use is kept for its retention window whether or
// not its run row is.
//
// A collapsed refusal row (one with a `refusal_window`) of an automation's
// call keys the run too: `key_uses_refusal_window_run_idx` covers those rows
// alone (`run_id IS NOT NULL`), and the insert of a run's refusal names its
// columns. An interactive refusal names no run and collapses on the other
// columns alone. `key_uses_refusal_window_idx` covers run rows as well,
// without the run, so while it exists a run's refusal that matches a row it
// doesn't arbitrate on in the same minute is refused by it: one from another
// run, or a concurrent refusal of the same run that loses the race to insert
// the row. The call path logs it as a use it could not record. A later
// migration gives interactive refusals an index of their own,
// `key_uses_refusal_window_interactive_idx`, so the older index can be
// dropped, and the drop lands before any run token is minted outside tests.
//
// CONCURRENTLY keeps `key_uses` writable while the indexes build, since every
// `callApi` writes to it; it can't run in a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure. An interrupted
// CONCURRENTLY build leaves an INVALID index under the name, so each CREATE
// is preceded by a DROP and a retry builds it again.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TABLE key_uses ADD COLUMN IF NOT EXISTS run_id uuid`);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS key_uses_run_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY key_uses_run_idx
      ON key_uses (run_id, created_at)
      WHERE run_id IS NOT NULL
  `);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_run_idx`,
  );
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY key_uses_refusal_window_run_idx
      ON key_uses (
        share_id, key_id, md5(realm_url), md5(operation), md5(caller), mode,
        run_id, code, status, host, refusal_window
      ) NULLS NOT DISTINCT
      WHERE refusal_window IS NOT NULL AND run_id IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_run_idx`,
  );
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS key_uses_run_idx`);
  pgm.sql(`ALTER TABLE key_uses DROP COLUMN IF EXISTS run_id`);
};
