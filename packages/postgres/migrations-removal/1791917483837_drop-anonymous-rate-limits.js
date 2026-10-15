exports.shorthands = undefined;

// Anonymous callers are counted per realm, per grant and per address in
// `anonymous_grant_rate_limits`; nothing reads or writes the realm-wide
// `anonymous_rate_limits` table. Drop it; its index and primary key fall with
// it.

exports.up = (pgm) => {
  pgm.dropTable('anonymous_rate_limits', { ifExists: true });
};

// Restore the table empty, in the shape it had when it was dropped.
exports.down = (pgm) => {
  pgm.createTable('anonymous_rate_limits', {
    realm_url: { type: 'varchar', notNull: true },
    client_ip: { type: 'varchar', notNull: true },
    window_start: { type: 'bigint', notNull: true },
    window_seconds: { type: 'integer', notNull: true },
    count: { type: 'integer', notNull: true },
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('anonymous_rate_limits', 'anonymous_rate_limits_pkey', {
    primaryKey: ['realm_url', 'client_ip', 'window_start', 'window_seconds'],
  });
  pgm.createIndex('anonymous_rate_limits', 'expires_at');
};
