import {
  SEARCH_ADMISSION_WAIT_MS,
  SERVER_MAX_IN_FLIGHT_SEARCHES,
} from '@cardstack/runtime-common';

// Admission gate for the realm-server's search endpoints (`/_search`,
// `/_federated-search`). Every in-flight search holds tens of MB of heap while
// its result set is assembled, and the process is a single event loop, so the
// number of searches running at once is what decides whether the heap survives
// a burst. The gate bounds it: up to `limit` searches run concurrently,
// arrivals above that wait up to a bounded time for a slot in FIFO order, and a
// request still waiting when its time is up is shed — the middleware answers
// 429 + Retry-After without having parsed a body or touched the index, so a
// shed costs the process almost nothing.
//
// Indexing traffic (a request stamped with a prerender job id or the
// during-prerender header) is admitted unconditionally: shedding an in-render
// search would write a render error into the index, and that lane is already
// bounded upstream by the prerender pool's page count. It still counts toward
// `inFlight`, so interactive arrivals see the true load and wait behind it.
//
// One process, one gate: the counters are module state, read by the health
// sampler (`realm:health`) as `inFlightSearch`.
export class SearchAdmissionGate {
  #limit: number;
  #inFlight = 0;
  #shed = 0;
  #waiters: Array<{
    resolve: (release: (() => void) | null) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(limit: number) {
    this.#limit = normalizeLimit(limit);
  }

  get limit(): number {
    return this.#limit;
  }

  // Searches currently holding a slot, including any admitted past the limit
  // by `admitUnconditionally`.
  get inFlight(): number {
    return this.#inFlight;
  }

  // Arrivals waiting for a slot.
  get waiting(): number {
    return this.#waiters.length;
  }

  // Arrivals that ran out of wait and were turned away, since construction.
  get shedCount(): number {
    return this.#shed;
  }

  // Take a slot immediately, even past the limit. For traffic that must never
  // be shed and is bounded elsewhere.
  admitUnconditionally(): () => void {
    this.#inFlight++;
    return this.#makeRelease();
  }

  // Resolves with a release function once a slot is free, or with `null` if
  // none freed within `waitMs`. Waiters are served in arrival order as slots
  // release, so a burst drains fairly rather than by luck of timing.
  admit(waitMs: number): Promise<(() => void) | null> {
    if (this.#inFlight < this.#limit) {
      this.#inFlight++;
      return Promise.resolve(this.#makeRelease());
    }
    if (waitMs <= 0) {
      this.#shed++;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let waiter = {
        resolve,
        timer: setTimeout(() => {
          let idx = this.#waiters.indexOf(waiter);
          if (idx !== -1) {
            this.#waiters.splice(idx, 1);
          }
          this.#shed++;
          resolve(null);
        }, waitMs),
      };
      // A waiting request must not keep the process alive on its own.
      waiter.timer.unref?.();
      this.#waiters.push(waiter);
    });
  }

  // Raising the limit admits queued waiters up to the new value. Lowering it
  // never preempts a running search; admissions simply pause until the count
  // falls under the new limit.
  setLimit(limit: number): void {
    this.#limit = normalizeLimit(limit);
    this.#drain();
  }

  // Each admission gets its own release so a caller that releases twice (a
  // response that both finished and closed) hands back exactly one slot.
  #makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (this.#inFlight > 0) {
        this.#inFlight--;
      }
      this.#drain();
    };
  }

  #drain(): void {
    while (this.#inFlight < this.#limit && this.#waiters.length > 0) {
      let next = this.#waiters.shift()!;
      clearTimeout(next.timer);
      this.#inFlight++;
      next.resolve(this.#makeRelease());
    }
  }
}

// A limit is a positive integer; anything else would either admit nothing or
// let `inFlight < limit` compare against NaN and stall every admission.
function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 1;
  }
  let floored = Math.floor(limit);
  return floored < 1 ? 1 : floored;
}

let gate = new SearchAdmissionGate(SERVER_MAX_IN_FLIGHT_SEARCHES);
let admissionWaitMs = SEARCH_ADMISSION_WAIT_MS;

export function admitSearch(): Promise<(() => void) | null> {
  return gate.admit(admissionWaitMs);
}

export function admitSearchUnconditionally(): () => void {
  return gate.admitUnconditionally();
}

export function getSearchInFlight(): number {
  return gate.inFlight;
}

export function getSearchAdmissionLimit(): number {
  return gate.limit;
}

export function getSearchShedCount(): number {
  return gate.shedCount;
}

// Tests exercise the ceiling with a small limit and a short wait instead of
// opening thirty connections or waiting out the real second.
export function setSearchAdmissionForTests(opts: {
  limit?: number;
  waitMs?: number;
}): void {
  gate = new SearchAdmissionGate(opts.limit ?? SERVER_MAX_IN_FLIGHT_SEARCHES);
  admissionWaitMs = opts.waitMs ?? SEARCH_ADMISSION_WAIT_MS;
}

export function resetSearchAdmissionForTests(): void {
  setSearchAdmissionForTests({});
}
