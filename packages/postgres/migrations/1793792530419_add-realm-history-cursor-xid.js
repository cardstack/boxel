// realm-historian reads the journal in `(xid, seq)` order: `xid` is the
// inserting transaction's id, assigned at the transaction's first write and
// so before the row's `seq`, and two overlapping writes can commit with the
// two in opposite orders. Writes to different files of one realm overlap
// too, so a realm's events arrive in the same order, and its cursor in
// `realm_history_state` is the pair `(cursor_xid, cursor_seq)` of the last
// event recorded rather than a `seq` alone. Every existing row takes the
// starting cursor `(0, 0)`: a cursor moves only when realm-historian records
// an event, which writes both columns. The index that serves the read,
// `realm_change_events_xid_seq_idx`, is built concurrently in its own
// migration.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_history_state
      ADD COLUMN IF NOT EXISTS cursor_xid xid8 NOT NULL DEFAULT '0'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE realm_history_state DROP COLUMN IF EXISTS cursor_xid`);
};
