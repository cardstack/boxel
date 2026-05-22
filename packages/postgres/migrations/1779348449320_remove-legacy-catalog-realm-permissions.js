// Remove all DB rows tied to the /legacy-catalog/ realm. The catalog content
// shipped from this monorepo (packages/catalog-realm) has been removed in favor
// of the separately-deployed cardstack/boxel-catalog realm, so the permission
// rows inserted by 1776762507000_add-legacy-catalog-realm-permissions.js no
// longer have a realm to gate, and the realm_registry row left behind by
// previous boots would otherwise still surface in /_grafana-full-reindex.
exports.up = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://realms-staging.stack.cards/legacy-catalog/'",
      );
      pgm.sql(
        "DELETE FROM realm_registry WHERE url = 'https://realms-staging.stack.cards/legacy-catalog/'",
      );
      break;
    case 'production':
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'https://app.boxel.ai/legacy-catalog/'",
      );
      pgm.sql(
        "DELETE FROM realm_registry WHERE url = 'https://app.boxel.ai/legacy-catalog/'",
      );
      break;
    default:
      pgm.sql(
        "DELETE FROM realm_user_permissions WHERE realm_url = 'http://localhost:4201/legacy-catalog/'",
      );
      pgm.sql(
        "DELETE FROM realm_registry WHERE url = 'http://localhost:4201/legacy-catalog/'",
      );
  }
};

// Down only restores the permissions installed by
// 1776762507000_add-legacy-catalog-realm-permissions.js. The realm_registry
// row is not re-inserted: it depends on disk_id / owner_username established
// by realm-server's startup registry-backfill, so a rewind here would be
// incomplete. If the realm is brought back, the next boot of realm-server
// with the realm on disk re-registers it automatically.
exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://realms-staging.stack.cards/legacy-catalog/', '@legacy_catalog_realm:stack.cards', true, true, true),
           ('https://realms-staging.stack.cards/legacy-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
      break;
    case 'production':
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('https://app.boxel.ai/legacy-catalog/', '@legacy_catalog_realm:boxel.ai', true, true, true),
           ('https://app.boxel.ai/legacy-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
      break;
    default:
      pgm.sql(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
         VALUES
           ('http://localhost:4201/legacy-catalog/', '@legacy_catalog_realm:localhost', true, true, true),
           ('http://localhost:4201/legacy-catalog/', '*', true, false, false)
         ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
      );
  }
};
