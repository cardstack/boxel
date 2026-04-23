import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, param, query } from '@cardstack/runtime-common';

// Helpers for mirroring handler-driven realm lifecycle events
// (publish/unpublish/delete/create) into realm_registry. Phase 1 dual-writes:
// every helper is wrapped in its own try/catch so that a failure to write the
// registry row never surfaces as an error to the caller. The registry is
// shadow data in Phase 1 (no reader depends on it until Phase 3), and any
// drift from the legacy tables is self-healed by the boot-time backfill in
// realm-registry-backfill.ts.
//
// All mutation helpers include a `kind != 'bootstrap'` guard so a user-facing
// handler mutation can never affect a bootstrap row (belt-and-suspenders: URLs
// shouldn't match in practice, but the guard keeps that guarantee enforced at
// the SQL layer).

const log = logger('realm-server:registry-writes');

// Upsert a published realm into realm_registry. Called from handle-publish-realm
// after the legacy published_realms write succeeds.
//
// On conflict: updates last_published_at/updated_at so repeat publishes
// advance the timestamp. The ON CONFLICT UPDATE's WHERE clause keeps the
// update no-oped if the existing row isn't kind='published' — which also
// serves as the bootstrap guard.
export async function mirrorPublishedRealmToRegistry(
  dbAdapter: DBAdapter,
  args: {
    publishedRealmURL: string;
    publishedRealmId: string;
    ownerUsername: string;
    sourceRealmURL: string;
    lastPublishedAt: number;
  },
): Promise<void> {
  try {
    await query(dbAdapter, [
      `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url, last_published_at, pinned) VALUES (`,
      param(args.publishedRealmURL),
      `, 'published', `,
      param(args.publishedRealmId),
      `, `,
      param(args.ownerUsername),
      `, `,
      param(args.sourceRealmURL),
      `, `,
      param(args.lastPublishedAt),
      `, false`,
      `) ON CONFLICT (url) DO UPDATE SET last_published_at = EXCLUDED.last_published_at, updated_at = now() WHERE realm_registry.kind = 'published'`,
    ]);
  } catch (err: unknown) {
    log.warn(
      `failed to mirror publish to realm_registry for ${args.publishedRealmURL}: ${String(err)}; will self-heal on next boot`,
    );
  }
}

// Insert a source realm into realm_registry. Called from server.ts:createRealm
// after permissions + .realm.json are written to disk.
export async function mirrorSourceRealmToRegistry(
  dbAdapter: DBAdapter,
  args: {
    url: string;
    diskId: string;
    ownerUsername: string;
  },
): Promise<void> {
  try {
    await query(dbAdapter, [
      `INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (`,
      param(args.url),
      `, 'source', `,
      param(args.diskId),
      `, `,
      param(args.ownerUsername),
      `, false`,
      `) ON CONFLICT (url) DO NOTHING`,
    ]);
  } catch (err: unknown) {
    log.warn(
      `failed to mirror source-realm create to realm_registry for ${args.url}: ${String(err)}; will self-heal on next boot`,
    );
  }
}

// Delete a single row from realm_registry by url. Used by
// handle-unpublish-realm (published row) and handle-delete-realm (source row).
// kind != 'bootstrap' is the belt-and-suspenders guard.
export async function deleteFromRegistryByUrl(
  dbAdapter: DBAdapter,
  url: string,
): Promise<void> {
  try {
    await query(dbAdapter, [
      `DELETE FROM realm_registry WHERE url =`,
      param(url),
      ` AND kind <> 'bootstrap'`,
    ]);
  } catch (err: unknown) {
    log.warn(
      `failed to delete realm_registry row for ${url}: ${String(err)}; will self-heal on next boot`,
    );
  }
}

// Delete every kind='published' row whose source_url matches the given source
// realm URL. Used by handle-delete-realm when a source realm (and all its
// publications) is being removed. The kind='published' filter is explicit
// even though the schema's CHECK constraint already guarantees that only
// published rows have non-null source_url — stating the contract in the SQL
// matches the helper's name and survives any future schema changes.
export async function deletePublishedFromRegistryBySource(
  dbAdapter: DBAdapter,
  sourceUrl: string,
): Promise<void> {
  try {
    await query(dbAdapter, [
      `DELETE FROM realm_registry WHERE source_url =`,
      param(sourceUrl),
      ` AND kind = 'published'`,
    ]);
  } catch (err: unknown) {
    log.warn(
      `failed to delete published realm_registry rows for source ${sourceUrl}: ${String(err)}; will self-heal on next boot`,
    );
  }
}
