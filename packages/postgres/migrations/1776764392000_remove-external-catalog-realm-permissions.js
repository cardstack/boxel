// Remove stale /external-catalog/ realm permissions. The URL `/external-catalog/`
// no longer exists after the Phase 2 URL swap — external catalog content is now
// served at `/catalog/`, and the monorepo catalog moved to `/legacy-catalog/`.
// This migration cleans up permission rows that would otherwise dangle.
exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/external-catalog/'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/external-catalog/'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url IN ('http://localhost:4201/external-catalog/', 'http://localhost:4205/external-catalog/')",
      );
  }
};

// Down restores the permissions that the original
// 1773309270591_rename-catalog-new-to-external-catalog migration left in place.
exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/external-catalog/', '@external_catalog_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/external-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://app.boxel.ai/external-catalog/', '@external_catalog_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/external-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
      break;
    default:
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('http://localhost:4201/external-catalog/', '@external_catalog_realm:localhost', true, true, true),
           ('http://localhost:4201/external-catalog/', '*', true, false, false),
           ('http://localhost:4205/external-catalog/', '@external_catalog_realm:localhost', true, true, true),
           ('http://localhost:4205/external-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
  }
};
