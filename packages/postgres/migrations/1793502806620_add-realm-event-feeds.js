// A realm's event feed (ADR 020), kept so that every process serving the
// realm shares one sequence and a restart continues it rather than starting a
// new one. `realm_feeds` holds each feed's epoch, the last position it gave
// out, and when a refresh request was last accepted, so the once-a-minute limit
// holds across processes. `realm_feed_events` holds the recent events a stream
// replays and the poll answers with; the realm trims it as it appends.
//
// Both tables are excluded from the SQLite schema dump: a realm the host runs
// in the browser keeps its feed in memory, so the host's schema file is
// unchanged.

exports.up = (pgm) => {
  pgm.createTable('realm_feeds', {
    realm_url: { type: 'varchar', primaryKey: true },
    epoch: { type: 'varchar', notNull: true },
    head: { type: 'bigint', notNull: true, default: 0 },
    last_refresh_at: { type: 'timestamptz' },
  });
  pgm.createTable('realm_feed_events', {
    realm_url: { type: 'varchar', notNull: true },
    seq: { type: 'bigint', notNull: true },
    event: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('realm_feed_events', 'realm_feed_events_pkey', {
    primaryKey: ['realm_url', 'seq'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('realm_feed_events');
  pgm.dropTable('realm_feeds');
};
