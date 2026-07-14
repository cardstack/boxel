// Isomorphic UUID — matches IndexRunner's batch-id minting.
import { v4 as uuidv4 } from '@lukeed/uuid';

import {
  flattenPrerenderHtmlVisitMeta,
  hasCardExtension,
  isBrowserTestEnv,
  isCardResource,
  jobIdentity,
  logger,
  modulesConsumedInMeta,
  RealmPaths,
  type Batch,
  type DefinitionLookup,
  type IndexWriter,
  type JobInfo,
  type LooseCardResource,
  type Prerenderer,
  type PrerenderedHtmlChange,
  type Reader,
  type RenderRouteOptions,
  type RenderVisitResponse,
  type Stats,
} from '../index.ts';
import type { IndexingProgressEvent } from '../worker.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { resolveFileDefCodeRef } from '../file-def-code-ref.ts';
import { canonicalURL } from './dependency-url.ts';
import { uniqueDeps } from './dependency-collections.ts';
import {
  preWarmModulesTable,
  resolveModuleCacheContext,
} from './prewarm-modules.ts';

export interface PrerenderHtmlPassArgs {
  realmURL: URL;
  // The invalidation set the spawning index pass computed, tagged per URL:
  // dependents/re-renders as 'update', genuine deletions as 'delete'. The
  // fan-out is never recomputed here.
  changes: PrerenderedHtmlChange[];
  // The realm generation the spawning index pass anticipated. Stamped on
  // every row this pass writes; the monotonic swap guard uses it to reject
  // out-of-order zombie writes.
  generation: number;
  // The realm's loader epoch the spawning pass renders under. Threaded on
  // every visit so each prerender tab this pass touches resets its loader
  // exactly once when the realm's module surface changed.
  loaderEpoch: string;
  // True when a from-scratch index pass spawned this job: run the realm-wide
  // module pre-warm sweep before the format renders begin. False on
  // incremental spawns — the sweep is O(realm module count).
  preWarm: boolean;
  indexWriter: IndexWriter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  reader: Reader;
  // Authed fetch, used only to resolve the realm's module-cache scope for
  // pre-warm (public vs private + owner user id).
  fetch: typeof globalThis.fetch;
  // The realm owner the pre-warm's sub-`prerenderModule` renders as, and the
  // user id a private realm's cache is keyed on.
  realmOwnerUserId: string;
  prerenderer: Prerenderer;
  auth: string;
  jobInfo: JobInfo;
  jobPriority?: number;
  onProgress?: (event: IndexingProgressEvent) => void;
}

export interface PrerenderHtmlPassResult {
  invalidations: string[];
  generation: number;
  stats: Stats;
  // The pre-warm sweep's wall-clock, present only when it ran (a from-scratch-
  // spawned pass outside the browser). Surfaces on the job result so
  // dashboards attribute the sweep to the job that pays it.
  preWarmMs?: number;
}

// The `prerender_html` job's visit loop — the HTML channel's analog of the
// incremental index loop in `IndexRunner`. Tombstones the whole invalidation
// set up front, then visits each 'update' URL with a standalone
// 'prerender-html' visit that renders from card+source (it never reads
// `boxel_index`), writing HTML or render-error rows into
// `prerendered_html_working`; 'delete' URLs are never visited so their
// tombstones survive. `batch.done()` swaps the set into production under the
// monotonic generation guard.
export async function runPrerenderHtmlPass({
  realmURL,
  changes,
  generation,
  loaderEpoch,
  preWarm,
  indexWriter,
  definitionLookup,
  virtualNetwork,
  reader,
  fetch,
  realmOwnerUserId,
  prerenderer,
  auth,
  jobInfo,
  jobPriority,
  onProgress,
}: PrerenderHtmlPassArgs): Promise<PrerenderHtmlPassResult> {
  let log = logger('prerender-html-runner');
  let perfLog = logger('index-perf');
  let start = Date.now();
  // realm + generation ride on every log line so the render channel can be
  // correlated back to the index pass that spawned it.
  let jobTag = `${jobIdentity(jobInfo)} [realm: ${realmURL.href}] [generation: ${generation}]`;
  let batchId = `${jobInfo.jobId}-${uuidv4().slice(0, 8)}`;
  let realmPaths = new RealmPaths(realmURL, virtualNetwork);
  let stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };

  log.debug(
    `${jobTag} starting prerender-html pass for ${changes.length} changes`,
  );

  // Delete-sticky dedupe, mirroring the incremental index loop: coalesced
  // publishes are already merged this way, but a single publish may still
  // carry duplicates.
  let operations = new Map<string, 'update' | 'delete'>();
  for (let { url, operation } of changes) {
    if (operation === 'delete') {
      operations.set(url, 'delete');
    } else if (!operations.has(url)) {
      operations.set(url, 'update');
    }
  }
  let totalFiles = operations.size;

  let batch = await indexWriter.createBatch(realmURL, virtualNetwork, jobInfo, {
    prerenderHtmlOnly: true,
    generation,
  });

  // The job's URL set arrives fully computed in its args, so the progress row
  // opens with the render denominator rather than the index runner's zero. A
  // from-scratch-spawned job then grows this total during pre-warm below (the
  // sweep's module count isn't known until its dep analysis runs), so the
  // `file-visited` events carry the combined total — the event sink adopts the
  // latest `totalFiles` it sees. The jobType matches the queue's
  // `jobs.job_type` value so both spell the job the same way.
  onProgress?.({
    type: 'indexing-started',
    realmURL: realmURL.href,
    jobId: jobInfo.jobId,
    jobType: 'prerender_html',
    totalFiles,
    files: [],
  });

  await batch.seedPrerenderedHtmlInvalidations(
    [...operations].map(([url, operation]) => ({ url, operation })),
  );
  let filesCompleted = 0;

  // Pre-warm the module definition cache before the format renders fire. The
  // realm-wide `.gts` / `.gjs` sweep is the layer that matters here: it primes
  // the sibling card modules referenced by *string* in query-backed field
  // renders (`<Search @query={{filter: {type: {module: '.../author.gts', name: 'Author'}}}}>`),
  // so a mid-render `lookupDefinition` hits a populated row instead of spawning
  // a same-affinity sub-`prerenderModule` that would stall the tab pool.
  //
  // Runs only when a from-scratch pass spawned this job (`preWarm`) — the sweep
  // is O(realm module count). Skipped in the browser: host tests run a Realm
  // inside a Chrome tab with no separate prerender server and no tab pool, and
  // populating the definition cache there bakes in keys the host's
  // card-reference-prefix reader can't match. The realm-wide list is re-derived
  // from `reader.mtimes()` rather than threaded through args — it mirrors the
  // index job's own source of truth and keeps the job payload from carrying an
  // O(realm) module list through every coalesce merge. Pre-warmed modules and
  // the files rendered below share one `totalFiles`, so the dashboard bar spans
  // both phases. Best-effort: a failure is warned and the format renders
  // populate the cache on demand. A retried job re-sweeps the whole realm (the
  // visit loop's resume-skip has no pre-warm analog), which is cheap — the
  // second attempt's populate calls hit the cache as O(1) reads, no re-renders.
  let preWarmMs: number | undefined;
  if (preWarm && !isBrowserTestEnv()) {
    let preWarmStart = Date.now();
    try {
      let filesystemMtimes = await reader.mtimes();
      let allRealmCardModules =
        Object.keys(filesystemMtimes).filter(hasCardExtension);
      // Info, not debug: the sweep can hold this worker for minutes on a
      // module-heavy realm, and with few workers everything queued behind it
      // waits that long. CI logs need the sweep's span attributable without a
      // log-level override.
      log.info(
        `${jobTag} module pre-warm sweep starting (${allRealmCardModules.length} realm card modules)`,
      );
      let updateURLs = [...operations]
        .filter(([, operation]) => operation === 'update')
        .map(([url]) => new URL(url));
      let preWarmedCount = await preWarmModulesTable({
        realmURL,
        invalidations: updateURLs,
        allRealmCardModules,
        definitionLookup,
        virtualNetwork,
        reader,
        getDependencyRows: (urls) => batch.getDependencyRows(urls),
        getModuleCacheContext: () =>
          resolveModuleCacheContext({ fetch, realmURL, realmOwnerUserId }),
        prerenderUserId: realmOwnerUserId,
        jobPriority: jobPriority ?? 0,
        jobInfo,
        log,
        perfLog,
        onModuleWarmed: ({ moduleUrl, warmedCount, totalToWarm }) => {
          filesCompleted = warmedCount;
          totalFiles = totalToWarm + operations.size;
          onProgress?.({
            type: 'file-visited',
            realmURL: realmURL.href,
            jobId: jobInfo.jobId,
            url: moduleUrl,
            filesCompleted,
            totalFiles,
          });
        },
      });
      totalFiles = preWarmedCount + operations.size;
      log.info(
        `${jobTag} module pre-warm sweep completed (${preWarmedCount} modules warmed) in ${Date.now() - preWarmStart} ms`,
      );
    } catch (e) {
      log.warn(
        `${jobTag} module pre-warm failed; the format renders will populate the definition cache on demand: ${(e as Error)?.message}`,
      );
    }
    preWarmMs = Date.now() - preWarmStart;
  }

  let resumedRows = batch.resumedRows;
  let resumedSkipped = 0;
  let tombstoned = 0;
  try {
    for (let [href, operation] of operations) {
      if (operation === 'delete') {
        // Deletion is the explicit threaded operation: never visited, the
        // up-front tombstone survives to the swap.
        tombstoned++;
      } else if (resumedRows.has(href)) {
        // A previous attempt of this job already rendered this URL.
        // `args.changes` is the deterministic seed, so the resumed row is
        // authoritative for this job.
        resumedSkipped++;
      } else {
        await visitForPrerenderedHtml({
          url: new URL(href),
          realmURL,
          realmPaths,
          reader,
          batch,
          prerenderer,
          virtualNetwork,
          auth,
          batchId,
          jobInfo,
          jobPriority,
          loaderEpoch,
          stats,
          log,
        });
      }
      filesCompleted++;
      onProgress?.({
        type: 'file-visited',
        realmURL: realmURL.href,
        jobId: jobInfo.jobId,
        url: href,
        filesCompleted,
        totalFiles,
      });
    }
    if (resumedSkipped > 0) {
      perfLog.debug(
        `${jobTag} skipped ${resumedSkipped} URLs already rendered by prior attempt`,
      );
    }
    let swapStart = Date.now();
    let { totalIndexEntries } = await batch.done();
    stats.totalIndexEntries = totalIndexEntries;
    perfLog.debug(
      `${jobTag} completed prerendered-html swap in ${Date.now() - swapStart} ms`,
    );
  } finally {
    onProgress?.({
      type: 'indexing-finished',
      realmURL: realmURL.href,
      jobId: jobInfo.jobId,
      stats,
    });
    // Release the batch's ownership of this realm's affinity on the
    // prerender server. Best-effort, mirroring IndexRunner.
    try {
      await prerenderer.releaseBatch?.({
        batchId,
        affinityType: 'realm',
        affinityValue: realmURL.href,
      });
    } catch (e) {
      log.warn(
        `${jobTag} failed to release prerender batch ${batchId}: ${(e as Error)?.message}`,
      );
    }
  }

  log.debug(
    `${jobTag} completed prerender-html pass (rendered ${stats.instancesIndexed} instances / ${stats.filesIndexed} files, ${
      stats.instanceErrors + stats.fileErrors
    } errors, ${tombstoned} tombstoned) in ${Date.now() - start} ms`,
  );
  return {
    invalidations: batch.invalidations,
    generation,
    stats,
    ...(preWarmMs !== undefined ? { preWarmMs } : {}),
  };
}

async function visitForPrerenderedHtml({
  url,
  realmURL,
  realmPaths,
  reader,
  batch,
  prerenderer,
  virtualNetwork,
  auth,
  batchId,
  jobInfo,
  jobPriority,
  loaderEpoch,
  stats,
  log,
}: {
  url: URL;
  realmURL: URL;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  prerenderer: Prerenderer;
  virtualNetwork: VirtualNetwork;
  auth: string;
  batchId: string;
  jobInfo: JobInfo;
  jobPriority?: number;
  loaderEpoch: string;
  stats: Stats;
  log: ReturnType<typeof logger>;
}): Promise<void> {
  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    log.debug(
      `${jobIdentity(jobInfo)} prerender-html visit of ${url.href} skipped (different realm than ${realmURL.href})`,
    );
    return;
  }

  let fileRef = await reader.readFile(url);
  if (!fileRef) {
    fileRef = await reader.readFile(new URL(encodeURI(localPath), url));
  }
  if (!fileRef) {
    // Unreadable file — the same outcome as the index visit's
    // missing-file handling: write nothing, so the up-front tombstone
    // survives to the swap and the two channels agree. This is how a
    // deletion that arrives under an alias form (e.g. a card delete names
    // the extensionless URL while the fan-out carries the `.json` form as
    // an update) lands consistently on both channels.
    log.info(
      `${jobIdentity(jobInfo)} tried to prerender file ${url.href}, but it no longer exists`,
    );
    return;
  }

  let parsedCardResource: LooseCardResource | undefined;
  if (url.href.endsWith('.json')) {
    try {
      let { data } = JSON.parse(fileRef.content);
      if (data && isCardResource(data)) {
        parsedCardResource = data as LooseCardResource;
      }
    } catch (_e) {
      // not card JSON — the file rendering still runs
    }
  }

  let fileURL = url.href;
  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL), virtualNetwork);

  // Hand through the write-time content hash + size so the extract pass can
  // skip buffering the file (same optimization as the index visit; only
  // forwarded when both are present).
  let { contentHash, contentSize } = await batch.getContentMeta(localPath);

  let renderOptions: RenderRouteOptions = {
    fileDefCodeRef,
    ...(parsedCardResource ? { cardRender: true } : {}),
    fileRender: true,
    // The standalone visit resolves the file's resource + types from source
    // via the extract pass — no chaining off a prior index visit, no
    // boxel_index read.
    fileExtract: true,
    loaderEpoch,
    ...(contentHash !== undefined && contentSize !== undefined
      ? { fileContentHash: contentHash, fileContentSize: contentSize }
      : {}),
  };

  let response: RenderVisitResponse = await prerenderer.prerenderVisit({
    affinityType: 'realm',
    affinityValue: realmURL.href,
    realm: realmURL.href,
    url: fileURL,
    auth,
    batchId,
    visitType: 'prerender-html',
    renderOptions,
    ...(jobPriority !== undefined ? { priority: jobPriority } : {}),
    ...(jobInfo ? { jobId: `${jobInfo.jobId}.${jobInfo.reservationId}` } : {}),
  });

  // The visit's render diagnostics (launch/wait timings, render elapsed,
  // per-format render timings, `prerenderHtmlRequestId`). One visit produces
  // both the instance and the file rendering of a URL, so the same blob
  // lands on both rows — mirroring how the fused pass stamps one merged
  // blob on both of a URL's `boxel_index` rows.
  let diagnostics = flattenPrerenderHtmlVisitMeta(response.meta);

  if (parsedCardResource) {
    let card = response.card;
    let cardError = card?.error ?? response.pageUnusableError;
    if (cardError || !card) {
      let error = cardError?.error ?? {
        message: `prerenderVisit returned no card result for a card resource`,
        status: 500,
        additionalErrors: null,
      };
      // Same dep enrichment the index channel's error path applies: the
      // error doc's deps must cover the modules the card consumes so fixing
      // one invalidates this row and clears the error.
      let metaModuleDeps = parsedCardResource.meta
        ? modulesConsumedInMeta(parsedCardResource.meta).map((m) =>
            canonicalURL(m, fileURL, virtualNetwork),
          )
        : undefined;
      await batch.updatePrerenderedHtmlEntry(url, {
        type: 'instance-error',
        error: {
          ...error,
          deps: uniqueDeps(error.deps, card?.deps ?? undefined, metaModuleDeps),
        },
        ...(diagnostics ? { diagnostics } : {}),
      });
      stats.instanceErrors++;
    } else {
      await batch.updatePrerenderedHtmlEntry(url, {
        type: 'instance',
        isolatedHtml: card.isolatedHTML,
        headHtml: card.headHTML,
        atomHtml: card.atomHTML,
        embeddedHtml: card.embeddedHTML,
        fittedHtml: card.fittedHTML,
        markdown: card.markdown,
        // The render route's settle-time dependency snapshot — what the
        // format renders actually pulled in (scoped-CSS URLs included).
        deps: card.deps ?? [],
        ...(diagnostics ? { diagnostics } : {}),
      });
      stats.instancesIndexed++;
    }
  }

  // Every URL has a file rendering (FileDef formats), mirroring the fused
  // visit.
  let fileRender = response.fileRender;
  let fileError = fileRender?.error ?? response.pageUnusableError;
  if (fileError || !fileRender) {
    let error = fileError?.error ?? {
      message: `prerenderVisit returned no file rendering`,
      status: 500,
      additionalErrors: null,
    };
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'file-error',
      error: {
        ...error,
        deps: uniqueDeps(error.deps, response.fileExtract?.deps),
      },
      ...(diagnostics ? { diagnostics } : {}),
    });
    stats.fileErrors++;
  } else {
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'file',
      isolatedHtml: fileRender.isolatedHTML,
      headHtml: fileRender.headHTML,
      atomHtml: fileRender.atomHTML,
      embeddedHtml: fileRender.embeddedHTML,
      fittedHtml: fileRender.fittedHTML,
      markdown: fileRender.markdown,
      deps: response.fileExtract?.deps ?? [],
      ...(diagnostics ? { diagnostics } : {}),
    });
    stats.filesIndexed++;
  }
}
