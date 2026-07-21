import { ignore, type Ignore } from './ignore.ts';
// Isomorphic UUID — works in both Node and the browser (host tests
// instantiate IndexRunner inside a Chrome tab, so Node's built-in
// `crypto.randomUUID` is not available).
import { v4 as uuidv4 } from '@lukeed/uuid';

import {
  logger,
  hasExecutableExtension,
  isCardResource,
  jobIdentity,
  Deferred,
  RealmPaths,
  type IndexWriter,
  type Batch,
  type LooseCardResource,
  type InstanceEntry,
  type InstanceErrorIndexEntry,
  type FileErrorIndexEntry,
  type FromScratchResult,
  type IncrementalResult,
  type LastModifiedTimes,
  type JobInfo,
  type Prerenderer,
  type LocalPath,
  type PrerenderedHtmlChange,
  type Reader,
  type Stats,
  type Diagnostics,
  type SearchIndexEntry,
} from './index.ts';
import { moduleFrom } from './code-ref.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { CacheScope, DefinitionLookup } from './definition-lookup.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import {
  CardError,
  coerceErrorMessage,
  isCardError,
  serializableError,
} from './error.ts';
import type { IndexingProgressEvent } from './worker.ts';
import { IndexRunnerDependencyManager } from './index-runner/dependency-resolver.ts';
import { resolveModuleCacheContext } from './index-runner/prewarm-modules.ts';
import {
  discoverInvalidations,
  type DiscoverInvalidationsResult,
} from './index-runner/discover-invalidations.ts';
import {
  renderFileForIndexing,
  routeIndexVisitResult,
  type IndexVisitRenderResult,
} from './index-runner/visit-file.ts';
import { performCardIndexing } from './index-runner/card-indexer.ts';
import { performFileIndexing } from './index-runner/file-indexer.ts';

// The result of a prefetched render, with any thrown error captured rather
// than rejected so an un-awaited prefetch can't surface as an unhandled
// rejection. `skipped` covers files the render short-circuited (ignored /
// different realm).
type VisitRenderOutcome =
  | { status: 'rendered'; result: IndexVisitRenderResult }
  | { status: 'skipped' }
  | { status: 'error'; error: unknown };

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
  #ignoreMap: Map<string, Ignore> | undefined;
  #prerenderer: Prerenderer;
  #auth: string;
  #realmURL: URL;
  #virtualNetwork: VirtualNetwork;
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
  // Fired the moment this pass's invalidation set is fixed — after
  // `invalidate()` (incremental) / `discoverInvalidations` (from-scratch)
  // and before the visit loop — and only when the batch runs in split mode
  // (`splitPrerenderHtml`). The task wires this to publish the
  // `prerender_html` job, so a free worker can start rendering HTML
  // concurrently with the still-running index pass.
  #onInvalidationsReady?: (args: {
    changes: PrerenderedHtmlChange[];
    generation: number;
    loaderEpoch: string;
  }) => void;
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
    onInvalidationsReady,
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
    onInvalidationsReady?(args: {
      changes: PrerenderedHtmlChange[];
      generation: number;
      loaderEpoch: string;
    }): void;
  }) {
    this.#indexWriter = indexWriter;
    this.#realmPaths = new RealmPaths(realmURL, virtualNetwork);
    this.#reader = reader;
    this.#realmURL = realmURL;
    this.#virtualNetwork = virtualNetwork;
    this.#ignoreData = ignoreData;
    this.#jobInfo = jobInfo ?? { jobId: -1, reservationId: -1, priority: 0 };
    this.#jobPriority = jobPriority ?? jobInfo?.priority ?? 0;
    this.#batchId = `${this.#jobInfo.jobId}-${uuidv4().slice(0, 8)}`;
    this.#reportStatus = reportStatus;
    this.#onProgress = onProgress;
    this.#onInvalidationsReady = onInvalidationsReady;
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
    // Between-visit phase walls, assembled onto the job result's `phaseTimings`
    // at the end. `visitLoopMs` / `swapMs` are set inside the try below.
    let visitLoopMs: number | undefined;
    let swapMs: number | undefined;
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing`,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing for realm ${current.realmURL.href}`,
    );
    let setupStart = Date.now();
    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#virtualNetwork,
      current.#jobInfo,
    );
    let setupMs = Date.now() - setupStart;
    // Announce the job at kickoff — before invalidation discovery and
    // pre-warm — so the dashboard shows it immediately. The total starts
    // at 0 and is filled in by the first `file-visited` once the
    // pre-warm + invalidation counts are known.
    current.#onProgress?.({
      type: 'indexing-started',
      realmURL: current.realmURL.href,
      jobId: current.#jobInfo.jobId,
      jobType: 'from-scratch',
      totalFiles: 0,
      files: [],
    });
    let invalidations: URL[] = [];
    let mtimesStart = Date.now();
    let mtimes = await current.batch.getModifiedTimes();
    let mtimesMs = Date.now() - mtimesStart;
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed getting index mtimes in ${mtimesMs} ms`,
    );
    let invalidateStart = Date.now();
    let discoverResult = await current.discoverInvalidations(
      current.realmURL,
      mtimes,
    );
    let discoverMs = Date.now() - invalidateStart;
    invalidations = discoverResult.urls.map((href) => new URL(href));
    // The from-scratch URL list lives outside the batch's invalidation set
    // until each visit writes its row; feed the loader-epoch scan up front
    // so the epoch is fixed before the enqueue and the first visit.
    current.batch.noteInvalidatedURLs(discoverResult.urls);
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed invalidations in ${discoverMs} ms`,
    );
    current.#notifyInvalidationsReady(
      discoverResult.urls,
      new Set(discoverResult.deletedUrls),
    );

    let visitStart = Date.now();
    let orderStart = Date.now();
    invalidations = sortInvalidations(invalidations, current.realmURL);
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
      );
    let orderMs = Date.now() - orderStart;
    // The index visit runs no module pre-warm: the from-scratch-spawned
    // `prerender_html` job runs the sweep, since that job is where the
    // mid-render `lookupDefinition` sub-prerenders it protects fire (the index
    // visit runs no format components). Any residual `lookupDefinition` during
    // an index visit falls back to the on-demand read-through, which is safe:
    // the PagePool materializes a tab for the sub-prerender rather than
    // queueing it behind the caller.
    let filesCompleted = 0;
    let totalFiles = invalidations.length;
    // One batched read of every visit's created-at + content hash/size, so the
    // per-visit lookups below are served from memory rather than two DB
    // round-trips each across the whole pass.
    await current.batch.prefetchFileMeta(
      current.#visitLocalPaths(invalidations),
    );
    let loopStart = Date.now();
    let resumedRows = current.batch.resumedRows;
    let resumedSkipped = 0;
    try {
      await current.#runVisitLoop(invalidations, {
        // Resume guard. If a previous attempt of this same job already wrote
        // URL_X to the working table AND the EFS mtime hasn't changed since,
        // skip the visit — the existing working row is still authoritative
        // and `applyBatchUpdates` will promote it (the constructor pre-seeded
        // it into `#invalidations`). If mtime DID change, fall through to a
        // normal visit so the upsert in `updateEntry` overwrites the resumed
        // row with current content.
        skipReason: (url) => {
          let resumedMtime = resumedRows.get(url.href);
          if (resumedMtime === undefined) {
            return undefined;
          }
          let currentMtime = discoverResult.filesystemMtimes[url.href];
          return currentMtime !== undefined && currentMtime === resumedMtime
            ? 'resumed'
            : undefined;
        },
        onSkip: () => {
          resumedSkipped++;
        },
        onVisited: (url) => {
          filesCompleted++;
          current.#onProgress?.({
            type: 'file-visited',
            realmURL: current.realmURL.href,
            jobId: current.#jobInfo.jobId,
            url: url.href,
            filesCompleted,
            totalFiles,
          });
        },
      });
      if (resumedSkipped > 0) {
        current.#perfLog.debug(
          `${jobIdentity(current.#jobInfo)} skipped ${resumedSkipped} URLs already processed by prior attempt`,
        );
      }
      visitLoopMs = Date.now() - loopStart;
      current.#perfLog.debug(
        `${jobIdentity(current.#jobInfo)} completed index visit in ${Date.now() - visitStart} ms`,
      );
      let finalizeStart = Date.now();
      let { totalIndexEntries } = await current.batch.done();
      swapMs = Date.now() - finalizeStart;
      current.#perfLog.debug(
        `${jobIdentity(current.#jobInfo)} completed index finalization in ${swapMs} ms`,
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
      generation: current.batch.currentGeneration,
      phaseTimings: {
        totalMs: Date.now() - start,
        setupMs,
        mtimesMs,
        discoverMs,
        orderMs,
        ...(visitLoopMs !== undefined ? { visitLoopMs } : {}),
        writeMs: current.batch.writeMs,
        ...(swapMs !== undefined ? { swapMs } : {}),
      },
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
    // Between-visit phase walls, assembled onto the job result's `phaseTimings`
    // at the end. `visitLoopMs` / `swapMs` are set inside the try below.
    let visitLoopMs: number | undefined;
    let swapMs: number | undefined;
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

    let setupStart = Date.now();
    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#virtualNetwork,
      current.#jobInfo,
    );
    let setupMs = Date.now() - setupStart;
    // Announce the job at kickoff — before invalidation — so the
    // dashboard shows it immediately. The total starts at 0 and the
    // first `file-visited` fills it in once the counts are known.
    current.#onProgress?.({
      type: 'indexing-started',
      realmURL: current.realmURL.href,
      jobId: current.#jobInfo.jobId,
      jobType: 'incremental',
      totalFiles: 0,
      files: [],
    });
    let discoverStart = Date.now();
    urls.forEach((url) =>
      current.#dependencyResolver.invalidateRelationshipDependencyRowCache(url),
    );
    // Incremental indexing does no module pre-warming. Query-backed field
    // expansion during a prerender `_search` reads the `queryFieldDefs`
    // pre-extracted onto each result instance's stored meta
    // (`populateQueryFieldsFromMeta`), so it needs no `modules`-table row
    // for the queried type. The prerender-search definition path is
    // cache-only by design — a read-through there would re-enter the same
    // affinity tab mid-render and deadlock the pool — while definition
    // needs outside it resolve through the on-demand `lookupDefinition`
    // read-through. There is nothing left for a pre-warm pass to
    // front-load here.
    //
    // Invalidation, dependency ordering, and the file-meta prefetch all run
    // before #runVisitLoop, so its per-URL error isolation cannot cover a
    // throw in this phase. Left uncaught, a setup-phase failure would drop the
    // whole batch with nothing recorded — the silent drop. #recordSetupPhaseError
    // writes an error doc for every URL the job was handed; the rethrow still
    // rejects the job so the failure stays visible to job accounting.
    let discoverMs = 0;
    let orderMs = 0;
    let invalidations: URL[] = [];
    let totalFiles = 0;
    let filesCompleted = 0;
    let hrefs: string[] = [];
    try {
      await current.batch.invalidate(urls);
      discoverMs = Date.now() - discoverStart;
      current.#notifyInvalidationsReady(
        current.batch.invalidations,
        new Set(
          [...operations]
            .filter(([, operation]) => operation === 'delete')
            .map(([href]) => href),
        ),
      );
      let orderStart = Date.now();
      invalidations = sortInvalidations(
        current.batch.invalidations.map((href) => new URL(href)),
        current.realmURL,
      );
      invalidations =
        await current.#dependencyResolver.orderInvalidationsByDependencies(
          invalidations,
        );
      orderMs = Date.now() - orderStart;
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
      totalFiles = invalidations.length;
      hrefs = urls.map((u) => u.href);
      // One batched read of the invalidation set's created-at + content
      // hash/size so the per-visit lookups are served from memory. Deletes and
      // resumed URLs that get skipped below just leave unused cache entries —
      // harmless.
      await current.batch.prefetchFileMeta(
        current.#visitLocalPaths(invalidations),
      );
    } catch (setupErr) {
      await current.#recordSetupPhaseError(urls, operations, setupErr);
      throw setupErr;
    }
    let resumedRows = current.batch.resumedRows;
    let resumedSkipped = 0;
    let loopStart = Date.now();
    try {
      await current.#runVisitLoop(invalidations, {
        skipReason: (url) => {
          if (
            operations.get(url.href) === 'delete' &&
            hrefs.includes(url.href)
          ) {
            // file is deleted, there is nothing to visit
            return 'delete';
          }
          // Previous attempt of this job already produced a working row for
          // this URL. `args.changes` is the deterministic seed for
          // incremental jobs; if the file changed again, that's a different
          // changeset enqueued as a separate job. Skip.
          if (resumedRows.has(url.href)) {
            return 'resumed';
          }
          return undefined;
        },
        onSkip: (_url, reason) => {
          if (reason === 'resumed') {
            resumedSkipped++;
          }
        },
        onVisited: (url) => {
          filesCompleted++;
          current.#onProgress?.({
            type: 'file-visited',
            realmURL: current.realmURL.href,
            jobId: current.#jobInfo.jobId,
            url: url.href,
            filesCompleted,
            totalFiles,
          });
        },
      });
      if (resumedSkipped > 0) {
        current.#perfLog.debug(
          `${jobIdentity(current.#jobInfo)} skipped ${resumedSkipped} URLs already processed by prior attempt`,
        );
      }
      visitLoopMs = Date.now() - loopStart;

      let finalizeStart = Date.now();
      let { totalIndexEntries } = await current.batch.done();
      swapMs = Date.now() - finalizeStart;
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
      generation: current.batch.currentGeneration,
      phaseTimings: {
        totalMs: Date.now() - start,
        setupMs,
        discoverMs,
        orderMs,
        ...(visitLoopMs !== undefined ? { visitLoopMs } : {}),
        writeMs: current.batch.writeMs,
        ...(swapMs !== undefined ? { swapMs } : {}),
      },
    };
  }

  // Announce this pass's now-fixed invalidation set, tagged per URL:
  // genuine deletions (the URLs in `deletes`) as 'delete', everything else —
  // fan-out dependents are always re-renders — as 'update'. Only fires in
  // split mode; the fused path renders HTML inline and enqueues nothing.
  #notifyInvalidationsReady(urls: string[], deletes: Set<string>) {
    if (!this.#onInvalidationsReady || urls.length === 0) {
      return;
    }
    if (!this.batch.splitPrerenderHtml) {
      return;
    }
    this.#onInvalidationsReady({
      changes: urls.map((url) => ({
        url,
        operation: deletes.has(url) ? 'delete' : 'update',
      })),
      generation: this.batch.currentGeneration,
      loaderEpoch: this.batch.loaderEpoch,
    });
  }

  // Local paths for the URLs this pass will visit, keyed the same way the
  // visit's own file-meta lookups are (`realmPaths.local(url)`). URLs outside
  // this realm are skipped — the visit skips them too. Handed to
  // `batch.prefetchFileMeta` so the per-visit created-at / content-meta lookups
  // are served from one batched read instead of a round-trip each.
  #visitLocalPaths(urls: URL[]): string[] {
    let paths: string[] = [];
    for (let url of urls) {
      try {
        paths.push(this.#realmPaths.local(url));
      } catch (_e) {
        // different realm — not visited, so nothing to prefetch
      }
    }
    return paths;
  }

  // The render (tab-bound) half of a visit. Reads the file and runs the
  // prerender round-trip(s) but never touches the index tables, so a
  // prefetched render can run while the previous visit's rows are still being
  // written. Rejections are folded into the returned outcome — a prefetched
  // render sits un-awaited for a tick, and an escaping rejection there would
  // be an unhandled-rejection rather than something the loop can route to a
  // file-error row.
  async #renderVisit(url: URL): Promise<VisitRenderOutcome> {
    try {
      let result = await renderFileForIndexing({
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
      });
      return result ? { status: 'rendered', result } : { status: 'skipped' };
    } catch (error) {
      return { status: 'error', error };
    }
  }

  // The bookkeeping + row-write (worker/DB-bound) half of a visit. Runs in
  // the shadow of the next visit's render.
  async #finishVisit(result: IndexVisitRenderResult): Promise<void> {
    await routeIndexVisitResult(result, {
      indexCardWithResult: async (args) => await this.indexCard(args),
      indexFileWithResults: async (args) => await this.indexFile(args),
    });
  }

  // Render-ahead visit loop. Visits are FINISHED strictly in order — the
  // post-render bookkeeping reads prior visits' index rows (dependency-error
  // propagation), and the visit order sequences dependencies before their
  // dependents — but the NEXT visit's render is started before the current
  // visit's bookkeeping + row write, so the tab renders file N+1 while the
  // worker writes file N. Since a render reads only production `boxel_index`
  // (never this pass's uncommitted `boxel_index_working` rows), rendering
  // ahead cannot observe a write that hasn't landed yet.
  //
  // `skipReason` suppresses the render for URLs a prior attempt already
  // resolved (`'resumed'`) or that were deleted (`'delete'`); it must be pure
  // because the prefetch look-ahead and the finish cursor each call it. Every
  // URL still reports progress in order via `onVisited`.
  async #runVisitLoop(
    invalidations: URL[],
    {
      skipReason,
      onSkip,
      onVisited,
    }: {
      skipReason: (url: URL) => 'resumed' | 'delete' | undefined;
      onSkip: (url: URL, reason: 'resumed' | 'delete') => void;
      onVisited: (url: URL) => void;
    },
  ): Promise<void> {
    let n = invalidations.length;
    let renders = new Map<number, Promise<VisitRenderOutcome>>();
    // Start the render for the next non-skipped URL at or after `from`,
    // keeping exactly one render in flight ahead of the finish cursor.
    let prefetch = (from: number) => {
      for (let j = from; j < n; j++) {
        if (renders.has(j)) {
          return;
        }
        if (skipReason(invalidations[j])) {
          continue;
        }
        renders.set(j, this.#renderVisit(invalidations[j]));
        return;
      }
    };
    prefetch(0);
    for (let i = 0; i < n; i++) {
      let url = invalidations[i];
      let reason = skipReason(url);
      if (reason) {
        onSkip(url, reason);
        onVisited(url);
        prefetch(i + 1);
        continue;
      }
      let outcome = await renders.get(i)!;
      renders.delete(i);
      // Kick off the next render now so its round-trip overlaps the finish
      // work below.
      prefetch(i + 1);
      try {
        if (outcome.status === 'error') {
          throw outcome.error;
        }
        if (outcome.status === 'rendered') {
          await this.#finishVisit(outcome.result);
        }
      } catch (err) {
        await this.#handleVisitError(url, err);
      }
      onVisited(url);
    }
  }

  async #handleVisitError(url: URL, err: any): Promise<void> {
    if (isCardError(err) && err.status === 404) {
      this.#log.info(
        `${jobIdentity(this.#jobInfo)} tried to visit file ${url.href}, but it no longer exists`,
      );
      return;
    }
    // A transport-level failure of the visit — its prerender-server request
    // timing out/aborting, or a reader/network error — never reaches
    // performCardIndexing/performFileIndexing's own error-entry construction:
    // renderFileForIndexing rejects before `#finishVisit` routes it. (HTML
    // prerendering is a separate job; the request here is the index pass's own
    // visit.) Left uncaught, one file's failure propagates out of the
    // fromScratch/incremental visit loop, skips batch.done(), and discards
    // every other successfully-visited file's rows for the whole job. Persist
    // a file-error row instead so the failure is isolated to this URL,
    // matching the error_doc pattern used for in-band render errors.
    let message = coerceErrorMessage(
      err,
      `Indexing failed for ${url.href} with no error message (${jobIdentity(this.#jobInfo)})`,
    );
    this.#log.warn(
      `${jobIdentity(this.#jobInfo)} failed to index ${url.href}, recording file-error: ${message}`,
    );
    await this.#bufferErrorEntriesFor(this.batch, url, err, message);
  }

  // Buffer a file-error row (and, when the URL is or was a card instance, an
  // instance-error row) for `url` into `batch`, preserving last-known-good
  // content. Shared by the per-visit failure isolation (#handleVisitError)
  // and the setup-phase failure path (#recordSetupPhaseError) so both record
  // the same shape of error doc.
  async #bufferErrorEntriesFor(
    batch: Batch,
    url: URL,
    err: any,
    message: string,
  ): Promise<void> {
    let error = isCardError(err)
      ? serializableError(err)
      : serializableError(
          Object.assign(new CardError(message, { status: 500 }), {
            stack: (err as Error)?.stack,
          }),
        );
    error.message = message;
    let fileEntry: FileErrorIndexEntry = {
      type: 'file-error',
      error,
    };
    await batch.bufferEntry(url, fileEntry);
    this.#dependencyResolver.invalidateRelationshipDependencyRowCache(url);
    this.stats.fileErrors++;
    // `Batch.invalidate()` already tombstoned every type this URL previously
    // had in the index — for an existing card that's both `instance` and
    // `file`. Overwriting only the `file` tombstone above would let
    // batch.done() promote the untouched `instance` tombstone, silently
    // removing a previously-good card from search over a transient error. The
    // index is the oracle for "was this a card?": the batch records which live
    // row types it tombstoned, so an existing card is protected even when the
    // file can't be read — which may be exactly how the visit failed.
    // Re-parsing the source is only the fallback for a brand-new file, which
    // has no prior row to protect but should still surface its failure as an
    // instance error when it's a card. (The setup-phase recovery seeds this
    // batch's live types from the production index first — see
    // recordProductionLiveTypes — so an existing card is classified from the
    // index there too, and the reparse runs only for genuinely new files.)
    let isCardInstance =
      batch.tombstonedLiveTypes(url.href)?.includes('instance') ?? false;
    if (!isCardInstance && url.href.endsWith('.json')) {
      try {
        let fileRef = await this.#reader.readFile(url);
        let resource = fileRef?.content
          ? (JSON.parse(fileRef.content)?.data as unknown)
          : undefined;
        isCardInstance = Boolean(resource && isCardResource(resource));
      } catch (parseErr) {
        this.#log.warn(
          `${jobIdentity(this.#jobInfo)} could not determine whether ${url.href} is a card instance after its visit failed: ${(parseErr as Error)?.message}`,
        );
      }
    }
    if (isCardInstance) {
      let instanceEntry: InstanceErrorIndexEntry = {
        type: 'instance-error',
        error,
      };
      await batch.bufferEntry(url, instanceEntry);
      this.stats.instanceErrors++;
    }
  }

  // A throw during the invalidation / dependency-ordering / file-meta-prefetch
  // phase happens before #runVisitLoop starts, so no per-file visit ever runs
  // to attach an error to — and the in-flight batch's working table holds only
  // fan-out tombstones that were never re-visited, so promoting it via
  // `done()` would delete those dependents. Record the failure on a FRESH
  // batch scoped to just the URLs the job was handed: buffer their error rows
  // and promote only those, leaving the rest of the index untouched. The
  // caller rethrows afterward, rejecting the job — a thrown error gets no
  // in-queue retry (only an expired reservation does), so these error docs
  // are the durable signal that the batch never indexed. They never wedge the
  // URLs, either: error rows are excluded from resume (`loadResumedRows`) and
  // are invalidated like any row, so an expired-reservation re-attempt or any
  // later write touching the URLs re-visits them and replaces the error with
  // fresh content.
  async #recordSetupPhaseError(
    urls: URL[],
    operations: Map<string, 'update' | 'delete'>,
    err: any,
  ): Promise<void> {
    // Deletes are excluded: a delete whose job failed at setup must not be
    // half-applied. Recording an error would resurrect the removed card, and
    // letting the in-flight tombstone promote would apply a delete from a
    // failed job. Leave production untouched and let the queue retry complete
    // the delete — the same outcome a setup failure produced before this
    // recovery existed.
    let recordUrls = urls.filter((u) => operations.get(u.href) !== 'delete');
    if (recordUrls.length === 0) {
      return;
    }
    let message = coerceErrorMessage(
      err,
      `Indexing failed during invalidation with no error message (${jobIdentity(this.#jobInfo)})`,
    );
    this.#log.warn(
      `${jobIdentity(this.#jobInfo)} invalidation phase failed for ${recordUrls
        .map((u) => u.href)
        .join(', ')}, recording error docs: ${message}`,
    );
    try {
      let errorBatch = await this.#indexWriter.createBatch(
        this.realmURL,
        this.#virtualNetwork,
        this.#jobInfo,
      );
      // Seed the live-card oracle from the production index so an existing
      // card is written as an instance-error — overwriting the `instance`
      // tombstone the in-flight batch left in the shared working table —
      // rather than having that tombstone promoted and the card deleted.
      await errorBatch.recordProductionLiveTypes(recordUrls);
      for (let url of recordUrls) {
        if (errorBatch.resumedRows.has(url.href)) {
          // A prior attempt of this same job already indexed this URL and
          // `done()` will promote that good row — don't clobber it with an
          // error just because this attempt's invalidation phase threw.
          continue;
        }
        try {
          await this.#bufferErrorEntriesFor(errorBatch, url, err, message);
        } catch (bufferErr) {
          this.#log.warn(
            `${jobIdentity(this.#jobInfo)} failed to buffer setup-phase error row for ${url.href}: ${(bufferErr as Error)?.message}`,
          );
        }
      }
      await errorBatch.done();
    } catch (recordErr) {
      // Recording is best-effort: if the failure was a DB outage the recovery
      // write fails too. The rethrow in the caller still surfaces the original
      // error to the queue, so the job is retried rather than lost.
      this.#log.error(
        `${jobIdentity(this.#jobInfo)} failed to record setup-phase error docs for ${this.realmURL.href}: ${(recordErr as Error)?.message} (original: ${message})`,
      );
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

  private async getModuleCacheContext() {
    if (this.#moduleCacheContext) {
      return this.#moduleCacheContext;
    }
    this.#moduleCacheContext = await resolveModuleCacheContext({
      fetch: this.#fetch,
      realmURL: this.realmURL,
      realmOwnerUserId: this.#realmOwnerUserId,
    });
    return this.#moduleCacheContext;
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

  private get ignoreMap() {
    if (this.#ignoreMap) {
      return this.#ignoreMap;
    }
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    this.#ignoreMap = ignoreMap;
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
    // Resolving the card's adoptsFrom module to an RRI is best-effort
    // telemetry for the jobs dashboard. A malformed reference (e.g. a
    // legacy "/"-prefixed module path that resolveRRI rejects) must not be
    // able to abort the whole indexing job — the card's own error doc,
    // written by performCardIndexing, is the durable signal for a broken
    // reference. So degrade to empty deps and keep going.
    let deps: RealmResourceIdentifier[] = [];
    try {
      deps = [
        this.#virtualNetwork.resolveRRI(
          moduleFrom(resource.meta.adoptsFrom),
          url as RealmResourceIdentifier,
        ),
      ];
    } catch (e) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} could not resolve adoptsFrom module "${moduleFrom(
          resource.meta.adoptsFrom,
        )}" for ${url} while reporting status: ${(e as Error)?.message}`,
      );
    }
    this.#reportStatus?.(
      {
        ...this.#jobInfo,
        url,
        realm: this.#realmURL.href,
        deps,
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
    diagnostics,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
    // Merged card result from the file's index + prerender-html visits.
    renderResult: NonNullable<
      Parameters<typeof performCardIndexing>[0]['precomputedRenderResult']
    >;
    diagnostics?: Diagnostics;
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
        diagnostics,
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
    isCardInstance,
    extractResult,
    renderResult,
    diagnostics,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
    isCardInstance?: boolean;
    // Extract result from the index visit and merged render result from the
    // index + prerender-html visits. Either may be undefined if the visits
    // short-circuited before producing it.
    extractResult?: Parameters<
      typeof performFileIndexing
    >[0]['precomputedExtractResult'];
    renderResult?: Parameters<
      typeof performFileIndexing
    >[0]['precomputedRenderResult'];
    diagnostics?: Diagnostics;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let result = await performFileIndexing({
      path,
      fileURL,
      lastModified,
      resourceCreatedAt,
      hasModulePrerender,
      isCardInstance,
      realmURL: this.#realmURL,
      auth: this.#auth,
      jobInfo: this.#jobInfo,
      precomputedExtractResult: extractResult,
      precomputedRenderResult: renderResult,
      diagnostics,
      dependencyResolver: this.#dependencyResolver,
      virtualNetwork: this.#virtualNetwork,
      updateEntry: async (entryURL, entry) => {
        await this.#writeEntry(entryURL, entry);
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
    await this.#writeEntry(normalizedURL, entry);
    this.#dependencyResolver.invalidateRelationshipDependencyRowCache(
      normalizedURL,
    );
    if (entry.type === 'instance') {
      this.stats.instancesIndexed++;
    } else {
      this.stats.instanceErrors++;
    }
  }

  // The single chokepoint every `boxel_index_working` row write goes through.
  // Hands the row to the batch's write-behind buffer rather than upserting it
  // inline, so the visit loop can start the next file's render while this row
  // (and its neighbors, coalesced into a multi-row upsert) drains. The batch
  // times the physical writes; the job result reads `batch.writeMs`.
  async #writeEntry(url: URL, entry: SearchIndexEntry): Promise<void> {
    await this.batch.bufferEntry(url, entry);
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
