import {
  inferContentType,
  internalKeyFor,
  jobIdentity,
  type ErrorEntry,
  type FileEntry,
  type FileErrorIndexEntry,
  type FileExtractResponse,
  type FileRenderResponse,
  type JobInfo,
  type LocalPath,
  type ResolvedCodeRef,
  type TimingDiagnostics,
} from '../index';
import {
  CardError,
  coerceErrorMessage,
  isCardError,
  serializableError,
} from '../error';
import type { IndexRunnerDependencyManager } from './dependency-resolver';
import { uniqueDeps } from './dependency-collections';
import {
  BASE_FILE_DEF_CODE_REF,
  resolveFileDefCodeRef,
} from '../file-def-code-ref';
import type { VirtualNetwork } from '../virtual-network';

export interface FileIndexerOptions {
  path: LocalPath;
  fileURL: string;
  lastModified: number;
  resourceCreatedAt: number;
  hasModulePrerender?: boolean;
  realmURL: URL;
  auth: string;
  jobInfo: JobInfo;
  // Extract / render results from the fused visit. extractResult may be
  // undefined if the visit short-circuited before the fileExtract pass ran;
  // renderResult may be undefined if the visit skipped fileRender (e.g. for
  // module files, which produce HTML via their own module prerender).
  precomputedExtractResult: FileExtractResponse | undefined;
  precomputedRenderResult?: FileRenderResponse;
  // Timing / diagnostic payload attached to the fused-visit response;
  // persisted onto `boxel_index.timing_diagnostics` for this file's row.
  timingDiagnostics?: TimingDiagnostics;
  dependencyResolver: IndexRunnerDependencyManager;
  virtualNetwork: VirtualNetwork;
  updateEntry(
    entryURL: URL,
    entry: FileEntry | FileErrorIndexEntry,
  ): Promise<void>;
  logWarn(message: string): void;
}

export async function performFileIndexing({
  path,
  fileURL,
  lastModified,
  resourceCreatedAt,
  hasModulePrerender,
  realmURL: _realmURL,
  auth: _auth,
  jobInfo,
  precomputedExtractResult,
  precomputedRenderResult,
  timingDiagnostics,
  dependencyResolver,
  virtualNetwork,
  updateEntry,
  logWarn,
}: FileIndexerOptions): Promise<'indexed' | 'error'> {
  let entryURL = new URL(fileURL);
  let name = path.split('/').pop() ?? path;
  let contentType = inferContentType(name);

  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL), virtualNetwork);
  let fileTypeRefs = [fileDefCodeRef];
  if (
    fileDefCodeRef.module !== BASE_FILE_DEF_CODE_REF.module ||
    fileDefCodeRef.name !== BASE_FILE_DEF_CODE_REF.name
  ) {
    fileTypeRefs.push(BASE_FILE_DEF_CODE_REF);
  }

  let extractResult: FileExtractResponse | undefined = precomputedExtractResult;
  let uncaughtError: Error | undefined;

  let missingMessageFallback = `File extract error for ${fileURL} produced no error message (upstream entry-construction site dropped the underlying extract error text)`;
  let normalizeToErrorEntry = (
    entry: ErrorEntry | undefined,
    err: unknown,
  ): FileErrorIndexEntry => {
    if (entry?.error) {
      let normalizedError = { ...entry.error };
      normalizedError.additionalErrors =
        normalizedError.additionalErrors ?? null;
      normalizedError.status = normalizedError.status ?? 500;
      normalizedError.message = coerceErrorMessage(
        normalizedError,
        coerceErrorMessage(err, missingMessageFallback),
      );
      return {
        ...entry,
        type: 'file-error',
        error: normalizedError,
      };
    }
    if (entry && !entry.error) {
      throw new CardError('ErrorEntry missing error payload', {
        status: 500,
      });
    }
    if (isCardError(err)) {
      let serialized = serializableError(err);
      serialized.message = coerceErrorMessage(
        serialized,
        missingMessageFallback,
      );
      return { type: 'file-error', error: serialized };
    }
    let fallback = new CardError(
      coerceErrorMessage(err, missingMessageFallback),
      { status: 500 },
    );
    fallback.stack = (err as Error)?.stack;
    return { type: 'file-error', error: serializableError(fallback) };
  };

  if (!extractResult || extractResult.status === 'error') {
    let renderError = normalizeToErrorEntry(
      extractResult?.error,
      uncaughtError,
    );
    let relationshipDeps = dependencyResolver.extractDirectRelationshipDeps(
      extractResult?.resource ?? null,
      entryURL,
    );
    // Runtime deps are authoritative. Direct relationship deps are fallback
    // edges for short-circuit extractor errors.
    renderError.error.deps = uniqueDeps(
      renderError.error.deps,
      [fileURL, fileDefCodeRef.module],
      extractResult?.deps,
      relationshipDeps,
    );

    logWarn(
      `${jobIdentity(jobInfo)} encountered error indexing file ${path}: ${renderError.error.message}`,
    );
    await updateEntry(entryURL, { ...renderError, timingDiagnostics });
    return 'error';
  }

  if (extractResult.error) {
    logWarn(
      `${jobIdentity(jobInfo)} extractor fallback while indexing file ${path}: ${extractResult.error.error.message}`,
    );
  }

  let fallbackTypes = fileTypeRefs.map((ref: ResolvedCodeRef) =>
    internalKeyFor(ref, undefined),
  );
  let fileTypes = extractResult.types ?? fallbackTypes;
  let deps = new Set(extractResult.deps ?? []);

  // Runtime deps are the source of truth. Use index-backed lookup only to
  // detect whether any dependency currently has an errored row.
  let dependencyError =
    await dependencyResolver.indexBackedDependencyErrorForEntry(deps, entryURL);
  if (dependencyError) {
    let normalizedDependencyError = {
      ...dependencyError,
      message: coerceErrorMessage(
        dependencyError,
        `File indexing failed because a dependency of ${fileURL} is in error state`,
      ),
    };
    await updateEntry(entryURL, {
      type: 'file-error',
      error: normalizedDependencyError,
      searchData: {
        url: fileURL,
        sourceUrl: fileURL,
        name,
        contentType,
        ...(extractResult.searchDoc ?? {}),
      },
      types: fileTypes,
      timingDiagnostics,
    });
    return 'error';
  }

  // HTML for the file entry comes from the fused visit's fileRender pass
  // (when the visit chose to run it — modules skip fileRender since their
  // module prerender already produces HTML).
  let renderResult: FileRenderResponse | undefined = precomputedRenderResult;
  if (renderResult?.error) {
    logWarn(
      `${jobIdentity(jobInfo)} file render produced error for ${path}, retaining partial HTML: ${renderResult.error.error?.message}`,
    );
  }
  // hasModulePrerender is retained on the options as a hint for callers but
  // is no longer acted on here — the fused visit already gates fileRender.
  void hasModulePrerender;

  await updateEntry(entryURL, {
    type: 'file',
    lastModified,
    resourceCreatedAt,
    deps,
    resource: extractResult.resource ?? null,
    searchData: {
      url: fileURL,
      sourceUrl: fileURL,
      name,
      contentType,
      ...(extractResult.searchDoc ?? {}),
    },
    types: fileTypes,
    displayNames: extractResult.displayNames ?? [],
    isolatedHtml: renderResult?.isolatedHTML ?? undefined,
    headHtml: renderResult?.headHTML ?? undefined,
    atomHtml: renderResult?.atomHTML ?? undefined,
    embeddedHtml: renderResult?.embeddedHTML ?? undefined,
    fittedHtml: renderResult?.fittedHTML ?? undefined,
    iconHTML: renderResult?.iconHTML ?? undefined,
    markdown: renderResult?.markdown ?? undefined,
    timingDiagnostics,
  });

  return 'indexed';
}
