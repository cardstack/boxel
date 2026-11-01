// A realm's event feeds (ADR 023), kept so that every process serving the
// realm shares one sequence and a restart continues it rather than starting a
// new one. A feed is keyed by the realm's URL, or, for a card's live channel,
// by the realm's URL and the card's path joined by `#`. `realm_feeds` holds
// each feed's epoch, the last position it gave
// out, and when a refresh request was last accepted, so the once-a-minute limit
// holds across processes. `realm_feed_events` holds the recent events a stream
// replays and the poll answers with; the realm trims it as it appends, keeping
// the latest message for each key a channel's messages name.
//
// Both tables are excluded from the SQLite schema dump: a realm the host runs
// in the browser keeps its feed in memory, so the host's schema file is
// unchanged.

exports.up = (pgm) => {
  pgm.createTable('realm_feeds', {
    feed_key: { type: 'varchar', primaryKey: true },
    epoch: { type: 'varchar', notNull: true },
    head: { type: 'bigint', notNull: true, default: 0 },
    last_refresh_at: { type: 'timestamptz' },
  });
  pgm.createTable('realm_feed_events', {
    feed_key: { type: 'varchar', notNull: true },
    seq: { type: 'bigint', notNull: true },
    event: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('realm_feed_events', 'realm_feed_events_pkey', {
    primaryKey: ['feed_key', 'seq'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('realm_feed_events');
  pgm.dropTable('realm_feeds');
};
