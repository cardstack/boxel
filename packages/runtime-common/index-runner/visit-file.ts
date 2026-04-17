import type { Ignore } from 'ignore';

import {
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
} from '../index';
import { CardError } from '../error';
import { resolveFileDefCodeRef } from '../file-def-code-ref';

interface VisitFileOptions {
  url: URL;
  realmURL: URL;
  ignoreMap: Map<string, Ignore>;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  jobInfo: JobInfo;
  logDebug(message: string): void;
  logWarn(message: string): void;
  indexCard(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
  }): Promise<void>;
  indexFile(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
  }): Promise<void>;
}

interface VisitFileFusedOptions {
  url: URL;
  realmURL: URL;
  ignoreMap: Map<string, Ignore>;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  jobInfo: JobInfo;
  auth: string;
  prerenderer: Prerenderer;
  consumeClearCacheForRender(): boolean;
  logDebug(message: string): void;
  logWarn(message: string): void;
  indexCardWithResult(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
    renderResult: NonNullable<RenderVisitResponse['card']>;
  }): Promise<void>;
  indexFileWithResults(args: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
    extractResult?: RenderVisitResponse['fileExtract'];
    renderResult?: RenderVisitResponse['fileRender'];
  }): Promise<void>;
}

export async function visitFileForIndexing({
  url,
  realmURL,
  ignoreMap,
  realmPaths,
  reader,
  batch,
  jobInfo,
  logDebug,
  logWarn,
  indexCard,
  indexFile,
}: VisitFileOptions): Promise<void> {
  if (isIgnored(realmURL, ignoreMap, url)) {
    return;
  }
  let start = Date.now();
  logDebug(`${jobIdentity(jobInfo)} begin visiting file ${url.href}`);

  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    // until we have cross realm invalidation, if our invalidation
    // graph cross a realm just skip over the file. it will be out
    // of date, but such is life...
    logDebug(
      `${jobIdentity(jobInfo)} Visit of ${url.href} cannot be performed as it is in a different realm than the realm whose contents are being invalidated (${realmURL.href})`,
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
  // ensure created_at exists for this file and use it for resourceCreatedAt
  let resourceCreatedAt = await batch.ensureFileCreatedAt(localPath);
  let isModule = hasExecutableExtension(url.href);

  if (url.href.endsWith('.json')) {
    let resource: unknown;
    try {
      let { data } = JSON.parse(content);
      resource = data;
    } catch (_e) {
      logWarn(
        `${jobIdentity(jobInfo)} unable to parse ${url.href} as card JSON`,
      );
    }

    if (resource && isCardResource(resource)) {
      if (lastModified == null) {
        logWarn(
          `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
        );
        lastModified = unixTime(Date.now());
      }

      await indexCard({
        path: localPath,
        lastModified,
        resourceCreatedAt,
        resource,
      });
      // Intentionally fall through so card JSON files also get a file entry.
    }
  }

  if (lastModified == null) {
    logWarn(
      `${jobIdentity(jobInfo)} No lastModified date available for ${url.href}, using current time`,
    );
    lastModified = unixTime(Date.now());
  }

  await indexFile({
    path: localPath,
    lastModified,
    resourceCreatedAt,
    hasModulePrerender: isModule,
  });
  logDebug(
    `${jobIdentity(jobInfo)} completed visiting file ${url.href} in ${Date.now() - start}ms`,
  );
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
  auth,
  prerenderer,
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
  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL));

  let clearCache = consumeClearCacheForRender();
  let renderOptions: RenderRouteOptions = {
    fileDefCodeRef,
    ...(needCardRender ? { cardRender: true } : {}),
    ...(needFileExtract ? { fileExtract: true } : {}),
    ...(needFileRender ? { fileRender: true } : {}),
    ...(clearCache ? { clearCache } : {}),
  };

  // [CS-10759-DEBUG] Temporary diagnostic logs — remove once the fused
  // visit path is stable. Search for "[CS-10759-DEBUG]" to find and delete.
  logDebug(
    `${jobIdentity(jobInfo)} [CS-10759-DEBUG] fused visit requesting url=${url.href} passes={card:${needCardRender},extract:${needFileExtract},render:${needFileRender}} clearCache=${clearCache}`,
  );

  let visitResponse: RenderVisitResponse;
  try {
    visitResponse = await prerenderer.prerenderVisit({
      affinityType: 'realm',
      affinityValue: realmURL.href,
      realm: realmURL.href,
      url: fileURL,
      auth,
      renderOptions,
    });
  } catch (err) {
    logWarn(
      `${jobIdentity(jobInfo)} fused visit prerender of ${url.href} threw: ${(err as Error)?.message}`,
    );
    throw err;
  }

  // [CS-10759-DEBUG] remove after stabilization
  logDebug(
    `${jobIdentity(jobInfo)} [CS-10759-DEBUG] fused visit response url=${url.href} hasCard=${Boolean(visitResponse.card)} cardHasError=${Boolean(visitResponse.card?.error)} hasExtract=${Boolean(visitResponse.fileExtract)} extractStatus=${visitResponse.fileExtract?.status} hasRender=${Boolean(visitResponse.fileRender)} renderHasError=${Boolean(visitResponse.fileRender?.error)} pageUnusable=${Boolean(visitResponse.pageUnusableError)}`,
  );

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
    // [CS-10759-DEBUG] remove after stabilization
    logDebug(
      `${jobIdentity(jobInfo)} [CS-10759-DEBUG] routing to indexCardWithResult url=${url.href}`,
    );
    await indexCardWithResult({
      path: localPath,
      lastModified,
      resourceCreatedAt,
      resource: parsedCardResource,
      renderResult: cardResult,
    });
  }

  // [CS-10759-DEBUG] remove after stabilization
  logDebug(
    `${jobIdentity(jobInfo)} [CS-10759-DEBUG] routing to indexFileWithResults url=${url.href}`,
  );
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
  });

  logDebug(
    `${jobIdentity(jobInfo)} completed fused visit of file ${url.href} in ${Date.now() - start}ms`,
  );
}
