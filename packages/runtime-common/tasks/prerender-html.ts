import type * as JSONTypes from 'json-typescript';
import type { Task, WorkerArgs } from './index.ts';
import {
  jobIdentity,
  userIdFromUsername,
  fetchUserPermissions,
} from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { runPrerenderHtmlPass } from '../index-runner/prerender-html-visit.ts';
import {
  ensureRealmOwnerPermissions,
  incrementalChangesCover,
  isObjectLike,
  maxPriorityAndTimeout,
  mergeIncrementalChanges,
  type IncrementalChange,
} from './indexer.ts';
import type { Stats } from '../worker.ts';

export { prerenderHtml };

export interface PrerenderHtmlArgs extends WorkerArgs {
  // The invalidation set the spawning index pass computed, tagged per URL —
  // dependents/re-renders as 'update', genuine deletions as 'delete'. The
  // job never recomputes the fan-out.
  changes: IncrementalChange[];
  // The realm generation the spawning index pass anticipated
  // (`current_generation + 1` at its batch start). Stamped on every row the
  // job writes; the monotonic swap guard keys off it, so correctness never
  // depends on the index pass having committed — or committing at all.
  generation: number;
  // The realm's loader epoch the spawning pass renders under (minted fresh
  // when its invalidation set includes executable modules). Threaded into
  // every render so each prerender tab resets its loader exactly once per
  // module change; carried in args rather than read from the DB because the
  // job can run before its spawning pass commits the epoch.
  loaderEpoch: string;
  // The index job that computed this invalidation set. Dashboard/log
  // correlation only.
  spawningJobId: number | null;
}

export interface PrerenderHtmlResult extends JSONTypes.Object {
  invalidations: string[];
  generation: number;
  stats: Stats;
}

function parsePrerenderHtmlArgsForCoalesce(
  args: unknown,
): PrerenderHtmlArgs | undefined {
  if (!isObjectLike(args)) {
    return undefined;
  }
  let {
    realmURL,
    realmUsername,
    changes,
    generation,
    loaderEpoch,
    spawningJobId,
  } = args;
  if (
    typeof realmURL !== 'string' ||
    typeof realmUsername !== 'string' ||
    !Array.isArray(changes) ||
    typeof generation !== 'number' ||
    typeof loaderEpoch !== 'string'
  ) {
    return undefined;
  }
  return {
    realmURL,
    realmUsername,
    changes: changes as IncrementalChange[],
    generation,
    loaderEpoch,
    spawningJobId: typeof spawningJobId === 'number' ? spawningJobId : null,
  };
}

// Modeled on `chooseIncrementalCoalesceDecision`: a same-realm pending
// publish joins by merging the URL sets (delete-sticky) and taking the max
// generation — the job renders from current source, so the newest pass's
// stamp is the right one for every merged URL. A publish can piggyback on an
// in-flight job only when that job's args already cover every incoming
// (url, operation) at an equal-or-newer generation; otherwise it inserts a
// fresh row, which the per-realm concurrency group serializes behind the
// running job.
function choosePrerenderHtmlCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let sameTypeCandidate = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (sameTypeCandidate) {
    let existingArgs = parsePrerenderHtmlArgsForCoalesce(
      sameTypeCandidate.args,
    );
    let incomingArgs = parsePrerenderHtmlArgsForCoalesce(incoming.args);
    if (!existingArgs || !incomingArgs) {
      return {
        type: 'join',
        jobId: sameTypeCandidate.id,
        update: {
          ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
        },
      };
    }
    // The loader epoch is an unordered token, so it rides with the
    // generation that carried it: the merged job renders every URL from
    // current source — the newest module world — so its renders must
    // synchronize tabs to the newest pass's epoch.
    let newest =
      incomingArgs.generation >= existingArgs.generation
        ? incomingArgs
        : existingArgs;
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
          generation: newest.generation,
          loaderEpoch: newest.loaderEpoch,
          spawningJobId:
            incomingArgs.spawningJobId ?? existingArgs.spawningJobId,
        },
      },
    };
  }

  let incomingArgs = parsePrerenderHtmlArgsForCoalesce(incoming.args);
  if (incomingArgs) {
    for (let candidate of inFlightCandidates) {
      if (candidate.jobType !== incoming.jobType) {
        continue;
      }
      let existingArgs = parsePrerenderHtmlArgsForCoalesce(candidate.args);
      if (!existingArgs) {
        continue;
      }
      if (
        existingArgs.generation >= incomingArgs.generation &&
        existingArgs.loaderEpoch === incomingArgs.loaderEpoch &&
        incrementalChangesCover(existingArgs.changes, incomingArgs.changes)
      ) {
        return { type: 'join', jobId: candidate.id };
      }
    }
  }

  return { type: 'insert' };
}

registerQueueJobDefinition({
  jobType: 'prerender_html',
  coalesce: choosePrerenderHtmlCoalesceDecision,
});

const prerenderHtml: Task<PrerenderHtmlArgs, PrerenderHtmlResult> = ({
  log,
  reportStatus,
  reportProgress,
  reportRealmEvent,
  dbAdapter,
  matrixURL,
  indexWriter,
  getReader,
  getAuthedFetch,
  prerenderer,
  virtualNetwork,
  createPrerenderAuth,
}) =>
  async function (args) {
    let { jobInfo, realmUsername, realmURL, changes, generation, loaderEpoch } =
      args;
    log.debug(
      `${jobIdentity(jobInfo)} starting prerender-html for realm ${realmURL} at generation ${generation} (${changes.length} changes, spawned by job ${args.spawningJobId})`,
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
    let { invalidations, stats } = await runPrerenderHtmlPass({
      realmURL: new URL(realmURL),
      changes,
      generation,
      loaderEpoch,
      indexWriter,
      virtualNetwork,
      reader,
      prerenderer,
      auth,
      jobInfo: jobInfo ?? { jobId: -1, reservationId: -1, priority: 0 },
      jobPriority: jobInfo?.priority,
      onProgress: reportProgress,
    });

    // Fresh HTML is live — tell subscribed hosts so open live searches
    // re-run and pick up the new renderings / corrected full-text
    // membership. Rides the worker→manager→realm-server event bridge.
    reportRealmEvent?.({
      eventName: 'prerender_html',
      realmURL,
      generation,
      invalidations,
    });

    reportStatus(jobInfo, 'finish');
    log.debug(
      `${jobIdentity(jobInfo)} completed prerender-html for realm ${realmURL} at generation ${generation}:\n${JSON.stringify(stats, null, 2)}`,
    );
    return { invalidations, generation, stats };
  };
