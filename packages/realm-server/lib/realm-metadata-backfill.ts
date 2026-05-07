import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  PUBLISHED_DIRECTORY_NAME,
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { BootstrapRealmSeed } from './realm-registry-backfill';

const log = logger('realm-server:metadata-backfill');

// Constant, arbitrarily chosen, distinct from REGISTRY_BACKFILL_LOCK_ID
// (7331011) so the metadata and registry backfills don't serialize on
// the same advisory lock when both run at boot.
export const METADATA_BACKFILL_LOCK_ID = 7331012;

// CS-10053 moves these two flags from .realm.json into realm_metadata.
// On first boot after the schema migration runs, this backfill walks
// each realm directory, copies any present values into the DB, and
// trims them out of the sidecar so subsequent reads don't shadow the
// DB. Idempotent on re-runs (ON CONFLICT DO NOTHING + a no-op trim
// when keys are already absent).
const SIDECAR_KEYS_TO_MIGRATE = ['showAsCatalog', 'publishable'] as const;

export interface RealmMetadataBackfillOpts {
  dbAdapter: DBAdapter;
  realmsRootPath: string;
  serverURL: URL;
  bootstrapRealms: BootstrapRealmSeed[];
}

export async function runRealmMetadataBackfill(
  opts: RealmMetadataBackfillOpts,
): Promise<void> {
  const started = Date.now();
  log.info('starting metadata backfill');

  const sourceCount = await safeStep('source', () =>
    backfillSourceRealms(opts),
  );
  const publishedCount = await safeStep('published', () =>
    backfillPublishedRealms(opts),
  );
  const bootstrapCount = await safeStep('bootstrap', () =>
    backfillBootstrapRealms(opts),
  );

  log.info(
    `metadata backfill complete in ${Date.now() - started}ms ` +
      `(source=${sourceCount ?? 0}, ` +
      `published=${publishedCount ?? 0}, ` +
      `bootstrap=${bootstrapCount ?? 0})`,
  );
}

async function safeStep<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: unknown) {
    log.warn(
      `metadata backfill step "${name}" failed; continuing: ${String(err)}`,
    );
    return undefined;
  }
}

// Migrates one realm's sidecar metadata into realm_metadata and trims
// the migrated keys from the sidecar. Returns true if the sidecar had
// any of the migrated keys (whether or not the DB INSERT actually
// landed under ON CONFLICT DO NOTHING).
async function migrateOne(
  dbAdapter: DBAdapter,
  sidecarPath: string,
  url: string,
): Promise<boolean> {
  if (!existsSync(sidecarPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = readFileSync(sidecarPath, 'utf8');
  } catch (err: unknown) {
    log.warn(`could not read ${sidecarPath}: ${String(err)}`);
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    log.warn(`could not parse ${sidecarPath}: ${String(err)}`);
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  const sidecar = parsed as Record<string, unknown>;
  const hasKeys = SIDECAR_KEYS_TO_MIGRATE.some((k) => k in sidecar);
  if (!hasKeys) {
    return false;
  }

  // ON CONFLICT DO NOTHING — once a realm has a row, the DB is the
  // source of truth and we never overwrite from sidecar values that
  // may be stale.
  await query(dbAdapter, [
    `INSERT INTO realm_metadata (url, show_as_catalog, publishable) VALUES (`,
    param(url),
    `,`,
    param(coerceBool(sidecar.showAsCatalog)),
    `,`,
    param(coerceBool(sidecar.publishable)),
    `) ON CONFLICT (url) DO NOTHING`,
  ]);

  // Trim regardless of whether our INSERT landed: if a row already
  // existed, the DB's already-correct value is authoritative and the
  // sidecar's copy is shadow data.
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sidecar)) {
    if (!(SIDECAR_KEYS_TO_MIGRATE as readonly string[]).includes(k)) {
      trimmed[k] = v;
    }
  }
  try {
    writeFileSync(sidecarPath, JSON.stringify(trimmed, null, 2) + '\n');
  } catch (err: unknown) {
    log.warn(
      `could not trim migrated keys from ${sidecarPath}: ${String(err)}`,
    );
  }
  return true;
}

// Coerces a JSON value into boolean | null. Accepts true/false; any
// other shape (including strings, numbers, missing) becomes null.
function coerceBool(value: unknown): boolean | null {
  if (value === true || value === false) {
    return value;
  }
  return null;
}

async function backfillSourceRealms(
  opts: RealmMetadataBackfillOpts,
): Promise<number> {
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
      continue;
    }
    const owner = ownerEntry.name;
    const ownerDir = join(opts.realmsRootPath, owner);
    for (const realmEntry of readdirSync(ownerDir, { withFileTypes: true })) {
      if (!realmEntry.isDirectory()) {
        continue;
      }
      const endpoint = realmEntry.name;
      const sidecarPath = join(ownerDir, endpoint, '.realm.json');
      const url = new URL(
        `${opts.serverURL.pathname.replace(/\/$/, '')}/${owner}/${endpoint}/`,
        opts.serverURL,
      ).href;
      if (await migrateOne(opts.dbAdapter, sidecarPath, url)) {
        count += 1;
      }
    }
  }
  return count;
}

async function backfillPublishedRealms(
  opts: RealmMetadataBackfillOpts,
): Promise<number> {
  const publishedRoot = join(opts.realmsRootPath, PUBLISHED_DIRECTORY_NAME);
  if (!existsSync(publishedRoot)) {
    return 0;
  }
  // Map disk uuid → published URL via realm_registry; disk alone doesn't
  // carry the URL.
  const rows = (await query(opts.dbAdapter, [
    `SELECT disk_id, url FROM realm_registry WHERE kind = 'published'`,
  ])) as Array<{ disk_id: string; url: string }>;
  const byId = new Map(rows.map((r) => [r.disk_id, r.url]));

  let count = 0;
  for (const entry of readdirSync(publishedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const url = byId.get(entry.name);
    if (!url) {
      continue;
    }
    const sidecarPath = join(publishedRoot, entry.name, '.realm.json');
    if (await migrateOne(opts.dbAdapter, sidecarPath, url)) {
      count += 1;
    }
  }
  return count;
}

async function backfillBootstrapRealms(
  opts: RealmMetadataBackfillOpts,
): Promise<number> {
  let count = 0;
  for (const { diskPath, url } of opts.bootstrapRealms) {
    const sidecarPath = join(diskPath, '.realm.json');
    if (await migrateOne(opts.dbAdapter, sidecarPath, url)) {
      count += 1;
    }
  }
  return count;
}

// Multi-instance safety: if a peer process is mid-backfill, we skip
// instead of duplicating the work. Mirrors the registry backfill's
// advisory-lock pattern, with a distinct lock ID so the two backfills
// don't serialize on each other.
export async function runRealmMetadataBackfillWithAdvisoryLock(
  dbAdapter: PgAdapter,
  opts: RealmMetadataBackfillOpts,
): Promise<void> {
  await dbAdapter.withConnection(async (queryFn) => {
    const rows = (await queryFn([
      `SELECT pg_try_advisory_lock(`,
      param(METADATA_BACKFILL_LOCK_ID),
      `) AS acquired`,
    ])) as [{ acquired: boolean }];
    if (!rows[0]?.acquired) {
      log.info(
        'peer process holds the metadata backfill advisory lock; skipping',
      );
      return;
    }
    try {
      await runRealmMetadataBackfill(opts);
    } finally {
      try {
        await queryFn([
          `SELECT pg_advisory_unlock(`,
          param(METADATA_BACKFILL_LOCK_ID),
          `)`,
        ]);
      } catch (err: unknown) {
        log.warn(
          `failed to release metadata backfill advisory lock: ${String(err)}`,
        );
      }
    }
  });
}
