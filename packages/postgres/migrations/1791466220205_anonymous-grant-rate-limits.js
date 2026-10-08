exports.shorthands = undefined;

// How many invocations each caller who isn't signed in has made through each
// grant of a realm's policy in the current window. A grant whose `where` names
// such callers counts what it admits against its own limit, so two grants in
// one realm never use up each other's allowance. The row is the count for one
// realm, one grant, one address and one fixed window; a window that has ended
// is swept, never read again.
//
// In the database rather than in each process, so a limit holds across every
// realm-server process and across a restart.

exports.up = (pgm) => {
  pgm.createTable('anonymous_grant_rate_limits', {
    realm_url: { type: 'varchar', notNull: true },
    // The grant's id, which stays the same however often the policy
    // recompiles.
    grant_id: { type: 'varchar', notNull: true },
    client_ip: { type: 'varchar', notNull: true },
    // Epoch seconds at which the window began, a multiple of its length.
    window_start: { type: 'bigint', notNull: true },
    window_seconds: { type: 'integer', notNull: true },
    count: { type: 'integer', notNull: true },
    // Epoch seconds at which the window ends, which is when the row can go.
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint(
    'anonymous_grant_rate_limits',
    'anonymous_grant_rate_limits_pkey',
    {
      primaryKey: [
        'realm_url',
        'grant_id',
        'client_ip',
        'window_start',
        'window_seconds',
      ],
    },
  );
  pgm.createIndex('anonymous_grant_rate_limits', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('anonymous_grant_rate_limits');
};
