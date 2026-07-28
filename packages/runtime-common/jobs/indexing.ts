import type {
  CoalescedCaller,
  IncrementalArgs,
  IncrementalChange,
  IncrementalDoneResult,
  IncrementalResult,
} from '../tasks/indexer.ts';
import { param, query, type PgPrimitive } from '../expression.ts';
import type { DBAdapter } from '../db.ts';
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
