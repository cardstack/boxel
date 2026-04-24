import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel';

// Pure in-memory counting semaphore with AbortSignal-aware queueing.
// Exported so cancellation-plumbing unit tests can drive it directly
// — no Chrome dependency. Used by:
//   - Prerenderer (global render-concurrency cap)
//   - PagePool file-queue admission control (CS-10946)
export class AsyncSemaphore {
  #available: number;
  // `resolve` hands the acquirer the release function once a slot
  // frees. `onCancel` gives the cancellation path a way to splice
  // the entry out of the queue without racing #release.
  #queue: Array<{
    resolve: (release: () => void) => void;
    onCancel: () => void;
  }> = [];

  constructor(max: number) {
    this.#available = Math.max(1, max);
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.#available > 0) {
      this.#available--;
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

  #release = () => {
    let next = this.#queue.shift();
    if (next) {
      next.resolve(this.#release);
      return;
    }
    this.#available++;
  };
}
