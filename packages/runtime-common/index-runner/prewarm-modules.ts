import {
  hasExecutableExtension,
  jobIdentity,
  SupportedMimeType,
  type DependencyIndexRow,
  type JobInfo,
  type logger,
  type Reader,
  type RealmInfo,
} from '../index.ts';
import type { CacheScope, DefinitionLookup } from '../definition-lookup.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { isScopedCSSRequest } from '../scoped-css.ts';
import { canonicalURL } from './dependency-url.ts';

// Default module pre-warm concurrency. Serial by default: a cold/shared
// prerender pool serves serial pre-warm by reusing a single warm tab,
// whereas concurrent module prerenders force the pool to materialize one
// tab per in-flight request — and that tab-startup cost outweighs the
// parallelism for the fast definition-extraction renders pre-warm fires.
// Raise `INDEXER_PREWARM_CONCURRENCY` only where the prerender pool is
// pre-sized for the extra concurrent module renders; the ceiling that
// matters is the per-affinity tab budget (`PRERENDER_AFFINITY_TAB_MAX`),
// since a realm's pre-warm targets one prerender affinity and beyond that
// the requests just queue at the server's per-affinity admission.
const DEFAULT_PREWARM_CONCURRENCY = 1;

// Resolve the pre-warm fan-out width from `INDEXER_PREWARM_CONCURRENCY`,
// falling back to the default. Reads `process.env` defensively — pre-warm
// runs only in the worker, but the bundle is shared, so guard against a
// missing `process`.
function prewarmConcurrency(): number {
  let raw =
    typeof process !== 'undefined'
      ? process.env?.INDEXER_PREWARM_CONCURRENCY
      : undefined;
  let parsed = raw != null && raw !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_PREWARM_CONCURRENCY;
}

// The cache context a read-through definition populate is keyed on: the
// realm's public/private scope and, for a private realm, the owner user id
// the realm-scoped reader keys on. Resolved from the realm's `_info`
// visibility so a pre-warm populate writes rows the visit-phase reader will
// actually read.
export async function resolveModuleCacheContext({
  fetch,
  realmURL,
  realmOwnerUserId,
}: {
  fetch: typeof globalThis.fetch;
  realmURL: URL;
  realmOwnerUserId: string;
}): Promise<{
  resolvedRealmURL: string;
  cacheScope: CacheScope;
  authUserId: string;
}> {
  let realmInfo = await fetchRealmInfo(fetch, realmURL);
  let isPublic = realmInfo.visibility === 'public';
  return {
    resolvedRealmURL: realmURL.href,
    cacheScope: isPublic ? 'public' : 'realm-auth',
    authUserId: isPublic ? '' : realmOwnerUserId,
  };
}

async function fetchRealmInfo(
  fetch: typeof globalThis.fetch,
  realmURL: URL,
): Promise<RealmInfo> {
  let realmInfoURL = `${realmURL}_info`;
  let realmInfoResponse = await fetch(realmInfoURL, {
    method: 'QUERY',
    headers: { Accept: SupportedMimeType.RealmInfo },
  });
  if (!realmInfoResponse.ok) {
    let body = '<unable to read response body>';
    try {
      body = await realmInfoResponse.text();
    } catch (_err) {
      // fall back to placeholder body text
    }
    throw new Error(
      `Failed to load realm info for indexing from ${realmInfoURL}: ` +
        `${realmInfoResponse.status} ${realmInfoResponse.statusText}. ` +
        `Response body: ${body}`,
    );
  }
  let payload: unknown;
  try {
    payload = await realmInfoResponse.json();
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse realm info response from ${realmInfoURL} as JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  let realmInfo = (payload as { data?: { attributes?: RealmInfo } })?.data
    ?.attributes;
  if (!realmInfo) {
    throw new Error('Unable to load realm info for indexing');
  }
  return realmInfo;
}

export interface PreWarmModulesTableArgs {
  realmURL: URL;
  // Instances/modules this pass will render. Drives the per-row deps layer
  // (existing `boxel_index.deps` + novel-`.json` `adoptsFrom.module`).
  invalidations: URL[];
  // Every `.gts` / `.gjs` file in the realm, from the caller's filesystem
  // walk. The realm-wide sweep layer.
  allRealmCardModules: string[];
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  reader: Reader;
  // Reads `boxel_index` / `boxel_index_working` deps for the invalidation set
  // — a supplementary per-URL warm signal on top of the realm-wide sweep.
  // When a from-scratch index pass is still in flight for this realm, these
  // are the prior generation's deps (or a partial working set); that only
  // affects the supplementary layer, and any module it misses falls back to
  // the safe on-demand read-through.
  getDependencyRows: (urls: string[]) => Promise<DependencyIndexRow[]>;
  // Resolves the cache scope + user id the populate is keyed on. Best-effort
  // (fetches realm `_info`): a failure degrades to a skipped pre-warm, so it
  // may throw.
  getModuleCacheContext: () => Promise<{
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    authUserId: string;
  }>;
  // The realm owner the sub-`prerenderModule` for a cache miss renders as.
  prerenderUserId: string;
  jobPriority: number;
  jobInfo: JobInfo;
  log: ReturnType<typeof logger>;
  perfLog: ReturnType<typeof logger>;
  // Fired as each module lands so the caller can advance its progress bar.
  // `warmedCount` climbs monotonically to `totalToWarm`; the caller folds
  // `totalToWarm` into the job's file total.
  onModuleWarmed?: (progress: {
    moduleUrl: string;
    warmedCount: number;
    totalToWarm: number;
  }) => void;
}

// Populate the `modules` table for every module the upcoming render phase is
// likely to need, before the first format render fires.
//
// Why: a format render that fires a `_federated-search` calling
// `populateQueryFields` → `lookupDefinition` for a definition not in the
// modules cache triggers a nested prerender. That nested prerender enters the
// same affinity-scoped tab queue the original render is occupying, deadlocking
// the pool. Pre-warming the modules table before the render phase means
// `lookupDefinition` hits a populated row instead of spawning a sub-prerender.
//
// Signal sources:
//   1. The realm-wide `.gts` / `.gjs` sweep (`allRealmCardModules`) — catches
//      sibling card modules referenced by *string* in templates (e.g.
//      `<Search @query={{filter: {type: {module: '.../author.gts', name: 'Author'}}}}>`),
//      which appear in no instance's runtime `deps`. This is the layer the
//      query-backed field renders depend on. `.gts` / `.gjs` only is an
//      optimization, not a correctness gate: a `.ts` / `.js` module hosting a
//      `CardDef` that this misses still resolves via the on-demand
//      `lookupDefinition` read-through (the PagePool materializes a tab for
//      the sub-prerender rather than queueing it behind the render), and
//      restricting the sweep to the extensions where cards live almost
//      exclusively avoids paying the prerender cost for helper files that
//      rarely define a card.
//   2. Existing `boxel_index.deps` — the runtime-captured dep list from a
//      URL's prior successful render. Includes `.ts` / `.js` helpers, but
//      only the ones the invalidation set touches.
//   3. `adoptsFrom.module` read from disk — for novel `.json` URLs without a
//      prior `deps` row.
//
// Every source is then narrowed to modules that live in this realm. The
// populate keys rows on this realm's cache context, while the render-phase
// reader keys a module's row on the realm the module lives in — so warming a
// cross-realm dep (a base module, an icon module) renders and persists a row
// under a key the reader never consults. Cross-realm modules are served by
// their owning realm's cache (populated by that realm's own sweep) or by the
// on-demand read-through.
//
// Cache hits are O(1) DB reads inside DefinitionLookup. Cache misses go
// through the read-through populate path, the same flow `lookupDefinition`
// uses; DefinitionLookup owns the in-flight dedup and the cross-process
// coalescer, so two callers asking for the same URL share one prerender.
//
// Failures here are warned but never thrown — a mid-render sub-prerender will
// still fire on demand if pre-warm misses a module. Returns the number of
// modules pre-warmed (0 when there are no candidates or the cache context is
// unresolvable), which the caller folds into the job's `totalFiles`.
export async function preWarmModulesTable({
  realmURL,
  invalidations,
  allRealmCardModules,
  definitionLookup,
  virtualNetwork,
  reader,
  getDependencyRows,
  getModuleCacheContext,
  prerenderUserId,
  jobPriority,
  jobInfo,
  log,
  perfLog,
  onModuleWarmed,
}: PreWarmModulesTableArgs): Promise<number> {
  if (invalidations.length === 0 && allRealmCardModules.length === 0) {
    return 0;
  }
  let preWarmStart = Date.now();

  // Base layer: the realm-wide `.gts` / `.gjs` sweep.
  let toWarm = new Set<string>(allRealmCardModules);

  let hrefs = invalidations.map((u) => u.href);
  let existingRows = await getDependencyRows(hrefs);
  let bestByUrl = new Map<string, { url: string; deps: string[] | null }>();
  for (let row of existingRows) {
    // Prefer rows that actually carry deps so the lookup below returns the
    // strongest signal available for each URL.
    let existing = bestByUrl.get(row.url);
    if (!existing || (!existing.deps?.length && row.deps?.length)) {
      bestByUrl.set(row.url, { url: row.url, deps: row.deps ?? null });
    }
  }

  let novelJsonUrls: URL[] = [];
  for (let url of invalidations) {
    // Module files in the invalidation set are deps that instances in the
    // same pass will consume — pre-warm them directly. This includes
    // `.ts` / `.js` helpers, but only the ones the pass is actually touching,
    // so cost is bounded by invalidation size rather than realm size.
    if (hasExecutableExtension(url.href)) {
      toWarm.add(url.href);
    }
    let row = bestByUrl.get(url.href);
    if (row?.deps?.length) {
      for (let dep of row.deps) {
        let resolved = canonicalURL(dep, url.href, virtualNetwork);
        // `.json` marks an instance dep and `.glimmer-scoped.css` marks an
        // inline-styles artifact; everything else in the deps array is a
        // module URL (stored extensionless after normalizeModuleURL /
        // normalizeDependency).
        if (!resolved.endsWith('.json') && !isScopedCSSRequest(resolved)) {
          toWarm.add(resolved);
        }
      }
    } else if (url.href.endsWith('.json')) {
      novelJsonUrls.push(url);
    }
  }
  for (let url of novelJsonUrls) {
    let adoptsFromModule = await readAdoptsFromModuleFromDisk(
      reader,
      url,
      virtualNetwork,
    );
    // adoptsFrom.module is always a module reference. The most common form is
    // relative + extensionless (e.g. `"../author"`), which canonicalizes to an
    // extensionless URL; gating on hasExecutableExtension would drop those
    // entirely and leave pre-warm missing exactly the module it is supposed to
    // prime.
    if (adoptsFromModule) {
      toWarm.add(adoptsFromModule);
    }
  }

  // Warm only this realm's own modules. The populate below keys every row on
  // this realm's cache context, but the render-phase reader
  // (`buildLookupContext`) keys a module's row on the realm the module
  // *lives in* — a cross-realm dep pulled in through the deps / adoptsFrom
  // layers (base modules, icon modules) would be rendered and persisted
  // under a key that reader never consults. Those modules are the owning
  // realm's to cache: its own pre-warm sweep populates them under the key
  // the reader does hit, and anything it misses falls back to the safe
  // on-demand read-through. The realm match mirrors `buildLookupContext`'s
  // form-agnostic check, so a dep recorded in RRI form still matches the
  // realm that owns it.
  let unresolvedRealmHref = virtualNetwork.unresolveURL(realmURL.href);
  let crossRealmSkipped = 0;
  let realmOwnModules: string[] = [];
  for (let moduleUrl of toWarm) {
    if (
      moduleUrl.startsWith(realmURL.href) ||
      virtualNetwork.unresolveURL(moduleUrl).startsWith(unresolvedRealmHref)
    ) {
      realmOwnModules.push(moduleUrl);
    } else {
      crossRealmSkipped++;
    }
  }
  if (crossRealmSkipped > 0) {
    // Info, not debug: when a sweep is unexpectedly slow (or a mid-render
    // sub-prerender fires for a module pre-warm was expected to cover), the
    // first question is what the warm set actually contained — this line
    // answers it from CI logs without a log-level override.
    log.info(
      `${jobIdentity(jobInfo)} module pre-warm: skipping ${crossRealmSkipped} cross-realm dep(s) cached under their own realm's key (${realmOwnModules.length} realm-own module(s) to warm)`,
    );
  }

  if (realmOwnModules.length === 0) {
    return 0;
  }

  // Supply the cache context explicitly. The worker constructs a bare
  // `CachingDefinitionLookup` with no registered realm, so the self-resolving
  // `getCachedDefinitions` would return null from `buildLookupContext` and
  // persist nothing — pre-warm would log success while doing nothing.
  //
  // Resolving the context fetches realm `_info`, which can transiently fail.
  // Pre-warm is best-effort, so a failure here must degrade to a warn/skip —
  // the render phase still populates on demand — rather than throwing out of
  // this function and aborting the whole job.
  let resolvedRealmURL: string;
  let cacheScope: CacheScope;
  let authUserId: string;
  try {
    ({ resolvedRealmURL, cacheScope, authUserId } =
      await getModuleCacheContext());
  } catch (err) {
    log.warn(
      `${jobIdentity(jobInfo)} skipping module pre-warm: could not resolve cache context for realm ${realmURL.href}; the render phase will populate on demand`,
      err,
    );
    return 0;
  }

  // The render-phase reader (the realm-server's realm-scoped lookup) keys a
  // private realm's modules cache on (realm-auth, realm-owner user id).
  // Writing a different key — e.g. an empty user id — would replace the silent
  // no-op with a silent *mismatch*: pre-warm would persist rows the reader
  // never reads. A private realm with no owner user id is a misconfiguration
  // that should never happen (`realmOwnerUserId` is derived from the realm
  // username); if it does, skip pre-warm and let the render phase populate on
  // demand rather than writing keys the reader can't read.
  if (cacheScope === 'realm-auth' && !authUserId) {
    log.warn(
      `${jobIdentity(jobInfo)} skipping module pre-warm for private realm ${realmURL.href}: empty cache user id would write cache keys the render phase cannot read`,
    );
    return 0;
  }

  // Drain the populate set with a bounded worker pool (serial by default — see
  // DEFAULT_PREWARM_CONCURRENCY). Each populate fires a `prerenderModule` on a
  // cache miss; DefinitionLookup owns the in-flight dedup and cross-process
  // coalescer, so different modules run independently while same-URL callers
  // share one prerender.
  let urls = realmOwnModules;
  let totalToWarm = urls.length;
  let failed = 0;
  let warmed = 0;
  let nextIndex = 0;
  let concurrency = Math.max(1, Math.min(prewarmConcurrency(), urls.length));
  let warmOne = async (): Promise<void> => {
    // `nextIndex++` is atomic between awaits (single-threaded event loop), so
    // each worker claims a distinct URL.
    for (let i = nextIndex++; i < urls.length; i = nextIndex++) {
      try {
        await definitionLookup.populateDefinitionCacheEntry({
          moduleURL: urls[i],
          realmURL: realmURL.href,
          resolvedRealmURL,
          cacheScope,
          cacheUserId: authUserId,
          prerenderUserId,
          priority: jobPriority,
        });
      } catch {
        failed += 1;
      }
      // Advance progress as each module lands. Under concurrency the
      // completion order isn't the input order, but the count still climbs
      // monotonically — all the dashboard bar needs.
      warmed += 1;
      onModuleWarmed?.({
        moduleUrl: urls[i],
        warmedCount: warmed,
        totalToWarm,
      });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => warmOne()));
  if (failed > 0) {
    log.warn(
      `${jobIdentity(jobInfo)} ${failed} of ${urls.length} module pre-warm lookups failed; the render phase will retry on-demand if needed`,
    );
  }

  perfLog.debug(
    `${jobIdentity(jobInfo)} pre-warm complete in ${Date.now() - preWarmStart} ms (candidates=${urls.length} crossRealmSkipped=${crossRealmSkipped} failed=${failed} concurrency=${concurrency})`,
  );
  return warmed;
}

async function readAdoptsFromModuleFromDisk(
  reader: Reader,
  url: URL,
  virtualNetwork: VirtualNetwork,
): Promise<string | undefined> {
  try {
    let fileRef = await reader.readFile(url);
    if (!fileRef?.content) {
      return undefined;
    }
    let doc = JSON.parse(fileRef.content) as {
      data?: { meta?: { adoptsFrom?: { module?: unknown } } };
    };
    let module = doc?.data?.meta?.adoptsFrom?.module;
    if (typeof module !== 'string') {
      return undefined;
    }
    return canonicalURL(module, url.href, virtualNetwork);
  } catch {
    return undefined;
  }
}
