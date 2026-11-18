// Indexes `credits_ledger` by realm and time, so a realm's charges in a time
// range read back without scanning every user's entries in that range. The
// Realms dashboard's automation and ledger panels filter on
// `realm IN (...)` plus a `created_at` range; `realm` leads so each realm
// identifier is one contiguous run of the index, ordered by `created_at`.
//
// Only consumption entries carry a realm (grants, purchases and expiries
// don't), so the index is partial on `realm IS NOT NULL`.
//
// The index is built CONCURRENTLY, outside a transaction, so building it
// doesn't block the ledger's writes. node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure. An interrupted CONCURRENTLY
// build leaves an INVALID index under the target name, so the CREATE is
// preceded by an unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_realm_created_at_idx`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY credits_ledger_realm_created_at_idx
      ON credits_ledger (realm, created_at) WHERE realm IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS credits_ledger_realm_created_at_idx`,
  );
};
