import {
  LINK_SHAPE_LOAD_HALF_LIFE_MS,
  LinkShapePolicy,
  SEARCH_ADMISSION_WAIT_MS,
  SERVER_MAX_IN_FLIGHT_SEARCHES,
} from '@cardstack/runtime-common';

// Admission gate for the realm-server's search endpoints (`/_search`,
// `/_federated-search`). A search that assembles its own result document holds
// tens of MB of heap while it does, and the process is a single event loop, so
// the number of such computations running at once is what decides whether the
// heap survives a burst. The gate bounds it: up to `limit` searches hold a
// slot at once, arrivals above that wait up to a bounded time for a slot in
// FIFO order, and a request still waiting when its time is up is shed — the
// middleware answers 429 + Retry-After without having parsed a body or
// touched the index, so a shed costs the process almost nothing. A request
// that the live-search cache serves from another request's computation hands
// its slot back as soon as the cache decides so, so in steady state the slots
// are held by computations plus the requests briefly between admission and
// the cache lookup.
//
// Indexing traffic (a request stamped with a prerender job id or the
// during-prerender header) is admitted unconditionally: shedding an in-render
// search would write a render error into the index, and that lane is already
// bounded upstream by the prerender pool's page count. It still counts toward
// `inFlight`, so interactive arrivals see the true load and wait behind it.
//
// One process, one gate: the counters are module state, read by the health
// sampler (`realm:health`) as `inFlightSearch`.
//
// The gate also carries the *sustained* form of the same number, which is what
// the link-shape policy decides on. It is accumulated here rather than sampled
// by a timer elsewhere because the gate is the only place that knows when the
// count changes: between two changes `inFlight` is a constant, so charging each
// span at its own value integrates the reading exactly, with no sampling error
// and no interval to keep alive. A sampler would additionally have to run on a
// cadence fine enough to catch a burst that opens and closes between ticks —
// the exact case the policy must not be fooled by, in either direction.
export class SearchAdmissionGate {
  #limit: number;
  #inFlight = 0;
  #shed = 0;
  #waiters: Array<{
    resolve: (release: (() => void) | null) => void;
    timer: NodeJS.Timeout;
  }> = [];
  // Time-weighted exponential moving average of `#inFlight`, and the moment it
  // was last advanced to. Seeded at 0 (an idle process), which is the reading
  // a freshly started replica should serve reads under.
  #sustained = 0;
  #sustainedAt: number;
  #halfLifeMs: number;
  #now: () => number;

  constructor(
    limit: number,
    opts?: { halfLifeMs?: number; now?: () => number },
  ) {
    this.#limit = normalizeLimit(limit);
    this.#halfLifeMs = normalizeHalfLife(
      opts?.halfLifeMs ?? LINK_SHAPE_LOAD_HALF_LIFE_MS,
    );
    this.#now = opts?.now ?? monotonicNow;
    this.#sustainedAt = this.#now();
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

  // The time-weighted mean of `inFlight` over the recent past, with the
  // half-life the link-shape policy is tuned against. Reading it advances the
  // accumulator first: `inFlight` has been constant since the last change, so
  // the span up to now integrates exactly at that value, and a long quiet
  // stretch decays the reading without anything having had to sample it.
  get sustainedInFlight(): number {
    this.#advance();
    return this.#sustained;
  }

  // Charge the span since the last advance to the value that was in force
  // across it. Called before every change to `#inFlight` — after the change the
  // old value is gone, and charging the span at the new one would credit a
  // burst that has not happened yet (or discount one that just ended).
  //
  // Elapsed time here is measured with `performance.now()` rather than
  // `Date.now()`. Both only ever measure spans inside one process, and a wall
  // clock can step: a forward NTP correction of a few seconds collapses the
  // decay weight toward zero, which snaps the reading to the instantaneous count
  // — the one behaviour this smoother exists to prevent, arriving at a moment
  // nothing in the load explains. A monotonic source cannot step, so the
  // backwards guard below is left only for a clock a test supplies.
  #advance(): void {
    let now = this.#now();
    let dt = now - this.#sustainedAt;
    if (dt <= 0) {
      // A clock that did not move contributes no span. Re-anchoring is still
      // right: with a test-supplied clock that can go backwards, it keeps the
      // step from being charged twice once the clock recovers.
      this.#sustainedAt = now;
      return;
    }
    let weight = Math.exp((-Math.LN2 * dt) / this.#halfLifeMs);
    this.#sustained = this.#sustained * weight + this.#inFlight * (1 - weight);
    this.#sustainedAt = now;
  }

  // Take a slot immediately, even past the limit. For traffic that must never
  // be shed and is bounded elsewhere.
  admitUnconditionally(): () => void {
    this.#advance();
    this.#inFlight++;
    return this.#makeRelease();
  }

  // Resolves with a release function once a slot is free, or with `null` if
  // none freed within `waitMs`. Waiters are served in arrival order as slots
  // release, so a burst drains fairly rather than by luck of timing.
  admit(waitMs: number): Promise<(() => void) | null> {
    if (this.#inFlight < this.#limit) {
      this.#advance();
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
        this.#advance();
        this.#inFlight--;
      }
      this.#drain();
    };
  }

  #drain(): void {
    while (this.#inFlight < this.#limit && this.#waiters.length > 0) {
      let next = this.#waiters.shift()!;
      clearTimeout(next.timer);
      this.#advance();
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

// Elapsed spans inside one process, from a source that cannot step. See
// `#advance`.
function monotonicNow(): number {
  return performance.now();
}

// A half-life divides an elapsed span, so a non-positive or non-finite one
// would make the decay weight NaN and poison the reading permanently. One
// millisecond is the degenerate-but-safe end of the range: the reading then
// tracks the instantaneous count.
function normalizeHalfLife(halfLifeMs: number): number {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs < 1) {
    return 1;
  }
  return halfLifeMs;
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

// The reading the link-shape policy decides on. Separate from
// `getSearchInFlight` because the two answer different questions: admission
// control acts on the instantaneous count (a slot is free or it is not), while
// a decision that must hold for minutes acts on the sustained one.
export function getSearchSustainedInFlight(): number {
  return gate.sustainedInFlight;
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
  // A test that drives the sustained reading supplies both: a short half-life
  // so a span it can actually wait out moves the number, and a clock it steps
  // itself so it need not wait at all.
  halfLifeMs?: number;
  now?: () => number;
}): void {
  gate = new SearchAdmissionGate(opts.limit ?? SERVER_MAX_IN_FLIGHT_SEARCHES, {
    ...(opts.halfLifeMs !== undefined ? { halfLifeMs: opts.halfLifeMs } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  admissionWaitMs = opts.waitMs ?? SEARCH_ADMISSION_WAIT_MS;
}

export function resetSearchAdmissionForTests(): void {
  setSearchAdmissionForTests({});
}

// The link-shape policy this process serves live reads under: how much of a
// card's link graph each one carries, chosen per realm from the load the
// process is under. It reads the same in-flight count admission control
// computes — in its sustained form, since a shape that flapped per request
// would fragment every validator it is folded into — and degrades a response
// one rung before admission control would refuse the request outright.
//
// This is the process's only control over the shape. There is deliberately no
// environment variable beside it: an operator-set flag cannot express "depends
// on concurrency", and two mechanisms deciding one thing is how they come to
// disagree.
//
// It lives here, beside the gate, rather than at the one call site that builds
// it, so that a test can exercise this construction instead of reproducing it.
// A test that rebuilt the wiring could not see the wiring break: dropping
// `readLoad` here would leave a suite that passed its own `readLoad` green.
//
// `now` is the one seam. The reading is a two-minute mean and the dwell a
// minute, so a test that drives either has to supply the clock; nothing else
// about the policy is a parameter.
export function buildLinkShapePolicy(opts?: {
  now?: () => number;
}): LinkShapePolicy {
  return new LinkShapePolicy({
    readLoad: getSearchSustainedInFlight,
    limit: getSearchAdmissionLimit(),
    ...(opts?.now ? { now: opts.now } : {}),
  });
}
