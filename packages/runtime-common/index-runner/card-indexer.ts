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
  type Prerenderer,
  type RealmInfo,
  type RenderResponse,
  type RenderRouteOptions,
} from '../index';
import { CardError, isCardError, serializableError } from '../error';
import type { IndexRunnerDependencyResolver } from './dependency-resolver';
import { canonicalURL } from './dependency-resolver';

interface CardIndexerOptions {
  path: LocalPath;
  lastModified: number;
  resourceCreatedAt: number;
  resource: LooseCardResource;
  fileURL: string;
  instanceURL: URL;
  realmURL: URL;
  auth: string;
  jobInfo: JobInfo;
  prerenderer: Prerenderer;
  consumeClearCacheForRender(): boolean;
  ensureRealmInfo(): Promise<RealmInfo>;
  dependencyResolver: IndexRunnerDependencyResolver;
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
  fileURL,
  instanceURL,
  realmURL,
  auth,
  jobInfo,
  prerenderer,
  consumeClearCacheForRender,
  ensureRealmInfo,
  dependencyResolver,
  updateEntry,
  logWarn,
}: CardIndexerOptions): Promise<void> {
  let uncaughtError: Error | undefined;
  let renderResult: RenderResponse | undefined;

  try {
    let clearCache = consumeClearCacheForRender();
    let prerenderOptions: RenderRouteOptions | undefined = clearCache
      ? { clearCache }
      : undefined;

    renderResult = await prerenderer.prerenderCard({
      url: fileURL,
      realm: realmURL.href,
      auth,
      renderOptions: prerenderOptions,
    });

    // we tack on data that can only be determined via access to underlying filesystem/DB
    let realmInfo = await ensureRealmInfo();
    let serialized = renderResult?.serialized;
    if (serialized) {
      merge(serialized, {
        data: {
          meta: {
            lastModified,
            resourceCreatedAt,
            realmInfo: { ...realmInfo },
            realmURL: realmURL.href,
          },
        },
      });
    }
  } catch (err: unknown) {
    uncaughtError = err as Error;
  }

  if (!renderResult || ('error' in renderResult && renderResult.error)) {
    let renderError: InstanceErrorIndexEntry;

    /**
     * Normalize any combination of an optional ErrorEntry and thrown value
     * into a well-formed ErrorEntry. Handles the common case of a provided
     * entry with an error, rejects malformed entries missing error payloads,
     * and synthesizes an ErrorEntry from either a CardError or generic Error.
     */
    let normalizeToErrorEntry = (
      entry: ErrorEntry | undefined,
      err: unknown,
    ): InstanceErrorIndexEntry => {
      if (entry?.error) {
        let normalizedError = { ...entry.error };
        normalizedError.additionalErrors =
          normalizedError.additionalErrors ?? null;
        normalizedError.status = normalizedError.status ?? 500;
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
        return { type: 'instance-error', error: serializableError(err) };
      }
      let fallback = new CardError(
        (err as Error)?.message ?? 'unknown render error',
        { status: 500 },
      );
      fallback.stack = (err as Error)?.stack;
      return { type: 'instance-error', error: serializableError(fallback) };
    };

    renderError = normalizeToErrorEntry(renderResult?.error, uncaughtError);

    if (
      renderError.error.id &&
      renderError.error.id.replace(/\.json$/, '') !== instanceURL.href
    ) {
      renderError.error.deps = renderError.error.deps ?? [];
      renderError.error.deps.push(
        canonicalURL(renderError.error.id, instanceURL.href),
      );
    }

    // always include the modules that we see in serialized as deps
    renderError.error.deps = renderError.error.deps ?? [];
    renderError.error.deps.push(
      ...modulesConsumedInMeta(resource.meta).map((m) =>
        canonicalURL(m, instanceURL.href),
      ),
    );

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
    renderError.error.deps.push(...relationshipDeps);
    renderError.error.deps = [...new Set(renderError.error.deps)];

    let [expandedModuleDeps, expandedRelationshipDeps] = await Promise.all([
      dependencyResolver.collectTransitiveModuleDeps(
        renderError.error.deps,
        instanceURL,
      ),
      dependencyResolver.collectTransitiveRelationshipDeps(relationshipDeps),
    ]);
    renderError.error.deps = [
      ...new Set([...expandedModuleDeps, ...expandedRelationshipDeps]),
    ];

    if (renderError.cardType) {
      renderError.searchData = {
        ...(renderError.searchData ?? {}),
        _cardType: renderError.searchData?._cardType ?? renderError.cardType,
      };
    }

    renderError = await dependencyResolver.appendDependencyErrors(
      renderError,
      instanceURL,
    );

    logWarn(
      `${jobIdentity(jobInfo)} encountered error indexing card instance ${path}: ${renderError.error.message}`,
    );
    await updateEntry(instanceURL, renderError);
    return;
  }

  let {
    serialized,
    searchDoc,
    displayNames,
    deps,
    types,
    isolatedHTML,
    headHTML,
    atomHTML,
    embeddedHTML,
    fittedHTML,
    iconHTML,
  } = renderResult;

  let expandedDeps = await dependencyResolver.collectExpandedDeps({
    moduleDeps: deps ?? [],
    relationshipResource:
      (serialized?.data as CardResource | undefined) ?? null,
    relationshipSourceResource: resource,
    relationshipSerialized: serialized ?? null,
    relationshipSearchDoc: searchDoc ?? null,
    relativeTo: instanceURL,
  });

  let dependencyError = await dependencyResolver.dependencyErrorForEntry(
    expandedDeps,
    instanceURL,
  );
  if (dependencyError) {
    await updateEntry(instanceURL, {
      type: 'instance-error',
      error: dependencyError,
      searchData: searchDoc ?? undefined,
      types: types ?? undefined,
      cardType:
        typeof searchDoc?._cardType === 'string'
          ? searchDoc._cardType
          : undefined,
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
    lastModified,
    resourceCreatedAt,
    types: types!,
    displayNames: displayNames ?? [],
    deps: expandedDeps,
  });
}
