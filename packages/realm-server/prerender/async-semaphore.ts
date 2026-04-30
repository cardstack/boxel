import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel';

// Pure in-memory counting semaphore with AbortSignal-aware queueing.
// Exported so cancellation-plumbing unit tests can drive it directly
// — no Chrome dependency. Used by:
//   - Prerenderer (global render-concurrency cap)
//   - PagePool global render-semaphore (per-server tab cap)
//   - PagePool file-queue admission control (CS-10946)
//
// Capacity is mutable post-construction via `setCapacity(n)` so callers
// (PagePool dynamic tab expansion / contraction in CS-10976) can grow
// the concurrency cap without rebuilding the semaphore. In-flight slots
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
  // the entry out of the queue without racing #release.
  #queue: Array<{
    resolve: (release: () => void) => void;
    onCancel: () => void;
  }> = [];

  constructor(max: number) {
    this.#capacity = Math.max(1, max);
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

  async acquire(signal?: AbortSignal): Promise<() => void> {
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
      };
      let onAbort = entry.onCancel;
      this.#queue.push(entry);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Resize the semaphore. Growing wakes queued waiters up to the new
  // cap. Shrinking is best-effort: in-flight slots are never preempted,
  // but no new waiters are admitted until #inUse falls under the new
  // cap. `n` is clamped to a minimum of 1.
  setCapacity(n: number): void {
    let newCap = Math.max(1, n);
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
