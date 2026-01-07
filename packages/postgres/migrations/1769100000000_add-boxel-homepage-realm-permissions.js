exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/boxel-homepage/', '@boxel_homepage_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/boxel-homepage/', '@homepage_writer:stack.cards', true, true, false),
           ('https://realms-staging.stack.cards/boxel-homepage/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://app.boxel.ai/boxel-homepage/', '@boxel_homepage_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/boxel-homepage/', '@homepage_writer:boxel.ai', true, true, false),
           ('https://app.boxel.ai/boxel-homepage/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
      break;
    default:
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('http://localhost:4201/boxel-homepage/', '@boxel_homepage_realm:localhost', true, true, true),
           ('http://localhost:4201/boxel-homepage/', '@homepage_writer:localhost', true, true, false),
           ('http://localhost:4201/boxel-homepage/', '*', true, false, false),
           ('http://localhost:4205/boxel-homepage/', '@boxel_homepage_realm:localhost', true, true, true),
           ('http://localhost:4205/boxel-homepage/', '@homepage_writer:localhost', true, true, false),
           ('http://localhost:4205/boxel-homepage/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey
         DO UPDATE SET
           realm_url   = EXCLUDED.realm_url,
           username    = EXCLUDED.username,
           read        = EXCLUDED.read,
           write       = EXCLUDED.write,
           realm_owner = EXCLUDED.realm_owner`,
      );
  }
};

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/boxel-homepage/' AND username = '@boxel_homepage_realm:stack.cards'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/boxel-homepage/' AND username = '@boxel_homepage_realm:boxel.ai'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/boxel-homepage/' AND username = '@boxel_homepage_realm:localhost'",
      );
  }
};
