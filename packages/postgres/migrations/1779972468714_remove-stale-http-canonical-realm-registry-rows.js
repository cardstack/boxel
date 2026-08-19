'use strict';

// Local realm-server bootstrap leaves stale HTTP-canonical rows behind in
// `realm_registry` after the canonical-localhost scheme flipped from
// `http://` to `https://` (migration 1779100257124). That earlier migration
// rewrote URL substrings across most text/JSONB columns, but realm-server
// re-inserts its bootstrap rows on every boot, so a developer who started
// the realm-server under the old scheme ends up with leftover HTTP rows in
// `realm_registry` that no longer have a matching `realm_user_permissions`
// row (those were all rewritten to HTTPS). When the file-watcher fires on
// the HTTP-keyed Realm instance, `getRealmOwnerUserId` finds no permission
// row and throws "Cannot determine realm owner for realm
// http://localhost:42XX/...".
//
// Fix: delete every HTTP-canonical localhost row in `realm_registry` that
// has no matching `realm_user_permissions` row at that exact URL. That
// captures both the duplicate case (an HTTPS sibling now owns the
// permissions) and the retired-realm case (legacy-catalog had its HTTPS
// rows removed entirely by 1779348449320 + 1779720206026, leaving the
// HTTP registry row as a dangling orphan). Realms that genuinely exist
// only at HTTP would still have HTTP permission rows and are left alone.
//
// Staging / production use real hostnames, never `localhost`, so the
// pattern matches no rows there and the migration is a safe no-op.

exports.shorthands = undefined;

exports.up = (pgm) => {
  if (
    process.env.REALM_SENTRY_ENVIRONMENT === 'staging' ||
    process.env.REALM_SENTRY_ENVIRONMENT === 'production'
  ) {
    return;
  }
  pgm.sql(`
    DELETE FROM realm_registry stale
    WHERE stale.url LIKE 'http://localhost:%'
      AND NOT EXISTS (
        SELECT 1 FROM realm_user_permissions
        WHERE realm_url = stale.url
      )
  `);
};

// Down is intentionally a no-op. `realm_registry` rows depend on
// `disk_id` / `owner_username` values established at realm-server boot
// time, not values a migration can reconstruct from the surviving HTTPS
// rows. A rewind that re-inserted stale HTTP rows would just reintroduce
// the same crash. If the bug is ever rediscovered, write a new forward
// migration rather than rewinding this one.
exports.down = () => {};
