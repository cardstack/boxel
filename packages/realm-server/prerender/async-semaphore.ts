import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel.ts';

// Pure in-memory counting semaphore with AbortSignal-aware queueing.
// Exported so cancellation-plumbing unit tests can drive it directly
// — no Chrome dependency. Used by:
//   - Prerenderer (global render-concurrency cap)
//   - PagePool global render-semaphore (per-server tab cap)
//   - PagePool file-queue admission control (CS-10946)
//
// Capacity is mutable post-construction via `setCapacity(n)` so callers
// (PagePool dynamic tab expansion / contraction) can grow the
// concurrency cap without rebuilding the semaphore. In-flight slots
// are never preempted on shrink — `setCapacity(smaller)` just stops
// admitting new waiters until `inUseCount` falls back under the new cap.
export class AsyncSemaphore {
  #capacity: number;
  // Tracked directly so resize works correctly. The original
  // `#capacity - #available` formulation fell apart when capacity could
  // change while requests were in flight.
  #inUse: number;
  // `resolve` hands the acquirer the release function once a slot
  // frees. `onCancel` gives the cancellation path a way to splice
  // the entry out of the queue without racing #release. `priority`
  // controls dequeue order: higher priority first, FIFO within the
  // same priority. Default priority is `0`.
  #queue: Array<{
    resolve: (release: () => void) => void;
    onCancel: () => void;
    priority: number;
  }> = [];

  constructor(max: number) {
    this.#capacity = normalizeCapacity(max);
    this.#inUse = 0;
  }

  // Current cap. Mutable via `setCapacity`; callers reading this
  // observe the live value.
  get capacity(): number {
    return this.#capacity;
  }

  // Waiters currently queued behind an exhausted semaphore. Zero when
  // `inUseCount < capacity` (no one is waiting because slots are free).
  get pendingCount(): number {
    return this.#queue.length;
  }

  // Slots currently held by callers that have acquired but not yet
  // released. `inUseCount === 0 && pendingCount === 0` means the
  // semaphore is idle and safe for a caller to drop.
  get inUseCount(): number {
    return this.#inUse;
  }

  // Per-priority count of queued waiters. Used to surface a priority
  // breakdown of file-admission backpressure in the periodic
  // `prerender-queue-snapshot` log line.
  pendingByPriority(): Map<number, number> {
    let m = new Map<number, number>();
    for (let entry of this.#queue) {
      m.set(entry.priority, (m.get(entry.priority) ?? 0) + 1);
    }
    return m;
  }

  async acquire(
    signal?: AbortSignal,
    priority: number = 0,
  ): Promise<() => void> {
    throwIfAborted(signal);
    if (this.#inUse < this.#capacity) {
      this.#inUse++;
      return this.#release;
    }
    return await new Promise<() => void>((resolve, reject) => {
      let settled = false;
      let entry = {
        resolve: (release: () => void) => {
          if (settled) {
            // The caller cancelled right as a slot became available.
            // Hand the slot off to the next waiter (or restore the
            // count) by calling release immediately, so the queue
            // doesn't deadlock.
            release();
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
        onCancel: () => {
          if (settled) return;
          settled = true;
          let idx = this.#queue.indexOf(entry);
          if (idx !== -1) this.#queue.splice(idx, 1);
          reject(
            new PrerenderCancelledError({
              state: 'queued',
              reason:
                typeof signal?.reason === 'string' ? signal!.reason : undefined,
            }),
          );
        },
        priority,
      };
      let onAbort = entry.onCancel;
      // Priority-ordered insertion: highest priority first, FIFO within
      // the same priority. Find the first existing entry with strictly
      // lower priority and insert before it; if none, append. Same-
      // priority entries land after all existing same-priority entries
      // → FIFO preserved.
      let insertIdx = this.#queue.findIndex((e) => e.priority < priority);
      if (insertIdx === -1) {
        this.#queue.push(entry);
      } else {
        this.#queue.splice(insertIdx, 0, entry);
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Resize the semaphore. Growing wakes queued waiters up to the new
  // cap. Shrinking is best-effort: in-flight slots are never preempted,
  // but no new waiters are admitted until #inUse falls under the new
  // cap. `n` is normalized through `normalizeCapacity`: NaN, non-finite,
  // and non-integer values fall back to a clamped integer (`1` floor),
  // matching the constructor's contract — `#inUse` is an integer
  // counter, so a fractional cap would silently allow `floor(n)+1`
  // concurrent holders.
  setCapacity(n: number): void {
    let newCap = normalizeCapacity(n);
    if (newCap === this.#capacity) return;
    this.#capacity = newCap;
    // Wake waiters up to the new cap. Same hand-off shape as #release
    // (increment inUse, resolve the next waiter), iterated.
    while (this.#inUse < this.#capacity && this.#queue.length > 0) {
      let next = this.#queue.shift()!;
      this.#inUse++;
      next.resolve(this.#release);
    }
  }

  #release = () => {
    this.#inUse--;
    // If a waiter is queued AND we have spare capacity, hand it the
    // slot (no net change in `#inUse`). Otherwise the slot stays free
    // until the next acquire.
    if (this.#inUse < this.#capacity && this.#queue.length > 0) {
      let next = this.#queue.shift()!;
      this.#inUse++;
      next.resolve(this.#release);
    }
  };
}

// Reject NaN / non-finite / non-integer / sub-1 values so the cap is
// always a positive integer. This matters for resize callers (PagePool
// expansion contraction in PR 7) where a malformed env-var or upstream
// math would otherwise propagate `NaN` into `#capacity` and stall every
// future acquire/release — comparisons against `NaN` are always false.
// Floor on non-integers because `#inUse` is integer-counted and a
// fractional cap effectively rounds up at the `<` comparison.
function normalizeCapacity(n: number): number {
  if (!Number.isFinite(n)) return 1;
  let floored = Math.floor(n);
  return floored < 1 ? 1 : floored;
}
