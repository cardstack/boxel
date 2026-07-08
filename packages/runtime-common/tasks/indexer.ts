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
import { INCREMENTAL_INDEX_JOB_TIMEOUT_SEC } from '../jobs/indexing.ts';
import { enqueuePrerenderHtmlJob } from '../jobs/prerender-html.ts';
import type { Stats } from '../worker.ts';

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

export interface CoalescedCaller extends JSONTypes.Object {
  waiterId: string;
  clientRequestId: string | null;
}

export interface IncrementalArgs extends WorkerArgs {
  changes: IncrementalChange[];
  ignoreData: Record<string, string>;
  coalescedCallers: CoalescedCaller[];
}

export interface IncrementalResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
  // The realm generation this pass committed. Optional so a result produced
  // by an older worker mid-deploy still parses.
  generation?: number;
}

export interface IncrementalDoneResult extends IncrementalResult {
  clientRequestId: string | null;
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
  let { realmURL, realmUsername, ignoreData, changes, coalescedCallers } = args;
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
        },
      };
    }

    return {
      type: 'join',
      jobId: sameTypeCandidate.id,
      update: {
        ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
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
  let incomingArgs = parseIncrementalArgsForCoalesce(incoming.args);
  if (incomingArgs) {
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
      onInvalidationsReady: ({ changes, generation, loaderEpoch }) => {
        enqueuePrerenderHtmlJob(queuePublisher, {
          realmURL,
          realmUsername,
          changes: changes.map(({ url, operation }) => ({ url, operation })),
          generation,
          loaderEpoch,
          spawningJobId: jobInfo?.jobId ?? null,
          spawningPriority: jobInfo?.priority ?? systemInitiatedPriority,
          timeoutSec: FROM_SCRATCH_JOB_TIMEOUT_SEC,
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
    let { stats, ignoreData, invalidations, generation } =
      await IndexRunner.fromScratch(currentRun);

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
      onInvalidationsReady: ({
        changes: htmlChanges,
        generation,
        loaderEpoch,
      }) => {
        enqueuePrerenderHtmlJob(queuePublisher, {
          realmURL,
          realmUsername,
          changes: htmlChanges.map(({ url, operation }) => ({
            url,
            operation,
          })),
          generation,
          loaderEpoch,
          spawningJobId: jobInfo?.jobId ?? null,
          spawningPriority: jobInfo?.priority ?? systemInitiatedPriority,
          timeoutSec: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
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
    let { stats, invalidations, ignoreData, generation } =
      await IndexRunner.incremental(currentRun, {
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
      stats,
      ...(generation !== undefined ? { generation } : {}),
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
