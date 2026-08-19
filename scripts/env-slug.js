/**
 * Canonical environment-slug sanitizer for JS/TS callers.
 * Mirror of scripts/env-slug.sh's `compute_env_slug` — keep the two in
 * sync. Required by:
 *   packages/host/scripts/traefik-helpers.js
 *   packages/matrix/support/environment-config.ts
 *   packages/realm-server/lib/dev-service-registry.ts
 */

'use strict';

/**
 * Normalize a raw branch/environment name into a slug suitable for
 * hostnames, container names, db names, and filesystem paths.
 *
 * Caps at 63 chars (DNS label limit) so the slug works as a hostname
 * label in `<service>.<slug>.localhost`. Chrome silently routes
 * hostnames with over-63-char labels to the search engine instead of
 * resolving them. `^-|-$` runs after the slice so a truncate that
 * lands on a hyphen doesn't leave the slug ending in one.
 *
 * @param {string | null | undefined} raw
 * @returns {string}
 */
function sanitizeSlug(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 63)
    .replace(/^-|-$/g, '');
}

/**
 * Convert a sanitized slug into a Postgres-safe database-name suffix.
 *
 * Postgres allows hyphens in identifiers only when quoted; unquoted
 * references (CREATE DATABASE foo-bar, psql -d foo-bar, libpq's
 * URI parser) treat them as operators or delimiters. Swap hyphens for
 * underscores so the slug is usable unquoted.
 *
 * @param {string | null | undefined} slug
 * @returns {string}
 */
function pgDbSlug(slug) {
  return (slug || '').replace(/-/g, '_');
}

module.exports = { sanitizeSlug, pgDbSlug };
