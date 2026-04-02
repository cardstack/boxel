import type * as JSONTypes from 'json-typescript';
import type { Task, WorkerArgs } from './index';
import {
  jobIdentity,
  userIdFromUsername,
  fetchUserPermissions,
  type RealmPermissions,
} from '../index';
import {
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  registerQueueJobDefinition,
} from '../queue';
import { IndexRunner } from '../index-runner';
import type { Stats } from '../worker';

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
}

export interface IncrementalDoneResult extends IncrementalResult {
  clientRequestId: string | null;
}

export type FromScratchArgs = WorkerArgs;

export interface FromScratchResult extends JSONTypes.Object {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
}

function isObjectLike(value: unknown): value is JSONTypes.Object {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function maxPriorityAndTimeout(
  existing: QueueCoalesceCandidate,
  incoming: { priority: number; timeout: number },
) {
  return {
    priority: Math.max(existing.priority, incoming.priority),
    timeout: Math.max(existing.timeout, incoming.timeout),
  };
}

function mergeIncrementalChanges(
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

function chooseIncrementalCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let sameTypeCandidate = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (!sameTypeCandidate) {
    return { type: 'insert' };
  }

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

function chooseFromScratchCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let sameTypeCandidate = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (!sameTypeCandidate) {
    return { type: 'insert' };
  }

  return {
    type: 'join',
    jobId: sameTypeCandidate.id,
    update: {
      ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
      args: {
        ...(isObjectLike(sameTypeCandidate.args) ? sameTypeCandidate.args : {}),
        ...(isObjectLike(incoming.args) ? incoming.args : {}),
        coalescedCallers: mergeCoalescedCallers(
          getCoalescedCallers(sameTypeCandidate.args),
          getCoalescedCallers(incoming.args),
        ),
      },
    },
  };
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
      jobInfo,
      reportStatus,
      onProgress: reportProgress,
      auth,
      fetch: _fetch,
      prerenderer,
      realmOwnerUserId: userId,
    });
    let { stats, ignoreData, invalidations } =
      await IndexRunner.fromScratch(currentRun);

    log.debug(
      `${jobIdentity(jobInfo)} completed from-scratch indexing for realm ${
        args.realmURL
      }:\n${JSON.stringify(stats, null, 2)}`,
    );
    reportStatus(args.jobInfo, 'finish');
    return {
      invalidations,
      ignoreData: { ...ignoreData },
      stats,
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
      jobInfo,
      reportStatus,
      onProgress: reportProgress,
      auth,
      fetch: _fetch,
      prerenderer,
      ignoreData: args.ignoreData,
      realmOwnerUserId: userId,
    });
    let { stats, invalidations, ignoreData } = await IndexRunner.incremental(
      currentRun,
      {
        changes: changes.map(({ operation, url }) => ({
          operation,
          url: new URL(url),
        })),
      },
    );

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
    };
  };

function ensureRealmOwnerPermissions(
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
