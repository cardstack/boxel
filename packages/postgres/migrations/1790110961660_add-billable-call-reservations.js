exports.shorthands = undefined;

// One row per billable upstream call a user has in flight through the realm
// server's proxy endpoints.
//
// A user's credit balance only reflects a call once its cost is recorded,
// which happens after the upstream answers. Calls admitted while others are
// still running are therefore all checked against the same balance, so each
// one admitted beyond the first can overspend by up to its own cost. Counting
// these rows at admission is what bounds that: a user can have at most a fixed
// number of calls in flight across every replica, and the overspend is at most
// that many calls.
//
// A row is inserted when a call is admitted and deleted once its cost is
// recorded, or once the call ends without a cost. The replica running the
// call keeps pushing `expires_at` (epoch milliseconds) forward while the call
// is live. A replica that dies mid-call stops doing so, and its row stops
// counting once `expires_at` passes. Expired rows are ignored by the count and
// cleared when the user's next call is admitted.
exports.up = (pgm) => {
  pgm.createTable('billable_call_reservations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    matrix_user_id: { type: 'varchar', notNull: true },
    expires_at: { type: 'bigint', notNull: true },
  });
  pgm.createIndex('billable_call_reservations', 'matrix_user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('billable_call_reservations');
};
