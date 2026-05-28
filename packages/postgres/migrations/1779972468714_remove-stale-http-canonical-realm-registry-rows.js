'use strict';

// Local realm-server bootstrap leaves stale HTTP-canonical rows behind in
// `realm_registry` after the canonical-localhost scheme flipped from
// `http://` to `https://` (migration 1779100257124). That earlier migration
// rewrote URL substrings across most text/JSONB columns, but realm-server
// re-inserts its bootstrap rows on every boot, so a developer who started
// the realm-server under the old scheme ends up with both an HTTP row and
// an HTTPS row for the same realm path.
//
// The HTTP row's `realm_user_permissions` sibling was rewritten to HTTPS
// by 1779100257124, so when the file-watcher fires on the HTTP-keyed
// Realm instance, `getRealmOwnerUserId` can't find any permission row at
// the HTTP URL and throws "Cannot determine realm owner for realm
// http://localhost:42XX/...".
//
// Fix: delete every HTTP-canonical row that has an HTTPS sibling at the
// equivalent path — those are guaranteed stale duplicates. HTTP rows
// without an HTTPS sibling (a realm that has never been re-bootstrapped
// under the new scheme) are left alone, since deleting them could orphan
// user content tied only to the HTTP URL.
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
      AND EXISTS (
        SELECT 1 FROM realm_registry current
        WHERE current.url = REPLACE(stale.url, 'http://', 'https://')
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
