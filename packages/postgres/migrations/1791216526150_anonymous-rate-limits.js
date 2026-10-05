exports.shorthands = undefined;

// How many invocations each anonymous caller has made against each realm in
// the current window. A realm's policy can admit callers who are not signed
// in, and every such invocation is counted here against the realm's limit for
// the caller's address. The row is the count for one realm, one address and
// one fixed window; a window that has ended is swept, never read again.
//
// In the database rather than in each process, so a limit holds across every
// realm-server process and across a restart.

exports.up = (pgm) => {
  pgm.createTable('anonymous_rate_limits', {
    realm_url: { type: 'varchar', notNull: true },
    client_ip: { type: 'varchar', notNull: true },
    // Epoch seconds at which the window began, a multiple of its length.
    window_start: { type: 'bigint', notNull: true },
    window_seconds: { type: 'integer', notNull: true },
    count: { type: 'integer', notNull: true },
    // Epoch seconds at which the window ends, which is when the row can go.
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('anonymous_rate_limits', 'anonymous_rate_limits_pkey', {
    primaryKey: ['realm_url', 'client_ip', 'window_start', 'window_seconds'],
  });
  pgm.createIndex('anonymous_rate_limits', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('anonymous_rate_limits');
};
