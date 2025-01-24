exports.up = (pgm) => {
  pgm.sql(
    `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('http://localhost:4205/seed/', '@seed_realm:localhost', true, true, true),
           ('http://localhost:4205/seed/', '*', true, false, false),
           ('http://localhost:4205/seed/', 'users', true, true, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
  );
};

exports.down = (pgm) => {
  pgm.sql(
    `DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4205/seed/'`,
  );
};
