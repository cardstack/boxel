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

// A prerender-html job normally floors one tier below the index pass that
// spawned it — a user-initiated index (userInitiatedPriority) yields
// userInitiatedPrerenderHtmlPriority, anything lower yields
// systemInitiatedPrerenderHtmlPriority — which holds HTML rendering off the
// indexing hot path (see the tier table in queue.ts for why the gap is
// load-bearing).
//
// The exception is a render a publish is waiting on: a publish does not
// report the realm ready until its HTML exists, so that render is on the
// publish's critical path rather than a background follow-on. It runs
// co-equal with indexing (userInitiatedPriority) so the prerender server
// admits it ahead of ordinary user renders. Where a dedicated index lane is
// configured (worker-manager's opt-in `--indexJobsOnly` pool), that lane's
// job-type filter — not the priority floor — is what keeps a co-equal publish
// render out of it.
export function prerenderHtmlPriority(
  spawningPriority: number,
  opts?: { awaitedByPublish?: boolean },
): number {
  if (spawningPriority < userInitiatedPriority) {
    return systemInitiatedPrerenderHtmlPriority;
  }
  return opts?.awaitedByPublish
    ? userInitiatedPriority
    : userInitiatedPrerenderHtmlPriority;
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
  // True only when a publish is awaiting this HTML. Lifts the job to the
  // indexing tier (co-equal) instead of one notch below it, so the publish's
  // critical-path render is admitted ahead of ordinary user renders. See
  // prerenderHtmlPriority.
  awaitedByPublish?: boolean;
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

// How long one `_readiness-check` request may block waiting for HTML. This is
// an in-request budget, NOT the overall deadline — the polling client owns
// that (`waitForReady`), and a request that returns 503 with
// `X-Boxel-Not-Ready` lets it keep counting. Kept well under the proxy layer's
// idle timeout (ALB defaults to 60s) because a request held past it is reset
// mid-flight, which reaches the client as an unattributable `fetch failed`
// rather than a legible not-ready. Matches the index gate's own 10s budget, so
// a single readiness request caps at roughly the two summed.
const IN_REQUEST_BUDGET_MS = 10_000;

// Await the prerender-html channel having caught up to a realm's index. The
// index pass spawns the prerender-html job fire-and-forget and completes
// without it, so "indexed" does not imply "viewable" — a freshly published
// realm can be reachable and searchable while still serving a shell without
// card markup. Publishing awaits this so a published realm reports ready only
// once its content has been rendered.
//
// Signal: every live, non-errored `boxel_index` row has HTML at or beyond its
// OWN generation — the same per-row predicate the read path
// (`index-query-engine`'s RENDER_ERROR_IS_CURRENT) and the catch-up sweep
// (`findStalePrerenderedHtmlRows`) use. A row the latest pass did not revisit
// keeps its own generation, and its HTML at that generation is fresh for it.
//
// This must NOT gate on `realm_generations.current_generation` (CS-12435): an
// index batch advances that watermark unconditionally, a prerender batch never
// does, and the prerender job writes rows only for the URLs it was handed and
// only at the generation its spawning pass anticipated. So a pass that
// advances the watermark without a matching render — an empty invalidation
// set, or a second publish pass committing after the first stamped its job —
// leaves a realm-wide watermark permanently unreachable while the realm is in
// fact fully rendered.
//
// Resolves true when caught up, false on timeout.
//
// Woken by NOTIFY rather than tight-polling: pg-queue emits `NOTIFY
// jobs_finished` when a job's finalize transaction commits, and the
// prerender-html batch's swap is already durable by then, so re-checking on
// that signal catches the render landing near-instantly. The
// periodic poll is a safety net for a missed notification and for adapters
// without pub/sub (SQLite has no LISTEN), so it stays coarse.
export async function awaitPublishedHtmlReady(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<boolean> {
  let timeoutMs = opts?.timeoutMs ?? IN_REQUEST_BUDGET_MS;
  let pollIntervalMs = opts?.pollIntervalMs ?? 1000;

  // Deliberately dialect-neutral (no jsonb operators, no `IS NOT TRUE`):
  // readinessCheck runs under SQLite too, unlike the Postgres-only sweep query
  // this mirrors. Tombstones and index-errored rows are excluded for the same
  // reasons the sweep excludes them — neither has servable HTML to wait on.
  // A failed render still writes an error row at its generation, so it settles
  // rather than hanging readiness on content that will never render.
  let hasCaughtUp = async () => {
    let rows = await query(dbAdapter, [
      `SELECT 1
         FROM boxel_index i
         LEFT JOIN prerendered_html ph
           ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
        WHERE i.realm_url =`,
      param(realmURL),
      `  AND (i.is_deleted = false OR i.is_deleted IS NULL)
          AND (i.has_error = false OR i.has_error IS NULL)
          AND i.error_doc IS NULL
          AND (ph.url IS NULL OR ph.generation < i.generation)
        LIMIT 1`,
    ]);
    // No row is behind its own generation — every live row is rendered. A realm
    // with no index rows at all (never indexed) reads as caught up, which is
    // the same answer the watermark version gave for a missing generation row.
    return rows.length === 0;
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
    awaitedByPublish,
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
    priority: prerenderHtmlPriority(spawningPriority, { awaitedByPublish }),
    timeout: timeoutSec,
    args,
  });
}
