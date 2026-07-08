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
  type Diagnostics,
} from '../index.ts';
import {
  CardError,
  coerceErrorMessage,
  isCardError,
  serializableError,
} from '../error.ts';
import type { IndexRunnerDependencyManager } from './dependency-resolver.ts';
import { uniqueDeps } from './dependency-collections.ts';
import {
  BASE_FILE_DEF_CODE_REF,
  resolveFileDefCodeRef,
} from '../file-def-code-ref.ts';
import type { VirtualNetwork } from '../virtual-network.ts';

export interface FileIndexerOptions {
  path: LocalPath;
  fileURL: string;
  lastModified: number;
  resourceCreatedAt: number;
  hasModulePrerender?: boolean;
  // True when this file is a card-instance .json — the fused visit dual-
  // indexes those (an `instance` row plus this `file` row).
  isCardInstance?: boolean;
  realmURL: URL;
  auth: string;
  jobInfo: JobInfo;
  // Extract result from the index visit and merged render result from the
  // index + prerender-html visits. extractResult may be undefined if the
  // visit short-circuited before the fileExtract pass ran; renderResult may
  // be undefined if no visit produced a file rendering.
  precomputedExtractResult: FileExtractResponse | undefined;
  precomputedRenderResult?: FileRenderResponse;
  // Timing / diagnostic payload attached to the visit responses;
  // persisted onto `boxel_index.diagnostics` for this file's row.
  diagnostics?: Diagnostics;
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
  isCardInstance,
  realmURL: _realmURL,
  auth: _auth,
  jobInfo,
  precomputedExtractResult,
  precomputedRenderResult,
  diagnostics,
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
    await updateEntry(entryURL, { ...renderError, diagnostics });
    return 'error';
  }

  if (extractResult.error) {
    logWarn(
      `${jobIdentity(jobInfo)} extractor fallback while indexing file ${path}: ${extractResult.error.error.message}`,
    );
  }

  let fallbackTypes = fileTypeRefs.map((ref: ResolvedCodeRef) =>
    internalKeyFor(ref, undefined, virtualNetwork),
  );
  let fileTypes = extractResult.types ?? fallbackTypes;
  let deps = new Set(extractResult.deps ?? []);

  // Shared by the success entry and the dependency-error entry below, so the
  // two rows carry the same search keys. Two of them are synthetic (stamped
  // after the extractor's searchDoc so they win deterministically):
  // - `_isCardInstance` marks the `file` row of a dual-indexed card-instance
  //   .json so mixed cards+files search can exclude it (the card already
  //   appears via its `instance` row). It rides on the dependency-error entry
  //   too, so a card .json whose card is in an error state stays out of file
  //   search. Stamped only when true; plain file docs don't carry the key.
  // - `_title` is the row's display title (a file's is its name) under a
  //   neutral key that card docs also carry (stamped alongside `_cardType`
  //   during card render), so one mixed query can substring-match
  //   (`contains: {_title}`) and A-Z sort (`search_doc->>'_title'`, NULLS
  //   LAST) cards and files uniformly.
  let searchData = {
    url: fileURL,
    sourceUrl: fileURL,
    name,
    contentType,
    ...(extractResult.searchDoc ?? {}),
    ...(isCardInstance ? { _isCardInstance: true } : {}),
    _title: name,
  };

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
      searchData,
      types: fileTypes,
      diagnostics,
    });
    return 'error';
  }

  // HTML for the file entry comes from the visits' fileRender passes (icon
  // from the index visit, html formats + markdown from the prerender-html
  // visit).
  let renderResult: FileRenderResponse | undefined = precomputedRenderResult;
  if (renderResult?.error) {
    logWarn(
      `${jobIdentity(jobInfo)} file render produced error for ${path}, retaining partial HTML: ${renderResult.error.error?.message}`,
    );
  }
  // hasModulePrerender remains on the options as a hint for callers; the visit
  // itself gates fileRender, so this path does not act on it.
  void hasModulePrerender;

  // A frontmatter parse failure doesn't fail the file (it still indexes
  // body-only), so it rides on the row's diagnostics — mirroring brokenLinks —
  // where `/_indexing-errors` surfaces it for the author. Merge it onto
  // whatever render-side diagnostics the visit already produced.
  let fileDiagnostics: Diagnostics | undefined =
    extractResult.frontmatterParseError
      ? {
          ...(diagnostics ?? {}),
          frontmatterParseError: extractResult.frontmatterParseError,
        }
      : diagnostics;

  await updateEntry(entryURL, {
    type: 'file',
    lastModified,
    resourceCreatedAt,
    deps,
    resource: extractResult.resource ?? null,
    searchData,
    types: fileTypes,
    displayNames: extractResult.displayNames ?? [],
    isolatedHtml: renderResult?.isolatedHTML ?? undefined,
    headHtml: renderResult?.headHTML ?? undefined,
    atomHtml: renderResult?.atomHTML ?? undefined,
    embeddedHtml: renderResult?.embeddedHTML ?? undefined,
    fittedHtml: renderResult?.fittedHTML ?? undefined,
    iconHTML: renderResult?.iconHTML ?? undefined,
    markdown: renderResult?.markdown ?? undefined,
    diagnostics: fileDiagnostics,
  });

  return 'indexed';
}
