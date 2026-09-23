import {
  IndexWriter,
  Deferred,
  type Job,
  hasExecutableExtension,
  logger,
  systemInitiatedPriority,
  userInitiatedPriority,
  type Stats,
  type DBAdapter,
  type QueuePublisher,
  type CopyArgs,
  type CopyResult,
} from './index.ts';
import {
  indexingConcurrencyGroup,
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  makeIncrementalArgsWithCallerMetadata,
  mapIncrementalDoneResult,
  type IncrementalIndexEnqueueArgs,
} from './jobs/indexing.ts';
import { enqueueReindexRealmJob } from './jobs/reindex-realm.ts';
import type {
  DeferredPrerenderHtml,
  FromScratchResult,
  IncrementalChange,
  IncrementalDoneResult,
  SharedIndexPass,
} from './tasks/indexer.ts';
import type { Realm } from './realm.ts';
import { RealmPaths, isPartialWritePath, realmConfigHrefFor } from './paths.ts';
import { ignore, type Ignore } from './ignore.ts';

// One file's place in an index job's change set: whether the file is there to
// be visited or gone. A job carries a set of these rather than one operation
// for the whole job because a single commit can write some files and remove
// others, and the invalidation fan-out for all of them has to be computed
// against one snapshot of the realm.
export interface IndexChange {
  url: URL;
  operation: 'update' | 'delete';
}

// What an index pass reports about itself alongside the URLs it invalidated.
export interface IncrementalIndexMeta {
  generation?: number;
  // The deduped adoption-chain keys the pass touched. Absent when the pass
  // couldn't report them (an older worker mid-deploy), which is the signal to
  // subscribers that nothing can be ruled out from types alone.
  invalidatedTypes?: string[];
  // Present when the pass indexed other publishes alongside this caller's.
  sharedPass?: SharedIndexPass;
}

export interface IncrementalIndexOptions {
  // Runs once the job is durably enqueued, before anything waits on the
  // worker. `enqueueChanges` returns at that boundary, so its own callers can
  // see it without a hook; a caller of the awaited form cannot, and for one
  // reporting where a write's time went the difference matters — queueing the
  // job and waiting for a worker to run it are different problems with
  // different fixes.
  onEnqueued?: () => void;
  onInvalidation?: (
    invalidatedURLs: URL[],
    meta: IncrementalIndexMeta,
  ) => Promise<void>;
  // Runs after the worker job resolves and onInvalidation finishes, but
  // before the indexing deferred is fulfilled and removed from
  // #incrementalIndexingDeferreds. This is the hook callers use for work that
  // must happen before `realm.incrementalIndexing()` resolves — for example,
  // the post-worker invalidation broadcast on the deferred-indexing path.
  // Without this, an outer `.then()` would fire after the drain returns and
  // could race with test teardown.
  onSettled?: () => Promise<void> | void;
  // Runs when the worker job rejects, inside the same deferred lifecycle
  // as onSettled (before the quiescence deferred fulfills). A failed
  // incremental job may still have persisted setup-phase error docs, so
  // callers use this to run the cache-invalidation / broadcast work the
  // success path routes through onInvalidation — otherwise those rows
  // stay hidden behind stale caches and silent subscribers until the
  // next successful swap. Best-effort: a hook failure is logged and the
  // job's own rejection still propagates through `settled`.
  onFailed?: (error: unknown) => Promise<void> | void;
  clientRequestId?: string | null;
  // Recorded on this caller's entry in the job so whichever caller announces
  // a shared pass can say what each writer authored. See CoalescedCaller.
  clientAuthored?: string[];
  // Whether the caller announces the pass the moment it lands, rather than
  // after later passes of the same write. See CoalescedCaller.
  announcesPass?: boolean;
  // Matrix user whose HTTP write produced this job, when known. Scopes
  // the read endpoints' read-your-writes drain — see
  // #incrementalIndexingDeferreds.
  initiatedBy?: string | null;
  // See IncrementalArgs. `onDeferredPrerenderHtml` receives the set the pass
  // declined to enqueue; it runs inside the deferred lifecycle, alongside
  // onInvalidation, so a caller can carry the set forward before
  // `realm.incrementalIndexing()` resolves.
  deferPrerenderHtml?: boolean;
  carriedPrerenderHtmlChanges?: IncrementalChange[];
  onDeferredPrerenderHtml?: (
    deferred: DeferredPrerenderHtml,
  ) => Promise<void> | void;
  // See IncrementalArgs. Named by the caller rather than inferred from which
  // form it used: awaiting a pass and reading the index for its urls are
  // separate things, and the callers that await without reading back — the
  // file watcher announcing a change somebody else made, a reindex answering
  // 204 — are the ones the in-flight join exists to serve.
  readsOwnWrite?: boolean;
}

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
  // alongside an in-flight from-scratch (no gate a write waits on covers
  // from-scratch jobs).
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
  // Tracked separately so a gate can be built over the incremental (and copy)
  // jobs alone — the ones whose race against concurrent file writes a waiting
  // caller cares about. From-scratch jobs are tracked too, but only so that
  // callers wanting "all indexing has settled" semantics (e.g. publish)
  // continue to see them via `indexing()`.
  //
  // These deferreds are quiescence signals, not success signals: they are
  // always fulfilled, never rejected, even when the underlying job fails.
  // Failures travel to interested callers via the per-job promise (`settled`
  // for incremental, `completed` for from-scratch, the method's own throw
  // for copy) and via error_doc inside the worker. Rejecting the gate would
  // (a) turn a background indexing failure into a 500 for whatever
  // unrelated request happens to be awaiting the write-path gate, and
  // (b) become an unhandled promise rejection whenever a deferred-indexing
  // job fails while nothing is draining the gate.
  // Each incremental/copy deferred is tagged with what a narrower gate needs
  // to decide whether it is one of the passes that caller must wait for.
  //
  // `initiatedBy` is the matrix user whose HTTP write produced the job, when
  // known. Read endpoints use it to scope their read-your-writes drain to the
  // requesting user's own writes (`incrementalIndexingInitiatedBy`) instead of
  // parking every reader behind whatever indexing happens to be in flight.
  // System-originated jobs (file watcher, realm copy) carry no tag.
  //
  // `affectsStaging` is whether the pass touched one of the two things a
  // staging write resolves out of shared state: an executable module, or the
  // realm's own config document. The write path uses it
  // (`incrementalIndexingAffectingStaging`) to wait for those passes alone —
  // an instance-only fan-out, however wide, moves neither and so gates no
  // writer.
  #incrementalIndexingDeferreds = new Map<
    Deferred<void>,
    { initiatedBy?: string; affectsStaging?: boolean }
  >();
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
  // (e.g. before publishing a realm). No gate a request waits on is this
  // wide: blocking one on from-scratch is unsafe under reindex storms, where
  // a queued from-scratch can sit behind hundreds of jobs and stall every
  // PATCH for hours.
  indexing() {
    let pending = [
      ...this.#incrementalIndexingDeferreds.keys(),
      ...this.#fullIndexingDeferreds,
    ];
    if (pending.length === 0) {
      return undefined;
    }
    return Promise.all(pending.map((deferred) => deferred.promise)).then(
      () => undefined,
    );
  }

  // Awaits every in-flight incremental and copy job, whatever it touched.
  // From-scratch jobs are excluded because workers read files independently
  // of realm-server writes and each row write is atomic; a from-scratch
  // sitting queued behind a system-wide reindex must not block user PATCHes.
  //
  // This is the widest gate a request waits on. Its consumers are the readers
  // of the index as a whole — the publishability report, the indexing-error
  // report, and the cheap "is anything pending at all" check the
  // read-your-writes drain starts from — plus one writer that is not a reader
  // at all: a bulk commit times its render-hold release off this gate, and
  // that one must stay wide. The hold has to outlive every pass the commit
  // spawned whatever it touched, so narrowing it would free the render lane
  // early and collapse the merge window a bulk import depends on.
  //
  // A write about to stage wants `incrementalIndexingAffectingStaging()`
  // instead; waiting here would make one card's fan-out gate every other
  // card's write.
  incrementalIndexing() {
    if (this.#incrementalIndexingDeferreds.size === 0) {
      return undefined;
    }
    return Promise.all(
      [...this.#incrementalIndexingDeferreds.keys()].map(
        (deferred) => deferred.promise,
      ),
    ).then(() => undefined);
  }

  // Awaits only the incremental jobs whose write was initiated by `user` —
  // the read-your-writes slice of `incrementalIndexing()`. Returns undefined
  // when this user has nothing in flight, even while other users' or
  // system-originated jobs are pending: those jobs can only make the caller's
  // read fresher-than-requested, never wrong, because the production index
  // rows stay live (and consistent) until the working-table swap lands.
  incrementalIndexingInitiatedBy(user: string): Promise<void> | undefined {
    let pending = [...this.#incrementalIndexingDeferreds.entries()]
      .filter(([, { initiatedBy }]) => initiatedBy === user)
      .map(([deferred]) => deferred.promise);
    if (pending.length === 0) {
      return undefined;
    }
    return Promise.all(pending).then(() => undefined);
  }

  // Awaits only the incremental/copy passes that can move what a staging
  // write resolves — the slice of `incrementalIndexing()` a write about to
  // stage is actually exposed to. Returns undefined when nothing qualifying
  // is in flight, even while instance-only passes are still draining: those
  // rewrite index rows a staging write does not read, so waiting for one buys
  // it nothing and costs it however long the other card's fan-out takes.
  //
  // Two kinds of change qualify, because a staging write resolves two things
  // out of shared state rather than one:
  //
  //   - an executable module, which is what a card's type is built from;
  //   - the realm's config document, whose indexed row overlays — and wins
  //     over — the settings read off disk, so a program reading a setting
  //     would otherwise see one the realm has already replaced.
  //
  // Everything else a batch resolves is either the stored bytes, which the
  // write lock already makes exclusive, or the realm's ignore rules. The
  // ignore rules are not stored bytes and not under the lock, but no pass this
  // gate could wait for moves them: they are written only by a from-scratch
  // pass's discovery step, and an incremental echoes back the set it was
  // handed. A gate over incremental and copy passes is therefore the wrong
  // place to guard them, not a place that forgot to.
  //
  // From-scratch passes are outside this gate for the same reason they are
  // outside `incrementalIndexing()`, but the reason has to be re-derived from
  // the question being asked here rather than inherited: the same job-type
  // membership answers "should I wait for this" and "can I trust what this
  // produced" differently. For the wait, a from-scratch re-derives index rows
  // from bytes already on disk and its production rows stay live and
  // consistent until the working-table swap, so it moves nothing a staging
  // write reads — while waiting for one would park every writer in the realm
  // for as long as a full reindex takes. Excluded, and not because the other
  // gate excludes it.
  incrementalIndexingAffectingStaging(): Promise<void> | undefined {
    let pending = [...this.#incrementalIndexingDeferreds.entries()]
      .filter(([, { affectsStaging }]) => affectsStaging)
      .map(([deferred]) => deferred.promise);
    if (pending.length === 0) {
      return undefined;
    }
    return Promise.all(pending).then(() => undefined);
  }

  // The realm's own config document, whose index row the realm's settings are
  // overlaid from. Compared by URL rather than by name, so a card that merely
  // ends in `realm.json` somewhere below the root is not mistaken for it, and
  // resolved through the same helper the indexer ranks its visit order with —
  // the gate and the indexer have to agree on which document this is, and two
  // copies of the rule would be free to drift.
  #isRealmConfigDocument(url: URL): boolean {
    return url.href === realmConfigHrefFor(this.realmURL);
  }

  publishFullIndex(
    priority = systemInitiatedPriority,
    opts?: { clearLastModified?: boolean; awaitedByPublish?: boolean },
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
          awaitedByPublish: opts?.awaitedByPublish,
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

  // A change set whose every URL carries the same operation: `delete: true`
  // for a set of removals, otherwise a set of updates.
  async enqueueUpdate(
    urls: URL[],
    opts?: IncrementalIndexOptions & { delete?: true },
  ): Promise<{ settled: Promise<void> }> {
    return await this.enqueueChanges(
      urls.map((url) => ({
        url,
        operation: opts?.delete ? 'delete' : ('update' as const),
      })),
      opts,
    );
  }

  // Two-phase incremental update over a change set that may mix removals with
  // updates, so a batch that writes some files and removes others is indexed
  // and invalidated as one unit rather than as two jobs whose fan-outs are
  // computed against different snapshots of the realm.
  //
  // Returns once the job is durably enqueued (the queue insert into Postgres
  // has landed), with `settled` exposing the promise that resolves when the
  // worker finishes and the optional onInvalidation/onSettled hooks run.
  // Pre-enqueue failures (getRealmOwnerUsername, queue.publish) reject from
  // this method so the caller knows the work was never queued and the realm
  // is still consistent. Worker-time and post-worker failures reject from
  // `settled` and surface via error_doc inside the worker.
  async enqueueChanges(
    changes: IndexChange[],
    opts?: IncrementalIndexOptions,
  ): Promise<{ settled: Promise<void> }> {
    let indexingDeferred = new Deferred<void>();
    this.#incrementalIndexingDeferreds.set(indexingDeferred, {
      initiatedBy: opts?.initiatedBy ?? undefined,
      // A removal counts the same as a write: a module that is gone changes
      // what resolves just as surely as one whose bytes moved.
      affectsStaging: changes.some(
        ({ url }) =>
          hasExecutableExtension(url.href) || this.#isRealmConfigDocument(url),
      ),
    });
    let snapshotVersion = this.#ignoreDataVersion;
    let job: Job<IncrementalDoneResult>;
    try {
      let args: IncrementalIndexEnqueueArgs = {
        changes: changes.map(({ url, operation }) => ({
          url: url.href,
          operation,
        })),
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        ignoreData: { ...this.#ignoreData },
        ...(opts?.deferPrerenderHtml ? { deferPrerenderHtml: true } : {}),
        ...(opts?.carriedPrerenderHtmlChanges?.length
          ? { carriedPrerenderHtmlChanges: opts.carriedPrerenderHtmlChanges }
          : {}),
        ...(opts?.readsOwnWrite ? { readsOwnWrite: true } : {}),
      };
      let clientRequestId = opts?.clientRequestId ?? null;
      let jobArgs = makeIncrementalArgsWithCallerMetadata(
        args,
        clientRequestId,
        {
          clientAuthored: opts?.clientAuthored ?? null,
          announcesPass: opts?.announcesPass === true,
        },
      );
      job = await this.#queue.publish<IncrementalDoneResult>({
        jobType: 'incremental-index',
        concurrencyGroup: indexingConcurrencyGroup(this.#realm.url),
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority: userInitiatedPriority,
        args: jobArgs,
        // Onto the row, so a gate in another replica can see whose pass this
        // is. The in-memory deferred below records the same thing for this
        // replica's own gates, and the two have to agree.
        ...(opts?.initiatedBy ? { initiatedBy: [opts.initiatedBy] } : {}),
        mapResult: mapIncrementalDoneResult(
          clientRequestId,
          jobArgs.coalescedCallers[0]?.waiterId,
        ),
      });
    } catch (e: any) {
      indexingDeferred.fulfill();
      this.#incrementalIndexingDeferreds.delete(indexingDeferred);
      throw e;
    }
    opts?.onEnqueued?.();
    // Past the durable-enqueue boundary. Build the settle promise that the
    // caller can either await (synchronous-indexing path) or fire-and-forget
    // (deferred-indexing path). Failures reject `settled` only — the
    // quiescence gate always fulfills (see #incrementalIndexingDeferreds).
    let settled = (async () => {
      try {
        let {
          invalidations,
          invalidatedTypes,
          ignoreData,
          stats,
          generation,
          deferredPrerenderHtml,
          sharedPass,
        } = await job.done;
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
            {
              generation,
              ...(invalidatedTypes !== undefined ? { invalidatedTypes } : {}),
              ...(sharedPass ? { sharedPass } : {}),
            },
          );
        }
        if (deferredPrerenderHtml && opts?.onDeferredPrerenderHtml) {
          await opts.onDeferredPrerenderHtml(deferredPrerenderHtml);
        }
        if (opts?.onSettled) {
          await opts.onSettled();
        }
      } catch (e) {
        if (opts?.onFailed) {
          try {
            await opts.onFailed(e);
          } catch (hookError: any) {
            this.#log.warn(
              `onFailed hook for ${this.realmURL.href} threw: ${hookError?.message}`,
            );
          }
        }
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
    opts?: Pick<
      IncrementalIndexOptions,
      | 'onInvalidation'
      | 'clientRequestId'
      | 'initiatedBy'
      | 'deferPrerenderHtml'
      | 'carriedPrerenderHtmlChanges'
      | 'onDeferredPrerenderHtml'
    > & { delete?: true },
  ): Promise<void> {
    let { settled } = await this.enqueueUpdate(urls, opts);
    await settled;
  }

  // The awaited form of `enqueueChanges`, for a caller that reads indexed
  // state once the job has landed.
  async updateChanges(
    changes: IndexChange[],
    opts?: Pick<
      IncrementalIndexOptions,
      | 'onEnqueued'
      | 'onInvalidation'
      | 'clientRequestId'
      | 'clientAuthored'
      | 'announcesPass'
      | 'initiatedBy'
      | 'deferPrerenderHtml'
      | 'carriedPrerenderHtmlChanges'
      | 'onDeferredPrerenderHtml'
      | 'readsOwnWrite'
    >,
  ): Promise<void> {
    let { settled } = await this.enqueueChanges(changes, opts);
    await settled;
  }

  async copy(
    sourceRealmURL: URL,
    onInvalidation?: (invalidatedURLs: URL[]) => Promise<void>,
  ): Promise<{ generation?: number }> {
    let indexingDeferred = new Deferred<void>();
    // A copy indexes the whole source realm, so its change set is everything
    // the realm holds — modules included. It is named here rather than
    // computed because a copy never enumerates its changes up front.
    this.#incrementalIndexingDeferreds.set(indexingDeferred, {
      affectsStaging: true,
    });
    try {
      let args: CopyArgs = {
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        sourceRealmURL: sourceRealmURL.href,
      };
      let job = await this.#queue.publish<CopyResult>({
        jobType: 'copy-index',
        concurrencyGroup: indexingConcurrencyGroup(this.#realm.url),
        timeout: 4 * 60,
        priority: userInitiatedPriority,
        args,
      });
      let { invalidations, generation } = await job.done;
      if (onInvalidation) {
        await onInvalidation(
          invalidations.map((href) => new URL(href.replace(/\.json$/, ''))),
        );
      }
      return { generation };
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
    url.href.startsWith(`${realmURL.href}.git/`) ||
    // A file the realm is part-way through writing, or one left behind by a
    // write that died. It is no part of the realm either way.
    isPartialWritePath(url.href)
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
