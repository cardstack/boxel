exports.shorthands = undefined;

exports.up = (pgm) => {
  // Epoch seconds, so it compares directly against a JWT's `iat` claim with no
  // timezone or sub-second rounding ambiguity. NULL means never revoked, which
  // is every user until an operator revokes one.
  pgm.addColumns('users', {
    sessions_revoked_at: { type: 'bigint' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['sessions_revoked_at']);
};
