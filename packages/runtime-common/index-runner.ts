import ignore, { type Ignore } from 'ignore';

import merge from 'lodash/merge';

import { Memoize } from 'typescript-memoize';

import {
  logger,
  isCardResource,
  hasExecutableExtension,
  SupportedMimeType,
  unixTime,
  jobIdentity,
  modulesConsumedInMeta,
  Deferred,
  RealmPaths,
  isIgnored,
  type IndexWriter,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type ResolvedCodeRef,
  type Batch,
  type LooseCardResource,
  type InstanceEntry,
  type ErrorEntry,
  type RealmInfo,
  type FromScratchResult,
  type IncrementalResult,
  type CardResource,
  type LastModifiedTimes,
  type JobInfo,
  type Prerenderer,
  type RenderRouteOptions,
  type LocalPath,
  type Reader,
  type Stats,
  baseRealm,
} from './index';
import { inferContentType } from './infer-content-type';
import { CardError, isCardError, serializableError } from './error';

const FILEDEF_CODE_REF_BY_EXTENSION: Record<string, ResolvedCodeRef> = {
  // TODO: Replace with realm metadata configuration.
  '.mismatch': { module: './filedef-mismatch', name: 'FileDef' },
};

function resolveFileDefCodeRef(fileURL: URL): ResolvedCodeRef {
  let name = fileURL.pathname.split('/').pop() ?? '';
  let dot = name.lastIndexOf('.');
  let extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  let mapping = extension ? FILEDEF_CODE_REF_BY_EXTENSION[extension] : undefined;
  if (!mapping) {
    return { module: `${baseRealm.url}file-api`, name: 'FileDef' };
  }
  if (mapping.module.includes('://')) {
    return mapping;
  }
  return {
    ...mapping,
    module: new URL(mapping.module, fileURL).href,
  };
}

function canonicalURL(url: string, relativeTo?: string): string {
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}

export class IndexRunner {
  #indexingInstances = new Map<string, Promise<void>>();
  #reader: Reader;
  #indexWriter: IndexWriter;
  #batch: Batch | undefined;
  #log = logger('index-runner');
  #fetch: typeof globalThis.fetch;
  #perfLog = logger('index-perf');
  #realmPaths: RealmPaths;
  #ignoreData: Record<string, string>;
  #prerenderer: Prerenderer;
  #auth: string;
  #realmURL: URL;
  #realmInfo?: RealmInfo;
  #jobInfo: JobInfo;
  #reportStatus?: (
    jobInfo: JobInfo | undefined,
    status: 'start' | 'finish',
  ) => void;
  readonly stats: Stats = {
    instancesIndexed: 0,
    modulesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };
  #shouldClearCacheForNextRender = true;

  constructor({
    realmURL,
    reader,
    indexWriter,
    ignoreData = {},
    jobInfo,
    reportStatus,
    prerenderer,
    auth,
    fetch,
  }: {
    realmURL: URL;
    reader: Reader;
    indexWriter: IndexWriter;
    ignoreData?: Record<string, string>;
    prerenderer: Prerenderer;
    auth: string;
    fetch: typeof globalThis.fetch;
    jobInfo?: JobInfo;
    reportStatus?(
      jobInfo: JobInfo | undefined,
      status: 'start' | 'finish',
    ): void;
  }) {
    this.#indexWriter = indexWriter;
    this.#realmPaths = new RealmPaths(realmURL);
    this.#reader = reader;
    this.#realmURL = realmURL;
    this.#ignoreData = ignoreData;
    this.#jobInfo = jobInfo ?? { jobId: -1, reservationId: -1 };
    this.#reportStatus = reportStatus;
    this.#prerenderer = prerenderer;
    this.#auth = auth;
    this.#fetch = fetch;
  }

  static async fromScratch(current: IndexRunner): Promise<FromScratchResult> {
    let start = Date.now();
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing`,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} starting from scratch indexing for realm ${current.realmURL.href}`,
    );
    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#jobInfo,
    );
    let invalidations: URL[] = [];
    let mtimesStart = Date.now();
    let mtimes = await current.batch.getModifiedTimes();
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed getting index mtimes in ${Date.now() - mtimesStart} ms`,
    );
    let invalidateStart = Date.now();
    invalidations = (
      await current.discoverInvalidations(current.realmURL, mtimes)
    ).map((href) => new URL(href));
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed invalidations in ${Date.now() - invalidateStart} ms`,
    );

    let visitStart = Date.now();
    invalidations = sortInvalidations(invalidations);
    for (let invalidation of invalidations) {
      await current.tryToVisit(invalidation);
    }
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed index visit in ${Date.now() - visitStart} ms`,
    );
    let finalizeStart = Date.now();
    let { totalIndexEntries } = await current.batch.done();
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed index finalization in ${Date.now() - finalizeStart} ms`,
    );
    current.stats.totalIndexEntries = totalIndexEntries;
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} completed from scratch indexing in ${Date.now() - start}ms`,
    );
    current.#perfLog.debug(
      `${jobIdentity(current.#jobInfo)} completed from scratch indexing for realm ${
        current.realmURL.href
      } in ${Date.now() - start} ms`,
    );
    return {
      ignoreData: current.#ignoreData,
      stats: current.stats,
    };
  }

  static async incremental(
    current: IndexRunner,
    {
      urls,
      operation,
    }: {
      urls: URL[];
      operation: 'update' | 'delete';
    },
  ): Promise<IncrementalResult> {
    let start = Date.now();
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from incremental indexing for ${urls.map((u) => u.href).join()}`,
    );

    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#jobInfo,
    );
    await current.batch.invalidate(urls);
    let invalidations = sortInvalidations(
      current.batch.invalidations.map((href) => new URL(href)),
    );
    let hasExecutableInvalidation = invalidations.some((url) =>
      hasExecutableExtension(url.href),
    );
    if (hasExecutableInvalidation) {
      if (!current.#shouldClearCacheForNextRender) {
        current.#log.debug(
          `${jobIdentity(current.#jobInfo)} detected executable invalidation, scheduling loader reset`,
        );
      }
      current.#scheduleClearCacheForNextRender();
    }

    let hrefs = urls.map((u) => u.href);
    for (let invalidation of invalidations) {
      if (operation === 'delete' && hrefs.includes(invalidation.href)) {
        // file is deleted, there is nothing to visit
      } else {
        await current.tryToVisit(invalidation);
      }
    }

    let { totalIndexEntries } = await current.batch.done();
    current.stats.totalIndexEntries = totalIndexEntries;

    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} completed incremental indexing for ${urls.map((u) => u.href).join()} in ${
        Date.now() - start
      }ms`,
    );
    return {
      invalidations: [...invalidations].map((url) => url.href),
      ignoreData: current.#ignoreData,
      stats: current.stats,
    };
  }

  private async tryToVisit(url: URL) {
    try {
      await this.visitFile(url);
    } catch (err: any) {
      if (isCardError(err) && err.status === 404) {
        this.#log.info(
          `${jobIdentity(this.#jobInfo)} tried to visit file ${url.href}, but it no longer exists`,
        );
      } else {
        throw err;
      }
    }
  }

  private get batch() {
    if (!this.#batch) {
      throw new Error('Batch is missing');
    }
    return this.#batch;
  }

  get realmURL() {
    return this.#realmURL;
  }

  #scheduleClearCacheForNextRender() {
    this.#shouldClearCacheForNextRender = true;
  }

  #consumeClearCacheForRender(): boolean {
    if (!this.#shouldClearCacheForNextRender) {
      return false;
    }
    this.#shouldClearCacheForNextRender = false;
    return true;
  }

  @Memoize()
  private get ignoreMap() {
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    return ignoreMap;
  }

  private async discoverInvalidations(
    url: URL,
    indexMtimes: LastModifiedTimes,
  ): Promise<string[]> {
    this.#log.debug(
      `${jobIdentity(this.#jobInfo)} discovering invalidations in dir ${url.href}`,
    );
    this.#perfLog.debug(
      `${jobIdentity(this.#jobInfo)} discovering invalidations in dir ${url.href}`,
    );
    let mtimesStart = Date.now();
    let filesystemMtimes = await this.#reader.mtimes();
    this.#perfLog.debug(
      `${jobIdentity(this.#jobInfo)} time to get file system mtimes ${Date.now() - mtimesStart} ms`,
    );

    let ignoreFile = new URL('.gitignore', url).href;
    // it costs about 10 sec to try to get the ignore file when it doesn't
    // exist, so don't get it if it's not there.
    if (filesystemMtimes[ignoreFile]) {
      let ignoreStart = Date.now();
      let ignorePatterns = await this.#reader.readFile(new URL(ignoreFile));
      this.#perfLog.debug(
        `time to get ignore rules ${Date.now() - ignoreStart} ms`,
      );
      if (ignorePatterns && ignorePatterns.content) {
        this.ignoreMap.set(url.href, ignore().add(ignorePatterns.content));
        this.#ignoreData[url.href] = ignorePatterns.content;
      }
    } else {
      this.#perfLog.debug(
        `${jobIdentity(this.#jobInfo)} skip getting the ignore file--there is nothing to ignore`,
      );
    }

    let invalidationList: string[] = [];
    let skipList: string[] = [];
    for (let [url, lastModified] of Object.entries(filesystemMtimes)) {
      let indexEntry = indexMtimes.get(url);

      if (
        !indexEntry ||
        indexEntry.type.endsWith('-error') ||
        indexEntry.lastModified == null ||
        lastModified !== indexEntry.lastModified
      ) {
        invalidationList.push(url);
      } else {
        skipList.push(url);
      }
    }
    if (skipList.length === 0) {
      // the whole realm needs to be visited, no need to calculate
      // invalidations--it's everything
      return invalidationList;
    }

    // Check for deleted files - files that exist in index but not on filesystem
    let indexedUrls = [...indexMtimes.keys()];
    let deletedUrls = indexedUrls.filter((url) => !filesystemMtimes[url]);
    if (deletedUrls.length > 0) {
      this.#perfLog.debug(
        `${jobIdentity(this.#jobInfo)} found ${deletedUrls.length} deleted files to add to invalidations: ${deletedUrls.join(', ')}`,
      );
      invalidationList.push(...deletedUrls);
    }

    let invalidationStart = Date.now();
    await this.batch.invalidate(invalidationList.map((u) => new URL(u)));
    this.#perfLog.debug(
      `${jobIdentity(this.#jobInfo)} time to invalidate ${url} ${Date.now() - invalidationStart} ms`,
    );
    return this.batch.invalidations;
  }

  private async visitFile(url: URL): Promise<void> {
    if (isIgnored(this.#realmURL, this.ignoreMap, url)) {
      return;
    }
    let start = Date.now();
    this.#log.debug(
      `${jobIdentity(this.#jobInfo)} begin visiting file ${url.href}`,
    );
    let localPath: string;
    try {
      localPath = this.#realmPaths.local(url);
    } catch (e) {
      // until we have cross realm invalidation, if our invalidation
      // graph cross a realm just skip over the file. it will be out
      // of date, but such is life...
      this.#log.debug(
        `${jobIdentity(this.#jobInfo)} Visit of ${url.href} cannot be performed as it is in a different realm than the realm whose contents are being invalidated (${this.realmURL.href})`,
      );
      return;
    }

    let fileRef = await this.#reader.readFile(url);
    if (!fileRef) {
      fileRef = await this.#reader.readFile(new URL(encodeURI(localPath), url));
    }
    if (!fileRef) {
      let error = new CardError(`missing file ${url.href}`, { status: 404 });
      error.deps = [url.href];
      throw error;
    }
    let { content, lastModified } = fileRef;
    // ensure created_at exists for this file and use it for resourceCreatedAt
    let resourceCreatedAt = await this.batch.ensureFileCreatedAt(localPath);
    if (hasExecutableExtension(url.href)) {
      await this.indexModule(url);
    } else if (url.href.endsWith('.json')) {
      let resource;

      try {
        let { data } = JSON.parse(content);
        resource = data;
      } catch (e) {
        this.#log.warn(
          `${jobIdentity(this.#jobInfo)} unable to parse ${url.href} as card JSON`,
        );
      }

      if (resource && isCardResource(resource)) {
        if (lastModified == null) {
          this.#log.warn(
            `${jobIdentity(this.#jobInfo)} No lastModified date available for ${url.href}, using current time`,
          );
          lastModified = unixTime(Date.now());
        }
        await this.indexCard({
          path: localPath,
          lastModified,
          resourceCreatedAt,
          resource,
        });
        // Intentionally fall through so card JSON files also get a file entry.
      }
    }

    if (lastModified == null) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} No lastModified date available for ${url.href}, using current time`,
      );
      lastModified = unixTime(Date.now());
    }
    await this.indexFile({
      path: localPath,
      lastModified,
      resourceCreatedAt,
    });
    this.#log.debug(
      `${jobIdentity(this.#jobInfo)} completed visiting file ${url.href} in ${Date.now() - start}ms`,
    );
  }

  private async indexModule(url: URL): Promise<void> {
    let clearCache = this.#consumeClearCacheForRender();
    let prerenderOptions: RenderRouteOptions | undefined = clearCache
      ? { clearCache }
      : undefined;
    let moduleResult: ModuleRenderResponse;
    try {
      moduleResult = await this.#prerenderer.prerenderModule({
        url: url.href,
        realm: this.#realmURL.href,
        auth: this.#auth,
        renderOptions: prerenderOptions,
      });
    } catch (err: any) {
      this.stats.moduleErrors++;
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} encountered error rendering module "${url.href}": ${err.message}`,
      );
      await this.batch.updateEntry(url, {
        type: 'module-error',
        error: {
          status: err.status ?? 500,
          message: `encountered error rendering module "${url.href}": ${err.message}`,
          additionalErrors: [serializableError(err)],
        },
      });
      return;
    }

    let {
      isShimmed,
      error,
      lastModified,
      createdAt: resourceCreatedAt,
      deps,
    } = moduleResult;

    if (error) {
      this.stats.moduleErrors++;
      await this.batch.updateEntry(url, { ...error, type: 'module-error' });
      return;
    }

    if (!isShimmed) {
      await this.batch.updateEntry(url, {
        type: 'module',
        lastModified,
        resourceCreatedAt,
        deps: new Set(deps),
      });
      this.stats.modulesIndexed++;
    }
  }

  private reportStatus(
    status: 'start' | 'finish',
    url: string,
    resource: LooseCardResource,
  ) {
    this.#reportStatus?.(
      {
        ...this.#jobInfo,
        url,
        realm: this.#realmURL.href,
        deps: [
          new URL((resource.meta.adoptsFrom as ResolvedCodeRef).module, url)
            .href,
        ],
      },
      status,
    );
  }

  private async indexCard({
    path,
    lastModified,
    resourceCreatedAt,
    resource,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    resource: LooseCardResource;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, ''),
    );
    this.reportStatus('start', fileURL, resource);
    let deferred: Deferred<void> | undefined;
    try {
      let indexingInstance = this.#indexingInstances.get(fileURL);
      if (indexingInstance) {
        return await indexingInstance;
      }
      deferred = new Deferred<void>();
      this.#indexingInstances.set(fileURL, deferred.promise);
      let uncaughtError: Error | undefined;
      let renderResult: RenderResponse | undefined;
      try {
        let clearCache = this.#consumeClearCacheForRender();
        let prerenderOptions: RenderRouteOptions | undefined = clearCache
          ? { clearCache }
          : undefined;
        renderResult = await this.#prerenderer.prerenderCard({
          url: fileURL,
          realm: this.#realmURL.href,
          auth: this.#auth,
          renderOptions: prerenderOptions,
        });

        // we tack on data that can only be determined via access to underlying filesystem/DB
        if (!this.#realmInfo) {
          let realmInfoResponse = await this.#fetch(`${this.realmURL}_info`, {
            headers: { Accept: SupportedMimeType.RealmInfo },
          });
          this.#realmInfo = (await realmInfoResponse.json())?.data?.attributes;
        }

        let serialized = renderResult?.serialized;
        if (serialized) {
          merge(serialized, {
            data: {
              meta: {
                lastModified,
                resourceCreatedAt,
                realmInfo: { ...this.#realmInfo },
                realmURL: this.realmURL.href,
              },
            },
          });
        }
      } catch (err: any) {
        uncaughtError = err;
      }

      if (!renderResult || ('error' in renderResult && renderResult.error)) {
        let renderError = renderResult?.error;

        /**
         * Normalize any combination of an optional ErrorEntry and thrown value
         * into a well-formed ErrorEntry. Handles the common case of a provided
         * entry with an error, rejects malformed entries missing error payloads,
         * and synthesizes an ErrorEntry from either a CardError or generic Error.
         */
        let normalizeToErrorEntry = (
          entry: ErrorEntry | undefined,
          err: unknown,
        ): ErrorEntry => {
          if (entry?.error) {
            let normalizedError = { ...entry.error };
            normalizedError.additionalErrors =
              normalizedError.additionalErrors ?? null;
            normalizedError.status = normalizedError.status ?? 500;
            return {
              ...entry,
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

        renderError = normalizeToErrorEntry(renderError, uncaughtError);

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
        renderError.error.deps = [...new Set(renderError.error.deps)];

        if (renderError.cardType) {
          renderError.searchData = {
            ...(renderError.searchData ?? {}),
            _cardType:
              renderError.searchData?._cardType ?? renderError.cardType,
          };
        }

        this.#log.warn(
          `${jobIdentity(this.#jobInfo)} encountered error indexing card instance ${path}: ${renderError.error.message}`,
        );
        await this.updateEntry(instanceURL, renderError);
        return;
      } else {
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
        await this.updateEntry(instanceURL, {
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
          deps: new Set(deps ?? []),
        });
        return;
      }
    } finally {
      deferred?.fulfill();
      this.reportStatus('finish', fileURL, resource);
    }
  }

  private async indexFile({
    path,
    lastModified,
    resourceCreatedAt,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let entryURL = new URL(fileURL);
    let name = path.split('/').pop() ?? path;
    let contentType = inferContentType(name);
    let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL));
    let clearCache = this.#consumeClearCacheForRender();
    let renderOptions: RenderRouteOptions = {
      fileExtract: true,
      fileDefCodeRef,
      ...(clearCache ? { clearCache } : {}),
    };

    let extractResult: FileExtractResponse | undefined;
    let uncaughtError: Error | undefined;
    try {
      extractResult = await this.#prerenderer.prerenderFileExtract({
        url: fileURL,
        realm: this.#realmURL.href,
        auth: this.#auth,
        renderOptions,
      });
    } catch (err: any) {
      uncaughtError = err;
    }

    let normalizeToErrorEntry = (
      entry: ErrorEntry | undefined,
      err: unknown,
    ): ErrorEntry => {
      if (entry?.error) {
        let normalizedError = { ...entry.error };
        normalizedError.additionalErrors =
          normalizedError.additionalErrors ?? null;
        normalizedError.status = normalizedError.status ?? 500;
        return {
          ...entry,
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
      renderError.error.deps = renderError.error.deps ?? [];
      renderError.error.deps.push(fileURL, fileDefCodeRef.module);
      if (extractResult?.deps) {
        renderError.error.deps.push(...extractResult.deps);
      }
      renderError.error.deps = [...new Set(renderError.error.deps)];

      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} encountered error indexing file ${path}: ${renderError.error.message}`,
      );
      await this.batch.updateEntry(entryURL, renderError);
      this.stats.fileErrors++;
      return;
    }

    if (extractResult.error) {
      this.#log.warn(
        `${jobIdentity(this.#jobInfo)} extractor fallback while indexing file ${path}: ${extractResult.error.error.message}`,
      );
    }

    await this.batch.updateEntry(entryURL, {
      type: 'file',
      lastModified,
      resourceCreatedAt,
      deps: new Set([...(extractResult.deps ?? []), fileURL]),
      searchData: {
        url: fileURL,
        sourceUrl: fileURL,
        name,
        contentType,
        ...(extractResult.searchDoc ?? {}),
      },
      types: [],
      displayNames: [],
    });
    this.stats.filesIndexed++;
  }

  private async updateEntry(
    instanceURL: URL,
    entry: InstanceEntry | ErrorEntry,
  ) {
    await this.batch.updateEntry(assertURLEndsWithJSON(instanceURL), entry);
    if (entry.type === 'instance') {
      this.stats.instancesIndexed++;
    } else {
      this.stats.instanceErrors++;
    }
  }
}

function assertURLEndsWithJSON(url: URL): URL {
  if (!url.href.endsWith('.json')) {
    return new URL(`${url}.json`);
  }
  return url;
}

function sortInvalidations(urls: URL[]): URL[] {
  return urls.sort((a, b) => {
    let aExec = hasExecutableExtension(a.href);
    let bExec = hasExecutableExtension(b.href);
    if (aExec === bExec) {
      return a.href.localeCompare(b.href);
    }
    return aExec ? -1 : 1;
  });
}
