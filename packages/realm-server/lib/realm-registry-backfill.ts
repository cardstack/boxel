import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  PUBLISHED_DIRECTORY_NAME,
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';

const log = logger('realm-server:registry-backfill');

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
//   2. Source rows from realmsRootPath/<owner>/<endpoint>/.realm.json
//      (inserted if absent, pinned=false)
//   3. Published rows cross-referenced from published_realms + on-disk
//      realmsRootPath/_published/<uuid>/ (inserted if absent, pinned=false)
//   4. Warns on registry rows whose disk path is missing
//   5. Warns on bootstrap rows that no longer have a matching CLI arg
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

  const bootstrapUrls = await upsertBootstrapRealms(opts);
  const sourceCount = await upsertSourceRealms(opts);
  const publishedCount = await upsertPublishedRealms(opts);

  await warnOnOrphans(opts);
  await warnOnStaleBootstrapRows(opts, bootstrapUrls);

  log.info(
    `registry backfill complete in ${Date.now() - started}ms ` +
      `(bootstrap=${bootstrapUrls.size}, source=${sourceCount}, ` +
      `published=${publishedCount})`,
  );
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
      if (!existsSync(join(ownerDir, endpoint, '.realm.json'))) {
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

async function upsertPublishedRealms(
  opts: RegistryBackfillOpts,
): Promise<number> {
  const publishedRoot = join(opts.realmsRootPath, PUBLISHED_DIRECTORY_NAME);
  if (!existsSync(publishedRoot)) {
    return 0;
  }

  // Correlate on-disk uuid directory names with published_realms rows to get
  // the url/owner/source/last_published_at metadata that disk alone doesn't
  // carry. Post-Phase-4 this can read straight from realm_registry; while the
  // legacy table still exists, this is the authoritative source.
  const rows = (await query(opts.dbAdapter, [
    `SELECT id::text AS id, published_realm_url, source_realm_url, owner_username, last_published_at FROM published_realms`,
  ])) as Array<{
    id: string;
    published_realm_url: string;
    source_realm_url: string;
    owner_username: string;
    last_published_at: number | string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  let count = 0;
  for (const entry of readdirSync(publishedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const uuid = entry.name;
    if (!existsSync(join(publishedRoot, uuid, '.realm.json'))) {
      continue;
    }
    const row = byId.get(uuid);
    if (!row) {
      log.warn(
        `published realm directory at ${join(publishedRoot, uuid)} has no matching published_realms row; skipping`,
      );
      continue;
    }
    const lastPublishedAt =
      row.last_published_at == null ? null : Number(row.last_published_at);
    await query(opts.dbAdapter, [
      `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url, last_published_at, pinned) VALUES (`,
      param(row.published_realm_url),
      `,`,
      param('published'),
      `,`,
      param(uuid),
      `,`,
      param(row.owner_username),
      `,`,
      param(row.source_realm_url),
      `,`,
      param(lastPublishedAt),
      `,`,
      param(false),
      `) ON CONFLICT (url) DO NOTHING`,
    ]);
    count += 1;
  }
  return count;
}

async function warnOnOrphans(opts: RegistryBackfillOpts): Promise<void> {
  // disk_id means something different for each kind — see the column comment
  // in the realm_registry migration — so the check is kind-specific.
  const rows = (await query(opts.dbAdapter, [
    `SELECT url, kind, disk_id FROM realm_registry`,
  ])) as Array<{ url: string; kind: string; disk_id: string }>;
  const publishedRoot = join(opts.realmsRootPath, PUBLISHED_DIRECTORY_NAME);

  for (const { url, kind, disk_id } of rows) {
    let realmJson: string;
    if (kind === 'source') {
      realmJson = join(opts.realmsRootPath, disk_id, '.realm.json');
    } else if (kind === 'published') {
      realmJson = join(publishedRoot, disk_id, '.realm.json');
    } else if (kind === 'bootstrap') {
      realmJson = join(disk_id, '.realm.json');
    } else {
      continue;
    }
    if (!existsSync(realmJson)) {
      log.warn(
        `registry row ${url} (kind=${kind}) is missing its disk path at ${realmJson}`,
      );
    }
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
