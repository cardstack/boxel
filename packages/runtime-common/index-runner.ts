import ignore, { type Ignore } from 'ignore';

import { Memoize } from 'typescript-memoize';

import {
  logger,
  hasExecutableExtension,
  SupportedMimeType,
  jobIdentity,
  Deferred,
  RealmPaths,
  type IndexWriter,
  type ResolvedCodeRef,
  type Batch,
  type LooseCardResource,
  type InstanceEntry,
  type InstanceErrorIndexEntry,
  type RealmInfo,
  type FromScratchResult,
  type IncrementalResult,
  type LastModifiedTimes,
  type JobInfo,
  type Prerenderer,
  type LocalPath,
  type Reader,
  type Stats,
} from './index';
import type { CacheScope, DefinitionLookup } from './definition-lookup';
import { isCardError } from './error';
import { IndexRunnerDependencyManager } from './index-runner/dependency-resolver';
import { discoverInvalidations } from './index-runner/discover-invalidations';
import { visitFileForIndexing } from './index-runner/visit-file';
import { performCardIndexing } from './index-runner/card-indexer';
import { performFileIndexing } from './index-runner/file-indexer';

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
  #moduleCacheContext?: {
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    authUserId: string;
  };
  #realmOwnerUserId: string;
  #definitionLookup: DefinitionLookup;
  #jobInfo: JobInfo;
  #dependencyResolver: IndexRunnerDependencyManager;
  #reportStatus?: (
    jobInfo: JobInfo | undefined,
    status: 'start' | 'finish',
  ) => void;
  readonly stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };
  #shouldClearCacheForNextRender = true;

  constructor({
    realmURL,
    reader,
    indexWriter,
    definitionLookup,
    ignoreData = {},
    jobInfo,
    reportStatus,
    prerenderer,
    auth,
    fetch,
    realmOwnerUserId,
  }: {
    realmURL: URL;
    reader: Reader;
    indexWriter: IndexWriter;
    definitionLookup: DefinitionLookup;
    ignoreData?: Record<string, string>;
    prerenderer: Prerenderer;
    auth: string;
    fetch: typeof globalThis.fetch;
    realmOwnerUserId: string;
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
    this.#realmOwnerUserId = realmOwnerUserId;
    this.#definitionLookup = definitionLookup;
    this.#dependencyResolver = new IndexRunnerDependencyManager({
      realmURL: this.#realmURL,
      readModuleCacheEntries: async (moduleIds) => {
        if (moduleIds.length === 0) {
          return {};
        }
        let { resolvedRealmURL, cacheScope, authUserId } =
          await this.getModuleCacheContext();
        return await this.#definitionLookup.getModuleCacheEntries({
          moduleUrls: moduleIds,
          cacheScope,
          authUserId,
          resolvedRealmURL,
        });
      },
      getDependencyRows: async (urls) =>
        await this.batch.getDependencyRows(urls),
      getInvalidations: () => this.#batch?.invalidations ?? [],
    });
  }

  static async fromScratch(current: IndexRunner): Promise<FromScratchResult> {
    current.#dependencyResolver.reset();
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
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
      );
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
    current.#dependencyResolver.reset();
    let start = Date.now();
    current.#log.debug(
      `${jobIdentity(current.#jobInfo)} starting from incremental indexing for ${urls.map((u) => u.href).join()}`,
    );

    current.#batch = await current.#indexWriter.createBatch(
      current.realmURL,
      current.#jobInfo,
    );
    urls.forEach((url) =>
      current.#dependencyResolver.invalidateRelationshipDependencyRowCache(url),
    );
    await current.batch.invalidate(urls);
    let invalidations = sortInvalidations(
      current.batch.invalidations.map((href) => new URL(href)),
    );
    invalidations =
      await current.#dependencyResolver.orderInvalidationsByDependencies(
        invalidations,
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

  private async ensureRealmInfo(): Promise<RealmInfo> {
    if (!this.#realmInfo) {
      let realmInfoURL = `${this.realmURL}_info`;
      let realmInfoResponse = await this.#fetch(realmInfoURL, {
        method: 'QUERY',
        headers: { Accept: SupportedMimeType.RealmInfo },
      });
      if (!realmInfoResponse.ok) {
        let body = '<unable to read response body>';
        try {
          body = await realmInfoResponse.text();
        } catch (_err) {
          // fall back to placeholder body text
        }
        throw new Error(
          `Failed to load realm info for indexing from ${realmInfoURL}: ` +
            `${realmInfoResponse.status} ${realmInfoResponse.statusText}. ` +
            `Response body: ${body}`,
        );
      }
      let payload: unknown;
      try {
        payload = await realmInfoResponse.json();
      } catch (err: unknown) {
        throw new Error(
          `Failed to parse realm info response from ${realmInfoURL} as JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.#realmInfo = (
        payload as { data?: { attributes?: RealmInfo } }
      )?.data?.attributes;
    }
    if (!this.#realmInfo) {
      throw new Error('Unable to load realm info for indexing');
    }
    return this.#realmInfo;
  }

  private async getModuleCacheContext() {
    if (this.#moduleCacheContext) {
      return this.#moduleCacheContext;
    }
    let realmInfo = await this.ensureRealmInfo();
    let isPublic = realmInfo.visibility === 'public';
    this.#moduleCacheContext = {
      resolvedRealmURL: this.realmURL.href,
      cacheScope: isPublic ? 'public' : 'realm-auth',
      authUserId: isPublic ? '' : this.#realmOwnerUserId,
    };
    return this.#moduleCacheContext;
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
    return await discoverInvalidations({
      url,
      indexMtimes,
      reader: this.#reader,
      batch: this.batch,
      ignoreMap: this.ignoreMap,
      ignoreData: this.#ignoreData,
      jobInfo: this.#jobInfo,
      logDebug: (message) => this.#log.debug(message),
      perfDebug: (message) => this.#perfLog.debug(message),
    });
  }

  private async visitFile(url: URL): Promise<void> {
    await visitFileForIndexing({
      url,
      realmURL: this.#realmURL,
      ignoreMap: this.ignoreMap,
      realmPaths: this.#realmPaths,
      reader: this.#reader,
      batch: this.batch,
      jobInfo: this.#jobInfo,
      logDebug: (message) => this.#log.debug(message),
      logWarn: (message) => this.#log.warn(message),
      indexCard: async (args) => await this.indexCard(args),
      indexFile: async (args) => await this.indexFile(args),
    });
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
      await performCardIndexing({
        path,
        lastModified,
        resourceCreatedAt,
        resource,
        fileURL,
        instanceURL,
        realmURL: this.#realmURL,
        auth: this.#auth,
        jobInfo: this.#jobInfo,
        prerenderer: this.#prerenderer,
        consumeClearCacheForRender: () => this.#consumeClearCacheForRender(),
        ensureRealmInfo: () => this.ensureRealmInfo(),
        dependencyResolver: this.#dependencyResolver,
        updateEntry: async (entryURL, entry) =>
          await this.updateEntry(entryURL, entry),
        logWarn: (message) => this.#log.warn(message),
      });
    } finally {
      deferred?.fulfill();
      this.reportStatus('finish', fileURL, resource);
    }
  }

  private async indexFile({
    path,
    lastModified,
    resourceCreatedAt,
    hasModulePrerender,
  }: {
    path: LocalPath;
    lastModified: number;
    resourceCreatedAt: number;
    hasModulePrerender?: boolean;
  }): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let result = await performFileIndexing({
      path,
      fileURL,
      lastModified,
      resourceCreatedAt,
      hasModulePrerender,
      realmURL: this.#realmURL,
      auth: this.#auth,
      jobInfo: this.#jobInfo,
      prerenderer: this.#prerenderer,
      consumeClearCacheForRender: () => this.#consumeClearCacheForRender(),
      dependencyResolver: this.#dependencyResolver,
      updateEntry: async (entryURL, entry) => {
        await this.batch.updateEntry(entryURL, entry);
        this.#dependencyResolver.invalidateRelationshipDependencyRowCache(
          entryURL,
        );
      },
      logWarn: (message) => this.#log.warn(message),
    });

    if (result === 'indexed') {
      this.stats.filesIndexed++;
    } else {
      this.stats.fileErrors++;
    }
  }

  private async updateEntry(
    instanceURL: URL,
    entry: InstanceEntry | InstanceErrorIndexEntry,
  ) {
    let normalizedURL = assertURLEndsWithJSON(instanceURL);
    await this.batch.updateEntry(normalizedURL, entry);
    this.#dependencyResolver.invalidateRelationshipDependencyRowCache(
      normalizedURL,
    );
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
  // sort invalidations so that .json files are visited after their non-.json counterparts,
  // which allows us to have the file entry in place before we visit the card JSON and need to render it.
  // among URLs that both do or both don't end with .json, sort lexically by href for consistency.
  return urls.sort((a, b) => {
    let aJson = a.href.endsWith('.json');
    let bJson = b.href.endsWith('.json');
    if (aJson === bJson) {
      return a.href.localeCompare(b.href);
    }
    return aJson ? 1 : -1;
  });
}
