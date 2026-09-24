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
  mergePrerenderHtmlChanges,
  parseSpawningIndexPasses,
  type SpawningIndexPass,
} from '../jobs/prerender-html.ts';
import {
  ensureRealmOwnerPermissions,
  incrementalChangesCover,
  isObjectLike,
  maxPriorityAndTimeout,
  type IncrementalChange,
} from './indexer.ts';
import { queueClaimOf, type QueueClaim, type Stats } from '../worker.ts';

export { prerenderHtml };

export interface PrerenderHtmlArgs extends WorkerArgs {
  // The invalidation set the spawning index pass computed, tagged per URL —
  // dependents/re-renders as 'update', genuine deletions as 'delete'. The
  // job never recomputes the fan-out.
  changes: IncrementalChange[];
  // The index passes that computed this invalidation set. The job's visits
  // wait until each has committed — its pass id appears in the
  // `realm_index_commits` ledger — or its job has stopped running without
  // committing it. A spawning pass allocates its generation only at commit, so
  // the passes, not a generation, name the state this job renders after.
  // Empty for a job spawned from committed state (reconcile). Absent from the
  // args of a job enqueued by a worker predating the field.
  spawningIndexPasses: SpawningIndexPass[];
  // What the job waits on when `spawningIndexPasses` is empty: the realm
  // generation it was spawned from, committed state for a reconcile repair,
  // or, on a job enqueued by a worker predating `spawningIndexPasses`, the
  // generation its spawning pass anticipated, which its visits wait for
  // `current_generation` to reach. A job spawned by an index pass carries the
  // generation that pass anticipated too, read only by a worker predating
  // `spawningIndexPasses`, which requires one. The rows the job writes are
  // stamped per URL from the live index (see `runPrerenderHtmlPass`), never
  // from this value.
  generation: number;
  // The realm's loader epoch the spawning pass renders under (minted fresh
  // when its invalidation set includes executable modules). Threaded into
  // every render so each prerender tab resets its loader exactly once per
  // module change.
  loaderEpoch: string;
  // The index job that computed this invalidation set. Load-bearing, not just
  // correlation: it is the render scope this job's visits run under
  // (`renderScopeFor`), so the pass and the index pass that spawned it share
  // one prerender-tab residency rather than each dropping what the other just
  // built. Stop populating it and every visit falls back to this job's own id
  // — no test fails, and a tab alternating between the two passes reloads
  // every link target on every alternation.
  spawningJobId: number | null;
  // How many publishes were merged into this job while it sat pending.
  // Dashboard/log correlation only; null means none. In-flight piggyback
  // joins can't be counted here — a running worker holds its args in memory,
  // so the queue never writes an update for them.
  coalescedPublishes: number | null;
  // True when a from-scratch index pass spawned this job (directly or via
  // coalescing, OR-preserved below): the realm-wide module pre-warm sweep runs
  // once at the start of the pass. Incremental spawns leave it false — the
  // sweep is O(realm module count), deliberately not paid on incrementals.
  preWarm: boolean;
}

export interface PrerenderHtmlResult extends JSONTypes.Object {
  invalidations: string[];
  // The realm's committed generation when the job's visits were released:
  // every row it wrote is stamped at or below it (see `runPrerenderHtmlPass`).
  generation: number;
  // The index jobs whose passes the visits waited on (see
  // `PrerenderHtmlArgs.spawningIndexPasses`).
  spawningIndexJobIds: number[];
  stats: Stats;
  // Phase wall-clocks the job paid, by name, or null when it recorded none.
  // `preWarmMs` is the module pre-warm sweep (from-scratch-spawned jobs only),
  // so dashboards attribute the sweep to the job that pays it. `spawnGateMs`
  // is how long the visits waited for the spawning passes to commit. `swapMs`,
  // `swapAttempts` and `swapRetryMs` describe the swap's transaction, and
  // `pendingCleanupMs`, `janitorRowsCleared` and `janitorStagingsCleared` the
  // cleanup after it, as on an index job's `phaseTimings`. A record of numbers rather than optional
  // members because the result is a `JSONTypes.Object`, whose index signature
  // rejects `undefined`.
  phaseTimings: Record<string, number> | null;
  // How the queue claimed this job, as on an index job's result (see
  // `IncrementalResult.queueClaim`); null when no queue claimed it.
  queueClaim: QueueClaim | null;
}

// The measured phases only, or null when none was measured.
function phaseTimingsRecord(
  phases: Record<string, number | undefined>,
): Record<string, number> | null {
  let measured = Object.entries(phases).filter(
    (entry): entry is [string, number] => entry[1] !== undefined,
  );
  return measured.length > 0 ? Object.fromEntries(measured) : null;
}

// Parsed args, plus whether they came from a worker predating
// `spawningIndexPasses` (see `choosePrerenderHtmlCoalesceDecision`).
interface CoalesceArgs extends PrerenderHtmlArgs {
  legacy: boolean;
}

function parsePrerenderHtmlArgsForCoalesce(
  args: unknown,
): CoalesceArgs | undefined {
  if (!isObjectLike(args)) {
    return undefined;
  }
  let {
    realmURL,
    realmUsername,
    changes,
    spawningIndexPasses,
    generation,
    loaderEpoch,
    spawningJobId,
    coalescedPublishes,
    preWarm,
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
  let passes = parseSpawningIndexPasses(spawningIndexPasses);
  return {
    realmURL,
    realmUsername,
    changes: changes as IncrementalChange[],
    spawningIndexPasses: passes ?? [],
    generation,
    loaderEpoch,
    spawningJobId: typeof spawningJobId === 'number' ? spawningJobId : null,
    coalescedPublishes:
      typeof coalescedPublishes === 'number' ? coalescedPublishes : null,
    preWarm: preWarm === true,
    legacy: passes === undefined,
  };
}

function spawnedByIndexPasses(args: PrerenderHtmlArgs): boolean {
  return args.spawningIndexPasses.length > 0;
}

// Whether two pending publishes can merge into one job. They cannot when:
//
// - either was enqueued by a worker predating `spawningIndexPasses`. Such a
//   job names its spawning pass only by generation, which the merged job would
//   no longer wait on once it carried passes — so its URLs could render before
//   that pass commits.
// - one was spawned by index passes and the other from committed state (a
//   reconcile repair), under different loader epochs. Which epoch is the newer
//   depends on whether the spawning passes committed before the state the
//   repair read, and a merged job rendering under the older one would keep a
//   stale module cache in every tab it reuses.
//
// Kept apart, the two run in order, since a publish only ever meets
// candidates of its own lane, and a lane runs one job at a time.
function canMergePending(existing: CoalesceArgs, incoming: CoalesceArgs) {
  if (existing.legacy || incoming.legacy) {
    return false;
  }
  if (
    spawnedByIndexPasses(existing) !== spawnedByIndexPasses(incoming) &&
    existing.loaderEpoch !== incoming.loaderEpoch
  ) {
    return false;
  }
  return true;
}

// Which of two merging publishes the merged job takes its loader epoch and
// render scope from: the later enqueue, except that between two reconcile
// repairs the one spawned from the higher committed generation is the newer.
// (A repair and a spawned publish merge only under the same epoch — see
// `canMergePending` — so which one wins there decides only the scope.)
function newerPublish(
  existing: PrerenderHtmlArgs,
  incoming: PrerenderHtmlArgs,
): PrerenderHtmlArgs {
  if (!spawnedByIndexPasses(existing) && !spawnedByIndexPasses(incoming)) {
    return incoming.generation >= existing.generation ? incoming : existing;
  }
  return incoming;
}

function unionPasses(
  a: SpawningIndexPass[],
  b: SpawningIndexPass[],
): SpawningIndexPass[] {
  let byPassId = new Map<string, SpawningIndexPass>();
  for (let pass of [...a, ...b]) {
    byPassId.set(pass.passId, pass);
  }
  return [...byPassId.values()];
}

// Modeled on `chooseIncrementalCoalesceDecision`: a same-realm pending
// publish joins by merging the URL sets (update wins per URL — see
// `mergePrerenderHtmlChanges`) and taking the union of the spawning index
// passes, so the merged job waits for every pass whose work it now renders. It
// renders from current source, so it takes the newer publish's loader epoch
// and render scope (see `newerPublish`). Some pairs cannot merge at all (see
// `canMergePending`).
//
// A publish can piggyback on an in-flight job only when that job already
// waits on every spawning pass the publish names, covers every incoming
// (url, operation), and renders under the same loader epoch. A publish from
// committed state (no spawning passes) piggybacks only on an in-flight job
// spawned from an equal-or-newer committed generation: a job with spawning
// passes may already have read the index generations it stamps, so it cannot
// promise to cover rows that moved since. Anything else inserts a fresh row,
// which its lane runs after the running job.
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
    if (!canMergePending(existingArgs, incomingArgs)) {
      return { type: 'insert' };
    }
    let newest = newerPublish(existingArgs, incomingArgs);
    let { legacy: _legacy, ...existingJobArgs } = existingArgs;
    return {
      type: 'join',
      jobId: sameTypeCandidate.id,
      update: {
        ...maxPriorityAndTimeout(sameTypeCandidate, incoming),
        args: {
          ...existingJobArgs,
          changes: mergePrerenderHtmlChanges(
            existingArgs.changes,
            incomingArgs.changes,
          ),
          spawningIndexPasses: unionPasses(
            existingArgs.spawningIndexPasses,
            incomingArgs.spawningIndexPasses,
          ),
          generation: Math.max(
            existingArgs.generation,
            incomingArgs.generation,
          ),
          loaderEpoch: newest.loaderEpoch,
          // The render scope follows the same rule as the epoch.
          spawningJobId:
            newest.spawningJobId ??
            (newest === incomingArgs ? existingArgs : incomingArgs)
              .spawningJobId,
          coalescedPublishes:
            (existingArgs.coalescedPublishes ?? 0) +
            (incomingArgs.coalescedPublishes ?? 0) +
            1,
          // OR semantics: a from-scratch-spawned publish merged with
          // incremental-spawned work keeps the pre-warm bit, so the merged
          // job still runs the realm-wide sweep. The pass runs the sweep once
          // at its start regardless of how many publishes coalesced into it.
          preWarm: existingArgs.preWarm || incomingArgs.preWarm,
        },
      },
    };
  }

  let incomingArgs = parsePrerenderHtmlArgsForCoalesce(incoming.args);
  if (incomingArgs && !incomingArgs.legacy) {
    for (let candidate of inFlightCandidates) {
      if (candidate.jobType !== incoming.jobType) {
        continue;
      }
      let existingArgs = parsePrerenderHtmlArgsForCoalesce(candidate.args);
      if (!existingArgs || existingArgs.legacy) {
        continue;
      }
      if (
        waitsOnEverySpawner(existingArgs, incomingArgs) &&
        existingArgs.loaderEpoch === incomingArgs.loaderEpoch &&
        incrementalChangesCover(existingArgs.changes, incomingArgs.changes)
      ) {
        return { type: 'join', jobId: candidate.id };
      }
    }
  }

  return { type: 'insert' };
}

// Whether an in-flight job's wait covers an incoming publish's: every spawning
// pass the publish names is one the job already waits on. A publish from
// committed state needs a job spawned from committed state at least as new —
// see `choosePrerenderHtmlCoalesceDecision`.
function waitsOnEverySpawner(
  existing: PrerenderHtmlArgs,
  incoming: PrerenderHtmlArgs,
): boolean {
  if (!spawnedByIndexPasses(incoming)) {
    return (
      !spawnedByIndexPasses(existing) &&
      existing.generation >= incoming.generation
    );
  }
  let existingPassIds = new Set(
    existing.spawningIndexPasses.map((pass) => pass.passId),
  );
  return incoming.spawningIndexPasses.every((pass) =>
    existingPassIds.has(pass.passId),
  );
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
  definitionLookup,
  virtualNetwork,
  createPrerenderAuth,
  mediaCacheAdapter,
}) =>
  async function (args) {
    let {
      jobInfo,
      realmUsername,
      realmURL,
      changes,
      loaderEpoch,
      // A job enqueued by an older worker (rolling deploy) or by a code path
      // predating the flag carries no `preWarm`; default it to false so the
      // boolean contract holds and a legacy job simply skips the sweep.
      preWarm = false,
    } = args;
    // Read loosely: a job enqueued by a worker predating
    // `spawningIndexPasses` carries none, and waits on its generation.
    let spawningIndexPasses =
      parseSpawningIndexPasses(args.spawningIndexPasses) ?? [];
    let { generation } = args;
    let spawningIndexJobIds = [
      ...new Set(spawningIndexPasses.map((pass) => pass.jobId)),
    ];
    log.debug(
      `${jobIdentity(jobInfo)} starting prerender-html for realm ${realmURL} (${changes.length} changes, spawning index jobs [${spawningIndexJobIds.join(', ')}], generation ${generation}, preWarm ${preWarm})`,
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
    let pass = await runPrerenderHtmlPass({
      realmURL: new URL(realmURL),
      changes,
      spawningIndexPasses,
      generation,
      spawningJobId: args.spawningJobId ?? null,
      loaderEpoch,
      preWarm,
      indexWriter,
      definitionLookup,
      virtualNetwork,
      reader,
      fetch: _fetch,
      realmOwnerUserId: userId,
      prerenderer,
      auth,
      // `-1` keeps the logging shape when the queue supplies no job (it always
      // does in production). It must not reach the render scope, though:
      // `<realm>@-1` would be one bucket shared by every such pass, which is
      // the one construction that can put unrelated passes in one scope.
      // `visit-file.ts` omits the scope in the same situation; `null` here
      // routes to the same omission rather than to the sentinel.
      jobInfo: jobInfo ?? {
        jobId: -1,
        reservationId: -1,
        priority: 0,
        queueWaitMs: null,
        concurrencyGroup: null,
        laneFamily: null,
      },
      jobPriority: jobInfo?.priority,
      onProgress: reportProgress,
      // Declared-screenshot persistence. Optional: a worker without a
      // MediaCache configured still renders HTML, it just captures nothing.
      dbAdapter,
      mediaCacheAdapter,
    });
    let { invalidations, stats } = pass;

    // Fresh HTML is live — tell subscribed hosts so open live searches
    // re-run and pick up the new renderings / corrected full-text
    // membership. Rides the worker→manager→realm-server event bridge. The
    // generation is the committed one the renders were stamped against, which
    // is the floor the host's live search reads at.
    reportRealmEvent?.({
      eventName: 'prerender_html',
      realmURL,
      generation: pass.generation,
      invalidations,
    });

    reportStatus(jobInfo, 'finish');
    log.debug(
      `${jobIdentity(jobInfo)} completed prerender-html for realm ${realmURL} at generation ${pass.generation}:\n${JSON.stringify(stats, null, 2)}`,
    );
    return {
      invalidations,
      generation: pass.generation,
      spawningIndexJobIds,
      stats,
      phaseTimings: phaseTimingsRecord({
        preWarmMs: pass.preWarmMs,
        spawnGateMs: pass.spawnGateMs,
        swapMs: pass.swapMs,
        swapAttempts: pass.swapAttempts,
        swapRetryMs: pass.swapRetryMs,
        pendingCleanupMs: pass.pendingCleanupMs,
        janitorRowsCleared: pass.janitorRowsCleared,
        janitorStagingsCleared: pass.janitorStagingsCleared,
      }),
      queueClaim: queueClaimOf(jobInfo) ?? null,
    };
  };
