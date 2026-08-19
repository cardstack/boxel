import type { DBAdapter, Querier } from '@cardstack/runtime-common';
import { dbAdapterQuerier, logger, param } from '@cardstack/runtime-common';

// Helpers that the realm-mutating handlers (publish/unpublish/delete/create)
// use to write `realm_registry`. Phase 4 PR 2 (CS-10897) made the registry the
// only source of truth — Phase 1 PR 3 wrote both tables; the legacy
// `published_realms` table is now dropped — so failures bubble up to the
// caller. The previous "log-and-swallow" posture matched the Phase 1 shadow-
// data semantics; under the new authoritative posture, a failed write must
// surface the same way any other handler DB failure surfaces.
//
// All mutation helpers include a `kind != 'bootstrap'` guard so a user-facing
// handler mutation can never affect a bootstrap row (belt-and-suspenders: URLs
// shouldn't match in practice, but the guard keeps that guarantee enforced at
// the SQL layer).
//
// After a successful DB write, each helper emits
// `NOTIFY realm_registry, '<op>:<url>'` so that any RealmRegistryReconciler
// instances listening on the channel can react promptly. The payload is a
// hint only — reconcilers always re-read the DB. NOTIFY itself is wrapped in
// its own try/catch and only logs on failure: a dropped notification is
// recovered by the reconciler's 30s poll safety net, so propagating it would
// fail an otherwise successful mutation for no benefit.

const REGISTRY_CHANNEL = 'realm_registry';
const log = logger('realm-server:registry-writes');

async function notifyRegistry(
  querier: Querier,
  op: 'upsert' | 'delete',
  url: string,
): Promise<void> {
  try {
    await querier([
      `SELECT pg_notify(`,
      param(REGISTRY_CHANNEL),
      `, `,
      param(`${op}:${url}`),
      `)`,
    ]);
  } catch (err: unknown) {
    log.warn(
      `failed to NOTIFY ${REGISTRY_CHANNEL} ${op}:${url}: ${String(err)}; reconciler poll will self-heal`,
    );
  }
}

// Upsert a published realm row. Called from handle-publish-realm. On
// conflict, updates last_published_at/updated_at so repeat publishes advance
// the timestamp. The ON CONFLICT UPDATE's WHERE clause keeps the update
// no-oped if the existing row isn't kind='published' — which also serves as
// the bootstrap guard.
export async function upsertPublishedRealmInRegistry(
  dbAdapter: DBAdapter,
  args: {
    publishedRealmURL: string;
    publishedRealmId: string;
    ownerUsername: string;
    sourceRealmURL: string;
    lastPublishedAt: number;
  },
  querier?: Querier,
): Promise<void> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await q([
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
  await notifyRegistry(q, 'upsert', args.publishedRealmURL);
}

// Insert a source realm row. Called from server.ts:createRealm after
// permissions + realm.json are written to disk.
export async function insertSourceRealmInRegistry(
  dbAdapter: DBAdapter,
  args: {
    url: string;
    diskId: string;
    ownerUsername: string;
  },
  querier?: Querier,
): Promise<void> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await q([
    `INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (`,
    param(args.url),
    `, 'source', `,
    param(args.diskId),
    `, `,
    param(args.ownerUsername),
    `, false`,
    `) ON CONFLICT (url) DO NOTHING`,
  ]);
  await notifyRegistry(q, 'upsert', args.url);
}

// Delete a single row by url. Used by handle-unpublish-realm (published row)
// and handle-delete-realm (source row). The kind != 'bootstrap' guard is
// belt-and-suspenders.
export async function deleteRegistryRowByUrl(
  dbAdapter: DBAdapter,
  url: string,
  querier?: Querier,
): Promise<void> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await q([
    `DELETE FROM realm_registry WHERE url =`,
    param(url),
    ` AND kind <> 'bootstrap'`,
  ]);
  await notifyRegistry(q, 'delete', url);
}

// Delete every kind='published' row whose source_url matches the given source
// realm URL. Used by handle-delete-realm when a source realm (and all its
// publications) is being removed. The kind='published' filter is explicit
// even though the schema's CHECK constraint already guarantees that only
// published rows have non-null source_url — stating the contract in the SQL
// matches the helper's name and survives any future schema changes.
//
// Returns the rows that were actually deleted so the caller can drive
// per-published cleanup (permissions, DB artifacts, FS) against the
// authoritative set the tx committed — closes the TOCTOU window where a
// pre-lock SELECT could miss a row inserted before the tx began.
export async function deletePublishedRowsBySourceUrl(
  dbAdapter: DBAdapter,
  sourceUrl: string,
  querier?: Querier,
): Promise<{ url: string; disk_id: string }[]> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  let deleted = (await q([
    `DELETE FROM realm_registry WHERE source_url =`,
    param(sourceUrl),
    ` AND kind = 'published' RETURNING url, disk_id`,
  ])) as { url: string; disk_id: string }[];
  // Single NOTIFY keyed on the source URL. Reconcilers will re-read and see
  // all deletes; the payload is a hint, not a precise per-row signal.
  await notifyRegistry(q, 'delete', sourceUrl);
  return deleted;
}
