// Users who reach a private realm only through its policy, and so are in
// neither its event room nor the session-room fallback, ask to watch it while
// they have it open. Each row lapses at `expires_at` (epoch milliseconds)
// unless the host renews it, so a closed tab stops costing the realm anything
// without a goodbye. The realm sends each live watcher a copy of its index
// events filtered to the cards its policy lets that watcher read.

exports.up = (pgm) => {
  pgm.createTable('realm_event_watchers', {
    realm_url: {
      type: 'varchar',
      notNull: true,
    },
    user_id: {
      type: 'varchar',
      notNull: true,
    },
    expires_at: {
      type: 'bigint',
      notNull: true,
    },
  });
  pgm.addConstraint('realm_event_watchers', 'realm_event_watchers_pkey', {
    primaryKey: ['realm_url', 'user_id'],
  });
  pgm.createIndex('realm_event_watchers', 'user_id');
  pgm.createIndex('realm_event_watchers', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('realm_event_watchers', { ifExists: true });
};
