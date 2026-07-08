import {
  systemInitiatedPrerenderHtmlPriority,
  userInitiatedPrerenderHtmlPriority,
  userInitiatedPriority,
  type Job,
  type QueuePublisher,
} from '../queue.ts';
import type { PgPrimitive } from '../expression.ts';
import type { IncrementalChange } from '../tasks/indexer.ts';
import type { PrerenderHtmlArgs } from '../tasks/prerender-html.ts';

// The prerender-html tier sits one notch below its initiator's tier (see the
// tier table in queue.ts): the high-priority worker pool still serves
// user-initiated HTML work, while system-initiated HTML work drops to the
// tier only the all-priority pool takes.
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
  spawningJobId: number | null;
  spawningPriority: number;
  timeoutSec: number;
}

// Publish a `prerender_html` job through the normal queue-publish path. The
// registered coalesce handler (tasks/prerender-html.ts) merges same-realm
// publishes: delete-sticky URL union, max generation/priority/timeout.
// Callers fire-and-forget — an index pass must never block on, or fail
// with, its prerender enqueue; a missed enqueue self-heals on the next pass.
export async function enqueuePrerenderHtmlJob(
  queuePublisher: QueuePublisher,
  {
    realmURL,
    realmUsername,
    changes,
    generation,
    spawningJobId,
    spawningPriority,
    timeoutSec,
  }: PrerenderHtmlEnqueueArgs,
): Promise<Job<PgPrimitive>> {
  let args: PrerenderHtmlArgs = {
    realmURL,
    realmUsername,
    changes,
    generation,
    spawningJobId,
  };
  return await queuePublisher.publish({
    jobType: 'prerender_html',
    // Separate from `indexing:${realmURL}` so HTML work never blocks
    // indexing, while same-realm HTML jobs still serialize — which is what
    // makes pending-join coalescing and tombstone ordering safe.
    concurrencyGroup: `prerender-html:${realmURL}`,
    priority: prerenderHtmlPriority(spawningPriority),
    timeout: timeoutSec,
    args,
  });
}
