import type * as JSONTypes from 'json-typescript';
import type { Task, WorkerArgs } from './index.ts';
import {
  jobIdentity,
  notifyAllFileChanges,
  notifyRealmIndexUpdated,
  userIdFromUsername,
  fetchUserPermissions,
  type RealmPermissions,
} from '../index.ts';
import {
  systemInitiatedPriority,
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  registerQueueJobDefinition,
} from '../queue.ts';
import { IndexRunner } from '../index-runner.ts';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  prerenderSpawnedPriority,
} from '../jobs/indexing.ts';
import {
  enqueuePrerenderHtmlJob,
  mergePrerenderHtmlChanges,
  skipsPrerenderHtml,
} from '../jobs/prerender-html.ts';
import type { JobInfo, Stats, IndexPhaseTimings } from '../worker.ts';

export { fromScratchIndex, incrementalIndex };
const DEFAULT_FROM_SCRATCH_JOB_TIMEOUT_SEC = 60 * 60;
const envTimeoutSec = Number(
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.FROM_SCRATCH_JOB_TIMEOUT_SEC,
);
export const FROM_SCRATCH_JOB_TIMEOUT_SEC =
  Number.isFinite(envTimeoutSec) && envTimeoutSec > 0
    ? envTimeoutSec
    : DEFAULT_FROM_SCRATCH_JOB_TIMEOUT_SEC;

export interface IncrementalChange extends JSONTypes.Object {
  url: string;
  operation: 'update' | 'delete';
}

// One publish a job carries. A pending job absorbs every same-realm publish
// that arrives before a worker claims it, so one pass can index several
// writers' changes, with every one of them waiting on it.
export interface CoalescedCaller extends JSONTypes.Object {
  waiterId: string;
  clientRequestId: string | null;
  // The files this publish asked the pass to index, in the spelling the
  // pass's invalidations use: the realm href without a trailing `.json`. Lets
  // a subscriber tell which of the pass's cards each writer changed. Null
  // when unknown — a job enqueued by a realm server predating the member —
  // which a subscriber has to read as "may have changed any of them".
  //
  // Non-optional, like the args' own members, so the entry satisfies the
  // JSON-shape index signature (which rejects `undefined`).
  urls: string[] | null;
  // The request's own report of which cards it wrote from content its client
  // supplied verbatim (see the event's `clientAuthored`). Null when the
  // request made no such report.
  clientAuthored: string[] | null;
  // Whether this caller announces the pass to subscribers the moment it
  // lands. False for a pass that is only a step in a larger write (the
  // module→instance flush), whose caller announces later, once its closing
  // pass has run, or never, if that pass fails. The first caller for which
  // this is true announces the pass for everyone; see `SharedIndexPass`.
  announcesPass: boolean;
}

export interface IncrementalArgs extends WorkerArgs {
  changes: IncrementalChange[];
  ignoreData: Record<string, string>;
  coalescedCallers: CoalescedCaller[];
  // When true, this pass enqueues no prerender_html job of its own: it
  // returns its invalidation set on `deferredPrerenderHtml` instead, for a
  // later pass in the same write to carry. Set by the module→instance flush
  // inside a mixed batch write, whose dependents include the very instances
  // the write is about to overwrite — rendering them now would render content
  // that is already stale, and the write's own pass renders them again
  // moments later. False on every other index path. Non-optional, like
  // FromScratchArgs's `clearLastModified`, so the args object still satisfies
  // WorkerArgs's JSON-shape index signature (which rejects `undefined`).
  deferPrerenderHtml: boolean;
  // Invalidation sets deferred by earlier passes of the same write, unioned
  // into the prerender_html job this pass spawns so one write pays for one
  // render of each URL. The URLs ride under THIS pass's loader epoch, which is
  // correct: the render reads current source, so the newest pass's epoch is
  // the right one for every merged URL — the same rule
  // `choosePrerenderHtmlCoalesceDecision` applies when it merges two
  // publishes. The job need not wait on the deferring passes: they ran
  // earlier in the same write and have finished before this pass is
  // enqueued.
  // Empty on every other index path; see `deferPrerenderHtml` for why it is
  // not optional.
  carriedPrerenderHtmlChanges: IncrementalChange[];
  // Whether the caller that published this will read the index for these same
  // URLs once the pass lands — the read-your-writes contract a card write
  // answers its response from. Read only by the coalesce handler, never by the
  // pass itself: what it governs is which existing pass this publish is
  // allowed to be satisfied by, not what the pass does. See
  // `chooseIncrementalCoalesceDecision`. Non-optional for the same reason
  // `deferPrerenderHtml` is.
  readsOwnWrite: boolean;
}

// An invalidation set an index pass computed but deliberately did not enqueue
// a prerender_html job for. The loader epoch and job id are the deferring
// pass's own, needed only when nothing carries the set forward and the caller
// has to enqueue it directly: the job id is the spawning index job that
// enqueued job waits on.
export interface DeferredPrerenderHtml extends JSONTypes.Object {
  changes: IncrementalChange[];
  loaderEpoch: string;
  // Null when the pass ran without a queue job.
  spawningIndexJobId: number | null;
  // Set only by a worker predating `spawningIndexJobId`: the generation that
  // pass anticipated at setup. Null otherwise.
  generation: number | null;
}

export interface IncrementalResult {
  invalidations: string[];
  // The deduped adoption-chain keys this pass touched, in `internalKeyFor`
  // form. Rides the invalidation broadcast so a client holding a type-anchored
  // live query can tell that a write it has no interest in cannot have moved
  // its membership. Optional so a result produced by an older worker
  // mid-deploy still parses — its absence puts every client back on the
  // unconditional re-run.
  invalidatedTypes?: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
  // The realm generation this pass committed. Optional so a result produced
  // by an older worker mid-deploy still parses.
  generation?: number;
  // The committed generation this pass was set up against. Below
  // `generation - 1` when a peer pass of the realm committed while this one
  // ran. Optional for the same reason as `generation`.
  baseGeneration?: number;
  // Between-visit phase decomposition of the job wall (see IndexPhaseTimings).
  // Optional so a result from a worker predating the instrumentation parses.
  phaseTimings?: IndexPhaseTimings;
  // Present only when the job ran with `deferPrerenderHtml`: the invalidation
  // set no prerender_html job was enqueued for. The caller either carries it
  // into a later pass of the same write or enqueues it itself.
  deferredPrerenderHtml?: DeferredPrerenderHtml;
  // Every publish whose changes this pass indexed, as the claimed job's args
  // named them. Optional so a result produced by an older worker mid-deploy
  // still parses; its absence leaves each caller announcing the pass itself.
  coalescedCallers?: CoalescedCaller[];
}

// A pass that indexed more than one publish, as one of its callers sees it.
export interface SharedIndexPass {
  // True when another caller announces this pass, so this one must not
  // announce it a second time. Every caller of a pass receives the same
  // invalidations, and a subscriber handed several copies of one pass would
  // act on each, so exactly one caller — the first that announces its passes
  // as they land — speaks for all of them.
  //
  // Standing down makes the pass's announcement depend on that one caller. If
  // the announcer's process dies after the pass lands, or its post-pass work
  // throws before the broadcast, the pass goes unannounced for every writer it
  // carried; subscribers catch up on the next event naming those cards.
  announcedByPeer: boolean;
  // This caller's own entry among `callers`, so whoever announces can tell
  // its own write from the others the pass carried.
  waiterId: string;
  callers: CoalescedCaller[];
}

export interface IncrementalDoneResult extends IncrementalResult {
  clientRequestId: string | null;
  // Present only when the pass indexed this caller's publish alongside at
  // least one other.
  sharedPass?: SharedIndexPass;
}

export interface FromScratchArgs extends WorkerArgs {
  // True when the caller cleared `boxel_index.last_modified` for the
  // realm before publishing. The worker doesn't need to act on this
  // (the clear already happened in the DB) — it's surfaced in args
  // so the coalesce decision can refuse to attach a clearing publish
  // to an already-running same-realm from-scratch whose
  // `Batch.getModifiedTimes` snapshot pre-dates the clear, which would
  // otherwise let the running job report success without re-rendering
  // the swapped files. Always present (non-optional) so the args
  // object satisfies WorkerArgs's JSON-shape index signature.
  clearLastModified: boolean;
}

export interface FromScratchResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
  // See IncrementalResult.generation.
  generation?: number;
  // See IncrementalResult.baseGeneration.
  baseGeneration?: number;
  // See IncrementalResult.phaseTimings.
  phaseTimings?: IndexPhaseTimings;
}

export function isObjectLike(value: unknown): value is JSONTypes.Object {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function maxPriorityAndTimeout(
  existing: QueueCoalesceCandidate,
  incoming: { priority: number; timeout: number },
) {
  return {
    priority: Math.max(existing.priority, incoming.priority),
    timeout: Math.max(existing.timeout, incoming.timeout),
  };
}

export function mergeIncrementalChanges(
  existing: IncrementalChange[],
  incoming: IncrementalChange[],
): IncrementalChange[] {
  let byUrl = new Map<string, IncrementalChange>();
  for (let change of [...existing, ...incoming]) {
    let previous = byUrl.get(change.url);
    if (!previous) {
      byUrl.set(change.url, change);
      continue;
    }
    if (previous.operation === 'delete') {
      continue;
    }
    if (change.operation === 'delete') {
      byUrl.set(change.url, { ...change, operation: 'delete' });
    }
  }
  return [...byUrl.values()];
}

function getCoalescedCallers(args: unknown): CoalescedCaller[] {
  if (!isObjectLike(args)) {
    return [];
  }
  let callers = args.coalescedCallers;
  if (!Array.isArray(callers)) {
    return [];
  }
  return callers.filter(
    (caller): caller is CoalescedCaller =>
      !!caller &&
      typeof caller === 'object' &&
      typeof (caller as CoalescedCaller).waiterId === 'string' &&
      ((caller as CoalescedCaller).clientRequestId === null ||
        typeof (caller as CoalescedCaller).clientRequestId === 'string'),
  );
}

function mergeCoalescedCallers(
  left: CoalescedCaller[],
  right: CoalescedCaller[],
): CoalescedCaller[] {
  let callers = new Map<string, CoalescedCaller>();
  for (let caller of [...left, ...right]) {
    callers.set(caller.waiterId, caller);
  }
  return [...callers.values()];
}

function parseIncrementalArgsForCoalesce(
  args: unknown,
): IncrementalArgs | undefined {
  if (!isObjectLike(args)) {
    return undefined;
  }
  let {
    realmURL,
    realmUsername,
    ignoreData,
    changes,
    coalescedCallers,
    deferPrerenderHtml,
    carriedPrerenderHtmlChanges,
    readsOwnWrite,
  } = args;
  if (
    typeof realmURL !== 'string' ||
    typeof realmUsername !== 'string' ||
    !isObjectLike(ignoreData) ||
    !Array.isArray(changes)
  ) {
    return undefined;
  }
  return {
    realmURL,
    realmUsername,
    ignoreData: ignoreData as Record<string, string>,
    changes: changes as IncrementalChange[],
    coalescedCallers: Array.isArray(coalescedCallers)
      ? (coalescedCallers as CoalescedCaller[])
      : [],
    // Read loosely: a job enqueued by a worker predating these fields has
    // neither, and dropping them here would silently un-defer that job.
    deferPrerenderHtml: deferPrerenderHtml === true,
    carriedPrerenderHtmlChanges: Array.isArray(carriedPrerenderHtmlChanges)
      ? (carriedPrerenderHtmlChanges as IncrementalChange[])
      : [],
    readsOwnWrite: readsOwnWrite === true,
  };
}

export function incrementalChangesCover(
  existing: IncrementalChange[],
  incoming: IncrementalChange[],
): boolean {
  let existingByUrl = new Map<string, IncrementalChange>();
  for (let change of existing) {
    existingByUrl.set(change.url, change);
  }
  for (let change of incoming) {
    let match = existingByUrl.get(change.url);
    if (!match || match.operation !== change.operation) {
      return false;
    }
  }
  return true;
}

function chooseIncrementalCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let sameTypeCandidate = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (sameTypeCandidate) {
    let existingArgs = parseIncrementalArgsForCoalesce(sameTypeCandidate.args);
    let incomingArgs = parseIncrementalArgsForCoalesce(incoming.args);
    if (!existingArgs || !incomingArgs) {
      return {
        type: 'join',
        jobId: sameTypeCandidate.id,
        update: {
          ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
          initiatedBy: mergeInitiators(sameTypeCandidate, incoming),
        },
      };
    }

    return {
      type: 'join',
      jobId: sameTypeCandidate.id,
      update: {
        ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
        // The merged pass carries both callers' work, so the row has to name
        // both: a writer whose pass was absorbed into someone else's job
        // would otherwise be invisible to its own gate and would not wait for
        // indexing of bytes it wrote. A publish naming nobody adds nobody,
        // which leaves an all-untagged job still reading as the realm owner.
        initiatedBy: mergeInitiators(sameTypeCandidate, incoming),
        args: {
          ...existingArgs,
          changes: mergeIncrementalChanges(
            existingArgs.changes,
            incomingArgs.changes,
          ),
          coalescedCallers: mergeCoalescedCallers(
            existingArgs.coalescedCallers,
            incomingArgs.coalescedCallers,
          ),
          // AND, not OR: a caller that did not ask to defer is waiting for
          // this pass to enqueue the render. Deferring on its behalf would
          // hand the set to a write that has no later pass to fold it into.
          // The merged job therefore only defers when every caller wants it
          // to, and the un-deferred case loses nothing — the job it spawns
          // renders the union below.
          deferPrerenderHtml:
            existingArgs.deferPrerenderHtml && incomingArgs.deferPrerenderHtml,
          carriedPrerenderHtmlChanges: mergePrerenderHtmlChanges(
            existingArgs.carriedPrerenderHtmlChanges,
            incomingArgs.carriedPrerenderHtmlChanges,
          ),
          // OR, because the field says whether anyone waiting on this job
          // will read the index for its changes, and one such caller is
          // enough to make that true of the merged job.
          readsOwnWrite:
            existingArgs.readsOwnWrite || incomingArgs.readsOwnWrite,
        },
      },
    };
  }

  // No still-pending candidate to merge into. Closes the race where the
  // PATCH-path enqueue gets claimed by a worker before the file-watcher
  // echo (or any second wave of callers) can attach via pre-claim
  // coalesce. We piggyback on the running job, but only when its args
  // already cover every (url, operation) we need — operation mismatch
  // (update vs delete) means different work, so we must enqueue a new
  // job in that case.
  //
  // Covering the URL is not enough for a caller that will read the index for
  // its own write. A claimed pass reads each file it visits once, and it was
  // claimed before this publish existed — so it may have already read the
  // bytes this publish supersedes, and attaching would settle the caller
  // against a version of its card that predates the write it just made. The
  // file-watcher echo this branch was built for has no such stake: it
  // announces bytes some other write already put on disk and reads nothing
  // afterwards. A publish that does have the stake inserts instead, and the
  // next one behind it merges into that pending job rather than into the
  // running one — which is what keeps a burst of saves to one card at the two
  // passes read-your-writes actually costs, rather than one per save.
  let incomingArgs = parseIncrementalArgsForCoalesce(incoming.args);
  if (incomingArgs && !incomingArgs.readsOwnWrite) {
    for (let candidate of inFlightCandidates) {
      if (candidate.jobType !== incoming.jobType) {
        continue;
      }
      let existingArgs = parseIncrementalArgsForCoalesce(candidate.args);
      if (!existingArgs) {
        continue;
      }
      if (incrementalChangesCover(existingArgs.changes, incomingArgs.changes)) {
        return { type: 'join', jobId: candidate.id };
      }
    }
  }

  return { type: 'insert' };
}

// The callers a merged job carries, deduped. Order is not meaningful — the
// gate asks about membership — so the existing set keeps its order and new
// names go on the end, which keeps a row stable when the same caller
// publishes twice.
//
// Reachable only from a join onto a PENDING candidate. A join onto one already
// claimed carries no update at all, because the worker holds its args in
// memory and would never see the write — so a publish that attaches there
// leaves the row naming whoever enqueued it and not itself. Nothing gates on
// the column yet; a gate that does has to decide whether a publish naming a
// writer may take that branch, since this is the one join where the row cannot
// be made to describe every writer waiting on the pass.
function mergeInitiators(
  existing: QueueCoalesceCandidate,
  incoming: { initiatedBy?: string[] },
): string[] {
  return [
    ...new Set([
      ...(existing.initiatedBy ?? []),
      ...(incoming.initiatedBy ?? []),
    ]),
  ];
}

function chooseFromScratchCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let sameTypeCandidate = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (sameTypeCandidate) {
    return {
      type: 'join',
      jobId: sameTypeCandidate.id,
      update: {
        ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
        // The merged pass carries both callers' work, so the row has to name
        // both: a writer whose pass was absorbed into someone else's job
        // would otherwise be invisible to its own gate and would not wait for
        // indexing of bytes it wrote. A publish naming nobody adds nobody,
        // which leaves an all-untagged job still reading as the realm owner.
        initiatedBy: mergeInitiators(sameTypeCandidate, incoming),
        args: {
          ...(isObjectLike(sameTypeCandidate.args)
            ? sameTypeCandidate.args
            : {}),
          ...(isObjectLike(incoming.args) ? incoming.args : {}),
          coalescedCallers: mergeCoalescedCallers(
            getCoalescedCallers(sameTypeCandidate.args),
            getCoalescedCallers(incoming.args),
          ),
        },
      },
    };
  }

  // No still-pending candidate. Attach to an in-flight same-realm
  // from-scratch instead — same concurrency group + same jobType is
  // sufficient because a from-scratch reindex subsumes any other
  // from-scratch for that realm by definition. Without this fallback,
  // a worker claiming the first enqueue between two pre-claim publishes
  // forces the second to insert a fresh row at its own priority, even
  // though the in-flight job will produce exactly the result the second
  // caller wanted.
  //
  // Exception: a publish carrying `clearLastModified: true` has already
  // nulled `boxel_index.last_modified` for the realm so the next
  // from-scratch pass re-renders every row even where mtimes didn't
  // change. An already-running from-scratch read its mtimes snapshot
  // before that clear, so attaching this publish to it would let the
  // caller observe a successful job that did NOT actually re-render
  // the swapped files. Force a fresh row instead.
  if (!incomingClearsLastModified(incoming.args)) {
    for (let candidate of inFlightCandidates) {
      if (candidate.jobType === incoming.jobType) {
        return { type: 'join', jobId: candidate.id };
      }
    }
  }

  return { type: 'insert' };
}

function incomingClearsLastModified(args: unknown): boolean {
  return isObjectLike(args) && args.clearLastModified === true;
}

// A publish sets this on its from-scratch args so the prerender-html job the
// pass spawns runs co-equal with indexing (the publish blocks on that HTML)
// rather than one tier below. Absent on every other index path. Read loosely
// so a job enqueued before this field existed reads as false.
// The index job a spawned prerender_html job waits on: this pass's own. A pass
// run without a real queue job (`jobId` absent or not positive) records no job
// on its `realm_index_commits` row, so there is nothing to wait on.
function spawningIndexJobIdsFor(jobInfo: JobInfo | undefined): number[] {
  return jobInfo && jobInfo.jobId > 0 ? [jobInfo.jobId] : [];
}

function argsAwaitedByPublish(args: unknown): boolean {
  return isObjectLike(args) && args.awaitedByPublish === true;
}

registerQueueJobDefinition({
  jobType: 'incremental-index',
  coalesce: chooseIncrementalCoalesceDecision,
});
registerQueueJobDefinition({
  jobType: 'from-scratch-index',
  coalesce: chooseFromScratchCoalesceDecision,
});

const fromScratchIndex: Task<FromScratchArgs, FromScratchResult> = ({
  log,
  reportStatus,
  reportProgress,
  dbAdapter,
  matrixURL,
  indexWriter,
  getReader,
  getAuthedFetch,
  prerenderer,
  definitionLookup,
  virtualNetwork,
  queuePublisher,
  createPrerenderAuth,
  skipPrerenderHtmlRealms,
}) =>
  async function (args) {
    let { jobInfo, realmUsername, realmURL } = args;
    log.debug(
      `${jobIdentity(args.jobInfo)} starting from-scratch indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let userId = userIdFromUsername(realmUsername, matrixURL);
    let permissions = await fetchUserPermissions(dbAdapter, { userId });
    let prerenderPermissions = ensureRealmOwnerPermissions(
      permissions,
      realmURL,
    );
    let auth = createPrerenderAuth(userId, prerenderPermissions);

    let _fetch = await getAuthedFetch(args);
    let reader = getReader(_fetch, realmURL);
    let currentRun = new IndexRunner({
      realmURL: new URL(realmURL),
      reader,
      indexWriter,
      definitionLookup,
      virtualNetwork,
      jobInfo,
      jobPriority: jobInfo?.priority,
      reportStatus,
      onProgress: reportProgress,
      // Fire-and-forget: the index pass must not block on — or fail with —
      // the prerender enqueue. Fires as soon as the invalidation set is
      // known, so HTML rendering can start concurrently with the pass.
      onInvalidationsReady: ({ changes, loaderEpoch }) => {
        if (skipsPrerenderHtml(realmURL, skipPrerenderHtmlRealms)) {
          // Configured off for this realm. Says so out loud: a realm whose
          // HTML never renders reads, from every other vantage point, exactly
          // like one whose render is merely slow.
          log.info(
            `${jobIdentity(jobInfo)} not spawning prerender_html for ${realmURL}: ` +
              `the realm is listed in --skipPrerenderHtmlRealm`,
          );
          return;
        }
        enqueuePrerenderHtmlJob(queuePublisher, {
          realmURL,
          realmUsername,
          changes: changes.map(({ url, operation }) => ({ url, operation })),
          spawningIndexJobIds: spawningIndexJobIdsFor(jobInfo),
          generation: null,
          loaderEpoch,
          spawningJobId: jobInfo?.jobId ?? null,
          spawningPriority: prerenderSpawnedPriority({
            realmURL,
            indexPriority: jobInfo?.priority ?? systemInitiatedPriority,
            awaitedByPublish: argsAwaitedByPublish(args),
          }),
          timeoutSec: FROM_SCRATCH_JOB_TIMEOUT_SEC,
          // A publish awaits this HTML, so its render is on the publish's
          // critical path and runs co-equal with indexing (see
          // prerenderHtmlPriority). Only the publish flow sets this.
          awaitedByPublish: argsAwaitedByPublish(args),
          // From-scratch: the prerender job runs the realm-wide module
          // pre-warm sweep before its format renders.
          preWarm: true,
        }).catch((e) => {
          log.warn(
            `${jobIdentity(jobInfo)} failed to enqueue prerender_html job for ${realmURL}: ${(e as Error)?.message}`,
          );
        });
      },
      auth,
      fetch: _fetch,
      prerenderer,
      realmOwnerUserId: userId,
    });
    let {
      stats,
      ignoreData,
      invalidations,
      generation,
      baseGeneration,
      phaseTimings,
    } = await IndexRunner.fromScratch(currentRun);

    log.debug(
      `${jobIdentity(jobInfo)} completed from-scratch indexing for realm ${
        args.realmURL
      }:\n${JSON.stringify(stats, null, 2)}`,
    );
    // CS-11182: emit the cross-replica `<realmURL>:*` wildcard so every
    // mounted Realm drops its in-memory `#sourceCache` / `#transpiledModuleCache`
    // and fires the L2 `module_transpile_cache` bulk tombstone for this
    // realm. This is the single chokepoint that every from-scratch
    // reindex flows through — startReindex's post-completion `.then`
    // (the original fix) only covered POST /_full-reindex and
    // POST /_reindex; the Grafana `/_grafana-reindex`,
    // `/_grafana-full-reindex`, `/_post-deployment`, publish-realm
    // `Realm.fullIndex`, and direct `enqueueReindexRealmJob` paths all
    // bypassed it, leaving stale L1+L2 even after a successful reindex.
    // Doing it here covers them all uniformly. Best-effort: failures
    // fall back to a bounded staleness window because the next
    // reader's transpile path re-tombstones the L2 row.
    await notifyAllFileChanges(dbAdapter, args.realmURL);
    // Same chokepoint, index-derived caches: emit realm_index_updated so
    // every mounted Realm drops `#inFlightSearch`, `#cachedRealmInfo`, and
    // `#cachedHostRoutingMap`. The from-scratch swap may have changed
    // realm.json (RealmInfo, hostRoutingRules) or the index contents these
    // caches derive from. The byte-cache wildcard above does not cover them,
    // and the from-scratch reindex paths (`/_reindex`, `/_full-reindex`, the
    // Grafana variants, direct `enqueueReindexRealmJob`) don't otherwise run
    // `clearRealmIndexCachesAndBroadcast()`. Best-effort, same as above.
    await notifyRealmIndexUpdated(dbAdapter, args.realmURL);
    reportStatus(args.jobInfo, 'finish');
    return {
      invalidations,
      ignoreData: { ...ignoreData },
      stats,
      ...(generation !== undefined ? { generation } : {}),
      ...(baseGeneration !== undefined ? { baseGeneration } : {}),
      ...(phaseTimings !== undefined ? { phaseTimings } : {}),
    };
  };

const incrementalIndex: Task<IncrementalArgs, IncrementalResult> = ({
  log,
  reportStatus,
  reportProgress,
  dbAdapter,
  matrixURL,
  indexWriter,
  getReader,
  getAuthedFetch,
  prerenderer,
  definitionLookup,
  virtualNetwork,
  queuePublisher,
  createPrerenderAuth,
}) =>
  async function (args) {
    let { jobInfo, realmUsername, changes, realmURL } = args;

    log.debug(
      `${jobIdentity(jobInfo)} starting incremental indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let userId = userIdFromUsername(realmUsername, matrixURL);
    let permissions = await fetchUserPermissions(dbAdapter, { userId });
    let prerenderPermissions = ensureRealmOwnerPermissions(
      permissions,
      realmURL,
    );
    let auth = createPrerenderAuth(userId, prerenderPermissions);

    let deferPrerenderHtml = args.deferPrerenderHtml === true;
    let carriedPrerenderHtmlChanges = Array.isArray(
      args.carriedPrerenderHtmlChanges,
    )
      ? args.carriedPrerenderHtmlChanges
      : [];
    let deferredPrerenderHtml: DeferredPrerenderHtml | undefined;

    let _fetch = await getAuthedFetch(args);
    let reader = getReader(_fetch, realmURL);
    let currentRun = new IndexRunner({
      realmURL: new URL(realmURL),
      reader,
      indexWriter,
      definitionLookup,
      virtualNetwork,
      jobInfo,
      jobPriority: jobInfo?.priority,
      reportStatus,
      onProgress: reportProgress,
      // See fromScratchIndex — same fire-and-forget early enqueue.
      onInvalidationsReady: ({ changes: htmlChanges, loaderEpoch }) => {
        let changes = htmlChanges.map(({ url, operation }) => ({
          url,
          operation,
        }));
        if (deferPrerenderHtml) {
          // The caller owns this set now — either it carries it into a later
          // pass of the same write, or it enqueues the job itself. Anything
          // an earlier pass handed us rides along rather than being dropped
          // on the floor by a pass that enqueues nothing.
          deferredPrerenderHtml = {
            changes: mergePrerenderHtmlChanges(
              carriedPrerenderHtmlChanges,
              changes,
            ),
            loaderEpoch,
            spawningIndexJobId: spawningIndexJobIdsFor(jobInfo)[0] ?? null,
            generation: null,
          };
          return;
        }
        enqueuePrerenderHtmlJob(queuePublisher, {
          realmURL,
          realmUsername,
          changes: mergePrerenderHtmlChanges(
            carriedPrerenderHtmlChanges,
            changes,
          ),
          spawningIndexJobIds: spawningIndexJobIdsFor(jobInfo),
          generation: null,
          loaderEpoch,
          spawningJobId: jobInfo?.jobId ?? null,
          spawningPriority: prerenderSpawnedPriority({
            realmURL,
            indexPriority: jobInfo?.priority ?? systemInitiatedPriority,
          }),
          timeoutSec: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
          // Incremental: no realm-wide sweep — its cost is O(realm module
          // count), deliberately not paid on incrementals.
          preWarm: false,
        }).catch((e) => {
          log.warn(
            `${jobIdentity(jobInfo)} failed to enqueue prerender_html job for ${realmURL}: ${(e as Error)?.message}`,
          );
        });
      },
      auth,
      fetch: _fetch,
      prerenderer,
      ignoreData: args.ignoreData,
      realmOwnerUserId: userId,
    });
    let {
      stats,
      invalidations,
      invalidatedTypes,
      ignoreData,
      generation,
      baseGeneration,
      phaseTimings,
    } = await IndexRunner.incremental(currentRun, {
      changes: changes.map(({ operation, url }) => ({
        operation,
        url: new URL(url),
      })),
    });

    log.debug(
      `${jobIdentity(jobInfo)} completed incremental indexing for ${changes
        .map(({ url, operation }) => `${operation}:${url}`)
        .join(',')}:\n${JSON.stringify({ ...stats, invalidations }, null, 2)}`,
    );
    reportStatus(jobInfo, 'finish');
    return {
      ignoreData: { ...ignoreData },
      invalidations,
      ...(invalidatedTypes !== undefined ? { invalidatedTypes } : {}),
      stats,
      ...(generation !== undefined ? { generation } : {}),
      ...(baseGeneration !== undefined ? { baseGeneration } : {}),
      ...(phaseTimings !== undefined ? { phaseTimings } : {}),
      ...(deferredPrerenderHtml !== undefined ? { deferredPrerenderHtml } : {}),
      coalescedCallers: getCoalescedCallers(args),
    };
  };

export function ensureRealmOwnerPermissions(
  permissions: RealmPermissions,
  realmURL: string,
): RealmPermissions {
  let next: RealmPermissions = { ...permissions };
  let existing = new Set(next[realmURL] ?? []);
  existing.add('read');
  existing.add('realm-owner');
  next[realmURL] = [...existing];
  return next;
}
