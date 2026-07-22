import {
  systemInitiatedPrerenderHtmlPriority,
  userInitiatedPrerenderHtmlPriority,
  userInitiatedPriority,
  type Job,
  type QueuePublisher,
} from '../queue.ts';
import { param, query, type PgPrimitive } from '../expression.ts';
import type { DBAdapter } from '../db.ts';
import { Deferred } from '../deferred.ts';
import type { IncrementalChange } from '../tasks/indexer.ts';
import type { PrerenderHtmlArgs } from '../tasks/prerender-html.ts';

// A prerender-html job takes the tier one notch below the index pass that
// spawned it: a user-initiated index (userInitiatedPriority) yields
// userInitiatedPrerenderHtmlPriority, anything lower yields
// systemInitiatedPrerenderHtmlPriority. Keeping HTML rendering one tier below
// its initiator is what holds it off the indexing hot path — see the tier
// table in queue.ts for why the gap is load-bearing.
export function prerenderHtmlPriority(spawningPriority: number): number {
  return spawningPriority >= userInitiatedPriority
    ? userInitiatedPrerenderHtmlPriority
    : systemInitiatedPrerenderHtmlPriority;
}

export interface PrerenderHtmlEnqueueArgs {
  realmURL: string;
  realmUsername: string;
  changes: IncrementalChange[];
  generation: number;
  loaderEpoch: string;
  spawningJobId: number | null;
  spawningPriority: number;
  timeoutSec: number;
  // True when a from-scratch index pass spawned this job. The realm-wide
  // module pre-warm sweep — O(realm module count) — runs at the start of the
  // job only when set; incremental spawns leave it false.
  preWarm: boolean;
}

// Every realm's prerender-html jobs share one concurrency group so they
// serialize — which is what makes pending-join coalescing and tombstone
// ordering safe. Anything that reasons about a realm's HTML jobs as a set
// (enqueue, teardown) must use this same name.
export function prerenderHtmlConcurrencyGroup(realmURL: string): string {
  return `prerender-html:${realmURL}`;
}

// Await the prerender-html channel having caught up to a realm's current
// index generation. The index pass spawns the prerender-html job
// fire-and-forget and completes without it, so "indexed" does not imply
// "viewable" — a freshly published realm can be reachable and searchable
// while still serving a shell without card markup. Publishing awaits this so a
// published realm reports ready only once its current generation has been
// rendered.
//
// Signal: `prerendered_html` carrying any row at >= the realm's current
// generation. `batch.done()` swaps a generation's rendered rows into the
// production table atomically, so a row at the current generation means that
// generation's render batch has landed (a successful render leaves the
// isolated HTML on those rows; a failed one leaves error rows — either way the
// async render work for this publish is done, and a genuine render failure
// surfaces downstream as missing markup rather than hanging readiness). Gating
// on `generation` (not job status) sidesteps the fire-and-forget enqueue race
// and never settles on a prior publish's stale (lower-generation) rows.
// Resolves true when caught up, false on timeout.
//
// Woken by NOTIFY rather than tight-polling: pg-queue emits `NOTIFY
// jobs_finished` when a job's finalize transaction commits, and the
// prerender-html batch's swap is already durable by then, so re-checking on
// that signal catches the current generation landing near-instantly. The
// periodic poll is a safety net for a missed notification and for adapters
// without pub/sub (SQLite has no LISTEN), so it stays coarse.
export async function awaitPublishedHtmlReady(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<boolean> {
  let timeoutMs = opts?.timeoutMs ?? 60_000;
  let pollIntervalMs = opts?.pollIntervalMs ?? 1000;
  let [genRow] = (await query(dbAdapter, [
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ])) as { current_generation: number }[];
  let currentGeneration = genRow?.current_generation;
  if (currentGeneration == null) {
    // The realm has never been indexed — there is no generation to await.
    return true;
  }

  let hasCaughtUp = async () => {
    let rows = await query(dbAdapter, [
      'SELECT 1 FROM prerendered_html WHERE realm_url =',
      param(realmURL),
      'AND generation >=',
      param(currentGeneration),
      'LIMIT 1',
    ]);
    return rows.length > 0;
  };

  if (await hasCaughtUp()) {
    return true;
  }

  // Feature-detected: PgAdapter exposes `subscribe`; SQLite does not and falls
  // back to the poll below.
  let subscribe = (
    dbAdapter as unknown as {
      subscribe?: (
        channel: string,
        handler: () => void,
      ) => Promise<{ unsubscribe: () => Promise<void> }>;
    }
  ).subscribe;

  let ready = new Deferred<boolean>();
  let settled = false;
  let settle = (value: boolean) => {
    if (!settled) {
      settled = true;
      ready.fulfill(value);
    }
  };
  let recheck = () => {
    hasCaughtUp().then(
      (caughtUp) => {
        if (caughtUp) {
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
  // we've already settled, just tear it down; otherwise re-check once, since a
  // row may have landed between the check above and the LISTEN establishing.
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

// Publish a `prerender_html` job through the normal queue-publish path. The
// registered coalesce handler (tasks/prerender-html.ts) merges same-realm
// publishes: per-URL update-wins merge, max generation/priority/timeout.
// Callers fire-and-forget — an index pass must never block on, or fail
// with, its prerender enqueue; a missed enqueue self-heals on the next pass.
export async function enqueuePrerenderHtmlJob(
  queuePublisher: QueuePublisher,
  {
    realmURL,
    realmUsername,
    changes,
    generation,
    loaderEpoch,
    spawningJobId,
    spawningPriority,
    timeoutSec,
    preWarm,
  }: PrerenderHtmlEnqueueArgs,
): Promise<Job<PgPrimitive>> {
  let args: PrerenderHtmlArgs = {
    realmURL,
    realmUsername,
    changes,
    generation,
    loaderEpoch,
    spawningJobId,
    coalescedPublishes: null,
    preWarm,
  };
  return await queuePublisher.publish({
    jobType: 'prerender_html',
    // Separate from `indexing:${realmURL}` so HTML work never blocks
    // indexing.
    concurrencyGroup: prerenderHtmlConcurrencyGroup(realmURL),
    priority: prerenderHtmlPriority(spawningPriority),
    timeout: timeoutSec,
    args,
  });
}
