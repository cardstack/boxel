// A counting semaphore. The recorders of one task share one, so at most its
// number of permits do I/O at once, however many realms are active. Permits
// are granted in the order they were asked for.

export class Semaphore {
  #available: number;
  #waiting: (() => void)[] = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`a semaphore needs at least one permit, not ${permits}`);
    }
    this.#available = permits;
  }

  // Resolves with the function that gives the permit back. Calling it twice
  // gives back one permit, not two. Aborting `signal` while the permit is
  // awaited gives up the wait and rejects with the signal's reason.
  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.#available > 0) {
      this.#available--;
    } else {
      await new Promise<void>((resolve, reject) => {
        let onAbort = () => {
          let index = this.#waiting.indexOf(grant);
          if (index !== -1) {
            this.#waiting.splice(index, 1);
          }
          reject(signal!.reason);
        };
        let grant = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        this.#waiting.push(grant);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      let next = this.#waiting.shift();
      if (next) {
        next();
      } else {
        this.#available++;
      }
    };
  }
}
