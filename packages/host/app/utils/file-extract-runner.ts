import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';

import {
  baseFileRef,
  baseRealm,
  formattedError,
  logger,
  snapshotRuntimeDependencies,
  ToolContextStamp,
  trackRuntimeModuleDependency,
  withRuntimeDependencyTrackingContext,
  type RenderError,
  type RenderRouteOptions,
  type ToolContext,
} from '@cardstack/runtime-common';

import { errorJsonApiToErrorEntry } from '../lib/window-error-handler';

import {
  FileDefAttributesExtractor,
  type FileDefExtractResult,
} from './file-def-attributes-extractor';

import type { AuthErrorGuard } from './auth-error-guard';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

const log = logger('host:file-extract');

export function buildFileExtractError(url: string, error: any): RenderError {
  let errorJSONAPI = formattedError(url, error).errors[0];
  return errorJsonApiToErrorEntry(errorJSONAPI) as RenderError;
}

// Runs the FileDef attribute extract for `fileURL` and returns the extract
// result carrying the dependency set the file row persists. Shared by the
// standalone render.file-extract route and the fused branch of render.meta so
// both produce the identical file-row payload.
//
// The caller owns the dependency-tracking SESSION this runs inside: the
// extract snapshots the whole current session, so it must not share one with
// card hydration — the standalone route inherits the parent render route's
// session (whose fileExtract-mode model tracks nothing else), while the fused
// meta branch starts a fresh session first.
//
// Throws never escape: an extractor failure is caught into a
// `status: 'error'` result so it surfaces through the route's payload (and
// from there the route-level error handling). Letting it escape would reach
// the window-level error trap, which marks the page unusable and evicts it —
// a remedy reserved for errors that wedge the Ember run loop.
export async function runFileExtract({
  fileURL,
  renderOptions,
  loaderService,
  network,
  authGuard,
  owner,
  fileSizeLimitBytes,
}: {
  fileURL: string;
  renderOptions: RenderRouteOptions;
  loaderService: LoaderService;
  network: NetworkService;
  authGuard: AuthErrorGuard;
  owner: Owner;
  fileSizeLimitBytes?: number;
}): Promise<FileDefExtractResult> {
  let fileDefCodeRef = renderOptions.fileDefCodeRef ?? baseFileRef;
  let contentHash: string | undefined = renderOptions.fileContentHash;
  let contentSize: number | undefined = renderOptions.fileContentSize;
  let lastModified: number | undefined = renderOptions.fileLastModified;
  let createdAt: number | undefined = renderOptions.fileCreatedAt;
  // This runs on the indexing path, so skill tool schemas are generated
  // during the extract and persisted with the row. Tool classes never read
  // the context during schema generation, but host-package tools resolve
  // services (e.g. the loader) through the context's owner at construction —
  // so the context must carry one, the same shape the tool service hands to
  // real invocations.
  let toolContext: ToolContext = { [ToolContextStamp]: true };
  setOwner(toolContext, owner);
  let extractor = new FileDefAttributesExtractor({
    loaderService,
    network,
    authGuard,
    fileURL,
    fileDefCodeRef,
    baseFileDefCodeRef: baseFileRef,
    contentHash,
    contentSize,
    lastModified,
    createdAt,
    fileSizeLimitBytes,
    buildError: buildFileExtractError,
    toolContext,
  });
  let fileApiURL = `${baseRealm.url}file-api`;
  // The dependency tracker is page-global, so an import still running when
  // the extract begins can land in its deps without the extract reading it.
  // Named here so deps that differ between two extracts of the same file can
  // be traced to the import that landed in one of them.
  let inFlight = loaderService.loader.inFlightModuleImports;
  if (inFlight.length > 0) {
    log.debug(
      `file extract of ${fileURL} begins with ${inFlight.length} module import(s) in flight: ${inFlight.join(', ')}`,
    );
  }
  let result: FileDefExtractResult;
  try {
    result = await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'render:file-extract',
        consumer: fileURL,
        consumerKind: 'file',
      },
      async () => {
        // `${baseRealm.url}file-api` is the public URL the indexer
        // uses to invalidate file extracts, but the FileDef class
        // physically lives in `card-api` (`baseFileRef.module`). The
        // extractor only imports `card-api`, so without this line
        // `file-api` never enters the tracker.
        //
        // Stamp the dep on the tracker directly rather than relying
        // on `loader.import(fileApiURL)` to do it. `loader.import`'s
        // synchronous `trackRuntimeModuleDependency` call sits behind
        // a moduleShims check, the resolveImport URL rewrite, and the
        // advanceToState machine — any of which can interpose if the
        // page's loader was replaced (e.g. after
        // `BrowserManager.restartBrowser()`), which is exactly the
        // condition the file-extract test flakes under. Stamping the
        // tracker directly here is one synchronous call with no
        // moving parts.
        trackRuntimeModuleDependency(fileApiURL);
        return extractor.extract();
      },
    );
  } catch (error) {
    result = {
      status: 'error',
      searchDoc: null,
      deps: [fileDefCodeRef.module],
      error: buildFileExtractError(fileURL, error),
    };
  }
  let { deps } = snapshotRuntimeDependencies({ excludeQueryOnly: true });
  // `file-api` is merged in as well as tracked: the indexer's invalidation
  // contract requires it for file extracts, and missing it produces silent
  // never-invalidated rows, even if the tracker call above didn't land in the
  // snapshot (session ended, URL normalization mismatch). The deps are folded
  // to the form the index stores them by, as the card half of a fused payload
  // is. Unfolded, the tracker can hold `file-api` under two spellings: the URL
  // stamped above, and `@cardstack/base/file-api`, which the loader records
  // only if an import of it happens to land inside this session —
  // matrix-service imports `file-api` in the background when it is first
  // constructed — so the same file's deps would differ between extracts.
  let mergedDeps = network.virtualNetwork.unresolveURLs([
    ...(result.deps ?? []),
    ...deps,
    fileApiURL,
  ]);
  return {
    ...result,
    deps: mergedDeps,
  };
}
