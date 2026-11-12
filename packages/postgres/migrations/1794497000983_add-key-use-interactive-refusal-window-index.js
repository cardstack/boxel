// An interactive call's collapsed refusal row (one with a `refusal_window`
// and no `run_id`) is keyed by `key_uses_refusal_window_interactive_idx`:
// the columns of `key_uses_refusal_window_idx`, over interactive rows alone.
// The insert of an interactive refusal names this index's predicate, and a
// run's refusal names `key_uses_refusal_window_run_idx`'s, so neither kind of
// row is held to the other's identity.
//
// `key_uses_refusal_window_idx` covers run rows as well, without the run, so
// while it exists a refusal from a second run that matches another run's row
// in the same minute is refused by it, and the call path logs it as a use it
// could not record. It is dropped in the removal phase of a later release,
// once no running task names its predicate.
//
// Every row this index covers is also covered by `key_uses_refusal_window_idx`
// on the same columns, so the build has no duplicates to refuse.
//
// CONCURRENTLY keeps `key_uses` writable while the index builds, since every
// `callApi` writes to it; it can't run in a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure. An interrupted
// CONCURRENTLY build leaves an INVALID index under the name, so the CREATE is
// preceded by a DROP and a retry builds it again.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_interactive_idx`,
  );
  pgm.sql(`
    CREATE UNIQUE INDEX CONCURRENTLY key_uses_refusal_window_interactive_idx
      ON key_uses (
        share_id, key_id, md5(realm_url), md5(operation), md5(caller), mode,
        code, status, host, refusal_window
      ) NULLS NOT DISTINCT
      WHERE refusal_window IS NOT NULL AND run_id IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_interactive_idx`,
  );
};
