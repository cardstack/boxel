import type {
  CoalescedCaller,
  DeferredPrerenderHtml,
  IncrementalArgs,
  IncrementalChange,
  IncrementalDoneResult,
  IncrementalResult,
  SharedIndexPass,
} from '../tasks/indexer.ts';
import {
  param,
  query,
  type Expression,
  type PgPrimitive,
} from '../expression.ts';
import type { DBAdapter } from '../db.ts';
import { baseRealm, baseRealmRRI } from '../constants.ts';
import { systemInitiatedPriority, userInitiatedPriority } from '../queue.ts';
import { Deferred } from '../deferred.ts';
import { parseSpawningIndexPasses } from './prerender-html.ts';
import { v4 as uuidv4 } from '@lukeed/uuid';
import { isObjectLike } from 'lodash-es';

export const INCREMENTAL_INDEX_JOB_TIMEOUT_SEC = 10 * 60;

// The name of a realm's index lane. Membership in it means one thing only:
// serialize against everything else in it. Every job that writes the realm's
// index joins — from-scratch, incremental, copy — and so does work that must
// not overlap a running pass without writing the index itself, today
// `scoped-css-gc` (see `runtime-common/scoped-css-gc.ts`).
//
// So the lane's membership does not answer "is this realm's index behind its
// source". A reader asking that must narrow to `INDEX_WRITING_JOB_TYPES`;
// reading the bare lane reports a realm as mid-index for as long as a GC sweep
// sits queued behind an unrelated backlog. A caller that wants the lane itself
// — cancelling a realm's outstanding work on teardown — wants every member and
// should not narrow.
export function indexingConcurrencyGroup(realmURL: string): string {
  return `indexing:${realmURL}`;
}

// The priority a system-initiated index of `realmURL` is enqueued at.
//
// Priority is a worker pool's dequeue floor, never a sort key: within a pool
// jobs are claimed in strict arrival order (see the tier table in queue.ts).
// A system-tier index is therefore reachable only by the all-priority pool,
// behind everything already queued at any tier — survivable for a realm whose
// stale index affects only itself.
//
// Not survivable for the base realm. Every card in the system imports from it,
// so for as long as its index carries an error row, anonymous `card+json`
// reads fail on every realm that links a base card. Its repair must not be
// able to queue behind a backlog, and a sweep that reindexes every realm is
// exactly such a backlog — one can hold a millisecond-scale base-realm repair
// for over an hour.
// At the user-initiated tier the high-priority pool can serve base while the
// sweep occupies the all-priority pool.
//
// Base is the only realm elevated this way, and two things bound what that
// costs. Every job that writes a realm's index shares
// `indexingConcurrencyGroup(realmURL)`, and the claim query skips any group
// already holding a live reservation — so base's index occupies one worker at
// a time. And the elevation stops at the index: follow-on prerender-html work
// derives its tier from `prerenderSpawnedPriority` below rather than from the
// elevated value, so a realm-wide HTML sweep for base cannot take a second
// worker out of the same pool. Each further realm elevated would add another
// index group, and so another worker held off user-initiated work; the other
// bootstrap realms (catalog, skills, ...) stay at the system tier and get FIFO
// position instead (see `getFullReindexRealmUrls`).
//
// Two pool shapes float above the system tier and could serve this: the
// high-priority pool (`--highPriorityCount`), flooring one tier below
// indexing, and the dedicated index lane (`--userIndexCount` +
// `--indexJobsOnly`), which floors at exactly this tier and registers only
// indexing job types. The lane would be the better home of the two — a
// prerender-html sweep can neither hold it nor be held by it — but no
// deployment configures it today, so in practice this reaches the
// high-priority pool. A deployment that runs neither has no pool above the
// lowest floor, so base's job waits its turn in the all-priority pool's FIFO
// like anything else, and the sweep ordering is what covers that case.
export function systemInitiatedIndexPriority(realmURL: string): number {
  return isBaseRealm(realmURL)
    ? userInitiatedPriority
    : systemInitiatedPriority;
}

// Every deployment configures the base realm with
// `--fromUrl https://cardstack.com/base/`, so that is the URL its registry row
// and its index jobs carry. The `@cardstack/base/` alias is matched too:
// main.ts registers it as an equivalent realm mapping for base, so a caller
// holding that form names the same realm and must not silently fall back to
// the system tier.
function isBaseRealm(realmURL: string): boolean {
  return realmURL === baseRealm.url || realmURL === baseRealmRRI;
}

// The tier that work spawned by an index pass — the realm's prerender-html
// job — should derive from.
//
// Normally that is the index job's own priority, which is what makes an HTML
// job track the pass that produced it. The exception is the base-realm
// elevation above: it exists so a base *index* can reach a worker pool the
// system-tier backlog cannot, and says nothing about base's HTML. Propagating
// it would put base's prerender-html job one tier below the elevated index —
// still inside the high-priority pool, in its own concurrency group — so every
// deploy's bootstrap reindex would hand that pool a second, long-running job:
// a from-scratch pass sets `preWarm`, whose module sweep is O(realm module
// count). The lane exists to stay clear for latency-sensitive work, and base's
// HTML is not on the path of anything waiting.
//
// A publish that awaits the HTML keeps the index tier, because there the
// render genuinely is on the caller's critical path. A user-initiated base
// reindex is demoted along with the system-initiated one: the two are
// indistinguishable here, and HTML is not what such a caller waits on.
export function prerenderSpawnedPriority({
  realmURL,
  indexPriority,
  awaitedByPublish,
}: {
  realmURL: string;
  indexPriority: number;
  awaitedByPublish?: boolean;
}): number {
  if (awaitedByPublish) {
    return indexPriority;
  }
  if (indexPriority === userInitiatedPriority && isBaseRealm(realmURL)) {
    return systemInitiatedPriority;
  }
  return indexPriority;
}

// Await a realm's index lane holding no outstanding work. The in-process
// gates (`Realm.indexing()` and friends) only see jobs the current instance
// published, so with several realm-server replicas behind one load balancer
// they answer per-replica; the `jobs` rows are the same for every replica.
//
// Signal: no `unfulfilled` job in the realm's index concurrency group, which
// covers both queued and running jobs. A job's status is stamped only after its
// handler has returned, so its index writes are already committed by the time
// it stops counting as unfulfilled — a clear lane means every index write
// enqueued so far is durable. Resolves true when the lane is clear, false on
// timeout.
//
// The lane is a point-in-time read, and it is safe to take one because the
// flows that poll for readiness enqueue durably before they respond: publish
// commits its reindex job inside the write lock it returns 202 from, and
// createRealm mounts and indexes before its own 202. There is no window where
// a caller can observe an empty lane for work it has already been promised.
//
// A realm with no server-side queue has no lane it could be behind, and
// answers settled without a query: `jobs` is Postgres-only, absent from the
// browser realm's SQLite schema, and that realm is a single process whose
// in-process gates already see all of its own indexing. Handling it here rather
// than at the call site keeps the contract total, so a caller that doesn't
// know about the asymmetry gets the right answer instead of a missing-table
// error.
//
// Woken by NOTIFY rather than tight-polling: pg-queue emits `NOTIFY
// jobs_finished` when a job's finalize transaction commits, so re-checking on
// that signal catches the lane draining near-instantly. The periodic poll is a
// safety net for a missed notification, so it stays coarse.
//
// The budget is deliberately short. Holding a request open is only a courtesy
// to the poller — `Retry-After` already tells it to come back — and a hold
// longer than a caller's deadline is worse than no hold at all. The binding
// constraint is the per-request kind: the CI readiness probes cap each attempt
// at `curl --max-time 15`, so a hold past that yields a connection timeout on
// every attempt instead of a status the loop can read. The budget stays under
// that with margin.
//
// It bounds one request, not a caller's total: a poller re-checks its own
// deadline only between requests, so an attempt started just under the wire
// overshoots by up to the length of the hold. A shorter budget bounds that
// overshoot; no budget removes it.
// Why a realm that has never had an index built has none: the failure of the
// newest from-scratch job in its index lane, when that job was rejected.
// Undefined when the realm has an index, when no from-scratch job has run, or
// when the newest one completed.
//
// "Never had an index built" is read from `realm_generations`: a pass inserts
// the realm's row at generation 0 before it visits anything and advances the
// generation only when it completes, so a row at 0 — or none — means no pass
// has ever promoted rows. A rejected job over an index that a later pass built
// is history and does not count. Both facts come from the rows every replica
// reads, so the answer holds whichever replica ran the job and whichever path
// enqueued it — a realm's own reindex endpoints, a publish, a system-wide
// reindex — and a pass that completes from any of them clears it as it lands.
export async function unbuiltIndexFailure(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string | undefined> {
  if (dbAdapter.kind !== 'pg') {
    return undefined;
  }
  let [generation] = (await query(dbAdapter, [
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ])) as { current_generation: number | string }[];
  if (generation && Number(generation.current_generation) > 0) {
    return undefined;
  }
  let [job] = (await query(dbAdapter, [
    `SELECT status, result FROM jobs WHERE job_type = 'from-scratch-index' AND concurrency_group =`,
    param(indexingConcurrencyGroup(realmURL)),
    'ORDER BY id DESC LIMIT 1',
  ])) as { status: string; result: unknown }[];
  if (!job || job.status !== 'rejected') {
    return undefined;
  }
  let { result } = job;
  if (isObjectLike(result) && typeof (result as any).message === 'string') {
    return (result as any).message;
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// The indexing jobs that can leave a card's index row describing bytes the
// realm no longer stores — which is the only thing a reader comparing an
// index-derived validator against the stored file needs to wait for.
//
// Derived from what moves BYTES, not from what the write-path drain happens to
// wait for. Only a write moves a card's stored file, and a write's indexing is
// one of these two. A `from-scratch-index` re-derives rows from files nobody
// changed, so it moves `indexed_at` without moving content — and the one case
// where it follows a real content change, a realm republish, cannot matter
// here: a published realm is created with `['read', 'realm-owner']` and
// `'*': ['read']` and grants write to nobody, so no conditional write can
// reach one. `scoped-css-gc` shares the lane too and only deletes unreferenced
// stylesheet rows.
//
// Narrow on purpose: this list decides who WAITS, and the lane is shared with
// passes that run fleet-wide for an hour at a time.
export const CONTENT_MOVING_INDEX_JOB_TYPES = [
  'incremental-index',
  'copy-index',
];

// The jobs in a realm's index lane that write the index, which is what a reader
// asking "is this realm's index behind its source" is waiting on. A superset of
// `CONTENT_MOVING_INDEX_JOB_TYPES`: a from-scratch pass re-derives rows without
// moving bytes, so it does not gate a conditional write, but it does leave the
// index behind its source until it lands.
//
// An allow-list of index-writing types, not a deny-list of the rest. The lane
// carries work that only needs mutual exclusion with a pass, and a deny-list
// would silently make the next such job to join a readiness signal.
export const INDEX_WRITING_JOB_TYPES = [
  'from-scratch-index',
  ...CONTENT_MOVING_INDEX_JOB_TYPES,
];

// `AND job_type IN (...)`, or nothing when the caller wants the whole lane.
// `column` qualifies the name for a query that aliases `jobs`; it is spelled
// into the SQL rather than bound, so the type enumerates the two forms instead
// of taking any string.
//
// Absent and empty are different filters, and the truthiness test that reads
// naturally here collapses them in the expensive direction — a caller whose
// list came out empty would get the whole lane instead of nothing. Every
// reader sharing this helper inherits that distinction rather than restating
// it, so a caller that computes its list cannot land on the wrong one.
export function jobTypeFilter(
  jobTypes: string[] | undefined,
  column: 'job_type' | 'j.job_type' = 'job_type',
): Expression {
  if (!jobTypes) {
    return [];
  }
  if (jobTypes.length === 0) {
    // A filter no row can match. `IN ()` is a syntax error, so the empty set
    // is spelled as a predicate that is simply never true.
    return ['AND FALSE'];
  }
  let expression: Expression = [`AND ${column} IN`, '('];
  jobTypes.forEach((jobType, index) => {
    if (index > 0) {
      expression.push(',');
    }
    expression.push(param(jobType));
  });
  expression.push(')');
  return expression;
}

// The unfulfilled jobs holding a realm's lane, oldest first — what a gate that
// expired was waiting on. For diagnostics only: a caller deciding anything must
// ask `awaitRealmIndexSettled`, whose answer is one query rather than a read
// that can disagree with the gate it explains.
//
// Capped because it lands in a log line. A realm's lane serializes, so it holds
// a handful in practice; the cap only bounds a pathological backlog, and a lane
// that deep is diagnosed from the queue, not from one realm's readiness log.
const OUTSTANDING_INDEX_JOBS_LOG_CAP = 10;

// `claimed` separates the two states a reader of this has to tell apart: a job
// waiting behind a backlog, and a job whose worker died holding it and has yet
// to be reaped. The ids and types read identically for both, so without it the
// log line names the lane's occupants but not which kind of stuck they are.
//
// A live reservation is an uncompleted one that has not expired, the same
// predicate `currentJobProgress` reads for `has_worker`. An expired reservation
// is a dead attempt: the job is claimable again, which reads as waiting.
// `job_reservations(job_id)` is indexed, so the subquery stays well inside the
// budget the only caller bounds this with.
export interface LaneHolder {
  id: number;
  jobType: string;
  claimed: boolean;
}

export async function outstandingIndexJobs(
  dbAdapter: DBAdapter,
  realmURL: string,
  jobTypes?: string[],
): Promise<LaneHolder[]> {
  if (dbAdapter.kind !== 'pg') {
    return [];
  }
  let rows = (await query(dbAdapter, [
    `SELECT id, job_type,`,
    `EXISTS (SELECT 1 FROM job_reservations jr WHERE jr.job_id = jobs.id`,
    `AND jr.completed_at IS NULL AND jr.locked_until > NOW()) AS claimed`,
    `FROM jobs WHERE status = 'unfulfilled' AND concurrency_group =`,
    param(indexingConcurrencyGroup(realmURL)),
    ...jobTypeFilter(jobTypes),
    `ORDER BY id LIMIT ${OUTSTANDING_INDEX_JOBS_LOG_CAP}`,
  ])) as { id: number | string; job_type: string; claimed: boolean }[];
  return rows.map((row) => ({
    id: Number(row.id),
    jobType: row.job_type,
    claimed: Boolean(row.claimed),
  }));
}

// `outstandingIndexJobs` for a log line on a path that must still answer.
//
// Never throws, and never outlives `timeoutMs`. Both matter because the only
// caller reads the lane AFTER a gate has already spent its budget: a rejection
// there would replace that gate's deliberate answer with an unexpected-exception
// 500, losing the headers the answer is carried in, and a slow read would push
// the request past the deadline the budget exists to bound. A lane that has not
// drained is also the case where the database is least likely to answer
// quickly, so neither is a remote possibility — it is the expected weather.
//
// Three outcomes rather than a value-or-nothing, because each sends whoever
// reads the log somewhere different. An empty lane says the lane drained just
// after the gate expired. A rejection says the database answered and refused,
// and carries why. A timeout says it did not answer at all. Collapsing the last
// two would print a budget the query may never have spent — a connection error
// returning in 2ms would read as a slow database.
export type LaneHoldersRead =
  | { outcome: 'read'; holders: LaneHolder[] }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'timed-out' };

export async function readLaneHoldersBestEffort(
  dbAdapter: DBAdapter,
  realmURL: string,
  jobTypes: string[] | undefined,
  timeoutMs: number,
): Promise<LaneHoldersRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = new Promise<LaneHoldersRead>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: 'timed-out' }), timeoutMs);
  });
  try {
    return await Promise.race([
      outstandingIndexJobs(dbAdapter, realmURL, jobTypes).then(
        (holders): LaneHoldersRead => ({ outcome: 'read', holders }),
        (error): LaneHoldersRead => ({
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      ),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function awaitRealmIndexSettled(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    // Narrows the lane to particular job types. Absent means the whole
    // `indexing:<realm>` lane, including members that only need mutual
    // exclusion with a pass — which is a stronger claim than any caller here
    // wants, so both readiness and the write-path drain pass a list. Empty is
    // a filter naming no job rather than no filter, so it settles at once.
    jobTypes?: string[];
    // Narrows the lane to passes this writer has a stake in. Reading your own
    // write matters; being made to read someone else's does not, and serving
    // another user a stale version of the card you are updating is the
    // intended behaviour rather than a compromise. So a caller that names
    // itself waits for its own indexing and lets every other writer's pass go
    // by, where one naming nobody waits for the lane — which is what a
    // readiness probe or a publish means.
    //
    // A pass no HTTP write produced records no user, and reads as the realm
    // owner rather than as nobody: a row written before the column existed, a
    // file-watcher echo, a GC sweep still gate somebody, and the owner is the
    // identity such a pass is closest to. The consequence is that the owner
    // pays for those passes and no other writer does, which is the intended
    // reading — it fails closed for exactly one identity.
    //
    // One option rather than two, because the owner is what decides an
    // untagged pass and a scope missing it would silently let every one of
    // them through — the gate would then report settled for exactly the
    // passes this arm exists to cover. Both are full matrix ids, as
    // `initiated_by` records them: `Realm` answers with one from
    // `getRealmOwnerUserId()`, while `getRealmOwnerUsername()` strips the
    // sigil and the server and can never match an entry.
    initiatedBy?: { user: string; realmOwner: string };
  },
): Promise<boolean> {
  if (dbAdapter.kind !== 'pg') {
    return true;
  }

  let timeoutMs = opts?.timeoutMs ?? 10_000;
  let pollIntervalMs = opts?.pollIntervalMs ?? 1000;

  let jobTypes = opts?.jobTypes;
  let initiatedBy = opts?.initiatedBy;

  let hasSettled = async () => {
    // An absent `jobTypes` is no filter; an empty one is a filter that names
    // no job, which no row can match. Collapsing the two is cheap to do and
    // expensive to have done — it turns "wait for nothing" into "wait for
    // every job in the realm's lane", which is how a caller whose list came
    // out empty ends up queued behind a full reindex rather than proceeding.
    if (jobTypes && jobTypes.length === 0) {
      return true;
    }
    let expression: Expression = [
      `SELECT 1 FROM jobs WHERE status = 'unfulfilled' AND concurrency_group =`,
      param(indexingConcurrencyGroup(realmURL)),
    ];
    if (initiatedBy) {
      // Containment over the recorded set, since a coalesced pass carries
      // every caller that merged into it. The null arm is the untagged pass,
      // which gates the realm owner alone.
      expression.push(
        `AND (initiated_by @> to_jsonb(`,
        param(initiatedBy.user),
        `::text) OR (initiated_by IS NULL AND`,
        param(initiatedBy.user),
        `=`,
        param(initiatedBy.realmOwner),
        `))`,
      );
    }
    expression.push(...jobTypeFilter(jobTypes));
    expression.push('LIMIT 1');
    let rows = await query(dbAdapter, expression);
    return rows.length === 0;
  };

  if (await hasSettled()) {
    return true;
  }

  let ready = new Deferred<boolean>();
  let settled = false;
  let settle = (value: boolean) => {
    if (!settled) {
      settled = true;
      ready.fulfill(value);
    }
  };
  let recheck = () => {
    hasSettled().then(
      (laneIsClear) => {
        if (laneIsClear) {
          settle(true);
        }
      },
      () => {
        // A transient query error just waits for the next signal / poll tick.
      },
    );
  };

  let subscription: { unsubscribe: () => Promise<void> } | undefined;
  let poll = setInterval(recheck, pollIntervalMs);
  let timer = setTimeout(() => settle(false), timeoutMs);
  // Subscribe fire-and-forget: the poll is the guarantee, so a slow or failed
  // LISTEN must never block the result or the timeout. If it comes up after
  // we've already settled, just tear it down; otherwise re-check once, since
  // the lane may have drained between the check above and the LISTEN
  // establishing.
  let subscribe = (
    dbAdapter as unknown as {
      subscribe?: (
        channel: string,
        handler: () => void,
      ) => Promise<{ unsubscribe: () => Promise<void> }>;
    }
  ).subscribe;
  if (subscribe) {
    subscribe.call(dbAdapter, 'jobs_finished', recheck).then(
      (sub) => {
        if (settled) {
          void sub.unsubscribe();
        } else {
          subscription = sub;
          recheck();
        }
      },
      () => {
        // LISTEN setup failed — rely on the poll.
      },
    );
  }
  try {
    return await ready.promise;
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
    await subscription?.unsubscribe();
  }
}

function parseIncrementalResult(
  result: PgPrimitive,
): IncrementalResult | undefined {
  if (!isObjectLike(result) || Array.isArray(result)) {
    return undefined;
  }
  let {
    invalidations,
    invalidatedTypes,
    ignoreData,
    stats,
    generation,
    deferredPrerenderHtml,
    coalescedCallers,
  } = result as Record<string, PgPrimitive>;
  if (
    !Array.isArray(invalidations) ||
    !invalidations.every((value) => typeof value === 'string') ||
    !isObjectLike(ignoreData) ||
    Array.isArray(ignoreData) ||
    !isObjectLike(stats) ||
    Array.isArray(stats)
  ) {
    return undefined;
  }
  // A result from a worker predating the type-carrying event simply has no
  // `invalidatedTypes`; dropping a malformed one has the same effect, which is
  // that subscribers re-run unconditionally the way they always did.
  let parsedTypes =
    Array.isArray(invalidatedTypes) &&
    invalidatedTypes.every((value) => typeof value === 'string')
      ? (invalidatedTypes as string[])
      : undefined;
  let deferred = parseDeferredPrerenderHtml(deferredPrerenderHtml);
  return {
    invalidations,
    ...(parsedTypes !== undefined ? { invalidatedTypes: parsedTypes } : {}),
    ignoreData: ignoreData as Record<string, string>,
    stats: stats as IncrementalResult['stats'],
    ...(typeof generation === 'number' ? { generation } : {}),
    ...(deferred ? { deferredPrerenderHtml: deferred } : {}),
    ...(Array.isArray(coalescedCallers)
      ? { coalescedCallers: parseCoalescedCallers(coalescedCallers) }
      : {}),
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

// The callers a pass indexed, as the claimed job's args named them. Read
// loosely: an entry written by a realm server predating a member lacks it, and
// one missing its identity is dropped rather than guessed at.
function parseCoalescedCallers(value: unknown[]): CoalescedCaller[] {
  let callers: CoalescedCaller[] = [];
  for (let caller of value) {
    if (!isObjectLike(caller)) {
      continue;
    }
    let { waiterId, clientRequestId, urls, clientAuthored, announcesPass } =
      caller as Record<string, unknown>;
    if (
      typeof waiterId !== 'string' ||
      (clientRequestId !== null && typeof clientRequestId !== 'string')
    ) {
      continue;
    }
    callers.push({
      waiterId,
      clientRequestId,
      urls: isStringArray(urls) ? urls : null,
      clientAuthored: isStringArray(clientAuthored) ? clientAuthored : null,
      announcesPass: announcesPass === true,
    });
  }
  return callers;
}

// How one caller of a pass relates to the others it shared the pass with.
// Undefined when the pass indexed this caller alone, or when it cannot say who
// else it indexed (a result from an older worker), or when this caller is not
// among those named — a publish that attached to a job already running is not
// in the args that job was claimed with. Each of those leaves the caller
// announcing the pass itself — a duplicate a subscriber can absorb, where a
// caller wrongly standing down would leave the pass unannounced.
function sharedPassFor(
  waiterId: string | undefined,
  callers: CoalescedCaller[] | undefined,
): SharedIndexPass | undefined {
  if (
    waiterId === undefined ||
    !callers ||
    callers.length < 2 ||
    !callers.some((caller) => caller.waiterId === waiterId)
  ) {
    return undefined;
  }
  // The first caller that announces its passes as they land. Chosen from the
  // args rather than negotiated, so every caller — in whichever replica it is
  // waiting — reaches the same answer from the same result without talking to
  // the others. A caller for which this pass is only a step toward a later
  // one is passed over: its announcement waits on work that has not happened
  // yet and may never succeed. When no caller announces as it lands, nobody
  // stands down.
  let announcer = callers.find((caller) => caller.announcesPass);
  return {
    announcedByPeer: announcer !== undefined && announcer.waiterId !== waiterId,
    waiterId,
    callers,
  };
}

// A job run by a worker that predates `deferPrerenderHtml` returns no such
// field, and a caller that never asked to defer must not be handed one, so
// this reads loosely and yields undefined for anything but the full shape.
// Losing the set here is not silent: the write's own pass still enqueues its
// prerender job, so the deferred URLs simply go unrendered until the next
// pass touches them, exactly as a dropped fire-and-forget enqueue does today.
function parseDeferredPrerenderHtml(
  value: PgPrimitive,
): DeferredPrerenderHtml | undefined {
  if (!isObjectLike(value) || Array.isArray(value)) {
    return undefined;
  }
  let { changes, spawningIndexPass, generation, loaderEpoch } =
    value as Record<string, PgPrimitive>;
  if (
    !Array.isArray(changes) ||
    typeof generation !== 'number' ||
    typeof loaderEpoch !== 'string'
  ) {
    return undefined;
  }
  let parsedChanges: IncrementalChange[] = [];
  for (let change of changes) {
    if (!isObjectLike(change) || Array.isArray(change)) {
      return undefined;
    }
    let { url, operation } = change as Record<string, PgPrimitive>;
    if (
      typeof url !== 'string' ||
      (operation !== 'update' && operation !== 'delete')
    ) {
      return undefined;
    }
    parsedChanges.push({ url, operation });
  }
  // A set from a worker predating `spawningIndexPass` carries none, and
  // its enqueued job waits on the generation instead.
  let [pass] = parseSpawningIndexPasses([spawningIndexPass]) ?? [];
  return {
    changes: parsedChanges,
    loaderEpoch,
    spawningIndexPass: pass ?? null,
    generation,
  };
}

export interface IncrementalIndexEnqueueArgs {
  realmURL: string;
  realmUsername: string;
  changes: IncrementalChange[];
  ignoreData: Record<string, string>;
  // See IncrementalArgs for all three of these.
  deferPrerenderHtml?: boolean;
  carriedPrerenderHtmlChanges?: IncrementalChange[];
  readsOwnWrite?: boolean;
}

export function makeIncrementalArgsWithCallerMetadata(
  args: IncrementalIndexEnqueueArgs,
  clientRequestId: string | null,
  caller?: {
    // See CoalescedCaller.
    clientAuthored?: string[] | null;
    announcesPass?: boolean;
  },
): IncrementalArgs {
  let waiterId = uuidv4();
  let coalescedCallers: CoalescedCaller[] = [
    {
      waiterId,
      clientRequestId,
      urls: args.changes.map(({ url }) => url.replace(/\.json$/, '')),
      clientAuthored: caller?.clientAuthored ?? null,
      announcesPass: caller?.announcesPass === true,
    },
  ];
  return {
    realmURL: args.realmURL,
    realmUsername: args.realmUsername,
    changes: args.changes,
    ignoreData: args.ignoreData,
    coalescedCallers,
    deferPrerenderHtml: args.deferPrerenderHtml === true,
    carriedPrerenderHtmlChanges: args.carriedPrerenderHtmlChanges ?? [],
    readsOwnWrite: args.readsOwnWrite === true,
  };
}

export function mapIncrementalDoneResult(
  clientRequestId: string | null,
  // The caller's own entry in the job's `coalescedCallers`, so it can find
  // itself among the callers the pass reports.
  waiterId?: string,
): (result: PgPrimitive) => IncrementalDoneResult {
  return (result: PgPrimitive) => {
    let parsedResult = parseIncrementalResult(result);
    if (!parsedResult) {
      // `result` is either a serialized worker error (rejected job) or a
      // malformed success payload — a plain object either way. Wrap it in a
      // real Error so downstream logs show the detail instead of
      // "[object Object]" and instanceof-Error handling applies.
      throw new Error(
        `incremental-index job did not produce a usable result: ${JSON.stringify(
          result,
        )}`,
      );
    }
    let sharedPass = sharedPassFor(waiterId, parsedResult.coalescedCallers);
    return {
      ...parsedResult,
      clientRequestId,
      ...(sharedPass ? { sharedPass } : {}),
    };
  };
}
