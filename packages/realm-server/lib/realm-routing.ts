import { join } from 'path';
import { existsSync } from 'fs-extra';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  executableExtensions,
  fetchRealmPermissions,
  hasExtension,
  logger,
  param,
  query,
  RealmPaths,
} from '@cardstack/runtime-common';
import {
  indexCandidateExpressions,
  indexURLCandidates,
} from './index-url-utils';
import type { RealmRegistryReconciler } from './realm-registry-reconciler';

const federatedLog = logger('realm-server:federated');

export type RealmRoutingDeps = {
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  dbAdapter: DBAdapter;
};

// Resolves a request URL to a mounted Realm, lazy-mounting via the
// reconciler if the request is the first hit on a non-pinned realm
// (Phase 3 lazy-mount semantics). Returns undefined when no realm in the
// registry matches the request — caller should respond 404.
//
// Lookup order:
//   1. realms[] — covers (a) realms whose mountFromRow has already
//      published them to this array but whose start() is still awaiting
//      fullIndex; the worker processing that fullIndex re-enters this
//      resolver to fetch <realm>/_mtimes and must hit the published
//      realm rather than reconciler.ensureMounted(), which would
//      return the same in-flight promise and deadlock the boot path;
//      and (b) handler-created realms in Phase 3 PR 1 (publish/copy
//      push directly to realms[]; the reconciler may not have
//      observed them via NOTIFY/reconcile yet). Phase 3 PR 2 collapses
//      (b) onto the reconciler.
//   2. reconciler.knownByUrl — the Phase 3 source of truth for never-
//      mounted realms. Iterates registry rows, finds the one whose URL
//      prefix contains the request, delegates to lookupOrMount() which
//      constructs+mounts via mountFromRow on the cold first request.
export async function findOrMountRealm(
  requestURL: URL,
  { realms, reconciler, dbAdapter }: RealmRoutingDeps,
): Promise<Realm | undefined> {
  let legacy = realms.find((candidate) => {
    let realmURL = new URL(candidate.url);
    realmURL.protocol = requestURL.protocol;
    return new RealmPaths(realmURL).inRealm(requestURL);
  });
  if (legacy) {
    return legacy;
  }
  for (const url of reconciler.knownByUrl.keys()) {
    let realmURL = new URL(url);
    realmURL.protocol = requestURL.protocol;
    if (new RealmPaths(realmURL).inRealm(requestURL)) {
      return await reconciler.lookupOrMount(url);
    }
  }
  // Phase 3: knownByUrl is populated by reconciler.reconcile() on
  // boot + LISTEN/poll. A request that arrives between a sibling
  // instance's POST /_create-realm (or /_publish-realm) and this
  // instance's reconciler picking up NOTIFY would otherwise 404.
  // Fall through to a direct registry probe — match on every path
  // prefix and let Postgres pick the longest URL so a request to
  // `/foo/bar/baz/file.json` resolves to `/foo/bar/baz/` if that's
  // registered, not `/foo/` (both prefixes are valid candidates).
  let candidatePaths = candidateRealmURLs(requestURL);
  if (candidatePaths.length === 0) {
    return undefined;
  }
  let inClause: (string | ReturnType<typeof param>)[] = ['('];
  candidatePaths.forEach((u, idx) => {
    if (idx > 0) inClause.push(',');
    inClause.push(param(u));
  });
  inClause.push(')');
  let rows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry WHERE url IN`,
    ...inClause,
    `ORDER BY LENGTH(url) DESC LIMIT 1`,
  ])) as { url: string }[];
  if (rows.length === 0) {
    return undefined;
  }
  return await reconciler.lookupOrMount(rows[0].url);
}

export async function getPublishedRealmInfo(
  requestURL: URL,
  deps: RealmRoutingDeps,
): Promise<{ lastPublishedAt: string | null } | null> {
  let realm = await findOrMountRealm(requestURL, deps);
  if (!realm) {
    return null;
  }

  let rows = await query(deps.dbAdapter, [
    `SELECT last_published_at FROM realm_registry WHERE kind = 'published' AND url =`,
    param(realm.url),
  ]);

  if (rows.length === 0) {
    return null;
  }

  return {
    lastPublishedAt: (rows[0].last_published_at as string) ?? null,
  };
}

// Check if the URL corresponds to an indexed card instance.
// This is used to distinguish card URLs from module URLs when deciding
// whether to serve HTML for published realms.
//
// IMPORTANT: Card instances have their file_alias set to the URL without
// the .json extension. This means an instance at /foo/bar.json has
// file_alias /foo/bar. When a module request comes in for /foo/bar (no
// extension), we must check if it's actually a module before assuming it's
// an instance. Modules take precedence over instance aliases.
export async function isIndexedCardInstance(
  cardURL: URL,
  deps: RealmRoutingDeps,
): Promise<boolean> {
  let candidates = indexURLCandidates(cardURL);
  if (candidates.length === 0) {
    return false;
  }

  // First check if there's a module at this URL - modules take precedence
  // over instance aliases. This handles the case where:
  // - Module: /foo/bar.gts (file_alias: /foo/bar)
  // - Instance: /foo/bar.json (file_alias: /foo/bar)
  // A request for /foo/bar should serve the module, not HTML for the instance.
  // Prefer the modules table here because copied/published realms do not
  // carry module rows in boxel_index.
  let moduleRows = await query(deps.dbAdapter, [
    `
      SELECT 1
      FROM modules
      WHERE
    `,
    ...indexCandidateExpressions(candidates),
    `
      LIMIT 1
    `,
  ]);

  if (moduleRows.length > 0) {
    return false;
  }

  let rows = await query(deps.dbAdapter, [
    `
      SELECT 1
      FROM boxel_index
      WHERE type = 'instance'
        AND is_deleted IS NOT TRUE
        AND
      `,
    ...indexCandidateExpressions(candidates),
    `
      LIMIT 1
    `,
  ]);

  if (rows.length === 0) {
    return false;
  }

  // During publish/copy index races, module rows can lag behind source files.
  // Only do filesystem probing after we've identified an instance candidate
  // to avoid extra IO on the hot request path.
  if (await hasExtensionlessSourceModule(cardURL, deps)) {
    return false;
  }

  return true;
}

export async function hasExtensionlessSourceModule(
  cardURL: URL,
  deps: RealmRoutingDeps,
): Promise<boolean> {
  let realm = await findOrMountRealm(cardURL, deps);
  if (!realm?.dir) {
    return false;
  }

  let localPath: string;
  try {
    localPath = realm.paths.local(cardURL);
  } catch {
    return false;
  }

  if (!localPath || hasExtension(localPath)) {
    return false;
  }

  for (let extension of executableExtensions) {
    if (existsSync(join(realm.dir, `${localPath}${extension}`))) {
      return true;
    }
    if (existsSync(join(realm.dir, localPath, `index${extension}`))) {
      return true;
    }
  }

  return false;
}

export async function hasPublicPermissions(
  realm: Realm | undefined,
  deps: RealmRoutingDeps,
): Promise<boolean> {
  if (!realm) {
    return false;
  }

  let permissions = await fetchRealmPermissions(
    deps.dbAdapter,
    new URL(realm.url),
  );

  return permissions['*']?.includes('read') ?? false;
}

// Resolve realms for a federated request (CS-11238). The
// multiRealmAuthorization middleware has already confirmed every URL
// is a registry row, but Phase 3 may not have mounted them yet — the
// handler is responsible for lazy-mounting on demand. Each lookup is
// independent (Promise.allSettled): a per-realm mount failure logs
// + drops to undefined, matching searchRealms / handle-realm-info's
// existing "skip missing realm, return partial results" semantics so
// one broken realm does not 5xx the whole federated request.
export async function resolveRealmsForFederatedRequest(
  reconciler: RealmRegistryReconciler,
  realmList: string[],
): Promise<Array<Realm | undefined>> {
  let results = await Promise.allSettled(
    realmList.map((url) => reconciler.lookupOrMount(url)),
  );
  return results.map((result, idx) => {
    if (result.status === 'fulfilled') {
      if (result.value === undefined) {
        federatedLog.warn(
          `lookupOrMount fulfilled without a realm for ${realmList[idx]} during federated request; registry presence was already confirmed by middleware`,
        );
      }
      return result.value;
    }
    federatedLog.warn(
      `failed to lazy-mount realm ${realmList[idx]} for federated request: ${String(
        result.reason,
      )}`,
    );
    return undefined;
  });
}

// Build candidate realm URLs from a request URL by trimming the
// pathname segment-by-segment. Used by findOrMountRealm's registry
// fallback when knownByUrl is stale. Includes the origin-only form
// (root realm) and every prefix that ends with a slash.
export function candidateRealmURLs(requestURL: URL): string[] {
  let segments = requestURL.pathname.split('/').filter(Boolean);
  let candidates: string[] = [];
  // Try longest-prefix first.
  for (let i = segments.length; i >= 0; i--) {
    let path = i === 0 ? '/' : '/' + segments.slice(0, i).join('/') + '/';
    candidates.push(`${requestURL.origin}${path}`);
  }
  return [...new Set(candidates)];
}
