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
  type Prerenderer,
  type RenderRouteOptions,
  type ResolvedCodeRef,
} from '../index';
import { CardError, isCardError, serializableError } from '../error';
import type { IndexRunnerDependencyManager } from './dependency-resolver';
import { uniqueDeps } from './dependency-collections';
import {
  BASE_FILE_DEF_CODE_REF,
  resolveFileDefCodeRef,
} from './file-def-code-ref';

interface FileIndexerOptions {
  path: LocalPath;
  fileURL: string;
  lastModified: number;
  resourceCreatedAt: number;
  hasModulePrerender?: boolean;
  realmURL: URL;
  auth: string;
  jobInfo: JobInfo;
  prerenderer: Prerenderer;
  consumeClearCacheForRender(): boolean;
  dependencyResolver: IndexRunnerDependencyManager;
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
  realmURL,
  auth,
  jobInfo,
  prerenderer,
  consumeClearCacheForRender,
  dependencyResolver,
  updateEntry,
  logWarn,
}: FileIndexerOptions): Promise<'indexed' | 'error'> {
  let entryURL = new URL(fileURL);
  let name = path.split('/').pop() ?? path;
  let contentType = inferContentType(name);

  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL));
  let fileTypeRefs = [fileDefCodeRef];
  if (
    fileDefCodeRef.module !== BASE_FILE_DEF_CODE_REF.module ||
    fileDefCodeRef.name !== BASE_FILE_DEF_CODE_REF.name
  ) {
    fileTypeRefs.push(BASE_FILE_DEF_CODE_REF);
  }

  let clearCache = consumeClearCacheForRender();
  let renderOptions: RenderRouteOptions = {
    fileExtract: true,
    fileDefCodeRef,
    ...(clearCache ? { clearCache } : {}),
  };

  let extractResult: FileExtractResponse | undefined;
  let uncaughtError: Error | undefined;
  try {
    extractResult = await prerenderer.prerenderFileExtract({
      url: fileURL,
      realm: realmURL.href,
      auth,
      renderOptions,
    });
  } catch (err: unknown) {
    uncaughtError = err as Error;
  }

  let normalizeToErrorEntry = (
    entry: ErrorEntry | undefined,
    err: unknown,
  ): FileErrorIndexEntry => {
    if (entry?.error) {
      let normalizedError = { ...entry.error };
      normalizedError.additionalErrors =
        normalizedError.additionalErrors ?? null;
      normalizedError.status = normalizedError.status ?? 500;
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
      return { type: 'file-error', error: serializableError(err) };
    }
    let fallback = new CardError(
      (err as Error)?.message ?? 'unknown file extract error',
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
    await updateEntry(entryURL, renderError);
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
    await updateEntry(entryURL, {
      type: 'file-error',
      error: dependencyError,
      searchData: {
        url: fileURL,
        sourceUrl: fileURL,
        name,
        contentType,
        ...(extractResult.searchDoc ?? {}),
      },
      types: fileTypes,
    });
    return 'error';
  }

  // Phase 2: Render HTML for file entry (non-fatal).
  // Skip for files that already have their own prerender (modules) since
  // they add significant per-file Puppeteer overhead and already produce HTML
  // through their module prerender path.
  let renderResult: FileRenderResponse | undefined;
  if (extractResult.resource && !hasModulePrerender) {
    try {
      let fileRenderOptions: RenderRouteOptions = {
        fileRender: true,
        fileDefCodeRef,
      };
      renderResult = await prerenderer.prerenderFileRender({
        url: fileURL,
        realm: realmURL.href,
        auth,
        fileData: {
          resource: extractResult.resource,
          fileDefCodeRef,
        },
        types: fileTypes,
        renderOptions: fileRenderOptions,
      });
      if (renderResult?.error) {
        logWarn(
          `${jobIdentity(jobInfo)} file render produced error for ${path}, continuing without HTML: ${renderResult.error.error?.message}`,
        );
        renderResult = undefined;
      }
    } catch (err: unknown) {
      logWarn(
        `${jobIdentity(jobInfo)} file render failed for ${path}, continuing without HTML: ${(err as Error).message}`,
      );
    }
  }

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
    displayNames: [],
    isolatedHtml: renderResult?.isolatedHTML ?? undefined,
    headHtml: renderResult?.headHTML ?? undefined,
    atomHtml: renderResult?.atomHTML ?? undefined,
    embeddedHtml: renderResult?.embeddedHTML ?? undefined,
    fittedHtml: renderResult?.fittedHTML ?? undefined,
    iconHTML: renderResult?.iconHTML ?? undefined,
  });

  return 'indexed';
}
