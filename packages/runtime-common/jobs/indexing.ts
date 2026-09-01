import type {
  CoalescedCaller,
  IncrementalArgs,
  IncrementalChange,
  IncrementalDoneResult,
  IncrementalResult,
} from '../tasks/indexer.ts';
import { param, query, type PgPrimitive } from '../expression.ts';
import type { DBAdapter } from '../db.ts';
import { baseRealm, baseRealmRRI } from '../constants.ts';
import { systemInitiatedPriority, userInitiatedPriority } from '../queue.ts';
import { Deferred } from '../deferred.ts';
import { v4 as uuidv4 } from '@lukeed/uuid';
import { isObjectLike } from 'lodash-es';

export const INCREMENTAL_INDEX_JOB_TIMEOUT_SEC = 10 * 60;

// Every job that writes a realm's index — from-scratch, incremental, copy —
// shares one concurrency group, which is what makes them serialize per realm.
// Anything that reasons about a realm's index jobs as a set (enqueue,
// teardown, quiescence) must use this same name.
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
export async function awaitRealmIndexSettled(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<boolean> {
  if (dbAdapter.kind !== 'pg') {
    return true;
  }

  let timeoutMs = opts?.timeoutMs ?? 10_000;
  let pollIntervalMs = opts?.pollIntervalMs ?? 1000;

  let hasSettled = async () => {
    let rows = await query(dbAdapter, [
      `SELECT 1 FROM jobs WHERE status = 'unfulfilled' AND concurrency_group =`,
      param(indexingConcurrencyGroup(realmURL)),
      'LIMIT 1',
    ]);
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
  let { invalidations, ignoreData, stats, generation } = result as Record<
    string,
    PgPrimitive
  >;
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
  return {
    invalidations,
    ignoreData: ignoreData as Record<string, string>,
    stats: stats as IncrementalResult['stats'],
    ...(typeof generation === 'number' ? { generation } : {}),
  };
}

export interface IncrementalIndexEnqueueArgs {
  realmURL: string;
  realmUsername: string;
  changes: IncrementalChange[];
  ignoreData: Record<string, string>;
  invalidationMode?: 'direct' | 'recursive';
}

export function makeIncrementalArgsWithCallerMetadata(
  args: IncrementalIndexEnqueueArgs,
  clientRequestId: string | null,
): IncrementalArgs {
  let waiterId = uuidv4();
  let coalescedCallers: CoalescedCaller[] = [{ waiterId, clientRequestId }];
  return {
    realmURL: args.realmURL,
    realmUsername: args.realmUsername,
    changes: args.changes,
    ignoreData: args.ignoreData,
    invalidationMode: args.invalidationMode ?? 'recursive',
    coalescedCallers,
  };
}

export function mapIncrementalDoneResult(
  clientRequestId: string | null,
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
    return {
      ...parsedResult,
      clientRequestId,
    };
  };
}
