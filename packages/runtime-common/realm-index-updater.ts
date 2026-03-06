import { Memoize } from 'typescript-memoize';
import {
  IndexWriter,
  Deferred,
  logger,
  systemInitiatedPriority,
  userInitiatedPriority,
  type Stats,
  type DBAdapter,
  type QueuePublisher,
  type CopyArgs,
  type CopyResult,
} from '.';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  makeIncrementalArgsWithCallerMetadata,
  mapIncrementalDoneResult,
  type IncrementalIndexEnqueueArgs,
} from './jobs/indexing';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  type FromScratchResult,
  type IncrementalDoneResult,
} from './tasks/indexer';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import ignore, { type Ignore } from 'ignore';

export class RealmIndexUpdater {
  #realm: Realm;
  #log = logger('realm-index-updater');
  #ignoreData: Record<string, string> = {};
  #stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };
  #indexWriter: IndexWriter;
  #queue: QueuePublisher;
  #indexingDeferreds = new Set<Deferred<void>>();

  constructor({
    realm,
    dbAdapter,
    queue,
  }: {
    realm: Realm;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
  }) {
    if (!dbAdapter) {
      throw new Error(
        `DB Adapter was not provided to SearchIndex constructor--this is required when using a db based index`,
      );
    }
    this.#indexWriter = new IndexWriter(dbAdapter);
    this.#queue = queue;
    this.#realm = realm;
  }

  get stats() {
    return this.#stats;
  }

  @Memoize()
  private get realmURL() {
    return new URL(this.#realm.url);
  }

  private get ignoreMap() {
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    return ignoreMap;
  }

  async isNewIndex(): Promise<boolean> {
    return await this.#indexWriter.isNewIndex(this.realmURL);
  }

  indexing() {
    if (this.#indexingDeferreds.size === 0) {
      return undefined;
    }
    return Promise.all(
      [...this.#indexingDeferreds].map((deferred) => deferred.promise),
    ).then(() => undefined);
  }

  // TODO consider triggering realm events for invalidations now that we can
  // calculate fine grained invalidations for from-scratch indexing by passing
  // in an onInvalidation callback
  async fullIndex(priority = systemInitiatedPriority) {
    let indexingDeferred = new Deferred<void>();
    this.#indexingDeferreds.add(indexingDeferred);
    let startedAt = performance.now();
    try {
      let args = {
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
      };

      this.#log.info(`Realm ${this.realmURL.href} is starting indexing`);

      let job = await this.#queue.publish<FromScratchResult>({
        jobType: 'from-scratch-index',
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
        priority,
        args,
      });
      let { ignoreData, stats } = await job.done;
      this.#stats = stats;
      this.#ignoreData = ignoreData;
      let indexingDurationSeconds = (
        (performance.now() - startedAt) /
        1000
      ).toFixed(2);
      this.#log.info(
        `Realm ${this.realmURL.href} has completed indexing in ${indexingDurationSeconds}s: ${JSON.stringify(
          stats,
          null,
          2,
        )}`,
      );
    } catch (e: any) {
      this.#log.error(`Error running from-scratch-index: ${e.message}`);
    } finally {
      indexingDeferred.fulfill();
      this.#indexingDeferreds.delete(indexingDeferred);
    }
  }

  async update(
    urls: URL[],
    opts?: {
      delete?: true;
      onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>;
      clientRequestId?: string | null;
    },
  ): Promise<void> {
    let indexingDeferred = new Deferred<void>();
    this.#indexingDeferreds.add(indexingDeferred);
    try {
      let args: IncrementalIndexEnqueueArgs = {
        changes: urls.map((url) => ({
          url: url.href,
          operation: opts?.delete ? 'delete' : 'update',
        })),
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        ignoreData: { ...this.#ignoreData },
      };
      let clientRequestId = opts?.clientRequestId ?? null;
      let job = await this.#queue.publish<IncrementalDoneResult>({
        jobType: 'incremental-index',
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority: userInitiatedPriority,
        args: makeIncrementalArgsWithCallerMetadata(args, clientRequestId),
        mapResult: mapIncrementalDoneResult(clientRequestId),
      });
      let { invalidations, ignoreData, stats } = await job.done;
      this.#stats = stats;
      this.#ignoreData = ignoreData;
      if (opts?.onInvalidation) {
        await opts.onInvalidation(
          invalidations.map((href) => new URL(href.replace(/\.json$/, ''))),
        );
      }
    } catch (e: any) {
      indexingDeferred.reject(e);
      throw e;
    } finally {
      indexingDeferred.fulfill();
      this.#indexingDeferreds.delete(indexingDeferred);
    }
  }

  async copy(
    sourceRealmURL: URL,
    onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>,
  ): Promise<void> {
    let indexingDeferred = new Deferred<void>();
    this.#indexingDeferreds.add(indexingDeferred);
    try {
      let args: CopyArgs = {
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        sourceRealmURL: sourceRealmURL.href,
      };
      let job = await this.#queue.publish<CopyResult>({
        jobType: 'copy-index',
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: 4 * 60,
        priority: userInitiatedPriority,
        args,
      });
      let { invalidations } = await job.done;
      if (onInvalidation) {
        await onInvalidation(
          invalidations.map((href) => new URL(href.replace(/\.json$/, ''))),
        );
      }
    } catch (e: any) {
      indexingDeferred.reject(e);
      throw e;
    } finally {
      indexingDeferred.fulfill();
      this.#indexingDeferreds.delete(indexingDeferred);
    }
  }

  public isIgnored(url: URL): boolean {
    // TODO this may be called before search index is ready in which case we
    // should provide a default ignore list. But really we should decouple the
    // realm's consumption of this from the search index so that the realm can
    // figure out what files are ignored before indexing has happened.
    if (
      ['node_modules'].includes(url.href.replace(/\/$/, '').split('/').pop()!)
    ) {
      return true;
    }
    return isIgnored(this.realmURL, this.ignoreMap, url);
  }
}

export function isIgnored(
  realmURL: URL,
  ignoreMap: Map<string, Ignore>,
  url: URL,
): boolean {
  if (url.href === realmURL.href) {
    return false; // you can't ignore the entire realm
  }
  if (
    [
      `${realmURL.href}.realm.json`,
      `${realmURL.href}.template-lintrc.js`,
    ].includes(url.href) ||
    url.href.startsWith(`${realmURL.href}.git/`)
  ) {
    return true;
  }
  if (ignoreMap.size === 0) {
    return false;
  }
  // Test URL against closest ignore. (Should the ignores cascade? so that the
  // child ignore extends the parent ignore?)
  let ignoreURLs = [...ignoreMap.keys()];
  let matchingIgnores = ignoreURLs.filter((u) => url.href.includes(u));
  let ignoreURL = matchingIgnores.sort((a, b) => b.length - a.length)[0] as
    | string
    | undefined;
  if (!ignoreURL) {
    return false;
  }
  let ignore = ignoreMap.get(ignoreURL)!;
  let realmPath = new RealmPaths(realmURL);
  let pathname = realmPath.local(url);
  return ignore.test(pathname).ignored;
}
