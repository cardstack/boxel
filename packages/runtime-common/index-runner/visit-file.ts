import type { Ignore } from 'ignore';

import {
  flattenPrerenderMeta,
  hasExecutableExtension,
  isCardResource,
  isIgnored,
  jobIdentity,
  unixTime,
  type Batch,
  type JobInfo,
  type LocalPath,
  type LooseCardResource,
  type Prerenderer,
  type Reader,
  type RealmPaths,
  type RenderRouteOptions,
  type RenderVisitResponse,
  type TimingDiagnostics,
} from '../index';
import { CardError } from '../error';
import { resolveFileDefCodeRef } from '../file-def-code-ref';
import type { VirtualNetwork } from '../virtual-network';

interface VisitFileFusedOptions {
  url: URL;
  realmURL: URL;
  ignoreMap: Map<string, Ignore>;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  jobInfo: JobInfo;
  // Worker-job priority threaded from `IndexRunner`. Forwarded into
  // the `prerenderVisit` request so the prerender server can route by
  // priority. `0` for system-priority indexing, `10` for user-
  // initiated; defaults to `0` when not provided.
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
    // Timing / diagnostic payload flattened from the fused visit's
    // `response.meta` (server timings + host-side breadcrumbs +
    // HTTP requestId). Persisted onto `boxel_index.timing_diagnostics`
    // so operators can investigate slow renders after the fact.
    timingDiagnostics?: TimingDiagnostics;
  }): Promise<void>;
  indexFileWithResults(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
    extractResult?: RenderVisitResponse['fileExtract'];
    renderResult?: RenderVisitResponse['fileRender'];
    timingDiagnostics?: TimingDiagnostics;
  }): Promise<void>;
}

// Fused visit: calls prerenderer.prerenderVisit once with whichever of the
// fileExtract/cardRender/fileRender passes are needed for this file, then
// routes the sub-results into the card/file indexers. Replaces up to 3
// separate prerender HTTP round-trips with a single one.
export async function visitFileForIndexingFused({
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
}: VisitFileFusedOptions): Promise<void> {
  if (isIgnored(realmURL, ignoreMap, url)) {
    return;
  }
  let start = Date.now();
  logDebug(`${jobIdentity(jobInfo)} begin fused visit of file ${url.href}`);

  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    logDebug(
      `${jobIdentity(jobInfo)} Fused visit of ${url.href} skipped (different realm than ${realmURL.href})`,
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
  // fileRender is requested for all non-module files. This is broader than
  // the legacy file-indexer gating (`extractResult.resource && !hasModulePrerender`);
  // missing-resource cases are handled downstream by the file indexer.
  let needFileRender = !isModule;

  if (lastModified == null) {
    logWarn(
      `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
    );
    lastModified = unixTime(Date.now());
  }

  let fileURL = url.href;
  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL), virtualNetwork);

  let clearCache = consumeClearCacheForRender();
  let renderOptions: RenderRouteOptions = {
    fileDefCodeRef,
    ...(needCardRender ? { cardRender: true } : {}),
    ...(needFileExtract ? { fileExtract: true } : {}),
    ...(needFileRender ? { fileRender: true } : {}),
    ...(clearCache ? { clearCache } : {}),
  };

  let visitResponse: RenderVisitResponse;
  try {
    visitResponse = await prerenderer.prerenderVisit({
      affinityType: 'realm',
      affinityValue: realmURL.href,
      realm: realmURL.href,
      url: fileURL,
      auth,
      renderOptions,
      batchId,
      ...(jobPriority !== undefined ? { priority: jobPriority } : {}),
      ...(jobInfo
        ? { jobId: `${jobInfo.jobId}.${jobInfo.reservationId}` }
        : {}),
    });
  } catch (err) {
    logWarn(
      `${jobIdentity(jobInfo)} fused visit prerender of ${url.href} threw: ${(err as Error)?.message}`,
    );
    throw err;
  }

  // Route card result when we parsed a card resource. If the composite
  // short-circuited (page-unusable/auth), visitResponse.card may be missing.
  // In that case, synthesize an error RenderResponse from pageUnusableError
  // so the card entry still gets a proper error row rather than being left
  // stale. This matches the legacy flow, which always attempts card indexing
  // independently of file-level outcomes.
  if (parsedCardResource) {
    let cardResult: NonNullable<RenderVisitResponse['card']> =
      visitResponse.card ?? {
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
        error: visitResponse.pageUnusableError ?? {
          type: 'instance-error',
          error: {
            message:
              'prerenderVisit returned no card result for a card resource',
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
      timingDiagnostics: flattenPrerenderMeta(visitResponse.meta),
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
    extractResult: visitResponse.fileExtract,
    renderResult: visitResponse.fileRender,
    timingDiagnostics: flattenPrerenderMeta(visitResponse.meta),
  });

  logDebug(
    `${jobIdentity(jobInfo)} completed fused visit of file ${url.href} in ${Date.now() - start}ms`,
  );
}
