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

const log = logger('realm-server:config-card-backfill');

// Distinct from REGISTRY_BACKFILL_LOCK_ID (7331011) and
// METADATA_BACKFILL_LOCK_ID (7331012) so the three boot-time backfills
// don't serialize on each other.
export const CONFIG_CARD_BACKFILL_LOCK_ID = 7331013;

// CS-11150 creates a RealmConfig card instance at /realm.json for every
// realm that doesn't have one yet, populating it from the legacy
// .realm.json sidecar. After CS-10051, parseRealmInfo prefers the card
// file but falls back to the sidecar; the fallback can be removed
// (CS-11131) once this backfill has run in every environment.
//
// Skips when /realm.json already exists — the card is the source of
// truth, and the backfill never overwrites it.
//
// Fields owned by the RealmConfig card (see REALM_CONFIG_CARD_PROPERTIES
// in runtime-common/realm.ts). Anything outside this set stays in the
// sidecar (today: hostHome / interactHome, until CS-10055 lands).
const CARD_KEYS_TO_MIGRATE = [
  'name',
  'backgroundURL',
  'iconURL',
  'hostRoutingRules',
  'includePrerenderedDefaultRealmIndex',
] as const;

// Canonical RealmConfig adopts-from module. patchRealmConfig writes the
// same absolute URL and rejects anything else on subsequent edits, so
// the migrated card matches what the running server would have written
// itself. Resolving cross-realm to packages/base/realm-config.gts means
// per-realm copies of that file are not needed.
const REALM_CONFIG_MODULE = 'https://cardstack.com/base/realm-config';
const REALM_CONFIG_NAME = 'RealmConfig';

export interface RealmConfigCardBackfillOpts {
  dbAdapter: DBAdapter;
  realmsRootPath: string;
  serverURL: URL;
  bootstrapRealms: BootstrapRealmSeed[];
}

export async function runRealmConfigCardBackfill(
  opts: RealmConfigCardBackfillOpts,
): Promise<void> {
  const started = Date.now();
  log.info('starting realm.json card backfill');

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
    `realm.json card backfill complete in ${Date.now() - started}ms ` +
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
      `realm.json card backfill step "${name}" failed; continuing: ${String(err)}`,
    );
    return undefined;
  }
}

// Materializes a RealmConfig card at cardPath from the migratable keys
// in the sidecar. Returns true when a card was actually written.
//
// Pre-existing card → leave both files alone (the card is source of
// truth; trimming the sidecar without reading the card would risk
// losing a value the card doesn't have).
// Pre-existing card absent, sidecar has zero migratable keys → no-op
// (don't write an empty card; a card with no attributes is not
// equivalent to "no card").
function migrateOne(
  sidecarPath: string,
  cardPath: string,
  url: string,
): boolean {
  if (existsSync(cardPath)) {
    return false;
  }
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

  const cardAttrs: Record<string, unknown> = {};
  const migratedKeys: string[] = [];
  for (const key of CARD_KEYS_TO_MIGRATE) {
    if (!(key in sidecar)) {
      continue;
    }
    const value = sidecar[key];
    if (key === 'name') {
      // `name` is stored under cardInfo.name on the card, matching what
      // patchRealmConfig writes (see REALM_CONFIG_CARD_PROPERTIES handling).
      cardAttrs.cardInfo = { name: value };
    } else {
      cardAttrs[key] = value;
    }
    migratedKeys.push(key);
  }
  if (migratedKeys.length === 0) {
    return false;
  }

  const cardDoc = {
    data: {
      type: 'card',
      attributes: cardAttrs,
      meta: {
        adoptsFrom: {
          module: REALM_CONFIG_MODULE,
          name: REALM_CONFIG_NAME,
        },
      },
    },
  };

  try {
    writeFileSync(cardPath, JSON.stringify(cardDoc, null, 2) + '\n');
  } catch (err: unknown) {
    log.warn(`could not write ${cardPath} for ${url}: ${String(err)}`);
    return false;
  }

  // Trim migrated keys from the sidecar. Leave non-migrated keys
  // (notably hostHome / interactHome) so they can be picked up by a
  // later migration (CS-10055).
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sidecar)) {
    if (!(migratedKeys as readonly string[]).includes(k)) {
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

async function backfillSourceRealms(
  opts: RealmConfigCardBackfillOpts,
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
      const realmDir = join(ownerDir, endpoint);
      const sidecarPath = join(realmDir, '.realm.json');
      const cardPath = join(realmDir, 'realm.json');
      const url = new URL(
        `${opts.serverURL.pathname.replace(/\/$/, '')}/${owner}/${endpoint}/`,
        opts.serverURL,
      ).href;
      if (migrateOne(sidecarPath, cardPath, url)) {
        count += 1;
      }
    }
  }
  return count;
}

async function backfillPublishedRealms(
  opts: RealmConfigCardBackfillOpts,
): Promise<number> {
  const publishedRoot = join(opts.realmsRootPath, PUBLISHED_DIRECTORY_NAME);
  if (!existsSync(publishedRoot)) {
    return 0;
  }

  // Best-effort lookup for log messages only. Under multi-instance
  // startup wave, a peer process can hold the registry-backfill lock
  // while this process wins the config-card-backfill lock, so
  // realm_registry may be empty or sparse here. Don't gate the
  // migration on registry state — the migration itself only needs the
  // sidecar/card file paths.
  let byId: Map<string, string>;
  try {
    const rows = (await query(opts.dbAdapter, [
      `SELECT disk_id, url FROM realm_registry WHERE kind = 'published'`,
    ])) as Array<{ disk_id: string; url: string }>;
    byId = new Map(rows.map((r) => [r.disk_id, r.url]));
  } catch (err: unknown) {
    log.warn(
      `could not read realm_registry for url lookup; ` +
        `continuing without URLs in log messages: ${String(err)}`,
    );
    byId = new Map();
  }

  let count = 0;
  for (const entry of readdirSync(publishedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const realmDir = join(publishedRoot, entry.name);
    const sidecarPath = join(realmDir, '.realm.json');
    const cardPath = join(realmDir, 'realm.json');
    // URL is informational only inside migrateOne (used in error log
    // lines). Fall back to a disk-derived identifier so a missing
    // registry row doesn't suppress the migration.
    const url = byId.get(entry.name) ?? `published-disk:${entry.name}`;
    if (migrateOne(sidecarPath, cardPath, url)) {
      count += 1;
    }
  }
  return count;
}

async function backfillBootstrapRealms(
  opts: RealmConfigCardBackfillOpts,
): Promise<number> {
  let count = 0;
  for (const { diskPath, url } of opts.bootstrapRealms) {
    const sidecarPath = join(diskPath, '.realm.json');
    const cardPath = join(diskPath, 'realm.json');
    if (migrateOne(sidecarPath, cardPath, url)) {
      count += 1;
    }
  }
  return count;
}

// Multi-instance safety: if a peer process is mid-backfill, skip rather
// than racing. Mirrors the registry / metadata backfill advisory-lock
// pattern with a distinct lock id.
export async function runRealmConfigCardBackfillWithAdvisoryLock(
  dbAdapter: PgAdapter,
  opts: RealmConfigCardBackfillOpts,
): Promise<void> {
  await dbAdapter.withConnection(async (queryFn) => {
    const rows = (await queryFn([
      `SELECT pg_try_advisory_lock(`,
      param(CONFIG_CARD_BACKFILL_LOCK_ID),
      `) AS acquired`,
    ])) as [{ acquired: boolean }];
    if (!rows[0]?.acquired) {
      log.info(
        'peer process holds the realm.json card backfill advisory lock; skipping',
      );
      return;
    }
    try {
      await runRealmConfigCardBackfill(opts);
    } finally {
      try {
        await queryFn([
          `SELECT pg_advisory_unlock(`,
          param(CONFIG_CARD_BACKFILL_LOCK_ID),
          `)`,
        ]);
      } catch (err: unknown) {
        log.warn(
          `failed to release realm.json card backfill advisory lock: ${String(err)}`,
        );
      }
    }
  });
}
