// Who is on a card's live channel now (ADR 023 §1.6): the latest unordered
// message for each key, until it expires. A write is one upsert that contends
// only with the same key, never with the channel's ordered appends. Excluded
// from the SQLite schema dump with the feed tables: a realm the host runs in
// the browser keeps presence in memory.

exports.up = (pgm) => {
  pgm.createTable('realm_presence', {
    feed_key: { type: 'varchar', notNull: true },
    operation: { type: 'varchar', notNull: true },
    key: { type: 'varchar', notNull: true },
    event: { type: 'jsonb', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.addConstraint('realm_presence', 'realm_presence_pkey', {
    primaryKey: ['feed_key', 'operation', 'key'],
  });
  pgm.createIndex('realm_presence', ['feed_key', 'expires_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('realm_presence');
};
