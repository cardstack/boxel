import {
  IndexWriter,
  Deferred,
  type Job,
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
import { enqueueReindexRealmJob } from './jobs/reindex-realm';
import type { FromScratchResult, IncrementalDoneResult } from './tasks/indexer';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import ignore, { type Ignore } from 'ignore';

export class RealmIndexUpdater {
  #realm: Realm;
  #realmURL: URL | undefined;
  #log = logger('realm-index-updater');
  #ignoreData: Record<string, string> = {};
  // Bumped every time a from-scratch result writes #ignoreData. Concurrent
  // incrementals capture this version when they snapshot #ignoreData; if a
  // from-scratch lands between snapshot and incremental completion, the
  // incremental's stale result is dropped on the floor instead of clobbering
  // the fresher data. This is reachable now that incrementals can be queued
  // alongside an in-flight from-scratch (the write-path gate only awaits
  // incremental + copy jobs, not from-scratch).
  #ignoreDataVersion = 0;
  #stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };
  #indexWriter: IndexWriter;
  #dbAdapter: DBAdapter;
  #queue: QueuePublisher;
  // Tracked separately so the realm write-path can wait only for incremental
  // (and copy) jobs — the ones whose race against concurrent file writes the
  // gate exists to serialize. From-scratch jobs are tracked too, but only so
  // that callers wanting "all indexing has settled" semantics (e.g. publish)
  // continue to see them via `indexing()`.
  #incrementalIndexingDeferreds = new Set<Deferred<void>>();
  #fullIndexingDeferreds = new Set<Deferred<void>>();

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
    this.#dbAdapter = dbAdapter;
    this.#indexWriter = new IndexWriter(dbAdapter);
    this.#queue = queue;
    this.#realm = realm;
  }

  get stats() {
    return this.#stats;
  }

  private get realmURL() {
    return (this.#realmURL ??= new URL(this.#realm.url));
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

  // Awaits every queued/in-flight indexing job — incremental, copy, and
  // from-scratch. Use this when you genuinely need all indexing to settle
  // (e.g. before publishing a realm). For the realm write-path gate use
  // `incrementalIndexing()` instead: blocking writes on from-scratch is
  // unsafe under reindex storms (a queued from-scratch can sit behind
  // hundreds of jobs and stall every PATCH for hours).
  indexing() {
    let pending = [
      ...this.#incrementalIndexingDeferreds,
      ...this.#fullIndexingDeferreds,
    ];
    if (pending.length === 0) {
      return undefined;
    }
    return Promise.all(pending.map((deferred) => deferred.promise)).then(
      () => undefined,
    );
  }

  // Awaits only incremental and copy jobs — the ones whose file/index race
  // the write-path gate exists to serialize. From-scratch jobs are excluded
  // because workers read files independently of realm-server writes and each
  // row write is atomic; a from-scratch sitting queued behind a system-wide
  // reindex must not block user PATCHes.
  incrementalIndexing() {
    if (this.#incrementalIndexingDeferreds.size === 0) {
      return undefined;
    }
    return Promise.all(
      [...this.#incrementalIndexingDeferreds].map(
        (deferred) => deferred.promise,
      ),
    ).then(() => undefined);
  }

  publishFullIndex(
    priority = systemInitiatedPriority,
    opts?: { clearLastModified?: boolean },
  ): {
    published: Promise<Job<FromScratchResult>>;
    completed: Promise<FromScratchResult>;
  } {
    let indexingDeferred = new Deferred<void>();
    this.#fullIndexingDeferreds.add(indexingDeferred);
    let startedAt = performance.now();

    this.#log.info(`Realm ${this.realmURL.href} is starting indexing`);
    let published = (async () => {
      let job = await enqueueReindexRealmJob(
        this.#realm.url,
        await this.#realm.getRealmOwnerUsername(),
        this.#queue,
        this.#dbAdapter,
        priority,
        {
          clearLastModified: opts?.clearLastModified,
        },
      );
      return job;
    })();

    let completed = published
      .then(async (job) => {
        let result = await job.done;
        let { ignoreData, stats } = result;
        this.#stats = stats;
        this.#ignoreData = ignoreData;
        this.#ignoreDataVersion++;
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
        return result;
      })
      .finally(() => {
        indexingDeferred.fulfill();
        this.#fullIndexingDeferreds.delete(indexingDeferred);
      });

    return {
      published,
      completed,
    };
  }

  async fullIndex(priority = systemInitiatedPriority) {
    let { completed } = this.publishFullIndex(priority);
    try {
      await completed;
    } catch (e: any) {
      this.#log.error(`Error running from-scratch-index: ${e.message}`);
      // Preserve the historical fullIndex() behavior for fire-and-forget
      // callers such as startup.
    }
  }

  // Two-phase incremental update. Returns once the job is durably enqueued
  // (the queue insert into Postgres has landed), with `settled` exposing the
  // promise that resolves when the worker finishes and the optional
  // onInvalidation/onSettled hooks run. Pre-enqueue failures
  // (getRealmOwnerUsername, queue.publish) reject from this method so the
  // caller knows the work was never queued and the realm is still
  // consistent. Worker-time and post-worker failures reject from `settled`
  // and surface via error_doc inside the worker.
  //
  // `onSettled` is part of the deferred lifecycle: it runs after the worker
  // and onInvalidation finish, but before the indexing deferred is
  // fulfilled and removed from #incrementalIndexingDeferreds. This is the
  // hook callers use for work that must happen before `realm.incrementalIndexing()`
  // resolves — for example, the post-worker invalidation broadcast on the
  // deferred-indexing path. Without this, an outer `.then()` would fire
  // after the drain returns and could race with test teardown.
  async enqueueUpdate(
    urls: URL[],
    opts?: {
      delete?: true;
      onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>;
      onSettled?: () => Promise<void> | void;
      clientRequestId?: string | null;
    },
  ): Promise<{ settled: Promise<void> }> {
    let indexingDeferred = new Deferred<void>();
    this.#incrementalIndexingDeferreds.add(indexingDeferred);
    let snapshotVersion = this.#ignoreDataVersion;
    let job: Job<IncrementalDoneResult>;
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
      job = await this.#queue.publish<IncrementalDoneResult>({
        jobType: 'incremental-index',
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority: userInitiatedPriority,
        args: makeIncrementalArgsWithCallerMetadata(args, clientRequestId),
        mapResult: mapIncrementalDoneResult(clientRequestId),
      });
    } catch (e: any) {
      indexingDeferred.reject(e);
      this.#incrementalIndexingDeferreds.delete(indexingDeferred);
      throw e;
    }
    // Past the durable-enqueue boundary. Build the settle promise that the
    // caller can either await (synchronous-indexing path) or fire-and-forget
    // (deferred-indexing path).
    let settled = (async () => {
      try {
        let { invalidations, ignoreData, stats } = await job.done;
        this.#stats = stats;
        // Drop the result if a from-scratch index landed since we snapshotted.
        // Its ignoreData was computed from a stale snapshot and would clobber
        // the fresher full-index data.
        if (snapshotVersion === this.#ignoreDataVersion) {
          this.#ignoreData = ignoreData;
        }
        if (opts?.onInvalidation) {
          await opts.onInvalidation(
            invalidations.map((href) => new URL(href.replace(/\.json$/, ''))),
          );
        }
        if (opts?.onSettled) {
          await opts.onSettled();
        }
      } catch (e: any) {
        indexingDeferred.reject(e);
        throw e;
      } finally {
        indexingDeferred.fulfill();
        this.#incrementalIndexingDeferreds.delete(indexingDeferred);
      }
    })();
    return { settled };
  }

  async update(
    urls: URL[],
    opts?: {
      delete?: true;
      onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>;
      clientRequestId?: string | null;
    },
  ): Promise<void> {
    let { settled } = await this.enqueueUpdate(urls, opts);
    await settled;
  }

  async copy(
    sourceRealmURL: URL,
    onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>,
  ): Promise<void> {
    let indexingDeferred = new Deferred<void>();
    this.#incrementalIndexingDeferreds.add(indexingDeferred);
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
      this.#incrementalIndexingDeferreds.delete(indexingDeferred);
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
    [`${realmURL.href}.template-lintrc.js`].includes(url.href) ||
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
