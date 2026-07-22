import { userInitiatedPriority } from '@cardstack/runtime-common';

// Anti-starvation aging for the prerender server's priority wait-queues: the
// per-tab `TabQueue` and the `AsyncSemaphore` backing the per-server render
// cap and per-affinity file admission.
//
// Both queues order waiters by priority, FIFO within a priority. That
// ordering on its own lets an unbroken stream of higher-priority arrivals
// defer a lower-priority waiter for as long as the stream lasts: a
// background (priority `systemInitiatedPrerenderHtmlPriority`) prerender-html
// job visit queued behind on-demand (priority `userInitiatedPriority`) index
// visits of the same realm affinity never reaches the front while the
// on-demand traffic continues, so the manager aborts its request before it
// ever starts rendering.
//
// Aging removes the unbounded part. A waiter's *effective* priority for
// dequeue selection rises with how long it has waited, so a waiter that has
// been passed over long enough outranks freshly-arrived higher-priority work
// and is chosen next. The stamped base priority is left intact — aging steers
// only which queued waiter is selected, not the priority reported to
// diagnostics or the manager.

// A waiter's effective priority is `basePriority + waitedMs / interval`, so a
// background (priority-0) waiter reaches the top user tier
// (`userInitiatedPriority`) after `userInitiatedPriority` intervals of waiting
// and, being the older entry, wins the tie against a fresh arrival at that tier
// from that point on. The interval is chosen so that crossover lands at the
// target below — an order of magnitude inside the prerender request timeout
// that bounds a visit — so a continuous on-demand stream can no longer hold a
// job-lane visit off until its client aborts.
const DEFAULT_ANTI_STARVATION_CROSSOVER_MS = 30_000;
const DEFAULT_QUEUE_AGING_INTERVAL_MS =
  DEFAULT_ANTI_STARVATION_CROSSOVER_MS / userInitiatedPriority;

// Set `PRERENDER_QUEUE_AGING_INTERVAL_MS` (milliseconds of waiting per one
// effective-priority point) to tune the crossover: smaller ages starved
// waiters up faster (background work overtakes user work sooner under sustained
// pressure), larger keeps strict priority order for longer. A value of `0`
// disables aging entirely, restoring pure priority-then-FIFO dequeue.
export function resolveQueueAgingIntervalMs(): number {
  let raw = process.env.PRERENDER_QUEUE_AGING_INTERVAL_MS;
  if (raw == null) {
    return DEFAULT_QUEUE_AGING_INTERVAL_MS;
  }
  let parsed = Number(raw);
  // A non-finite or negative interval would corrupt the wait-time math; fall
  // back to the default rather than let it through.
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_QUEUE_AGING_INTERVAL_MS;
  }
  return parsed;
}

// Effective priority for dequeue ordering: base priority plus one point per
// `intervalMs` of waiting. `intervalMs <= 0` disables aging (effective ===
// base). A waiter that has not waited (or that acquired immediately without
// queueing) keeps its base priority.
export function effectivePriority(
  basePriority: number,
  enqueuedAt: number,
  now: number,
  intervalMs: number,
): number {
  if (intervalMs <= 0) {
    return basePriority;
  }
  let waitedMs = now - enqueuedAt;
  if (waitedMs <= 0) {
    return basePriority;
  }
  return basePriority + waitedMs / intervalMs;
}

export interface AgingWaiter {
  priority: number;
  enqueuedAt: number;
  // Set by the queue when a waiter is cancelled but not yet removed from the
  // backing array; such entries are never selected.
  settled?: boolean;
}

// Index of the waiter to serve next: the highest effective priority, breaking
// ties toward the earliest-enqueued waiter so ordering stays FIFO within an
// effective-priority tier. Returns `-1` when no live waiter is queued.
//
// Scanning the whole queue (rather than trusting a sorted front) is required
// because aging changes relative order over time: an entry inserted later can
// outrank an earlier one once it has waited long enough. The queues are bounded
// by the per-affinity tab cap and the render/admission concurrency caps, so the
// scan is over a small array.
export function selectNextWaiterIndex(
  queue: ReadonlyArray<AgingWaiter>,
  now: number,
  intervalMs: number,
): number {
  let bestIdx = -1;
  let bestEffective = -Infinity;
  let bestEnqueuedAt = Infinity;
  for (let i = 0; i < queue.length; i++) {
    let entry = queue[i];
    if (entry.settled) {
      continue;
    }
    let eff = effectivePriority(
      entry.priority,
      entry.enqueuedAt,
      now,
      intervalMs,
    );
    // Strictly-better replacement only: among entries that tie on effective
    // priority the earliest-scanned (earliest-enqueued, since insertion
    // appends) stays selected, preserving FIFO.
    if (
      eff > bestEffective ||
      (eff === bestEffective && entry.enqueuedAt < bestEnqueuedAt)
    ) {
      bestIdx = i;
      bestEffective = eff;
      bestEnqueuedAt = entry.enqueuedAt;
    }
  }
  return bestIdx;
}
