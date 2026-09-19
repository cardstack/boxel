// The concurrency this driver holds against the realm, in the form the realm
// server's own thresholds are expressed in.
//
// Two of the server's mechanisms decide on one quantity: the admission gate
// bounds the instantaneous count of in-flight searches at a cap, and the
// link-shape policy degrades a live read's link closure once a *time-weighted
// mean* of that same count crosses one of its rungs. Both are per replica, per
// process, and neither is visible from outside — so a run that wants to say
// how close it came to either has to measure the quantity itself.
//
// The gate does not shed at the cap. An arrival above it queues in FIFO order
// and is answered `429` only if no slot frees within the admission wait, so a
// process pinned at its cap can serve every request and report no shedding at
// all. A run's `429` count is therefore a measure of how long the queue stayed
// full, not of whether the cap was reached — reaching it is what the peak
// count below reports.
//
// Request rate is not a stand-in. In-flight is rate multiplied by service
// time, and service time is the term that moves: a page-bounded workload has
// been measured at six times the request rate of an unbounded one while
// producing a quarter of the in-flight. A summary that reported searches per
// minute alone would call the cheaper run the heavier one.
//
// What this measures and what it does not. This is the concurrency held by
// *this driver*, so it bounds what any one replica's own reading saw of this
// driver's traffic from above, twice over: a fleet divides these requests
// across its replicas, and a driver keeps a request in flight while its body
// crosses the network, after the server had released the slot. It says nothing
// about whatever else is reading the same realm. So a reading below a
// threshold is evidence that this run did not cross it; a reading above one is
// not evidence that it did.

// The half-life the realm server smooths its own reading over by default, from
// `LINK_SHAPE_LOAD_HALF_LIFE_MS` in `packages/runtime-common/search-bounds.ts`.
// Restated rather than imported because this directory is copied to the box
// that runs it and has no access to the repo around it; `load-harness-test.ts`
// pins the two together so the copy cannot drift from the constant.
//
// It is only a default. That constant is an environment override on the
// server, so a deployment can smooth over a different window — and a mean
// taken over the wrong window is not comparable to the reading the policy
// acts on, which is the only reason to take it. `--load-half-life-ms` states
// the target's value for a run, and every figure reported names the window it
// was measured over.
export const DEFAULT_LOAD_HALF_LIFE_MS = 120_000;

// Elapsed spans inside one process, from a source that cannot step: a forward
// wall-clock correction of a few seconds collapses the decay weight toward
// zero, which snaps the mean to the instantaneous count at a moment nothing in
// the load explains.
function monotonicNow(): number {
  return performance.now();
}

export class InFlightReading {
  #halfLifeMs: number;
  #now: () => number;
  #inFlight = 0;
  #peakInFlight = 0;
  #mean = 0;
  #meanAt: number;
  #peakMean = 0;

  constructor(opts?: { halfLifeMs?: number; now?: () => number }) {
    this.#halfLifeMs = normalizeHalfLife(
      opts?.halfLifeMs ?? DEFAULT_LOAD_HALF_LIFE_MS,
    );
    this.#now = opts?.now ?? monotonicNow;
    this.#meanAt = this.#now();
  }

  // The window this reading is smoothed over. Reported with every figure taken
  // from it: a mean is only comparable to the server's if the two were taken
  // over the same window, and nothing else in the output would say which.
  get halfLifeMs(): number {
    return this.#halfLifeMs;
  }

  // Requests this driver has open right now.
  get inFlight(): number {
    return this.#inFlight;
  }

  // The most it ever had open at once. This is what the admission cap is
  // compared against, since that gate acts on the instantaneous count.
  get peakInFlight(): number {
    return this.#peakInFlight;
  }

  // The time-weighted mean, in the shape the link-shape policy reads. Reading
  // it advances the accumulator first, so a run that went quiet decays without
  // anything having had to sample it.
  get mean(): number {
    this.#advance();
    return this.#mean;
  }

  // The highest that mean ever reached. A run's headline number: the peak is
  // what a threshold either was or was not crossed by, and the final value
  // decays away with the last few requests of the run.
  get peakMean(): number {
    this.#advance();
    return this.#peakMean;
  }

  // Open a request, and hand back its close. The close is idempotent so a
  // caller that both resolves and rejects returns exactly one request.
  open(): () => void {
    this.#advance();
    this.#inFlight++;
    if (this.#inFlight > this.#peakInFlight) {
      this.#peakInFlight = this.#inFlight;
    }
    let closed = false;
    return () => {
      if (closed) {
        return;
      }
      closed = true;
      this.#advance();
      if (this.#inFlight > 0) {
        this.#inFlight--;
      }
    };
  }

  // Charge the span since the last advance to the count that was in force
  // across it. Called before every change to the count — afterwards the old
  // value is gone, and charging the span at the new one would credit a burst
  // that has not happened yet.
  #advance(): void {
    let now = this.#now();
    let dt = now - this.#meanAt;
    if (dt <= 0) {
      this.#meanAt = now;
      return;
    }
    let weight = Math.exp((-Math.LN2 * dt) / this.#halfLifeMs);
    this.#mean = this.#mean * weight + this.#inFlight * (1 - weight);
    this.#meanAt = now;
    if (this.#mean > this.#peakMean) {
      this.#peakMean = this.#mean;
    }
  }
}

// A half-life divides an elapsed span, so a non-positive or non-finite one
// would make the decay weight NaN and poison the reading for the rest of the
// run.
function normalizeHalfLife(halfLifeMs: number): number {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs < 1) {
    return 1;
  }
  return halfLifeMs;
}

// The live figure, for a progress line that has one column to spend on it.
// Carries its window because that is the whole of what makes it comparable to
// anything: a run is steered by this number while it is going, and a line
// copied out of a terminal keeps neither the summary below it nor the flags
// above it.
export function inFlightProgressLabel(reading: InFlightReading): string {
  return `${reading.mean.toFixed(1)}@${Math.round(reading.halfLifeMs / 1000)}s`;
}

// The concurrency paragraph of a run summary. Kept next to the measurement so
// the caveats travel with the number: the bound is only a bound in one
// direction, and only over this driver's own traffic.
export function describeInFlight(reading: InFlightReading): string {
  let window = `${Math.round(reading.halfLifeMs / 1000)}s`;
  let matchesDefault = reading.halfLifeMs === DEFAULT_LOAD_HALF_LIFE_MS;
  return (
    `concurrency: peak ${reading.peakMean.toFixed(1)} searches in flight ` +
    `(${window} mean), ${reading.peakInFlight} at once\n` +
    `  The realm server's admission gate acts on the instantaneous count and its\n` +
    `  link-shape policy on a mean of the same shape, both per replica. These are\n` +
    `  those two numbers measured from here, which bounds what one replica saw of\n` +
    `  THIS DRIVER from above: the fleet divides these across replicas, and a\n` +
    `  request counts as in flight here while its body crosses the network, after\n` +
    `  the server released it. So a figure under a threshold says this run did not\n` +
    `  reach it; a figure over one does not say it did, and neither accounts for\n` +
    `  other traffic on the realm. Take the server's own reading from the\n` +
    `  boxel:link-shape-policy heartbeat.\n` +
    (matchesDefault
      ? `  The ${window} window is the shipped default. If the target sets\n` +
        `  LINK_SHAPE_LOAD_HALF_LIFE_MS, pass --load-half-life-ms to match it, or\n` +
        `  this mean and the policy's are not the same measurement.`
      : `  Measured over ${window} as --load-half-life-ms asked, rather than the\n` +
        `  shipped default — comparable only to a target smoothing over ${window}.`)
  );
}
