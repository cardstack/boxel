// A `key_uses` row of an automation's call names the run that made it
// (`run_id`, an `automation_runs` id), so a run's key uses can be read back
// with the run. Interactive uses leave it null. It is not a foreign key: a
// use is kept for its retention window whether or not its run row is.
//
// A collapsed refusal row (one with a `refusal_window`) keys the run too:
// `key_uses_refusal_window_run_idx` is the unique index whose columns the
// insert's ON CONFLICT names. `key_uses_refusal_window_idx` beside it keys the
// same columns without the run, for code that names those. While both exist,
// a refusal from a second run that matches another run's row in the same
// minute is refused by the narrower index, and the call path logs it as a use
// it could not record. A removal-phase migration drops the narrower index.
//
// CONCURRENTLY keeps `key_uses` writable while the index builds, since every
// `callApi` writes to it; it can't run in a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure. An interrupted
// CONCURRENTLY build leaves an INVALID index under the name, so the CREATE is
// preceded by a DROP and a retry builds it again.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TABLE key_uses ADD COLUMN IF NOT EXISTS run_id uuid`);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_run_idx`,
  );
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY key_uses_refusal_window_run_idx
      ON key_uses (
        share_id, key_id, md5(realm_url), md5(operation), md5(caller), mode,
        run_id, code, status, host, refusal_window
      ) NULLS NOT DISTINCT
      WHERE refusal_window IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_run_idx`,
  );
  pgm.sql(`ALTER TABLE key_uses DROP COLUMN IF EXISTS run_id`);
};
