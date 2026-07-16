import {
  systemInitiatedPrerenderHtmlPriority,
  userInitiatedPrerenderHtmlPriority,
  userInitiatedPriority,
  type Job,
  type QueuePublisher,
} from '../queue.ts';
import { param, query, type PgPrimitive } from '../expression.ts';
import type { DBAdapter } from '../db.ts';
import type { IncrementalChange } from '../tasks/indexer.ts';
import type { PrerenderHtmlArgs } from '../tasks/prerender-html.ts';

// User-initiated HTML work shares its initiator's tier — for a published
// realm the rendered HTML is a first-class artifact, as important as the
// search index (see the tier table in queue.ts). System-initiated HTML work
// still drops to the background tier only the all-priority pool takes.
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
export async function awaitPublishedHtmlReady(
  dbAdapter: DBAdapter,
  realmURL: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  let timeoutMs = opts?.timeoutMs ?? 60_000;
  // 1s cadence: readiness callers already re-poll at ~1s (Retry-After: 1) and
  // HTML rendering takes seconds, so a tighter interval only multiplies DB
  // queries under concurrent publish polls without meaningfully improving
  // latency.
  let intervalMs = opts?.intervalMs ?? 1000;
  let [genRow] = (await query(dbAdapter, [
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ])) as { current_generation: number }[];
  let currentGeneration = genRow?.current_generation;
  if (currentGeneration == null) {
    // The realm has never been indexed — there is no generation to await.
    return true;
  }
  let deadline = Date.now() + timeoutMs;
  for (;;) {
    let rows = await query(dbAdapter, [
      'SELECT 1 FROM prerendered_html WHERE realm_url =',
      param(realmURL),
      'AND generation >=',
      param(currentGeneration),
      'LIMIT 1',
    ]);
    if (rows.length > 0) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
