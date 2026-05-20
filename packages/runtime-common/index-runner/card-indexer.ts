import merge from 'lodash/merge';

import {
  jobIdentity,
  modulesConsumedInMeta,
  type CardResource,
  type ErrorEntry,
  type InstanceEntry,
  type InstanceErrorIndexEntry,
  type JobInfo,
  type LocalPath,
  type LooseCardResource,
  type RenderResponse,
  type TimingDiagnostics,
} from '../index';
import {
  CardError,
  coerceErrorMessage,
  isCardError,
  serializableError,
} from '../error';
import { unresolveResourceInstanceURLs } from '../url';
import type { IndexRunnerDependencyManager } from './dependency-resolver';
import { uniqueDeps } from './dependency-collections';
import { canonicalURL } from './dependency-url';

export interface CardIndexerOptions {
  path: LocalPath;
  lastModified: number;
  resourceCreatedAt: number;
  resource: LooseCardResource;
  fileURL: string;
  instanceURL: URL;
  realmURL: URL;
  auth: string;
  jobInfo: JobInfo;
  // Render result from the fused visit's cardRender pass. Always supplied
  // by the fused indexer.
  precomputedRenderResult: RenderResponse;
  // Timing / diagnostic payload attached to the fused-visit
  // response; persisted onto `boxel_index.timing_diagnostics`.
  timingDiagnostics?: TimingDiagnostics;
  dependencyResolver: IndexRunnerDependencyManager;
  updateEntry(
    instanceURL: URL,
    entry: InstanceEntry | InstanceErrorIndexEntry,
  ): Promise<void>;
  logWarn(message: string): void;
}

export async function performCardIndexing({
  path,
  lastModified,
  resourceCreatedAt,
  resource,
  fileURL: _fileURL,
  instanceURL,
  realmURL,
  auth: _auth,
  jobInfo,
  precomputedRenderResult,
  timingDiagnostics,
  dependencyResolver,
  updateEntry,
  logWarn,
}: CardIndexerOptions): Promise<void> {
  let uncaughtError: Error | undefined;
  let renderResult: RenderResponse = precomputedRenderResult;

  try {
    // we tack on data that can only be determined via access to underlying filesystem/DB
    let serialized = renderResult?.serialized;
    if (serialized) {
      merge(serialized, {
        data: {
          meta: {
            lastModified,
            resourceCreatedAt,
            realmURL: realmURL.href,
          },
        },
      });
      // Convert instance URLs (id, relationship links/data) from resolved HTTP
      // URLs to registered prefix form (e.g. @cardstack/catalog/...) so that
      // stored card data is portable across environments.
      unresolveResourceInstanceURLs(serialized.data);
    }
  } catch (err: unknown) {
    uncaughtError = uncaughtError ?? (err as Error);
  }

  if (!renderResult || ('error' in renderResult && renderResult.error)) {
    let renderError: InstanceErrorIndexEntry;

    /**
     * Normalize any combination of an optional ErrorEntry and thrown value
     * into a well-formed ErrorEntry. Handles the common case of a provided
     * entry with an error, rejects malformed entries missing error payloads,
     * and synthesizes an ErrorEntry from either a CardError or generic Error.
     */
    // The synthesized fallback message names the instance URL so the
    // persisted error doc is at least diagnosable by URL when an
    // upstream caller produced an entry with no usable message text.
    let missingMessageFallback = `Render error for ${instanceURL.href} produced no error message (upstream entry-construction site dropped the underlying render error text)`;
    let normalizeToErrorEntry = (
      entry: ErrorEntry | undefined,
      err: unknown,
    ): InstanceErrorIndexEntry => {
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
          type: 'instance-error',
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
        return { type: 'instance-error', error: serialized };
      }
      let fallback = new CardError(
        coerceErrorMessage(err, missingMessageFallback),
        { status: 500 },
      );
      fallback.stack = (err as Error)?.stack;
      return { type: 'instance-error', error: serializableError(fallback) };
    };

    renderError = normalizeToErrorEntry(renderResult?.error, uncaughtError);
    let runtimeErrorDeps = renderResult?.deps ?? [];
    let metaModuleDeps = modulesConsumedInMeta(resource.meta).map((m) =>
      canonicalURL(m, instanceURL.href),
    );
    let errorIdDep =
      renderError.error.id &&
      renderError.error.id.replace(/\.json$/, '') !== instanceURL.href
        ? [canonicalURL(renderError.error.id, instanceURL.href)]
        : undefined;

    let queryFieldPaths = dependencyResolver.extractQueryFieldRelationshipPaths(
      resource,
      (renderResult?.serialized?.data as CardResource | undefined) ?? null,
    );
    let relationshipDeps = new Set<string>([
      ...dependencyResolver.extractDirectRelationshipDeps(
        resource,
        instanceURL,
      ),
      ...dependencyResolver.extractSerializedRelationshipDeps(
        renderResult?.serialized ?? null,
        instanceURL,
      ),
      ...dependencyResolver.extractSearchDocRelationshipDeps(
        renderError.searchData ?? null,
        instanceURL,
        queryFieldPaths,
      ),
    ]);
    // Runtime deps are authoritative. Relationship deps from source/search-doc
    // remain as a direct-edge fallback for short-circuit error paths.
    renderError.error.deps = uniqueDeps(
      renderError.error.deps,
      runtimeErrorDeps,
      metaModuleDeps,
      errorIdDep,
      relationshipDeps,
    );

    if (renderError.cardType) {
      renderError.searchData = {
        ...(renderError.searchData ?? {}),
        _cardType: renderError.searchData?._cardType ?? renderError.cardType,
      };
    }

    // Index-backed error propagation augments runtime-seeded deps with
    // existing dependency errors (module cache + index rows).
    renderError = await dependencyResolver.appendIndexBackedDependencyErrors(
      renderError,
      instanceURL,
    );

    logWarn(
      `${jobIdentity(jobInfo)} encountered error indexing card instance ${path}: ${renderError.error.message}`,
    );
    await updateEntry(instanceURL, { ...renderError, timingDiagnostics });
    return;
  }

  let {
    serialized,
    searchDoc,
    displayNames,
    deps: runtimeDeps,
    types,
    isolatedHTML,
    headHTML,
    atomHTML,
    embeddedHTML,
    fittedHTML,
    iconHTML,
    markdown,
  } = renderResult;

  let deps = new Set(runtimeDeps ?? []);

  // Runtime deps are the source of truth. Use index-backed lookup only to
  // detect whether any dependency currently has an errored row.
  let dependencyError =
    await dependencyResolver.indexBackedDependencyErrorForEntry(
      deps,
      instanceURL,
    );
  if (dependencyError) {
    let normalizedDependencyError = {
      ...dependencyError,
      message: coerceErrorMessage(
        dependencyError,
        `Indexing failed because a dependency of ${instanceURL.href} is in error state`,
      ),
    };
    await updateEntry(instanceURL, {
      type: 'instance-error',
      error: normalizedDependencyError,
      searchData: searchDoc ?? undefined,
      types: types ?? undefined,
      cardType:
        typeof searchDoc?._cardType === 'string'
          ? searchDoc._cardType
          : undefined,
      timingDiagnostics,
    });
    return;
  }

  await updateEntry(instanceURL, {
    type: 'instance',
    resource: serialized!.data as CardResource,
    searchData: searchDoc!,
    isolatedHtml: isolatedHTML ?? undefined,
    headHtml: headHTML ?? undefined,
    atomHtml: atomHTML ?? undefined,
    embeddedHtml: embeddedHTML ?? undefined,
    fittedHtml: fittedHTML ?? undefined,
    iconHTML: iconHTML ?? undefined,
    markdown: markdown ?? undefined,
    lastModified,
    resourceCreatedAt,
    types: types!,
    displayNames: displayNames ?? [],
    deps,
    timingDiagnostics,
  });
}
