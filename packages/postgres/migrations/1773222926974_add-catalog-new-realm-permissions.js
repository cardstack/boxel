exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/catalog-new/', '@catalog_new_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/catalog-new/', '*', true, false, false)
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
           ('https://app.boxel.ai/catalog-new/', '@catalog_new_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/catalog-new/', '*', true, false, false)
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
           ('http://localhost:4201/catalog-new/', '@catalog_new_realm:localhost', true, true, true),
           ('http://localhost:4201/catalog-new/', '*', true, false, false),
           ('http://localhost:4205/catalog-new/', '@catalog_new_realm:localhost', true, true, true),
           ('http://localhost:4205/catalog-new/', '*', true, false, false)
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
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/catalog-new/' AND username IN ('@catalog_new_realm:stack.cards', '*')",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/catalog-new/' AND username IN ('@catalog_new_realm:boxel.ai', '*')",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url IN ('http://localhost:4201/catalog-new/', 'http://localhost:4205/catalog-new/') AND username IN ('@catalog_new_realm:localhost', '*')",
      );
  }
};
