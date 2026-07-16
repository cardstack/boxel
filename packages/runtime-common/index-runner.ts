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
import { visitFileForIndexing } from './index-runner/visit-file.ts';
import { performCardIndexing } from './index-runner/card-indexer.ts';
import { performFileIndexing } from './index-runner/file-indexer.ts';

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
  // Aggregate wall of every `batch.updateEntry` row write in the current pass.
  // Summed here (not per row) because a row can't time its own INSERT; surfaces
  // on the job result's `phaseTimings.writeMs`. Reset at the start of each pass.
  #writeMsTotal = 0;
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
    current.#writeMsTotal = 0;
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
              totalFiles,
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
          totalFiles,
        });
      }
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
        writeMs: current.#writeMsTotal,
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
    current.#writeMsTotal = 0;
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
    await current.batch.invalidate(urls);
    let discoverMs = Date.now() - discoverStart;
    current.#notifyInvalidationsReady(
      current.batch.invalidations,
      new Set(
        [...operations]
          .filter(([, operation]) => operation === 'delete')
          .map(([href]) => href),
      ),
    );
    let orderStart = Date.now();
    let invalidations = sortInvalidations(
      current.batch.invalidations.map((href) => new URL(href)),
      current.realmURL,
    );
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
      );
    let orderMs = Date.now() - orderStart;
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
    let filesCompleted = 0;
    let totalFiles = invalidations.length;

    let hrefs = urls.map((u) => u.href);
    // One batched read of the invalidation set's created-at + content hash/size
    // so the per-visit lookups are served from memory. Deletes and resumed URLs
    // that get skipped below just leave unused cache entries — harmless.
    await current.batch.prefetchFileMeta(
      current.#visitLocalPaths(invalidations),
    );
    let resumedRows = current.batch.resumedRows;
    let resumedSkipped = 0;
    let loopStart = Date.now();
    try {
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
          totalFiles,
        });
      }
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
        writeMs: current.#writeMsTotal,
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

  private async tryToVisit(url: URL) {
    try {
      await visitFileForIndexing({
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
        return;
      }
      // A transport-level failure of the index visit — its
      // prerender-server request timing out/aborting, or a reader/network
      // error — never reaches performCardIndexing/performFileIndexing's
      // own error-entry construction: visitFileForIndexing rethrows
      // before calling indexCardWithResult/indexFileWithResults. (HTML
      // prerendering is a separate job; the request here is the index
      // pass's own visit.) Left uncaught, one file's failure propagates
      // out of the fromScratch/incremental visit loop, skips
      // batch.done(), and discards every other successfully-visited
      // file's rows for the whole job. Persist a file-error row instead
      // so the failure is isolated to this URL, matching the error_doc
      // pattern used for in-band render errors.
      let message = coerceErrorMessage(
        err,
        `Indexing failed for ${url.href} with no error message (${jobIdentity(this.#jobInfo)})`,
      );
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} failed to index ${url.href}, recording file-error: ${message}`,
      );
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
      await this.batch.updateEntry(url, fileEntry);
      this.#dependencyResolver.invalidateRelationshipDependencyRowCache(url);
      this.stats.fileErrors++;
      // `Batch.invalidate()` already tombstoned every type this URL
      // previously had in the index — for an existing card that's both
      // `instance` and `file`. Overwriting only the `file` tombstone
      // above would let batch.done() promote the untouched `instance`
      // tombstone, silently removing a previously-good card from search
      // over a transient error. The index is the oracle for "was this a
      // card?": the batch records which live row types it tombstoned, so
      // an existing card is protected even when the file can't be read —
      // which may be exactly how the visit failed. Re-parsing the source
      // is only the fallback for a brand-new file, which has no prior
      // row to protect but should still surface its failure as an
      // instance error when it's a card.
      let isCardInstance =
        this.batch.tombstonedLiveTypes(url.href)?.includes('instance') ?? false;
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
        await this.batch.updateEntry(url, instanceEntry);
        this.stats.instanceErrors++;
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

  // Time the row write and fold it into the pass's aggregate. The single
  // chokepoint every `boxel_index_working` row write goes through, so the job
  // result's `phaseTimings.writeMs` covers instance and file rows alike.
  async #writeEntry(url: URL, entry: SearchIndexEntry): Promise<void> {
    let start = Date.now();
    try {
      await this.batch.updateEntry(url, entry);
    } finally {
      this.#writeMsTotal += Date.now() - start;
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
