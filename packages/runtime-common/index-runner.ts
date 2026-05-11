import ignore, { type Ignore } from 'ignore';
// Isomorphic UUID — works in both Node and the browser (host tests
// instantiate IndexRunner inside a Chrome tab, so Node's built-in
// `crypto.randomUUID` is not available).
import { v4 as uuidv4 } from '@lukeed/uuid';

import { Memoize } from 'typescript-memoize';

import {
  logger,
  hasExecutableExtension,
  SupportedMimeType,
  jobIdentity,
  Deferred,
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
import type { CacheScope, DefinitionLookup } from './definition-lookup';
import { resolveCardReference } from './card-reference-resolver';
import { isCardError } from './error';
import type { IndexingProgressEvent } from './worker';
import { canonicalURL } from './index-runner/dependency-url';
import { IndexRunnerDependencyManager } from './index-runner/dependency-resolver';
import {
  discoverInvalidations,
  type DiscoverInvalidationsResult,
} from './index-runner/discover-invalidations';
import { visitFileForIndexingFused } from './index-runner/visit-file';
import { performCardIndexing } from './index-runner/card-indexer';
import { performFileIndexing } from './index-runner/file-indexer';

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
      readModuleCacheEntries: async (moduleIds) => {
        if (moduleIds.length === 0) {
          return {};
        }
        let { resolvedRealmURL, cacheScope, authUserId } =
          await this.getModuleCacheContext();
        return await this.#definitionLookup.getModuleCacheEntries({
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
    let sortedInvalidations = sortInvalidations(
      invalidations,
      current.realmURL,
    );
    let { ordered, maxLayerWidth, topoDepth } =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        sortedInvalidations,
      );
    invalidations = ordered;
    await current.preWarmModulesTable(invalidations);
    let concurrency = computeIndexVisitConcurrency(
      invalidations.length,
      maxLayerWidth,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} from-scratch visit plan: files=${invalidations.length} maxLayerWidth=${maxLayerWidth} topoDepth=${topoDepth} concurrency=${concurrency}`,
    );
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
      let visitResults = await runWithBoundedConcurrency(
        invalidations,
        concurrency,
        async (invalidation) => {
          // Resume guard. If a previous attempt of this same job
          // already wrote URL_X to the working table AND the EFS
          // mtime hasn't changed since, skip the visit — the
          // existing working row is still authoritative and
          // `applyBatchUpdates` will promote it (the constructor
          // pre-seeded it into `#invalidations`). If mtime DID
          // change, fall through to a normal visit so the upsert in
          // `updateEntry` overwrites the resumed row with current
          // content.
          let resumedMtime = resumedRows.get(invalidation.href);
          if (resumedMtime !== undefined) {
            let currentMtime =
              discoverResult.filesystemMtimes[invalidation.href];
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
              return;
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
        },
      );
      let rejection = firstRejection(visitResults);
      if (rejection) {
        throw rejection.reason;
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
    );
    urls.forEach((url) =>
      current.#dependencyResolver.invalidateRelationshipDependencyRowCache(url),
    );
    await current.batch.invalidate(urls);
    let sortedInvalidations = sortInvalidations(
      current.batch.invalidations.map((href) => new URL(href)),
      current.realmURL,
    );
    let { ordered, maxLayerWidth, topoDepth } =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        sortedInvalidations,
      );
    let invalidations = ordered;
    let concurrency = computeIndexVisitConcurrency(
      invalidations.length,
      maxLayerWidth,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} incremental visit plan: files=${invalidations.length} maxLayerWidth=${maxLayerWidth} topoDepth=${topoDepth} concurrency=${concurrency}`,
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

    // Set-based membership check so the per-task `delete-and-in-seed`
    // guard stays O(1). With large fan-outs the inner Array.includes
    // would otherwise be O(n) per task.
    let hrefs = new Set(urls.map((u) => u.href));
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
      let visitResults = await runWithBoundedConcurrency(
        invalidations,
        concurrency,
        async (invalidation) => {
          if (
            operations.get(invalidation.href) === 'delete' &&
            hrefs.has(invalidation.href)
          ) {
            // file is deleted, there is nothing to visit
          } else if (resumedRows.has(invalidation.href)) {
            // Previous attempt of this job already produced a working
            // row for this URL. `args.changes` is the deterministic
            // seed for incremental jobs; if the file changed again,
            // that's a different changeset enqueued as a separate
            // job. Skip.
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
        },
      );
      let rejection = firstRejection(visitResults);
      if (rejection) {
        throw rejection.reason;
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
  // loop is likely to need, before the parallel visit phase fires.
  //
  // Why: a parallel batch where N concurrent file renders each fire a
  // same-affinity `prerenderModule` sub-render produces a self-
  // referential deadlock — the file renders hold the tabs the module
  // sub-renders need, the module sub-renders are queued behind the
  // file renders that are waiting on them. PagePool's per-affinity
  // admission cap is designed to prevent this for a single in-flight
  // file render, but it can't reserve enough headroom for N parallel
  // file renders' worth of sub-renders. By pre-rendering modules in
  // a controlled phase (parallel within the module queue, but never
  // mixed with file admissions), we ensure every later file render
  // finds its definitions already in cache and never triggers a mid-
  // render sub-prerender.
  //
  // Signal sources, in priority order:
  //   1. Existing `boxel_index.deps` — strongest, captured from a
  //      prior successful render. Used for KNOWN URLs.
  //   2. `adoptsFrom.module` read from disk — used for NOVEL `.json`
  //      URLs that don't have a prior `deps` row yet.
  //   3. The URL itself — used for NOVEL executable files (`.gts`
  //      etc.); the file IS a module, pre-warm it directly.
  //
  // Modules that are already cached are returned immediately from the
  // first DB read inside getModuleCacheEntry; cache misses go through
  // the read-through path (loadModuleCacheEntryUncached →
  // getModuleDefinitionsViaPrerenderer → persistModuleCacheEntry),
  // which is the same flow lookupDefinition uses. We never call the
  // prerenderer directly from here — DefinitionLookup owns the
  // in-flight dedup, the cross-process coalescer, and the persist.
  private async preWarmModulesTable(invalidations: URL[]): Promise<void> {
    if (invalidations.length === 0) {
      return;
    }
    let preWarmStart = Date.now();
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

    // Resolve the disk-adoptsFrom signal in parallel for any `.json`
    // URLs missing a prior deps row, so a wide invalidation set
    // doesn't pay N sequential file reads here.
    let novelJsonUrls: URL[] = [];
    let toWarm = new Set<string>();
    for (let url of invalidations) {
      let row = bestByUrl.get(url.href);
      if (row?.deps?.length) {
        for (let dep of row.deps) {
          let resolved = canonicalURL(dep, url.href);
          if (hasExecutableExtension(resolved)) {
            toWarm.add(resolved);
          }
        }
      } else if (hasExecutableExtension(url.href)) {
        toWarm.add(url.href);
      } else if (url.href.endsWith('.json')) {
        novelJsonUrls.push(url);
      }
    }
    if (novelJsonUrls.length > 0) {
      let adoptsFrom = await Promise.all(
        novelJsonUrls.map((u) => this.#readAdoptsFromModuleFromDisk(u)),
      );
      for (let module of adoptsFrom) {
        if (module && hasExecutableExtension(module)) {
          toWarm.add(module);
        }
      }
    }

    if (toWarm.size === 0) {
      return;
    }

    // Call definitionLookup.getModuleCacheEntry per URL in parallel.
    // Each call short-circuits on a DB cache hit (cheap); on a miss
    // it goes through the full read-through path including the
    // in-flight dedup map and the cross-process coalescer.
    let results = await Promise.allSettled(
      [...toWarm].map((moduleUrl) =>
        this.#definitionLookup.getModuleCacheEntry(moduleUrl),
      ),
    );

    let failed = 0;
    for (let result of results) {
      if (result.status === 'rejected') {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} ${failed} of ${toWarm.size} module pre-warm lookups failed; the visit phase will retry on-demand if needed`,
      );
    }

    this.#perfLog.debug(
      `${jobIdentity(this.#jobInfo)} pre-warm complete in ${Date.now() - preWarmStart} ms (candidates=${toWarm.size} failed=${failed})`,
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
      return canonicalURL(module, url.href);
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
        deps: [resolveCardReference(moduleFrom(resource.meta.adoptsFrom), url)],
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

// Below this many invalidations the cold-tab tax dominates any
// parallelism payoff (a fresh tab joining the shared BrowserContext
// costs ~3-5s before it can produce useful work, plus per-tab cardDoc
// / store / Glimmer-compile warmup paid before each tab's first
// render). 10 lines up roughly with that crossover at the typical
// per-card render budget of 1-3s.
const PARALLEL_INDEX_VISIT_THRESHOLD = 10;
// Topo graphs whose widest layer is this small are effectively linear
// chains — every additional worker just waits on the head of the
// chain. Keep visits serial in this case to avoid spawning tabs that
// have nothing to do.
const PARALLEL_INDEX_LAYER_MIN_WIDTH = 2;
// Default cap on the number of in-flight file visits a single
// IndexRunner will keep open. Overridable via the
// `INDEX_RUNNER_MAX_CONCURRENCY` env var. The cap is independent of
// the prerender pool's per-affinity envelope: even when the pool
// permits more parallelism, this cap prevents a single realm's
// reindex from monopolising server-fleet capacity.
const DEFAULT_INDEX_VISIT_MAX_CONCURRENCY = 4;

// Per-tab parallelism envelope. Each file visit can fan out into ~1-2
// module sub-prerenders (one per `CachingDefinitionLookup` miss), so
// we reserve one tab against `PRERENDER_AFFINITY_TAB_MAX` to leave
// headroom for those sub-prerenders to land without queueing behind
// the file renders that need their results. The fallback default of
// 5 matches `PRERENDER_AFFINITY_TAB_MAX`'s default in
// `packages/realm-server/prerender/page-pool.ts`.
function affinityEnvelopeMax(): number {
  let raw = process.env.PRERENDER_AFFINITY_TAB_MAX;
  let parsed = raw != null ? parseInt(raw, 10) : NaN;
  let envelope = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  return Math.max(1, envelope - 1);
}

function indexVisitHardCap(): number {
  let raw = process.env.INDEX_RUNNER_MAX_CONCURRENCY;
  let parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_INDEX_VISIT_MAX_CONCURRENCY;
}

export function computeIndexVisitConcurrency(
  totalWork: number,
  maxLayerWidth: number,
): number {
  if (totalWork < PARALLEL_INDEX_VISIT_THRESHOLD) {
    return 1;
  }
  if (maxLayerWidth <= PARALLEL_INDEX_LAYER_MIN_WIDTH) {
    return 1;
  }
  return Math.max(
    1,
    Math.min(affinityEnvelopeMax(), maxLayerWidth, indexVisitHardCap()),
  );
}

// Run `fn` against each item with at most `concurrency` in flight at
// once. Returns one `PromiseSettledResult` per input position. Caller
// chooses how to react to rejected results — the runner re-throws the
// first one to preserve the serial loop's "abort the batch on
// unexpected error" semantics.
export async function runWithBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  let results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) {
    return results;
  }
  let n = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  async function worker() {
    for (;;) {
      let i = next++;
      if (i >= items.length) {
        return;
      }
      try {
        let value = await fn(items[i]!, i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  let workers: Promise<void>[] = [];
  for (let w = 0; w < n; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function firstRejection<R>(
  results: PromiseSettledResult<R>[],
): PromiseRejectedResult | undefined {
  for (let result of results) {
    if (result && result.status === 'rejected') {
      return result;
    }
  }
  return undefined;
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
