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
// What the gate counts is deliberately not what the link-shape policy decides
// on. A slot bounds concurrent *computations*, because a computation is what
// holds the heap. The policy wants concurrent *requests*, because a joiner
// waits out the whole computation it joined and the user behind it
// experiences all of it: the two differ by exactly the live-search cache's
// miss rate, which moves with how much a workload's readers share their
// questions. So requests are counted separately, by `SearchRequestLoad`
// below, and the policy reads that.
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

// Search requests in flight, from admission until the response ends, and the
// time-weighted means of that count the link-shape policy decides on — one for
// the process and one per realm.
//
// A request counts here for its whole lifecycle whatever the live-search cache
// decides about it: a joiner hands its admission slot back the moment the
// cache says so, but it goes on waiting for the computation it joined, and a
// rung is meant to denote how many requests are being served at once. Counting
// only the slot-holders would make the reading the request count multiplied by
// the miss rate, so one threshold would denote a different amount of real
// concurrency on every workload it met. A request the gate sheds never counts:
// it is answered at once and costs the process almost nothing.
//
// # Per realm, because the ladder acts per realm
//
// The ladder holds a level per realm, and a level is what a realm's readers
// are served. Deciding every realm's level on the process's reading would
// charge one tenant's load to every other tenant on the replica: a realm with
// one idle reader would lose its closure because a different realm was busy,
// and pay a validator drop and a response-cache variant on the way in and
// again on the way out. So each request is also counted against the realms it
// names, and a realm's level follows only the requests that name it.
//
// A request naming several realms counts in full toward each of them, not a
// share of one toward each. The reading denotes how many requests are waiting
// on a realm, and a federated request is waiting on every realm it fans out
// to; splitting it would let a dashboard that spans several realms read as a
// fraction of the load its readers experience. It follows that a realm's
// reading never exceeds the process's, while the realms' readings together
// can.
//
// Realms are named after admission, not at it: the gate runs before the body
// is parsed so a shed costs nothing, and a federated request's realms are in
// its body. So a request begins counting toward the process on admission and
// is attributed to its realms by whichever handler first learns them. The
// span in between is uncharged to any realm, and it is short — the parse and
// authorization that precede the search.
//
// The process-wide reading is kept for the process-wide questions: the health
// sampler reports it, and it is the context each ladder decision is logged
// beside. Nothing degrades on it. What protects the process from load spread
// thinly across many realms — where each realm's reading is a fraction of the
// process's and no ladder engages — is the admission gate, which acts on the
// process's instantaneous count.
//
// The means are accumulated here rather than sampled by a timer elsewhere
// because this is the only place that knows when a count changes: between two
// changes a count is a constant, so charging each span at its own value
// integrates the reading exactly, with no sampling error and no interval to
// keep alive. A sampler would additionally have to run on a cadence fine
// enough to catch a burst that opens and closes between ticks — the exact case
// the policy must not be fooled by, in either direction.
export class SearchRequestLoad {
  #process: DecayedCount;
  #realms = new Map<string, DecayedCount>();
  #halfLifeMs: number;
  #now: () => number;

  constructor(opts?: { halfLifeMs?: number; now?: () => number }) {
    this.#halfLifeMs = normalizeHalfLife(
      opts?.halfLifeMs ?? LINK_SHAPE_LOAD_HALF_LIFE_MS,
    );
    this.#now = opts?.now ?? monotonicNow;
    this.#process = new DecayedCount(this.#halfLifeMs, this.#now);
  }

  // Requests currently between admission and the end of their response.
  get inFlight(): number {
    return this.#process.inFlight;
  }

  // The time-weighted mean of `inFlight` over the recent past, with the
  // half-life the link-shape policy is tuned against.
  get sustained(): number {
    return this.#process.sustained;
  }

  // Requests currently in flight that name `realm`.
  inFlightFor(realm: string): number {
    return this.#realms.get(realm)?.inFlight ?? 0;
  }

  // The time-weighted mean of `inFlightFor(realm)`: the reading the ladder
  // decides that realm's level on. A realm no request has named reads as idle.
  sustainedFor(realm: string): number {
    let count = this.#realms.get(realm);
    if (!count) {
      return 0;
    }
    let sustained = count.sustained;
    this.#forgetIfIdle(realm, count);
    return sustained;
  }

  // The highest per-realm reading, and the realm it belongs to — the one
  // number that says how close any realm is to a rung.
  get busiestRealm(): { realm: string; sustained: number } | null {
    let busiest: { realm: string; sustained: number } | null = null;
    for (let [realm, count] of [...this.#realms]) {
      let sustained = count.sustained;
      if (this.#forgetIfIdle(realm, count)) {
        continue;
      }
      if (!busiest || sustained > busiest.sustained) {
        busiest = { realm, sustained };
      }
    }
    return busiest;
  }

  // Count one request until it ends. Every end is idempotent, so a response
  // that both finishes and closes ends its request once.
  begin(): SearchRequest {
    let endProcess = this.#process.begin();
    let realmEnds = new Map<string, () => void>();
    let ended = false;
    return {
      attribute: (realms: Iterable<string>) => {
        if (ended) {
          return;
        }
        for (let realm of realms) {
          if (realmEnds.has(realm)) {
            continue;
          }
          let count = this.#realms.get(realm);
          if (!count) {
            count = new DecayedCount(this.#halfLifeMs, this.#now);
            this.#realms.set(realm, count);
          }
          realmEnds.set(realm, count.begin());
        }
      },
      end: () => {
        if (ended) {
          return;
        }
        ended = true;
        endProcess();
        for (let endRealm of realmEnds.values()) {
          endRealm();
        }
      },
    };
  }

  // A realm is added on its first request and would otherwise never leave, so
  // a process that served many realms over its life would carry a count for
  // each. One with nothing in flight and a reading decayed to nothing is
  // indistinguishable from one never named, so it is dropped.
  #forgetIfIdle(realm: string, count: DecayedCount): boolean {
    if (count.inFlight === 0 && count.sustained < FORGET_BELOW) {
      this.#realms.delete(realm);
      return true;
    }
    return false;
  }
}

// One admitted search request, as `SearchRequestLoad` counts it.
export interface SearchRequest {
  // Count this request toward the named realms from now until it ends. A realm
  // it already counts toward is not counted twice, and a request that has
  // ended is not counted again.
  attribute(realms: Iterable<string>): void;
  end(): void;
}

// A per-realm reading below this, with nothing in flight, is dropped rather
// than kept decaying. Far under any threshold the ladder can be set to (the
// lowest reachable release is 0.5), so forgetting it changes no decision.
const FORGET_BELOW = 0.001;

// A count and the time-weighted exponential moving average of it.
class DecayedCount {
  #inFlight = 0;
  // Seeded at 0 (idle), which is the reading a freshly started replica — or a
  // realm first named — should be decided under.
  #sustained = 0;
  #sustainedAt: number;
  #halfLifeMs: number;
  #now: () => number;

  constructor(halfLifeMs: number, now: () => number) {
    this.#halfLifeMs = halfLifeMs;
    this.#now = now;
    this.#sustainedAt = now();
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  // Reading it advances the accumulator first: `inFlight` has been constant
  // since the last change, so the span up to now integrates exactly at that
  // value, and a long quiet stretch decays the reading without anything having
  // had to sample it.
  get sustained(): number {
    this.#advance();
    return this.#sustained;
  }

  begin(): () => void {
    this.#advance();
    this.#inFlight++;
    let ended = false;
    return () => {
      if (ended) {
        return;
      }
      ended = true;
      this.#advance();
      this.#inFlight--;
    };
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
let requestLoad = new SearchRequestLoad();
let admissionWaitMs = SEARCH_ADMISSION_WAIT_MS;

export function admitSearch(): Promise<(() => void) | null> {
  return gate.admit(admissionWaitMs);
}

export function admitSearchUnconditionally(): () => void {
  return gate.admitUnconditionally();
}

// Count an admitted search request toward the link-shape policy's readings
// until it ends, which is when its response ends. It counts toward the process
// from here, and toward each realm once it is attributed to them.
export function beginSearchRequest(): SearchRequest {
  return requestLoad.begin();
}

export function getSearchInFlight(): number {
  return gate.inFlight;
}

export function getSearchRequestsInFlight(): number {
  return requestLoad.inFlight;
}

export function getRealmSearchRequestsInFlight(realm: string): number {
  return requestLoad.inFlightFor(realm);
}

// The process's sustained count of search requests in flight — the context
// the link-shape policy logs each decision beside, while each realm's level is
// decided on that realm's own share (`getRealmSearchRequestLoad`). Separate from `getSearchInFlight` twice over — it counts
// requests rather than computations, and it is a mean over minutes rather than
// the instantaneous value admission control acts on, because a decision that
// must hold for minutes cannot follow a count that moves per request.
export function getSearchRequestLoad(): number {
  return requestLoad.sustained;
}

// The reading the link-shape policy decides one realm's level on: the
// sustained count of search requests in flight that name that realm.
export function getRealmSearchRequestLoad(realm: string): number {
  return requestLoad.sustainedFor(realm);
}

export function getBusiestRealmSearchRequestLoad(): {
  realm: string;
  sustained: number;
} | null {
  return requestLoad.busiestRealm;
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
  gate = new SearchAdmissionGate(opts.limit ?? SERVER_MAX_IN_FLIGHT_SEARCHES);
  requestLoad = new SearchRequestLoad({
    ...(opts.halfLifeMs !== undefined ? { halfLifeMs: opts.halfLifeMs } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  admissionWaitMs = opts.waitMs ?? SEARCH_ADMISSION_WAIT_MS;
}

export function resetSearchAdmissionForTests(): void {
  setSearchAdmissionForTests({});
}

// The link-shape policy this process serves live reads under: how much of a
// card's link graph each one carries, chosen per realm from the load that
// realm is under. It reads the sustained count of search requests in flight
// naming the realm — sustained, since a shape that flapped per request would
// fragment every validator it is folded into — and logs the process's count
// beside it. It is independent of admission control, which
// sheds on bursts against the instantaneous cap.
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
    readLoad: getRealmSearchRequestLoad,
    readProcessLoad: getSearchRequestLoad,
    limit: getSearchAdmissionLimit(),
    ...(opts?.now ? { now: opts.now } : {}),
  });
}
