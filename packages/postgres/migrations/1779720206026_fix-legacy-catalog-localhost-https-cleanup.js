/* eslint-disable camelcase */

exports.shorthands = undefined;

// Removes the local-dev legacy-catalog rows that an earlier cleanup missed.
// Local realm-server seeds realm_registry / realm_user_permissions for this
// realm using https:// URLs; a previous removal attempt targeted the http://
// variant and was a no-op for local dev. Staging/production are unaffected:
// those rows used https:// throughout and were removed by the earlier
// migration.
exports.up = (pgm) => {
  if (
    process.env.REALM_SENTRY_ENVIRONMENT === 'staging' ||
    process.env.REALM_SENTRY_ENVIRONMENT === 'production'
  ) {
    return;
  }
  pgm.sql(
    "DELETE FROM realm_user_permissions WHERE realm_url = 'https://localhost:4201/legacy-catalog/'",
  );
  pgm.sql(
    "DELETE FROM realm_registry WHERE url = 'https://localhost:4201/legacy-catalog/'",
  );
};

// Down restores the permission rows under the corrected URL. The
// realm_registry row is not restored: it depends on disk_id / owner_username
// established at realm-server boot, and the realm content is no longer
// shipped from this repo, so a rewind here would be incomplete.
exports.down = (pgm) => {
  if (
    process.env.REALM_SENTRY_ENVIRONMENT === 'staging' ||
    process.env.REALM_SENTRY_ENVIRONMENT === 'production'
  ) {
    return;
  }
  pgm.sql(
    `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
     VALUES
       ('https://localhost:4201/legacy-catalog/', '@legacy_catalog_realm:localhost', true, true, true),
       ('https://localhost:4201/legacy-catalog/', '*', true, false, false)
     ON CONFLICT ON CONSTRAINT realm_user_permissions_pkey DO NOTHING`,
  );
};
