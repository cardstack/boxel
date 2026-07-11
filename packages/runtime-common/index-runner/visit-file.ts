import type { Ignore } from 'ignore';

import {
  flattenPrerenderMeta,
  hasExecutableExtension,
  isCardResource,
  isIgnored,
  jobIdentity,
  unixTime,
  type Batch,
  type Diagnostics,
  type FileRenderResponse,
  type JobInfo,
  type LocalPath,
  type LooseCardResource,
  type Prerenderer,
  type Reader,
  type RealmPaths,
  type RenderResponse,
  type RenderRouteOptions,
  type RenderVisitResponse,
} from '../index.ts';
import { CardError, mergeErrorsByGeneration } from '../error.ts';
import { resolveFileDefCodeRef } from '../file-def-code-ref.ts';
import type { VirtualNetwork } from '../virtual-network.ts';

interface VisitFileOptions {
  url: URL;
  realmURL: URL;
  ignoreMap: Map<string, Ignore>;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  jobInfo: JobInfo;
  // Worker-job priority threaded from `IndexRunner`. Forwarded into
  // the `prerenderVisit` request so the prerender server can route by
  // priority. On the tier scale in `queue.ts`: `systemInitiatedPriority`
  // for background indexing, `userInitiatedPriority` for user-initiated;
  // defaults to the lowest tier (`0`) when not provided.
  jobPriority?: number;
  auth: string;
  // Indexing batch identifier (CS-10758 step 3). Threaded into
  // PrerenderVisitArgs so the server-side gate honors `clearCache: true`
  // for this batch's visits and strips it from concurrent non-batch
  // traffic that happens to land on the same warm tab.
  batchId: string;
  prerenderer: Prerenderer;
  virtualNetwork: VirtualNetwork;
  consumeClearCacheForRender(): boolean;
  logDebug(message: string): void;
  logWarn(message: string): void;
  indexCardWithResult(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
    renderResult: NonNullable<RenderVisitResponse['card']>;
    // Timing / diagnostic payload flattened from the visits'
    // `response.meta` (server timings + host-side breadcrumbs +
    // HTTP requestId). Persisted onto `boxel_index.diagnostics`
    // so operators can investigate slow renders after the fact.
    diagnostics?: Diagnostics;
  }): Promise<void>;
  indexFileWithResults(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
    // True when this file is a card-instance .json (the same fact that
    // triggers the additional `instance` row in this fused visit).
    isCardInstance?: boolean;
    extractResult?: RenderVisitResponse['fileExtract'];
    renderResult?: RenderVisitResponse['fileRender'];
    diagnostics?: Diagnostics;
  }): Promise<void>;
}

// Visits a file for indexing as two consolidated prerender visits along the
// search-doc/HTML seam, then routes the merged sub-results into the
// card/file indexers:
//
//   1. the index visit — file extract, card meta (search doc / serialized /
//      types / display names / deps) and the card + file icons. Never runs
//      the html route.
//   2. the prerender-html visit — the html route per format plus markdown
//      for the card and the file rendering, chained off the index visit's
//      outputs (extract resource → fileData, extract types → FileDef
//      ancestor chain, meta types → card ancestor chain).
//
// The merged writes are identical to what a single fused visit produces;
// the seam separates HTML production from search-doc production so each can
// run on its own channel.
export async function visitFileForIndexing({
  url,
  realmURL,
  ignoreMap,
  realmPaths,
  reader,
  batch,
  jobInfo,
  jobPriority,
  auth,
  batchId,
  prerenderer,
  virtualNetwork,
  consumeClearCacheForRender,
  logDebug,
  logWarn,
  indexCardWithResult,
  indexFileWithResults,
}: VisitFileOptions): Promise<void> {
  if (isIgnored(realmURL, ignoreMap, url)) {
    return;
  }
  let start = Date.now();
  logDebug(`${jobIdentity(jobInfo)} begin visit of file ${url.href}`);

  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    logDebug(
      `${jobIdentity(jobInfo)} Visit of ${url.href} skipped (different realm than ${realmURL.href})`,
    );
    return;
  }

  let fileRef = await reader.readFile(url);
  if (!fileRef) {
    fileRef = await reader.readFile(new URL(encodeURI(localPath), url));
  }
  if (!fileRef) {
    let error = new CardError(`missing file ${url.href}`, { status: 404 });
    error.deps = [url.href];
    throw error;
  }

  let { content, lastModified } = fileRef;
  let resourceCreatedAt = await batch.ensureFileCreatedAt(localPath);
  let isModule = hasExecutableExtension(url.href);

  // Determine which passes are needed based on the file kind.
  let resource: unknown;
  let parsedCardResource: LooseCardResource | undefined;
  if (url.href.endsWith('.json')) {
    try {
      let { data } = JSON.parse(content);
      resource = data;
    } catch (_e) {
      logWarn(
        `${jobIdentity(jobInfo)} unable to parse ${url.href} as card JSON`,
      );
    }
    if (resource && isCardResource(resource)) {
      parsedCardResource = resource as LooseCardResource;
    }
  }

  let needCardRender = Boolean(parsedCardResource);
  let needFileExtract = true; // every file gets a file entry
  // fileRender is requested for every file, including executable modules
  // (.gts/.ts). Module files are also FileDef subclasses (GtsFileDef /
  // TsFileDef) with their own fitted/embedded/atom/isolated templates, and
  // CardsGrid's "All Files" group renders those formats — so they need the
  // FileDef-format HTML just like .json/.md/image files do (CS-11171).
  // `isModule` does NOT gate this: it's only recorded as the
  // `hasModulePrerender` flag on the file-index row below (a metadata hint
  // for downstream consumers; the file indexer no longer acts on it).
  // Missing-resource cases are handled downstream by the file indexer.
  let needFileRender = true;

  if (lastModified == null) {
    logWarn(
      `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
    );
    lastModified = unixTime(Date.now());
  }

  let fileURL = url.href;
  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL), virtualNetwork);

  let clearCache = consumeClearCacheForRender();

  // The file-extract pass runs `FileDef.extractAttributes` in the prerenderer,
  // which otherwise buffers the entire file just to MD5 it and measure its
  // size. The realm already persisted both values at write time (computed over
  // the exact bytes it wrote, which is what the prerenderer would re-fetch), so
  // hand them through and let `extractAttributes` skip the buffer entirely.
  // Only forwarded when BOTH are present — `extractAttributes` re-reads the
  // stream unless it has the hash and the size — so a partial lookup buys
  // nothing. Absent values (pre-hashing files, no-op rewrites) fall back to the
  // prerenderer's own buffered read.
  let fileContentHash: string | undefined;
  let fileContentSize: number | undefined;
  if (needFileExtract) {
    let { contentHash, contentSize } = await batch.getContentMeta(localPath);
    if (contentHash !== undefined && contentSize !== undefined) {
      fileContentHash = contentHash;
      fileContentSize = contentSize;
    }
  }

  let visitArgs = {
    affinityType: 'realm' as const,
    affinityValue: realmURL.href,
    realm: realmURL.href,
    url: fileURL,
    auth,
    batchId,
    ...(jobPriority !== undefined ? { priority: jobPriority } : {}),
    ...(jobInfo ? { jobId: `${jobInfo.jobId}.${jobInfo.reservationId}` } : {}),
  };

  // The index visit runs first and carries the one-shot clearCache. Every
  // visit also threads the pass's loader epoch, so each prerender tab this
  // pass touches resets its loader exactly once when the realm's module
  // surface changed — the one-shot boolean can only sanitize the single tab
  // its visit lands on.
  let indexRenderOptions: RenderRouteOptions = {
    fileDefCodeRef,
    loaderEpoch: batch.loaderEpoch,
    ...(needCardRender ? { cardRender: true } : {}),
    ...(needFileExtract ? { fileExtract: true } : {}),
    ...(needFileRender ? { fileRender: true } : {}),
    ...(clearCache ? { clearCache } : {}),
    ...(fileContentHash !== undefined ? { fileContentHash } : {}),
    ...(fileContentSize !== undefined ? { fileContentSize } : {}),
  };

  let indexResponse: RenderVisitResponse;
  try {
    indexResponse = await prerenderer.prerenderVisit({
      ...visitArgs,
      visitType: 'index',
      renderOptions: indexRenderOptions,
    });
  } catch (err) {
    logWarn(
      `${jobIdentity(jobInfo)} index visit prerender of ${url.href} threw: ${(err as Error)?.message}`,
    );
    throw err;
  }

  // The prerender-html visit chains off the index visit: the extract's
  // resource becomes the FileDef rendering's fileData, the extract's types
  // drive the FileDef fitted/embedded renders, and the card meta's types
  // drive the card's ancestor renders. Skipped when the index visit left
  // the page unusable (mirroring the short-circuit inside a single visit)
  // or when there is nothing for it to render. In split mode
  // (`batch.splitPrerenderHtml`) it is skipped entirely: HTML runs on its
  // own channel in the `prerender_html` job, and this index pass writes
  // only the search-doc half.
  let htmlResponse: RenderVisitResponse | undefined;
  let htmlFileData = indexResponse.fileExtract?.resource
    ? { resource: indexResponse.fileExtract.resource, fileDefCodeRef }
    : undefined;
  let needFileHtml = needFileRender && htmlFileData !== undefined;
  if (
    !batch.splitPrerenderHtml &&
    !indexResponse.pageUnusableError &&
    (needCardRender || needFileHtml)
  ) {
    let htmlRenderOptions: RenderRouteOptions = {
      fileDefCodeRef,
      loaderEpoch: batch.loaderEpoch,
      ...(needCardRender ? { cardRender: true } : {}),
      ...(needFileHtml ? { fileRender: true } : {}),
    };
    try {
      htmlResponse = await prerenderer.prerenderVisit({
        ...visitArgs,
        visitType: 'prerender-html',
        renderOptions: htmlRenderOptions,
        ...(htmlFileData ? { fileData: htmlFileData } : {}),
        ...(indexResponse.fileExtract?.types?.length
          ? { types: indexResponse.fileExtract.types }
          : {}),
        ...(indexResponse.card?.types?.length
          ? { cardTypes: indexResponse.card.types }
          : {}),
      });
    } catch (err) {
      logWarn(
        `${jobIdentity(jobInfo)} prerender-html visit of ${url.href} threw: ${(err as Error)?.message}`,
      );
      throw err;
    }
  }

  let card = mergeCardVisitResults(indexResponse.card, htmlResponse?.card);
  let fileRenderResult = mergeFileRenderVisitResults(
    indexResponse.fileRender,
    htmlResponse?.fileRender,
  );
  let pageUnusableError =
    indexResponse.pageUnusableError ?? htmlResponse?.pageUnusableError;
  let diagnostics = mergeVisitDiagnostics(
    flattenPrerenderMeta(indexResponse.meta),
    flattenPrerenderMeta(htmlResponse?.meta),
  );

  // Route card result when we parsed a card resource. If the visits
  // short-circuited (page-unusable/auth), the card sub-result may be
  // missing. In that case, synthesize an error RenderResponse from
  // pageUnusableError so the card entry still gets a proper error row
  // rather than being left stale — card indexing always runs for a parsed
  // card resource, independent of file-level outcomes.
  if (parsedCardResource) {
    let cardResult: NonNullable<RenderVisitResponse['card']> = card ?? {
      serialized: null,
      searchDoc: null,
      displayNames: null,
      deps: null,
      types: null,
      isolatedHTML: null,
      headHTML: null,
      atomHTML: null,
      embeddedHTML: null,
      fittedHTML: null,
      iconHTML: null,
      markdown: null,
      error: pageUnusableError ?? {
        type: 'instance-error',
        error: {
          message: 'prerenderVisit returned no card result for a card resource',
          status: 500,
          additionalErrors: null,
        },
      },
    };
    await indexCardWithResult({
      path: localPath,
      lastModified,
      resourceCreatedAt,
      resource: parsedCardResource,
      renderResult: cardResult,
      diagnostics,
    });
  }

  // Route file extract + file render to the file indexer. The file indexer's
  // existing error-path handling runs even if extractResult is missing; that
  // behavior is preserved by passing undefined through.
  await indexFileWithResults({
    path: localPath,
    lastModified,
    resourceCreatedAt,
    hasModulePrerender: isModule,
    isCardInstance: Boolean(parsedCardResource),
    extractResult: indexResponse.fileExtract,
    renderResult: fileRenderResult,
    diagnostics,
  });

  logDebug(
    `${jobIdentity(jobInfo)} completed visit of file ${url.href} in ${Date.now() - start}ms`,
  );
}

// Reassemble the two visits' card sub-results into the single RenderResponse
// shape the card indexer consumes: the index visit supplies the search-doc
// side (meta fields + icon), the prerender-html visit supplies the html
// formats + markdown, and the runtime deps are the union of both visits'
// captures — the meta deps cover the search-doc walk, the html visit's
// cover what the format renders pulled in, and both edge sets must land on
// the row for invalidation to reach every dependent. When both visits error,
// they belong to one indexing job — the same index generation — so neither
// supersedes the other: keep the html visit's isolated-render-wrapped,
// card-facing message ("Encountered error rendering HTML for card: …") as the
// primary error and fold the index visit's dependency-error detail into its
// additionalErrors. A card whose computed throws fails serialization (index)
// and template render (html) alike; a card whose adopted module is missing
// carries its dependency chain on the index visit's error, which the html
// render path does not reconstruct. Whichever visit is the sole one to error
// is used as-is.
function mergeCardVisitResults(
  index: RenderResponse | undefined,
  html: RenderResponse | undefined,
): RenderResponse | undefined {
  if (!index && !html) {
    return undefined;
  }
  let error: RenderResponse['error'];
  if (index?.error && html?.error) {
    error = {
      ...html.error,
      // Both visits are the same indexing job → the same index generation.
      error: mergeErrorsByGeneration(html.error.error, 0, index.error.error, 0),
    };
  } else {
    error = index?.error ?? html?.error;
  }
  return {
    serialized: index?.serialized ?? null,
    searchDoc: index?.searchDoc ?? null,
    displayNames: index?.displayNames ?? null,
    types: index?.types ?? null,
    deps: mergeDeps(index?.deps ?? null, html?.deps ?? null),
    ...(index?.diagnostics ? { diagnostics: index.diagnostics } : {}),
    iconHTML: index?.iconHTML ?? null,
    isolatedHTML: html?.isolatedHTML ?? null,
    headHTML: html?.headHTML ?? null,
    atomHTML: html?.atomHTML ?? null,
    embeddedHTML: html?.embeddedHTML ?? null,
    fittedHTML: html?.fittedHTML ?? null,
    markdown: html?.markdown ?? null,
    ...(error ? { error } : {}),
  };
}

function mergeFileRenderVisitResults(
  index: FileRenderResponse | undefined,
  html: FileRenderResponse | undefined,
): FileRenderResponse | undefined {
  if (!index && !html) {
    return undefined;
  }
  let error = index?.error ?? html?.error;
  return {
    iconHTML: index?.iconHTML ?? null,
    isolatedHTML: html?.isolatedHTML ?? null,
    headHTML: html?.headHTML ?? null,
    atomHTML: html?.atomHTML ?? null,
    embeddedHTML: html?.embeddedHTML ?? null,
    fittedHTML: html?.fittedHTML ?? null,
    markdown: html?.markdown ?? null,
    ...(error ? { error } : {}),
  };
}

function mergeDeps(a: string[] | null, b: string[] | null): string[] | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return [...new Set([...a, ...b])];
}

// A row is produced by two sequential visits, each reporting its own
// server-observed timings. Sum the timing fields so the persisted
// diagnostics still answer "how long did this row take to produce"; every
// other field prefers the index visit's value, with the html visit's
// surviving where the index visit has none (e.g. `renderStage` from a
// timed-out format render). The html visit's HTTP correlation id is kept
// under `prerenderHtmlRequestId` so operators can join logs for both.
function mergeVisitDiagnostics(
  index: Diagnostics | undefined,
  html: Diagnostics | undefined,
): Diagnostics | undefined {
  if (!index || !html) {
    return index ?? html;
  }
  let sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  let merged: Diagnostics = { ...html, ...index };
  for (let key of ['launchMs', 'renderElapsedMs', 'totalElapsedMs'] as const) {
    let total = sum(index[key], html[key]);
    if (total !== undefined) {
      merged[key] = total;
    }
  }
  if (index.waits || html.waits) {
    let waits: NonNullable<Diagnostics['waits']> = {};
    for (let key of [
      'semaphoreMs',
      'admissionMs',
      'tabQueueMs',
      'tabStartupMs',
    ] as const) {
      let total = sum(index.waits?.[key], html.waits?.[key]);
      if (total !== undefined) {
        waits[key] = total;
      }
    }
    merged.waits = waits;
  }
  if (html.requestId && html.requestId !== merged.requestId) {
    merged.prerenderHtmlRequestId = html.requestId;
  }
  return merged;
}
