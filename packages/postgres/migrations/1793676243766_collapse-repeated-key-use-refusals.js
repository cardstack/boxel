// A `key_uses` row can stand for more than one use (`count`), so a caller who
// keeps calling past a limit grows the table by a row a minute, not a row a
// call.
//
// Refusals are collapsed: the refusals of one minute (`refusal_window`, the
// start of that UTC minute) that match in share or key, realm, operation,
// caller, mode, code, status and host are one row, its `count` the number of
// them and its `created_at` the latest. The unique index is what makes a
// refusal either the row's first or one more on it, atomically, however many
// arrive at once. Every other use is one row with a `count` of 1 and no
// `refusal_window`.
//
// The index keys `realm_url`, `operation` and `caller` by their md5: they are
// unbounded, and an operation name is whatever the card's author wrote, so
// indexing them raw could exceed the B-tree's row size and leave that refusal
// unrecorded. The other columns are platform-bounded: ids, a mode, a code, a
// status and a host. The insert's ON CONFLICT names the same expressions.
//
// CONCURRENTLY keeps `key_uses` writable while the index builds, since every
// `callApi` writes to it; it can't run in a transaction, hence noTransaction().
// node-pg-migrate logs `#> WARNING: Need to break single transaction! <` when
// applying this migration; that is expected, not a failure. An interrupted
// CONCURRENTLY build leaves an INVALID index under the name, which `IF NOT
// EXISTS` would take as done, so the CREATE is preceded by a DROP and a retry
// builds it again. Until the index exists no row carries a `refusal_window`,
// so the build has no duplicates to refuse.

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    ALTER TABLE key_uses
      ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS refusal_window timestamptz
  `);
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

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS key_uses_refusal_window_idx`);
  pgm.sql(`
    ALTER TABLE key_uses
      DROP COLUMN IF EXISTS refusal_window,
      DROP COLUMN IF EXISTS count
  `);
};
