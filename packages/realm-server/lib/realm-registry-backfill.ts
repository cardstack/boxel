import { existsSync, readdirSync } from 'fs';
import { access } from 'fs/promises';
import { join, resolve } from 'path';
import {
  PUBLISHED_DIRECTORY_NAME,
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

const log = logger('realm-server:registry-backfill');

// Constant, arbitrarily chosen, stable across deployments. Only one process
// at a time can hold this advisory lock against a given database, so only
// one process performs the boot-time backfill per startup wave in a
// multi-instance deployment. Single-instance: uncontended acquisition, no
// behavioral effect.
export const REGISTRY_BACKFILL_LOCK_ID = 7331011;

// Sentinel used as owner_username for kind='bootstrap' rows. Bootstrap realms
// (base, catalog, etc.) are not user-owned, but the column is NOT NULL, so we
// use a fixed value instead. Mutation handlers reject operations targeting
// kind='bootstrap' rows regardless of owner, so this value is informational
// only.
const BOOTSTRAP_OWNER_SENTINEL = 'system';

export interface BootstrapRealmSeed {
  // Absolute path to the realm directory on disk (supplied via --path).
  diskPath: string;
  // The URL the realm is addressed by (matches Realm.url at construction
  // time). This is what populates realm_registry.url.
  url: string;
}

export interface RegistryBackfillOpts {
  dbAdapter: DBAdapter;
  realmsRootPath: string;
  serverURL: URL;
  bootstrapRealms: BootstrapRealmSeed[];
}

// Runs the boot-time backfill of realm_registry:
//   1. Bootstrap rows from CLI args (upserted, always pinned=true)
//   2. Source rows from realmsRootPath/<owner>/<endpoint>/realm.json
//      (inserted if absent, pinned=false)
//   3. Warns on registry rows whose disk path is missing
//   4. Warns on bootstrap rows that no longer have a matching CLI arg
//
// Published rows are written by handle-publish-realm and persist in
// realm_registry directly; there is no boot-time disk-scan recovery for them.
// (Pre-Phase-4-PR-2 the recovery joined the legacy `published_realms` table
// against the on-disk uuid directories; CS-10897 dropped that table, so the
// registry is the only source for the URL/owner/source metadata that disk
// alone doesn't carry.)
//
// Called from main.ts before the per-realm mount loop runs, so the registry
// reflects the full set of known realms before any Realm is constructed. All
// upserts are idempotent; running this multiple times (e.g., multi-instance
// boot) converges on the same state. Multi-instance coordination (advisory
// lock around the whole routine) is added in CS-10890.
export async function runRegistryBackfill(
  opts: RegistryBackfillOpts,
): Promise<void> {
  const started = Date.now();
  log.info('starting registry backfill');

  // Each sub-routine is wrapped independently so a failure in one (e.g.,
  // EACCES during a disk scan) doesn't prevent the others from running.
  // This is Phase 1 shadow data — any drift self-heals on next boot, so
  // "log and continue" is the right posture.
  const bootstrapUrls = await safeStep('bootstrap', () =>
    upsertBootstrapRealms(opts),
  );
  const sourceDiscovered = await safeStep('source', () =>
    upsertSourceRealms(opts),
  );
  await safeStep('orphan-check', () => warnOnOrphans(opts));
  await safeStep('stale-bootstrap-check', () =>
    warnOnStaleBootstrapRows(opts, bootstrapUrls ?? new Set()),
  );

  // Note: `sourceDiscovered` is the number of realm directories seen on
  // disk, not the number of INSERTs actually executed. Under ON CONFLICT DO
  // NOTHING, a second run reports the same count even if no rows change.
  // That's intentional — the count is a measure of the scan, not the diff.
  log.info(
    `registry backfill complete in ${Date.now() - started}ms ` +
      `(bootstrap=${bootstrapUrls?.size ?? 0}, ` +
      `sourceDiscovered=${sourceDiscovered ?? 0})`,
  );
}

// Run a sub-routine with a catch-all that logs and swallows. Returns the
// sub-routine's resolved value, or undefined if it threw. The per-step
// isolation is deliberate: shadow data in Phase 1 doesn't warrant crashing
// realm-server boot on a transient FS error or DB blip.
async function safeStep<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: unknown) {
    log.warn(
      `registry backfill step "${name}" failed; continuing: ${String(err)}`,
    );
    return undefined;
  }
}

async function upsertBootstrapRealms(
  opts: RegistryBackfillOpts,
): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const { diskPath, url } of opts.bootstrapRealms) {
    seen.add(url);
    // DO UPDATE the disk_id so that if an operator rehomes a bootstrap realm
    // (container rebuild, path change across environments) the registry
    // tracks the new path. The kind='bootstrap' guard in the WHERE clause
    // ensures a CLI typo that collides with a user-realm URL won't clobber
    // that user's row.
    await query(opts.dbAdapter, [
      `INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (`,
      param(url),
      `,`,
      param('bootstrap'),
      `,`,
      param(resolve(diskPath)),
      `,`,
      param(BOOTSTRAP_OWNER_SENTINEL),
      `,`,
      param(true),
      `) ON CONFLICT (url) DO UPDATE SET disk_id = EXCLUDED.disk_id, pinned = true, updated_at = now() WHERE realm_registry.kind = 'bootstrap'`,
    ]);
  }
  return seen;
}

async function upsertSourceRealms(opts: RegistryBackfillOpts): Promise<number> {
  if (!existsSync(opts.realmsRootPath)) {
    return 0;
  }
  let count = 0;
  for (const ownerEntry of readdirSync(opts.realmsRootPath, {
    withFileTypes: true,
  })) {
    if (!ownerEntry.isDirectory()) {
      continue;
    }
    if (ownerEntry.name === PUBLISHED_DIRECTORY_NAME) {
      // Skip: published realms are scanned separately below.
      continue;
    }
    const owner = ownerEntry.name;
    const ownerDir = join(opts.realmsRootPath, owner);
    for (const realmEntry of readdirSync(ownerDir, { withFileTypes: true })) {
      if (!realmEntry.isDirectory()) {
        continue;
      }
      const endpoint = realmEntry.name;
      if (!existsSync(join(ownerDir, endpoint, 'realm.json'))) {
        continue;
      }
      // URL construction matches server.ts:loadRealms so a Realm constructed
      // from this row later uses the same URL that was registered.
      const url = new URL(
        `${opts.serverURL.pathname.replace(/\/$/, '')}/${owner}/${endpoint}/`,
        opts.serverURL,
      ).href;
      const diskId = `${owner}/${endpoint}`;
      await query(opts.dbAdapter, [
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (`,
        param(url),
        `,`,
        param('source'),
        `,`,
        param(diskId),
        `,`,
        param(owner),
        `,`,
        param(false),
        `) ON CONFLICT (url) DO NOTHING`,
      ]);
      count += 1;
    }
  }
  return count;
}

// One fs.access call per row, run in parallel (bounded concurrency); avoids
// blocking the event loop for the duration of a blocking existsSync sweep.
// Each call is latency-bound on EFS, so parallelism materially reduces wall
// time. Gated by REALM_REGISTRY_SKIP_ORPHAN_CHECK so an operator running at
// very large registry size can disable the sweep entirely.
const ORPHAN_CHECK_CONCURRENCY = 32;

async function warnOnOrphans(opts: RegistryBackfillOpts): Promise<void> {
  if (process.env.REALM_REGISTRY_SKIP_ORPHAN_CHECK === 'true') {
    log.info('orphan check skipped (REALM_REGISTRY_SKIP_ORPHAN_CHECK=true)');
    return;
  }
  // disk_id means something different for each kind — see the column comment
  // in the realm_registry migration — so the check is kind-specific.
  const rows = (await query(opts.dbAdapter, [
    `SELECT url, kind, disk_id FROM realm_registry`,
  ])) as Array<{ url: string; kind: string; disk_id: string }>;
  const publishedRoot = join(opts.realmsRootPath, PUBLISHED_DIRECTORY_NAME);

  async function checkOne(row: { url: string; kind: string; disk_id: string }) {
    let realmJson: string;
    if (row.kind === 'source') {
      realmJson = join(opts.realmsRootPath, row.disk_id, 'realm.json');
    } else if (row.kind === 'published') {
      realmJson = join(publishedRoot, row.disk_id, 'realm.json');
    } else if (row.kind === 'bootstrap') {
      realmJson = join(row.disk_id, 'realm.json');
    } else {
      return;
    }
    try {
      await access(realmJson);
    } catch {
      log.warn(
        `registry row ${row.url} (kind=${row.kind}) is missing its disk path at ${realmJson}`,
      );
    }
  }

  for (let i = 0; i < rows.length; i += ORPHAN_CHECK_CONCURRENCY) {
    const slice = rows.slice(i, i + ORPHAN_CHECK_CONCURRENCY);
    await Promise.all(slice.map(checkOne));
  }
}

async function warnOnStaleBootstrapRows(
  opts: RegistryBackfillOpts,
  cliBootstrapUrls: Set<string>,
): Promise<void> {
  const rows = (await query(opts.dbAdapter, [
    `SELECT url FROM realm_registry WHERE kind = 'bootstrap'`,
  ])) as Array<{ url: string }>;
  for (const { url } of rows) {
    if (!cliBootstrapUrls.has(url)) {
      log.warn(
        `registry has bootstrap row ${url} but no matching --path CLI arg this boot (operator may have removed it)`,
      );
    }
  }
}

// Runs runRegistryBackfill under a pg advisory lock so that, in a multi-
// instance deployment, only one realm-server performs the backfill per
// startup wave. Acquired via `withConnection` so the lock (session-scoped)
// is pinned to a dedicated connection; explicitly released before that
// connection returns to the pool so the lock doesn't leak.
//
// If the lock is held by a peer, this function logs and returns without
// running the backfill. The reconciler (CS-10890) still starts on this
// process and picks up the registry state that the peer populated.
export async function runRegistryBackfillWithAdvisoryLock(
  dbAdapter: PgAdapter,
  opts: RegistryBackfillOpts,
): Promise<void> {
  await dbAdapter.withConnection(async (queryFn) => {
    const rows = (await queryFn([
      `SELECT pg_try_advisory_lock(`,
      param(REGISTRY_BACKFILL_LOCK_ID),
      `) AS acquired`,
    ])) as [{ acquired: boolean }];
    if (!rows[0]?.acquired) {
      log.info(
        'peer process holds the registry backfill advisory lock; skipping backfill on this instance',
      );
      return;
    }
    try {
      await runRegistryBackfill(opts);
    } finally {
      try {
        await queryFn([
          `SELECT pg_advisory_unlock(`,
          param(REGISTRY_BACKFILL_LOCK_ID),
          `)`,
        ]);
      } catch (err: unknown) {
        log.warn(
          `failed to release registry backfill advisory lock: ${String(err)}`,
        );
      }
    }
  });
}
