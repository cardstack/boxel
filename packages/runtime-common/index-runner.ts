import ignore, { type Ignore } from 'ignore';
// Isomorphic UUID — works in both Node and the browser (host tests
// instantiate IndexRunner inside a Chrome tab, so Node's built-in
// `crypto.randomUUID` is not available).
import { v4 as uuidv4 } from '@lukeed/uuid';

import { Memoize } from 'typescript-memoize';

import {
  logger,
  hasCardExtension,
  hasExecutableExtension,
  SupportedMimeType,
  jobIdentity,
  Deferred,
  isBrowserTestEnv,
  RealmPaths,
  type IndexWriter,
  type Batch,
  type LooseCardResource,
  type InstanceEntry,
  type InstanceErrorIndexEntry,
  type RealmInfo,
  type FromScratchResult,
  type IncrementalResult,
  type LastModifiedTimes,
  type JobInfo,
  type Prerenderer,
  type LocalPath,
  type Reader,
  type Stats,
  type TimingDiagnostics,
} from './index';
import { moduleFrom } from './code-ref';
import type { RealmResourceIdentifier } from './card-reference-resolver';
import type { CacheScope, DefinitionLookup } from './definition-lookup';
import type { VirtualNetwork } from './virtual-network';
import { isCardError } from './error';
import type { IndexingProgressEvent } from './worker';
import { canonicalURL } from './index-runner/dependency-url';
import { IndexRunnerDependencyManager } from './index-runner/dependency-resolver';
import { isScopedCSSRequest } from './scoped-css';
import {
  discoverInvalidations,
  type DiscoverInvalidationsResult,
} from './index-runner/discover-invalidations';
import { visitFileForIndexingFused } from './index-runner/visit-file';
import { performCardIndexing } from './index-runner/card-indexer';
import { performFileIndexing } from './index-runner/file-indexer';

// Default module pre-warm concurrency. Aligned with the prerender
// server's per-affinity tab budget (`PRERENDER_AFFINITY_TAB_MAX`, default
// 5): a single realm's pre-warm targets one prerender affinity, so beyond
// this many concurrent module prerenders the requests just queue at the
// server's per-affinity admission. Raising it past the affinity budget
// shifts the queueing into the prerender server rather than adding real
// parallelism.
const DEFAULT_PREWARM_CONCURRENCY = 5;

// Resolve the pre-warm fan-out width from `INDEXER_PREWARM_CONCURRENCY`,
// falling back to the default. Reads `process.env` defensively — pre-warm
// is skipped in the browser (see `isBrowserTestEnv`), but the bundle is
// shared, so guard against a missing `process`.
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

export class IndexRunner {
  #indexingInstances = new Map<string, Promise<void>>();
  #reader: Reader;
  #indexWriter: IndexWriter;
  #batch: Batch | undefined;
  #log = logger('index-runner');
  #fetch: typeof globalThis.fetch;
  #perfLog = logger('index-perf');
  #realmPaths: RealmPaths;
  #ignoreData: Record<string, string>;
  #prerenderer: Prerenderer;
  #auth: string;
  #realmURL: URL;
  #virtualNetwork: VirtualNetwork;
  #realmInfo?: RealmInfo;
  #moduleCacheContext?: {
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    authUserId: string;
  };
  #realmOwnerUserId: string;
  #definitionLookup: DefinitionLookup;
  #jobInfo: JobInfo;
  // Worker-job priority threaded from `pg-queue` → `tasks/indexer.ts`
  // → here. Forwarded into every prerenderer call site so the
  // prerender server can route by priority. Defaults to `0` for tests
  // / non-job callers that don't carry job context.
  #jobPriority: number;
  #dependencyResolver: IndexRunnerDependencyManager;
  #reportStatus?: (
    jobInfo: JobInfo | undefined,
    status: 'start' | 'finish',
  ) => void;
  #onProgress?: (event: IndexingProgressEvent) => void;
  readonly stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };
  #shouldClearCacheForNextRender = true;
  // Identifier for this runner's indexing batch (CS-10758 step 3).
  // Threaded into PrerenderVisitArgs and released from the fromScratch /
  // incremental finally blocks. One runner = one batch: if fromScratch
  // then incremental run on the same instance, they share this id (same
  // warm loader ownership — intended). Populated in the constructor after
  // jobInfo is known so the id is easy to correlate with a job in logs.
  #batchId!: string;

  constructor({
    realmURL,
    reader,
    indexWriter,
    definitionLookup,
    virtualNetwork,
    ignoreData = {},
    jobInfo,
    jobPriority,
    reportStatus,
    onProgress,
    prerenderer,
    auth,
    fetch,
    realmOwnerUserId,
  }: {
    realmURL: URL;
    reader: Reader;
    indexWriter: IndexWriter;
    definitionLookup: DefinitionLookup;
    virtualNetwork: VirtualNetwork;
    ignoreData?: Record<string, string>;
    prerenderer: Prerenderer;
    auth: string;
    fetch: typeof globalThis.fetch;
    realmOwnerUserId: string;
    jobInfo?: JobInfo;
    // Optional override of `jobInfo.priority`. When both are present,
    // `jobPriority` wins — this is the path the worker handler takes
    // so non-`JobInfo` callers (tests) can still set priority
    // explicitly.
    jobPriority?: number;
    reportStatus?(
      jobInfo: JobInfo | undefined,
      status: 'start' | 'finish',
    ): void;
    onProgress?(event: IndexingProgressEvent): void;
  }) {
    this.#indexWriter = indexWriter;
    this.#realmPaths = new RealmPaths(realmURL);
    this.#reader = reader;
    this.#realmURL = realmURL;
    this.#virtualNetwork = virtualNetwork;
    this.#ignoreData = ignoreData;
    this.#jobInfo = jobInfo ?? { jobId: -1, reservationId: -1, priority: 0 };
    this.#jobPriority = jobPriority ?? jobInfo?.priority ?? 0;
    this.#batchId = `${this.#jobInfo.jobId}-${uuidv4().slice(0, 8)}`;
    this.#reportStatus = reportStatus;
    this.#onProgress = onProgress;
    this.#prerenderer = prerenderer;
    this.#auth = auth;
    this.#fetch = fetch;
    this.#realmOwnerUserId = realmOwnerUserId;
    this.#definitionLookup = definitionLookup;
    this.#dependencyResolver = new IndexRunnerDependencyManager({
      realmURL: this.#realmURL,
      virtualNetwork: this.#virtualNetwork,
      readDefinitionCacheEntries: async (moduleIds) => {
        if (moduleIds.length === 0) {
          return {};
        }
        let { resolvedRealmURL, cacheScope, authUserId } =
          await this.getModuleCacheContext();
        return await this.#definitionLookup.getCachedDefinitionsBatch({
          moduleUrls: moduleIds,
          cacheScope,
          authUserId,
          resolvedRealmURL,
        });
      },
      getDependencyRows: async (urls) =>
        await this.batch.getDependencyRows(urls),
      getOrderingDependencyRows: async (urls) =>
        await this.batch.getOrderingDependencyRows(urls),
      getInvalidations: () => this.#batch?.invalidations ?? [],
    });
  }

  static async fromScratch(current: IndexRunner): Promise<FromScratchResult> {
    current.#dependencyResolver.reset();
    let start = Date.now();
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing`,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing for realm ${current.realmURL.href}`,
    );
    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#jobInfo,
      current.#virtualNetwork,
    );
    let invalidations: URL[] = [];
    let mtimesStart = Date.now();
    let mtimes = await current.batch.getModifiedTimes();
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed getting index mtimes in ${Date.now() - mtimesStart} ms`,
    );
    let invalidateStart = Date.now();
    let discoverResult = await current.discoverInvalidations(
      current.realmURL,
      mtimes,
    );
    invalidations = discoverResult.urls.map((href) => new URL(href));
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed invalidations in ${Date.now() - invalidateStart} ms`,
    );

    let visitStart = Date.now();
    invalidations = sortInvalidations(invalidations, current.realmURL);
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
      );
    // Pre-warm the modules cache. Combines per-row deps (which catch
    // most modules used during a from-scratch pass) with the realm-
    // wide `.gts` / `.gjs` sweep (which catches sibling card modules
    // referenced by string in templates — the typical
    // `<Search @query={{filter: {type: {module: '.../cohort.gts', name: 'Cohort'}}}}>`
    // pattern). The filesystem-mtimes walk was already paid by
    // discoverInvalidations above; we just filter and reuse it.
    let allRealmCardModules = Object.keys(
      discoverResult.filesystemMtimes,
    ).filter(hasCardExtension);
    await current.preWarmModulesTable(invalidations, allRealmCardModules);
    let resumedRows = current.batch.resumedRows;
    let resumedSkipped = 0;
    current.#onProgress?.({
      type: 'indexing-started',
      realmURL: current.realmURL.href,
      jobId: current.#jobInfo.jobId,
      jobType: 'from-scratch',
      totalFiles: invalidations.length,
      files: invalidations.map((u) => u.href),
    });
    try {
      let filesCompleted = 0;
      for (let invalidation of invalidations) {
        // Resume guard. If a previous attempt of this same job already
        // wrote URL_X to the working table AND the EFS mtime hasn't
        // changed since, skip the visit — the existing working row is
        // still authoritative and `applyBatchUpdates` will promote it
        // (the constructor pre-seeded it into `#invalidations`). If
        // mtime DID change, fall through to a normal visit so the
        // upsert in `updateEntry` overwrites the resumed row with
        // current content.
        let resumedMtime = resumedRows.get(invalidation.href);
        if (resumedMtime !== undefined) {
          let currentMtime = discoverResult.filesystemMtimes[invalidation.href];
          if (currentMtime !== undefined && currentMtime === resumedMtime) {
            resumedSkipped++;
            filesCompleted++;
            current.#onProgress?.({
              type: 'file-visited',
              realmURL: current.realmURL.href,
              jobId: current.#jobInfo.jobId,
              url: invalidation.href,
              filesCompleted,
              totalFiles: invalidations.length,
            });
            continue;
          }
        }
        await current.tryToVisit(invalidation);
        filesCompleted++;
        current.#onProgress?.({
          type: 'file-visited',
          realmURL: current.realmURL.href,
          jobId: current.#jobInfo.jobId,
          url: invalidation.href,
          filesCompleted,
          totalFiles: invalidations.length,
        });
      }
      if (resumedSkipped > 0) {
        current.#perfLog.debug(
          `${jobIdentity(current.#jobInfo)} skipped ${resumedSkipped} URLs already processed by prior attempt`,
        );
      }
      current.#perfLog.debug(
        `${jobIdentity(current.#jobInfo)} completed index visit in ${Date.now() - visitStart} ms`,
      );
      let finalizeStart = Date.now();
      let { totalIndexEntries } = await current.batch.done();
      current.#perfLog.debug(
        `${jobIdentity(current.#jobInfo)} completed index finalization in ${Date.now() - finalizeStart} ms`,
      );
      current.stats.totalIndexEntries = totalIndexEntries;
    } finally {
      current.#onProgress?.({
        type: 'indexing-finished',
        realmURL: current.realmURL.href,
        jobId: current.#jobInfo.jobId,
        stats: current.stats,
      });
      // Release the batch's ownership of this realm's affinity on the
      // prerender server. Best-effort: if the prerenderer doesn't
      // implement releaseBatch (older/remote stub), skip silently.
      try {
        await current.#prerenderer.releaseBatch?.({
          batchId: current.#batchId,
          affinityType: 'realm',
          affinityValue: current.realmURL.href,
        });
      } catch (e) {
        current.#log.warn(
          `${jobIdentity(current.#jobInfo)} failed to release prerender batch ${current.#batchId} for ${current.realmURL.href}: ${(e as Error)?.message}`,
        );
      }
    }
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} completed from scratch indexing in ${Date.now() - start}ms`,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed from scratch indexing for realm ${
        current.realmURL.href
      } in ${Date.now() - start} ms`,
    );
    return {
      invalidations: [...invalidations].map((url) => url.href),
      ignoreData: current.#ignoreData,
      stats: current.stats,
    };
  }

  static async incremental(
    current: IndexRunner,
    {
      changes,
    }: {
      changes: { url: URL; operation: 'update' | 'delete' }[];
    },
  ): Promise<IncrementalResult> {
    current.#dependencyResolver.reset();
    let start = Date.now();
    let operations = new Map<string, 'update' | 'delete'>();
    for (let { url, operation } of changes) {
      if (operation === 'delete') {
        operations.set(url.href, 'delete');
      } else if (!operations.has(url.href)) {
        operations.set(url.href, 'update');
      }
    }
    let urls = [...operations.keys()].map((href) => new URL(href));
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from incremental indexing for ${urls.map((u) => u.href).join()}`,
    );

    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#jobInfo,
      current.#virtualNetwork,
    );
    urls.forEach((url) =>
      current.#dependencyResolver.invalidateRelationshipDependencyRowCache(url),
    );
    await current.batch.invalidate(urls);
    let invalidations = sortInvalidations(
      current.batch.invalidations.map((href) => new URL(href)),
      current.realmURL,
    );
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
      );
    let hasExecutableInvalidation = invalidations.some((url) =>
      hasExecutableExtension(url.href),
    );
    if (hasExecutableInvalidation) {
      if (!current.#shouldClearCacheForNextRender) {
        current.#log.debug(
          `${jobIdentity(current.#jobInfo)} detected executable invalidation, scheduling loader reset`,
        );
      }
      current.#scheduleClearCacheForNextRender();
    }
    // Pre-warm: combine per-row deps with a realm-wide `.gts`/`.gjs`
    // sweep. Incremental skips `discoverInvalidations` so the
    // filesystem-mtimes walk hasn't happened yet — call it here.
    // Typical realm sizes make this < 200 ms; one call per job.
    let incrementalMtimes = await current.#reader.mtimes();
    let allRealmCardModules =
      Object.keys(incrementalMtimes).filter(hasCardExtension);
    await current.preWarmModulesTable(invalidations, allRealmCardModules);

    let hrefs = urls.map((u) => u.href);
    let resumedRows = current.batch.resumedRows;
    let resumedSkipped = 0;
    current.#onProgress?.({
      type: 'indexing-started',
      realmURL: current.realmURL.href,
      jobId: current.#jobInfo.jobId,
      jobType: 'incremental',
      totalFiles: invalidations.length,
      files: invalidations.map((u) => u.href),
    });
    try {
      let filesCompleted = 0;
      for (let invalidation of invalidations) {
        if (
          operations.get(invalidation.href) === 'delete' &&
          hrefs.includes(invalidation.href)
        ) {
          // file is deleted, there is nothing to visit
        } else if (resumedRows.has(invalidation.href)) {
          // Previous attempt of this job already produced a working
          // row for this URL. `args.changes` is the deterministic seed
          // for incremental jobs; if the file changed again, that's a
          // different changeset enqueued as a separate job. Skip.
          resumedSkipped++;
        } else {
          await current.tryToVisit(invalidation);
        }
        filesCompleted++;
        current.#onProgress?.({
          type: 'file-visited',
          realmURL: current.realmURL.href,
          jobId: current.#jobInfo.jobId,
          url: invalidation.href,
          filesCompleted,
          totalFiles: invalidations.length,
        });
      }
      if (resumedSkipped > 0) {
        current.#perfLog.debug(
          `${jobIdentity(current.#jobInfo)} skipped ${resumedSkipped} URLs already processed by prior attempt`,
        );
      }

      let { totalIndexEntries } = await current.batch.done();
      current.stats.totalIndexEntries = totalIndexEntries;
    } finally {
      current.#onProgress?.({
        type: 'indexing-finished',
        realmURL: current.realmURL.href,
        jobId: current.#jobInfo.jobId,
        stats: current.stats,
      });
      // Release the batch's ownership of this realm's affinity on the
      // prerender server. Best-effort: if the prerenderer doesn't
      // implement releaseBatch (older/remote stub), skip silently.
      try {
        await current.#prerenderer.releaseBatch?.({
          batchId: current.#batchId,
          affinityType: 'realm',
          affinityValue: current.realmURL.href,
        });
      } catch (e) {
        current.#log.warn(
          `${jobIdentity(current.#jobInfo)} failed to release prerender batch ${current.#batchId} for ${current.realmURL.href}: ${(e as Error)?.message}`,
        );
      }
    }

    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} completed incremental indexing for ${urls.map((u) => u.href).join()} in ${
        Date.now() - start
      }ms`,
    );
    return {
      invalidations: [...invalidations].map((url) => url.href),
      ignoreData: current.#ignoreData,
      stats: current.stats,
    };
  }

  private async tryToVisit(url: URL) {
    try {
      await visitFileForIndexingFused({
        url,
        realmURL: this.#realmURL,
        ignoreMap: this.ignoreMap,
        realmPaths: this.#realmPaths,
        reader: this.#reader,
        batch: this.batch,
        jobInfo: this.#jobInfo,
        jobPriority: this.#jobPriority,
        auth: this.#auth,
        batchId: this.#batchId,
        prerenderer: this.#prerenderer,
        virtualNetwork: this.#virtualNetwork,
        consumeClearCacheForRender: () => this.#consumeClearCacheForRender(),
        logDebug: (message) => this.#log.debug(message),
        logWarn: (message) => this.#log.warn(message),
        indexCardWithResult: async (args) => await this.indexCard(args),
        indexFileWithResults: async (args) => await this.indexFile(args),
      });
    } catch (err: any) {
      if (isCardError(err) && err.status === 404) {
        this.#log.info(
          `${jobIdentity(this.#jobInfo)} tried to visit file ${url.href}, but it no longer exists`,
        );
      } else {
        throw err;
      }
    }
  }

  private get batch() {
    if (!this.#batch) {
      throw new Error('Batch is missing');
    }
    return this.#batch;
  }

  get realmURL() {
    return this.#realmURL;
  }

  private async ensureRealmInfo(): Promise<RealmInfo> {
    if (!this.#realmInfo) {
      let realmInfoURL = `${this.realmURL}_info`;
      let realmInfoResponse = await this.#fetch(realmInfoURL, {
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
      this.#realmInfo = (
        payload as { data?: { attributes?: RealmInfo } }
      )?.data?.attributes;
    }
    if (!this.#realmInfo) {
      throw new Error('Unable to load realm info for indexing');
    }
    return this.#realmInfo;
  }

  private async getModuleCacheContext() {
    if (this.#moduleCacheContext) {
      return this.#moduleCacheContext;
    }
    let realmInfo = await this.ensureRealmInfo();
    let isPublic = realmInfo.visibility === 'public';
    this.#moduleCacheContext = {
      resolvedRealmURL: this.realmURL.href,
      cacheScope: isPublic ? 'public' : 'realm-auth',
      authUserId: isPublic ? '' : this.#realmOwnerUserId,
    };
    return this.#moduleCacheContext;
  }

  // Populate the `modules` table for every module the upcoming visit
  // loop is likely to need, before the file-visit phase fires.
  //
  // Why: a file render that fires a `_federated-search` calling
  // `populateQueryFields` → `lookupDefinition` for a definition not
  // in the modules cache triggers a nested prerender. That nested
  // prerender enters the same affinity-scoped tab queue the original
  // render is occupying, deadlocking the pool (PR #4777 papered over
  // this with `cacheOnlyDefinitions:true`). Pre-warming the modules
  // table before the visit loop fires means `lookupDefinition` hits
  // a populated row instead of spawning a sub-prerender.
  //
  // Signal sources, in priority order:
  //   1. Existing `boxel_index.deps` — the runtime-captured dep list
  //      from the URL's prior successful render. Strongest signal.
  //   2. `adoptsFrom.module` read from disk — used for novel `.json`
  //      URLs without a prior `deps` row.
  //   3. The URL itself — used for novel executable files; the file
  //      IS a module, pre-warm it directly.
  //
  // Cache hits are O(1) DB reads inside DefinitionLookup. Cache
  // misses go through the read-through path
  // (loadDefinitionCacheEntryUncached → getModuleDefinitionsViaPrerenderer
  // → persistDefinitionCacheEntry), the same flow `lookupDefinition`
  // uses; DefinitionLookup owns the in-flight dedup and the cross-
  // process coalescer, so two callers asking for the same URL share
  // one prerender.
  //
  // Phase 1: serial. Validates that pre-warm as a concept clears the
  // deadlock without concurrency-driven variability. Phase 2 will
  // bound-parallelize this loop.
  //
  // Failures here are warned but do not fail the batch — a mid-render
  // sub-prerender will still fire on demand if pre-warm misses a
  // module.
  private async preWarmModulesTable(
    invalidations: URL[],
    allRealmCardModules: string[] = [],
  ): Promise<void> {
    // Pre-warm exists to keep the prerender server's affinity-scoped tab
    // pool from deadlocking when a mid-render `lookupDefinition` fires a
    // same-affinity sub-`prerenderModule`. The in-browser realm (host
    // tests run a Realm + IndexRunner inside a Chrome tab) has no separate
    // prerender server and no tab pool, so pre-warm is pointless there.
    // It is also actively harmful: the in-browser realm shares the global
    // card-reference prefix registry with the host, so populating the
    // definition cache before the host registers a prefix bakes in keys
    // the prefixed reader can't match. A real server never sees this — it
    // only receives resolved URLs over the wire. Skip pre-warm in-browser.
    if (isBrowserTestEnv()) {
      return;
    }
    if (invalidations.length === 0 && allRealmCardModules.length === 0) {
      return;
    }
    let preWarmStart = Date.now();

    // Base layer: every `.gts` / `.gjs` file in the realm, regardless of
    // whether it appears in this batch's invalidation set. Catches sibling
    // card modules referenced by *string* in templates (e.g.
    // `<Search @query={{filter: {type: {module: '.../cohort.gts', ...}}}}>`)
    // — those don't appear in any instance's runtime `deps`. Without
    // this layer the search fires a same-affinity `prerenderModule`
    // mid-card-render at lookup time, which is the wait-shape the
    // PagePool's tab-materialization for module/command callers is
    // meant to relieve.
    //
    // `.gts` / `.gjs` only is an optimization, not a correctness gate:
    // `.ts` / `.js` files CAN host `CardDef` (e.g. command-input
    // cards). If pre-warm misses such a module, the on-demand
    // `lookupDefinition` read-through during the visit fires a
    // `prerenderModule` for it — safe because the PagePool now
    // materializes a tab for the sub-prerender instead of queueing it
    // behind the render that triggered the lookup. Restricting the
    // sweep to the extensions where cards live almost exclusively
    // avoids paying the prerender cost on every reindex for files that
    // rarely define a card (typical realms have many helper `.ts`
    // files alongside their cards).
    let toWarm = new Set<string>(allRealmCardModules);

    let hrefs = invalidations.map((u) => u.href);
    let existingRows = await this.batch.getDependencyRows(hrefs);
    let bestByUrl = new Map<string, { url: string; deps: string[] | null }>();
    for (let row of existingRows) {
      // Prefer rows that actually carry deps so the lookup below
      // returns the strongest signal available for each URL.
      let existing = bestByUrl.get(row.url);
      if (!existing || (!existing.deps?.length && row.deps?.length)) {
        bestByUrl.set(row.url, { url: row.url, deps: row.deps ?? null });
      }
    }

    let novelJsonUrls: URL[] = [];
    for (let url of invalidations) {
      // Module files in the invalidation set are deps that instances
      // in the same batch will consume — pre-warm them directly. This
      // covers from-scratch and atomic-update batches where most rows
      // have no prior `deps` data yet. Unlike the realm-wide layer
      // above, this includes `.ts` / `.js` helpers — only the ones the
      // batch is actually touching, so cost is bounded by invalidation
      // size rather than realm size.
      if (hasExecutableExtension(url.href)) {
        toWarm.add(url.href);
      }
      let row = bestByUrl.get(url.href);
      if (row?.deps?.length) {
        for (let dep of row.deps) {
          let resolved = canonicalURL(dep, url.href, this.#virtualNetwork);
          // `.json` marks an instance dep and `.glimmer-scoped.css`
          // marks an inline-styles artifact; everything else in the
          // deps array is a module URL (stored extensionless after
          // normalizeModuleURL / normalizeDependency).
          if (!resolved.endsWith('.json') && !isScopedCSSRequest(resolved)) {
            toWarm.add(resolved);
          }
        }
      } else if (url.href.endsWith('.json')) {
        novelJsonUrls.push(url);
      }
    }
    for (let url of novelJsonUrls) {
      let adoptsFromModule = await this.#readAdoptsFromModuleFromDisk(url);
      // adoptsFrom.module is always a module reference. The most common
      // form is relative + extensionless (e.g. `"../author"`), which
      // canonicalizes to an extensionless URL; gating on
      // hasExecutableExtension would drop those entirely and leave
      // pre-warm missing exactly the module it is supposed to prime.
      if (adoptsFromModule) {
        toWarm.add(adoptsFromModule);
      }
    }

    if (toWarm.size === 0) {
      return;
    }

    // Supply the cache context explicitly. The worker constructs a bare
    // `CachingDefinitionLookup` with no registered realm, so the
    // self-resolving `getCachedDefinitions` would return null from
    // `buildLookupContext` and persist nothing — pre-warm would log
    // success while doing nothing. This is the same context the read-only
    // batch reader uses (`getModuleCacheContext` → `getCachedDefinitionsBatch`).
    //
    // Resolving the context fetches realm `_info`, which can transiently
    // fail. Pre-warm is best-effort, so a failure here must degrade to a
    // warn/skip — the visit phase still populates on demand — rather than
    // throwing out of this method and aborting the whole indexing run.
    let resolvedRealmURL: string;
    let cacheScope: CacheScope;
    let authUserId: string;
    try {
      ({ resolvedRealmURL, cacheScope, authUserId } =
        await this.getModuleCacheContext());
    } catch (err) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} skipping module pre-warm: could not resolve cache context for realm ${this.realmURL.href}; the visit phase will populate on demand`,
        err,
      );
      return;
    }

    // The visit-phase reader (the realm-server's realm-scoped lookup)
    // keys a private realm's modules cache on (realm-auth, realm-owner
    // user id). Writing a different key — e.g. an empty user id — would
    // replace the silent no-op with a silent *mismatch*: pre-warm would
    // persist rows the reader never reads. A private realm with no owner
    // user id is a misconfiguration that should never happen
    // (`realmOwnerUserId` is derived from the realm username); if it does,
    // skip pre-warm and let the visit phase populate on demand rather than
    // writing keys the reader can't read.
    if (cacheScope === 'realm-auth' && !authUserId) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} skipping module pre-warm for private realm ${this.realmURL.href}: empty cache user id would write cache keys the visit phase cannot read`,
      );
      return;
    }

    // Bound-parallelize the populate loop. Each populate fires a
    // `prerenderModule` on a cache miss; DefinitionLookup owns the
    // in-flight dedup and cross-process coalescer, so different modules
    // run independently while same-URL callers share one prerender.
    // Concurrency is capped at the prerender server's per-affinity tab
    // budget (`INDEXER_PREWARM_CONCURRENCY`, default aligned with
    // `PRERENDER_AFFINITY_TAB_MAX`): a single realm's pre-warm is one
    // prerender affinity, so beyond that the requests just queue at the
    // server's per-affinity admission rather than running in parallel.
    let urls = [...toWarm];
    let failed = 0;
    let nextIndex = 0;
    let concurrency = Math.max(1, Math.min(prewarmConcurrency(), urls.length));
    let warmOne = async (): Promise<void> => {
      // `nextIndex++` is atomic between awaits (single-threaded event
      // loop), so each worker claims a distinct URL.
      for (let i = nextIndex++; i < urls.length; i = nextIndex++) {
        try {
          await this.#definitionLookup.populateDefinitionCacheEntry({
            moduleURL: urls[i],
            realmURL: this.realmURL.href,
            resolvedRealmURL,
            cacheScope,
            cacheUserId: authUserId,
            prerenderUserId: this.#realmOwnerUserId,
            priority: this.#jobPriority,
          });
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => warmOne()));
    if (failed > 0) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} ${failed} of ${urls.length} module pre-warm lookups failed; the visit phase will retry on-demand if needed`,
      );
    }

    this.#perfLog.debug(
      `${jobIdentity(this.#jobInfo)} pre-warm complete in ${Date.now() - preWarmStart} ms (candidates=${urls.length} failed=${failed} concurrency=${concurrency})`,
    );
  }

  async #readAdoptsFromModuleFromDisk(url: URL): Promise<string | undefined> {
    try {
      let fileRef = await this.#reader.readFile(url);
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
      return canonicalURL(module, url.href, this.#virtualNetwork);
    } catch {
      return undefined;
    }
  }

  #scheduleClearCacheForNextRender() {
    this.#shouldClearCacheForNextRender = true;
  }

  #consumeClearCacheForRender(): boolean {
    if (!this.#shouldClearCacheForNextRender) {
      return false;
    }
    this.#shouldClearCacheForNextRender = false;
    return true;
  }

  @Memoize()
  private get ignoreMap() {
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    return ignoreMap;
  }

  private async discoverInvalidations(
    url: URL,
    indexMtimes: LastModifiedTimes,
  ): Promise<DiscoverInvalidationsResult> {
    return await discoverInvalidations({
      url,
      indexMtimes,
      reader: this.#reader,
      batch: this.batch,
      ignoreMap: this.ignoreMap,
      ignoreData: this.#ignoreData,
      jobInfo: this.#jobInfo,
      logDebug: (message) => this.#log.debug(message),
      perfDebug: (message) => this.#perfLog.debug(message),
    });
  }

  private reportStatus(
    status: 'start' | 'finish',
    url: string,
    resource: LooseCardResource,
  ) {
    this.#reportStatus?.(
      {
        ...this.#jobInfo,
        url,
        realm: this.#realmURL.href,
        deps: [
          this.#virtualNetwork.resolveRRI(
            moduleFrom(resource.meta.adoptsFrom),
            url as RealmResourceIdentifier,
          ),
        ],
      },
      status,
    );
  }

  private async indexCard({
    path,
    lastModified,
    resourceCreatedAt,
    resource,
    renderResult,
    timingDiagnostics,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
    // Render result produced by the fused visit's cardRender pass.
    renderResult: NonNullable<
      Parameters<typeof performCardIndexing>[0]['precomputedRenderResult']
    >;
    timingDiagnostics?: TimingDiagnostics;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, ''),
    );
    this.reportStatus('start', fileURL, resource);
    let deferred: Deferred<void> | undefined;
    try {
      let indexingInstance = this.#indexingInstances.get(fileURL);
      if (indexingInstance) {
        return await indexingInstance;
      }
      deferred = new Deferred<void>();
      this.#indexingInstances.set(fileURL, deferred.promise);
      await performCardIndexing({
        path,
        lastModified,
        resourceCreatedAt,
        resource,
        fileURL,
        instanceURL,
        realmURL: this.#realmURL,
        auth: this.#auth,
        jobInfo: this.#jobInfo,
        precomputedRenderResult: renderResult,
        timingDiagnostics,
        dependencyResolver: this.#dependencyResolver,
        virtualNetwork: this.#virtualNetwork,
        updateEntry: async (entryURL, entry) =>
          await this.updateEntry(entryURL, entry),
        logWarn: (message) => this.#log.warn(message),
      });
    } finally {
      deferred?.fulfill();
      this.reportStatus('finish', fileURL, resource);
    }
  }

  private async indexFile({
    path,
    lastModified,
    resourceCreatedAt,
    hasModulePrerender,
    extractResult,
    renderResult,
    timingDiagnostics,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
    // Extract/render results produced by the fused visit's fileExtract /
    // fileRender passes. Either may be undefined if the visit chose not to
    // run that pass (e.g. fileRender is skipped for module files).
    extractResult?: Parameters<
      typeof performFileIndexing
    >[0]['precomputedExtractResult'];
    renderResult?: Parameters<
      typeof performFileIndexing
    >[0]['precomputedRenderResult'];
    timingDiagnostics?: TimingDiagnostics;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let result = await performFileIndexing({
      path,
      fileURL,
      lastModified,
      resourceCreatedAt,
      hasModulePrerender,
      realmURL: this.#realmURL,
      auth: this.#auth,
      jobInfo: this.#jobInfo,
      precomputedExtractResult: extractResult,
      precomputedRenderResult: renderResult,
      timingDiagnostics,
      dependencyResolver: this.#dependencyResolver,
      virtualNetwork: this.#virtualNetwork,
      updateEntry: async (entryURL, entry) => {
        await this.batch.updateEntry(entryURL, entry);
        this.#dependencyResolver.invalidateRelationshipDependencyRowCache(
          entryURL,
        );
      },
      logWarn: (message) => this.#log.warn(message),
    });

    if (result === 'indexed') {
      this.stats.filesIndexed++;
    } else {
      this.stats.fileErrors++;
    }
  }

  private async updateEntry(
    instanceURL: URL,
    entry: InstanceEntry | InstanceErrorIndexEntry,
  ) {
    let normalizedURL = assertURLEndsWithJSON(instanceURL);
    await this.batch.updateEntry(normalizedURL, entry);
    this.#dependencyResolver.invalidateRelationshipDependencyRowCache(
      normalizedURL,
    );
    if (entry.type === 'instance') {
      this.stats.instancesIndexed++;
    } else {
      this.stats.instanceErrors++;
    }
  }
}

function assertURLEndsWithJSON(url: URL): URL {
  if (!url.href.endsWith('.json')) {
    return new URL(`${url}.json`);
  }
  return url;
}

function sortInvalidations(urls: URL[], realmURL: URL): URL[] {
  // Visit order priority:
  //   1. The realm's RealmConfig card at <realmURL>realm.json — write its
  //      working-index row first so any /_info query that lands AFTER the
  //      pass commits (`batch.done()` swaps boxel_index_working into
  //      boxel_index) sees the RealmConfig overlay and resolves the realm's
  //      display name. parseRealmInfo's overlay path queries the live
  //      `boxel_index` table without `useWorkInProgressIndex`, so it cannot
  //      see realm.json mid-pass; this ordering only guarantees a correct
  //      answer at and after the pass-end commit (and on subsequent
  //      passes). Host-side prerender caching of stale realmInfo (see
  //      RealmResource.fetchInfo's `dropTask` short-circuit) is a separate
  //      concern not addressed here.
  //   2. Non-.json files (modules, source) — file entries must exist before
  //      the cards that depend on them are rendered.
  //   3. Other .json files, sorted lexically for determinism.
  let realmConfigHref = new RealmPaths(realmURL).fileURL('realm.json').href;
  return urls.sort((a, b) => {
    let aRealmConfig = a.href === realmConfigHref;
    let bRealmConfig = b.href === realmConfigHref;
    if (aRealmConfig !== bRealmConfig) {
      return aRealmConfig ? -1 : 1;
    }
    let aJson = a.href.endsWith('.json');
    let bJson = b.href.endsWith('.json');
    if (aJson === bJson) {
      return a.href.localeCompare(b.href);
    }
    return aJson ? 1 : -1;
  });
}
