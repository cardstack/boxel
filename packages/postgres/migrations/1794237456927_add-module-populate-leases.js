// One lease per definition-cache populate in progress, so at most one
// realm-server process at a time prerenders a given module for a given cache
// scope. The populating process claims the row, prerenders holding no database
// connection, writes the definition row, then deletes its lease and notifies
// `module_cache_populated` in one statement. Peers that find a live lease wait
// on that notification instead of prerendering the module themselves.
//
// `lease_key` is the populate's coalesce key hashed to an int64, the same value
// the notification carries. `holder_id` is unique to one claim, so a holder
// deletes only its own lease. The holder pushes `expires_at` out on a timer
// for as long as its populate runs, so the lease lapses only when the holder
// dies mid-populate: an expired lease is claimed over as though it were absent.
//
// UNLOGGED: Postgres empties the table after a crash, and losing every lease
// then costs a duplicate prerender at most. Server-only, and excluded from the
// SQLite schema dump.
//
// Additive: a new table nothing reads until the code that writes it ships.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNLOGGED TABLE IF NOT EXISTS module_populate_leases (
      lease_key text PRIMARY KEY,
      holder_id text NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS module_populate_leases`);
};
