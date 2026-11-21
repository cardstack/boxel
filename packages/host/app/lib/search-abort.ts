// Abort plumbing for host searches.
//
// Live search resources run as restartable tasks, so a newer query drops a
// superseded run's result. Dropping the result is not enough: the realm server
// keeps executing a search until its client disconnects (it cancels the
// Postgres statement and reports 499 when the request's connection closes).
// Each run therefore owns an `AbortController` whose signal reaches `fetch()`,
// and aborts it when the run is cancelled, superseded, or its resource is torn
// down. An abort is a silent cancel: callers check `isAbortError` and neither
// render an error nor log one.

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

export function abortReason(signal?: AbortSignal): unknown {
  return (
    signal?.reason ?? new DOMException('The search was aborted', 'AbortError')
  );
}

// Settles with `promise`, or rejects with the signal's abort reason as soon as
// `signal` aborts, whichever comes first.
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    // The shared promise may still reject later; that rejection belongs to
    // whoever else awaits it, not to this caller.
    promise.catch(() => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

// One in-flight request shared by several consumers (the store's coalesced
// search). The underlying request is aborted only once no consumer still wants
// it: every consumer that joined with a signal has aborted, and none joined
// without one (a consumer without a signal can never cancel, so it pins the
// request). A consumer whose own signal aborts is released at once with an
// AbortError, while the others keep waiting on the shared result.
export class SharedAbortableRequest<T> {
  readonly promise: Promise<T>;
  #controller = new AbortController();
  #consumers = 0;
  #pinned = false;
  #settled = false;

  constructor(start: (signal: AbortSignal) => Promise<T>) {
    this.promise = start(this.#controller.signal);
    this.promise.then(
      () => (this.#settled = true),
      () => (this.#settled = true),
    );
  }

  // True once the underlying request was aborted; a new consumer must start a
  // fresh request rather than join this one.
  get aborted(): boolean {
    return this.#controller.signal.aborted;
  }

  join(signal?: AbortSignal): Promise<T> {
    if (!signal) {
      this.#pinned = true;
      return this.promise;
    }
    if (signal.aborted) {
      this.#maybeAbort();
      return raceAbort(this.promise, signal);
    }
    this.#consumers++;
    let released = false;
    let release = (wantsAbort: boolean) => {
      if (released) {
        return;
      }
      released = true;
      this.#consumers--;
      signal.removeEventListener('abort', onAbort);
      if (wantsAbort) {
        this.#maybeAbort();
      }
    };
    let onAbort = () => release(true);
    signal.addEventListener('abort', onAbort, { once: true });
    let joined = raceAbort(this.promise, signal);
    joined.then(
      () => release(false),
      () => release(signal.aborted),
    );
    return joined;
  }

  #maybeAbort() {
    if (this.#consumers === 0 && !this.#pinned && !this.#settled) {
      this.#controller.abort();
    }
  }
}
