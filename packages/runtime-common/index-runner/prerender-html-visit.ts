// Isomorphic UUID — matches IndexRunner's batch-id minting.
import { v4 as uuidv4 } from '@lukeed/uuid';

import {
  isCardResource,
  jobIdentity,
  logger,
  RealmPaths,
  type Batch,
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
  indexWriter: IndexWriter;
  virtualNetwork: VirtualNetwork;
  reader: Reader;
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
  indexWriter,
  virtualNetwork,
  reader,
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

  let batch = await indexWriter.createBatch(realmURL, virtualNetwork, jobInfo, {
    prerenderHtmlOnly: true,
    generation,
  });

  onProgress?.({
    type: 'indexing-started',
    realmURL: realmURL.href,
    jobId: jobInfo.jobId,
    jobType: 'prerender-html',
    totalFiles: 0,
    files: [],
  });

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

  await batch.seedPrerenderedHtmlInvalidations(
    [...operations].map(([url, operation]) => ({ url, operation })),
  );

  let totalFiles = operations.size;
  let filesCompleted = 0;
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
  return { invalidations: batch.invalidations, generation, stats };
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

  if (parsedCardResource) {
    let card = response.card;
    let cardError = card?.error ?? response.pageUnusableError;
    if (cardError || !card) {
      await batch.updatePrerenderedHtmlEntry(url, {
        type: 'instance-error',
        error: cardError?.error ?? {
          message: `prerenderVisit returned no card result for a card resource`,
          status: 500,
          additionalErrors: null,
        },
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
      });
      stats.instancesIndexed++;
    }
  }

  // Every URL has a file rendering (FileDef formats), mirroring the fused
  // visit.
  let fileRender = response.fileRender;
  let fileError = fileRender?.error ?? response.pageUnusableError;
  if (fileError || !fileRender) {
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'file-error',
      error: fileError?.error ?? {
        message: `prerenderVisit returned no file rendering`,
        status: 500,
        additionalErrors: null,
      },
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
    });
    stats.filesIndexed++;
  }
}
