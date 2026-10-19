// Index over a user's secure sessions by client. Signing out of the app ends
// every unexpired `window` session of the user, so it looks rows up by
// `user_id` and `client`; without this it reads every row that hasn't been
// swept, which is most of the table.
//
// CONCURRENTLY avoids locking sign-ins and sign-outs during the build in
// production; it cannot run inside a transaction, hence noTransaction(). An
// interrupted CONCURRENTLY build leaves an INVALID index under the target
// name, which `IF NOT EXISTS` would treat as done, so the CREATE is preceded by
// an unconditional DROP, making retries self-healing.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS secure_sessions_user_id_client_idx;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY secure_sessions_user_id_client_idx
      ON secure_sessions (user_id, client);
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS secure_sessions_user_id_client_idx;`,
  );
};
