// The journal's `(xid, seq)` index, which serves realm-historian's read: the
// events after its position and below the visibility horizon, in
// `(xid, seq)` order.
//
// CONCURRENTLY because an ordinary build takes a lock that blocks every
// insert into `realm_change_events` for its whole duration, and every write
// to a realm that records history inserts one. It cannot run inside a
// transaction, hence noTransaction(). node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure.
//
// An interrupted CONCURRENTLY build leaves an INVALID index under the target
// name, which `IF NOT EXISTS` would treat as done. The CREATE is therefore
// preceded by an unconditional DROP, so a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS realm_change_events_xid_seq_idx;`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY realm_change_events_xid_seq_idx
      ON realm_change_events (xid, seq);
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS realm_change_events_xid_seq_idx;`);
};
