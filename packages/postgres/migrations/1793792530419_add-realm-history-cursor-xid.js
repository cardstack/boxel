// realm-historian reads the journal in `(xid, seq)` order: `xid` is the
// inserting transaction's id, assigned at the transaction's first write and
// so before the row's `seq`, and two overlapping writes can commit with the
// two in opposite orders. The index serves that read. Writes to different
// files of one realm overlap too, so a realm's events arrive in the same
// order, and its cursor in `realm_history_state` is the pair
// `(cursor_xid, cursor_seq)` of the last event recorded rather than a `seq`
// alone. A cursor already past the start takes its event's `xid`; left at 0,
// it would sit below every event and have the realm's history recorded again.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_change_events_xid_seq_idx
      ON realm_change_events (xid, seq)
  `);
  pgm.sql(`
    ALTER TABLE realm_history_state
      ADD COLUMN IF NOT EXISTS cursor_xid xid8 NOT NULL DEFAULT '0'
  `);
  pgm.sql(`
    UPDATE realm_history_state state
    SET cursor_xid = event.xid
    FROM realm_change_events event
    WHERE event.seq = state.cursor_seq AND state.cursor_seq > 0
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE realm_history_state DROP COLUMN IF EXISTS cursor_xid`);
  pgm.sql(`DROP INDEX IF EXISTS realm_change_events_xid_seq_idx`);
};
