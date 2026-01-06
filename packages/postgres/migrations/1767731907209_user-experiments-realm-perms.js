exports.up = (pgm) => {
  if (
    ['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }

  pgm.sql(
    `INSERT INTO realm_user_permissions (realm_url, username, read, write)
     VALUES
       ('http://localhost:4201/experiments/', '@user:localhost', true, true)
     ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
     DO UPDATE SET
       realm_url = EXCLUDED.realm_url,
       username = EXCLUDED.username,
       read = EXCLUDED.read,
       write = EXCLUDED.write`,
  );
};

exports.down = (pgm) => {
  if (
    ['staging', 'production'].includes(process.env.REALM_SENTRY_ENVIRONMENT)
  ) {
    return;
  }

  pgm.sql(
    "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/experiments/' AND username = '@user:localhost'",
  );
};
