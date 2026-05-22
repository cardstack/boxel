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

// CS-11150 creates a RealmConfig card at /realm.json for every realm
// that doesn't have one yet, populating it from the legacy .realm.json
// sidecar. CS-10055 extends that work: the legacy `hostHome` (a string
// URL) is also migrated into the card, becoming a `/`-rooted entry in
// `hostRoutingRules`, and `interactHome` (now obsolete — `index.json`
// covers the interact-mode home case) is dropped from the sidecar.
//
// Three migration shapes coexist in one pass so existing card +
// sidecar-only fields don't have to wait for separate boot cycles:
//
//   - New card created from a sidecar that has any migratable key.
//   - Existing card augmented with a `/`-rule when the sidecar has
//     `hostHome` and the card doesn't already have a `/` rule.
//   - Sidecar always trimmed of every key the card now owns.
const CARD_ATTRIBUTE_KEYS = [
  'backgroundURL',
  'iconURL',
  'includePrerenderedDefaultRealmIndex',
] as const;

// `name` is migrated into `cardInfo.name` on the card, not a top-level
// attribute. Tracked separately so the card-construction step can do
// the translation.
const NAME_KEY = 'name';

// Sidecar keys that always get trimmed when present, regardless of
// whether the card needed any modification. interactHome is dropped
// outright (no card field) — the field is obsolete now that index.json
// is the interact-mode home.
const SIDECAR_KEYS_TO_DROP = ['interactHome'] as const;

// Canonical RealmConfig adopts-from module. patchRealmConfig writes the
// same absolute URL and rejects anything else on subsequent edits, so
// the migrated card matches what the running server would have written
// itself. Resolving cross-realm to packages/base/realm-config.gts means
// per-realm copies of that file are not needed.
const REALM_CONFIG_MODULE = 'https://cardstack.com/base/realm-config';
const REALM_CONFIG_NAME = 'RealmConfig';

// On-disk shape of a RealmConfig card. `hostRoutingRules` paths live in
// `attributes` but their `instance` linksTo lives under `relationships`
// keyed by `hostRoutingRules.<index>.instance`, with a relative `./Type/id`
// URL inside `links.self`. Matches what patchRealmConfig / the indexer
// write on this codebase.
interface CardDoc {
  data: {
    type: 'card';
    attributes?: Record<string, unknown>;
    relationships?: Record<string, { links: { self: string | null } }>;
    meta: {
      adoptsFrom: { module: string; name: string };
    };
  };
}

interface RoutingRule {
  path?: string;
}

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

// Returns:
//   true  — the backfill modified at least one of (card file, sidecar
//           file) for this realm
//   false — no-op (no sidecar, nothing to migrate, or registry URL
//           required-but-missing for hostHome)
//
// `url` is the realm's canonical URL when known. Pass `null` for
// published realms when realm_registry doesn't have a row yet — the
// new-card path still works (URL is only used in error logs), but
// the hostHome → `/`-rule path needs the URL to compute the relative
// `./Type/id` link and is skipped with a warning.
function migrateOne(
  sidecarPath: string,
  cardPath: string,
  url: string | null,
): boolean {
  if (!existsSync(sidecarPath)) {
    return false;
  }

  const sidecar = readSidecar(sidecarPath);
  if (sidecar === null) {
    return false;
  }

  const existingCard = readExistingCard(cardPath);
  if (existingCard === 'unparseable') {
    log.warn(`existing realm.json at ${cardPath} is unparseable; skipping`);
    return false;
  }

  if (existingCard === null) {
    return createCardFromSidecar(sidecarPath, cardPath, sidecar, url);
  }
  return augmentExistingCard(sidecarPath, cardPath, existingCard, sidecar, url);
}

function readSidecar(sidecarPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(sidecarPath, 'utf8');
  } catch (err: unknown) {
    log.warn(`could not read ${sidecarPath}: ${String(err)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    log.warn(`could not parse ${sidecarPath}: ${String(err)}`);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function readExistingCard(cardPath: string): CardDoc | null | 'unparseable' {
  if (!existsSync(cardPath)) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(cardPath, 'utf8');
  } catch (err: unknown) {
    log.warn(`could not read ${cardPath}: ${String(err)}`);
    return 'unparseable';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    log.warn(`could not parse ${cardPath}: ${String(err)}`);
    return 'unparseable';
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !('data' in (parsed as object))
  ) {
    return 'unparseable';
  }
  return parsed as CardDoc;
}

// Build a fresh RealmConfig card from sidecar values. Returns null if
// the sidecar has no card-bound keys to migrate (so no empty card is
// written).
function createCardFromSidecar(
  sidecarPath: string,
  cardPath: string,
  sidecar: Record<string, unknown>,
  url: string | null,
): boolean {
  const attributes: Record<string, unknown> = {};
  const relationships: Record<string, { links: { self: string | null } }> = {};
  const migratedKeys = new Set<string>();

  if (NAME_KEY in sidecar) {
    attributes.cardInfo = { name: sidecar[NAME_KEY] };
    migratedKeys.add(NAME_KEY);
  }
  for (const key of CARD_ATTRIBUTE_KEYS) {
    if (!(key in sidecar)) continue;
    attributes[key] = sidecar[key];
    migratedKeys.add(key);
  }

  // hostRoutingRules: rare in sidecars on this codebase (the field
  // already lives on the card today), but if a sidecar carries it,
  // split into the canonical {path}-in-attributes / linksTo-in-
  // relationships shape rather than copying verbatim.
  const sidecarRules = sidecar.hostRoutingRules;
  if (Array.isArray(sidecarRules)) {
    const rulesAttrs: { path?: string }[] = [];
    sidecarRules.forEach((rule, i) => {
      if (rule && typeof rule === 'object') {
        const r = rule as Record<string, unknown>;
        rulesAttrs.push({ path: r.path as string | undefined });
        if (typeof r.instance === 'string') {
          relationships[`hostRoutingRules.${i}.instance`] = {
            links: { self: toRelativeInstanceLink(r.instance, url) },
          };
        }
      }
    });
    attributes.hostRoutingRules = rulesAttrs;
    migratedKeys.add('hostRoutingRules');
  }

  // hostHome → /-rooted hostRoutingRules entry. Appended after any
  // existing rules; if the sidecar already contained a /-rule via
  // hostRoutingRules, that rule wins and hostHome is dropped silently.
  const hostHome = sidecar.hostHome;
  if (typeof hostHome === 'string') {
    if (url === null) {
      log.warn(
        `cannot migrate hostHome at ${sidecarPath} without a known realm URL; ` +
          `leaving sidecar entry for a future boot`,
      );
    } else {
      const existingRules = Array.isArray(attributes.hostRoutingRules)
        ? (attributes.hostRoutingRules as RoutingRule[])
        : [];
      const hasSlashRule = existingRules.some((r) => r.path === '/');
      if (!hasSlashRule) {
        const newIndex = existingRules.length;
        existingRules.push({ path: '/' });
        attributes.hostRoutingRules = existingRules;
        relationships[`hostRoutingRules.${newIndex}.instance`] = {
          links: { self: toRelativeInstanceLink(hostHome, url) },
        };
      }
      migratedKeys.add('hostHome');
    }
  }

  for (const key of SIDECAR_KEYS_TO_DROP) {
    if (key in sidecar) {
      migratedKeys.add(key);
    }
  }

  if (migratedKeys.size === 0) {
    return false;
  }

  // If hostRoutingRules ended up empty, omit the attribute so the card
  // doesn't carry an empty array purely as a backfill artifact.
  if (
    Array.isArray(attributes.hostRoutingRules) &&
    (attributes.hostRoutingRules as unknown[]).length === 0
  ) {
    delete attributes.hostRoutingRules;
  }

  const cardDoc: CardDoc = {
    data: {
      type: 'card',
      attributes,
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
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
    log.warn(`could not write ${cardPath} for ${url ?? '?'}: ${String(err)}`);
    return false;
  }

  trimSidecar(sidecarPath, sidecar, migratedKeys);
  return true;
}

// When a realm.json card already exists, the card is the source of
// truth for everything the card schema owns. The only sidecar value we
// can safely migrate after the fact is `hostHome` (no equivalent ever
// existed on the card; adding a `/`-rule is purely additive). Plus we
// strip `interactHome` if present.
function augmentExistingCard(
  sidecarPath: string,
  cardPath: string,
  card: CardDoc,
  sidecar: Record<string, unknown>,
  url: string | null,
): boolean {
  const migratedKeys = new Set<string>();
  let cardModified = false;

  const hostHome = sidecar.hostHome;
  if (typeof hostHome === 'string') {
    if (url === null) {
      log.warn(
        `cannot migrate hostHome at ${sidecarPath} into existing card without ` +
          `a known realm URL; leaving sidecar entry for a future boot`,
      );
    } else {
      cardModified = addHostHomeRule(card, hostHome, url, sidecarPath) || cardModified;
      migratedKeys.add('hostHome');
    }
  }
  // hostHome present-but-non-string still gets trimmed — it can't be
  // honored anyway. interactHome always trims (we never migrate it).
  if ('hostHome' in sidecar) {
    migratedKeys.add('hostHome');
  }
  for (const key of SIDECAR_KEYS_TO_DROP) {
    if (key in sidecar) {
      migratedKeys.add(key);
    }
  }

  if (cardModified) {
    try {
      writeFileSync(cardPath, JSON.stringify(card, null, 2) + '\n');
    } catch (err: unknown) {
      log.warn(`could not write ${cardPath} for ${url ?? '?'}: ${String(err)}`);
      return false;
    }
  }

  if (migratedKeys.size === 0 && !cardModified) {
    return false;
  }

  if (migratedKeys.size > 0) {
    trimSidecar(sidecarPath, sidecar, migratedKeys);
  }
  return true;
}

// Returns true if the card document was modified (a new /-rule was
// added). If a /-rule already exists, no-op + log when the existing
// rule's target differs from the sidecar's hostHome value.
function addHostHomeRule(
  card: CardDoc,
  hostHome: string,
  url: string,
  sidecarPath: string,
): boolean {
  card.data.attributes = card.data.attributes ?? {};
  card.data.relationships = card.data.relationships ?? {};

  const rulesRaw = card.data.attributes.hostRoutingRules;
  const rules: RoutingRule[] = Array.isArray(rulesRaw)
    ? (rulesRaw as RoutingRule[])
    : [];

  const existingSlashIdx = rules.findIndex((r) => r?.path === '/');
  if (existingSlashIdx >= 0) {
    const existingLink =
      card.data.relationships[`hostRoutingRules.${existingSlashIdx}.instance`]
        ?.links?.self ?? null;
    const desiredLink = toRelativeInstanceLink(hostHome, url);
    if (existingLink !== desiredLink) {
      log.warn(
        `existing /-rule in ${sidecarPath.replace(/\.realm\.json$/, 'realm.json')} ` +
          `points at ${existingLink ?? '(null)'}, not at sidecar hostHome ${hostHome}; ` +
          `keeping the card's value`,
      );
    }
    return false;
  }

  const newIndex = rules.length;
  rules.push({ path: '/' });
  card.data.attributes.hostRoutingRules = rules;
  card.data.relationships[`hostRoutingRules.${newIndex}.instance`] = {
    links: { self: toRelativeInstanceLink(hostHome, url) },
  };
  return true;
}

// Convert an absolute card URL (e.g. https://realm.example.com/Foo/abc)
// to the realm-relative form used inside relationships (./Foo/abc). If
// the absolute URL doesn't start with the realm URL, or the realm URL
// is unknown (e.g. published realm with no registry row yet), fall
// back to returning the absolute URL — still a valid link, just less
// portable.
function toRelativeInstanceLink(
  absoluteUrl: string,
  realmUrl: string | null,
): string {
  if (realmUrl === null) {
    return absoluteUrl;
  }
  const realm = realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`;
  if (absoluteUrl.startsWith(realm)) {
    return `./${absoluteUrl.slice(realm.length)}`;
  }
  return absoluteUrl;
}

function trimSidecar(
  sidecarPath: string,
  sidecar: Record<string, unknown>,
  migratedKeys: Set<string>,
): void {
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sidecar)) {
    if (!migratedKeys.has(k)) {
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

  // Best-effort lookup. Under multi-instance startup wave, a peer
  // process can hold the registry-backfill lock while this process
  // wins the config-card-backfill lock, so realm_registry may be
  // empty or sparse here. The card-keys-only migration still works
  // without the URL (only used in error log lines), but the
  // hostHome → /-rule migration needs the URL to compute the
  // relative ./Type/id link. We pass null when registry has no row,
  // and migrateOne logs + leaves the hostHome sidecar entry for a
  // future boot.
  let byId: Map<string, string>;
  try {
    const rows = (await query(opts.dbAdapter, [
      `SELECT disk_id, url FROM realm_registry WHERE kind = 'published'`,
    ])) as Array<{ disk_id: string; url: string }>;
    byId = new Map(rows.map((r) => [r.disk_id, r.url]));
  } catch (err: unknown) {
    log.warn(
      `could not read realm_registry for url lookup; ` +
        `continuing without URLs: ${String(err)}`,
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
    const url = byId.get(entry.name) ?? null;
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
