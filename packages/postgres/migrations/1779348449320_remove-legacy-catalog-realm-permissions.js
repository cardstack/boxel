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
//
// CS-11246: each INSERT is guarded by NOT EXISTS against both http- and
// https-forms of the (realm_url, username) pair. Background: an earlier
// migration (1779100257124_canonical-url-http-to-https) rewrites localhost
// URLs in place from http→https on UP. On dev that runs before this
// migration, so by the time this UP fires the legacy-catalog rows are
// already in https form and its http-targeted DELETE matches nothing — the
// rows persist into the rollback. Then this DOWN inserts the http row, and
// 1779100257124's DOWN rewrites the leftover https row back to http, which
// collides with the just-inserted http row on realm_user_permissions_pkey.
// Guarding the INSERT keeps the chain idempotent regardless of which form
// is sitting in the table. Staging/production never hit the underlying
// trigger (their canonicals are always https) but use the same guard for
// uniformity.
function guardedRestore(realmUrl, username, write, realmOwner) {
  let httpsUrl = realmUrl.replace(/^http:/, 'https:');
  let httpUrl = realmUrl.replace(/^https:/, 'http:');
  return `
    INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
    SELECT '${realmUrl}', '${username}', true, ${write}, ${realmOwner}
    WHERE NOT EXISTS (
      SELECT 1 FROM realm_user_permissions
      WHERE realm_url IN ('${httpUrl}', '${httpsUrl}')
        AND username = '${username}'
    )
  `;
}

exports.down = (pgm) => {
  switch (process.env.REALM_SENTRY_ENVIRONMENT) {
    case 'staging':
      pgm.sql(
        guardedRestore(
          'https://realms-staging.stack.cards/legacy-catalog/',
          '@legacy_catalog_realm:stack.cards',
          true,
          true,
        ),
      );
      pgm.sql(
        guardedRestore(
          'https://realms-staging.stack.cards/legacy-catalog/',
          '*',
          false,
          false,
        ),
      );
      break;
    case 'production':
      pgm.sql(
        guardedRestore(
          'https://app.boxel.ai/legacy-catalog/',
          '@legacy_catalog_realm:boxel.ai',
          true,
          true,
        ),
      );
      pgm.sql(
        guardedRestore('https://app.boxel.ai/legacy-catalog/', '*', false, false),
      );
      break;
    default:
      pgm.sql(
        guardedRestore(
          'http://localhost:4201/legacy-catalog/',
          '@legacy_catalog_realm:localhost',
          true,
          true,
        ),
      );
      pgm.sql(
        guardedRestore(
          'http://localhost:4201/legacy-catalog/',
          '*',
          false,
          false,
        ),
      );
  }
};
