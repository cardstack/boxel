// A request-scoped wall-clock collector for the realm-server search path.
//
// One instance is created per instrumented `_search` request in
// `handle-search` and threaded into search opts. Each *sequential* stage of
// the server-side pipeline that runs after the request is received — the SQL
// query, the post-SQL `loadLinks` relationship assembly, the JSON wire-format
// serialization — stamps its elapsed time via `time()`, so the handler can
// emit a single line attributing the request's wall-clock across stages.
//
// Work that runs CONCURRENTLY (the per-result populate + per-instance cache
// round-trips inside `loadLinks`'s `Promise.all`) is recorded separately via
// `busyTime()`: summing each concurrent op's elapsed time overcounts
// wall-clock (N parallel ops summed ≫ the wall-clock window they ran in), so
// mixing it into the sequential `stages` would make the timeline lie. It's
// kept in its own bucket and rendered with an explicit `busyMs(parallel-sum)`
// label — read it as a ratio (which sub-step dominates) or divide by the
// relevant count for a per-item average, never as wall-clock.
//
// Deliberately plain (no Node-only APIs) so it can live in runtime-common
// alongside the search pipeline it instruments. In practice it is only ever
// instantiated by the realm-server: the host's store fetches search results
// over HTTP and never runs `RealmIndexQueryEngine`, so in the browser the
// threaded collector is always `undefined` and every `opts?.timings?.…` call
// is a no-op.
export class RequestTimings {
  // Sequential wall-clock stages. Adding these up approximates `handler`.
  #stages = new Map<string, number>();
  // Aggregate busy-time for concurrent work — summed across parallel ops, so
  // NOT wall-clock. Kept apart from `#stages` so it never inflates the
  // timeline. See the class comment.
  #busy = new Map<string, number>();
  #counters = new Map<string, number>();

  // Time a SEQUENTIAL stage and accumulate its elapsed ms under `stage`.
  // Repeated stages (e.g. one `loadLinks` per realm in a federated search)
  // sum, which is still wall-clock because those run in sequence.
  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    let start = Date.now();
    try {
      return await fn();
    } finally {
      this.add(stage, Date.now() - start);
    }
  }

  add(stage: string, ms: number): void {
    this.#stages.set(stage, (this.#stages.get(stage) ?? 0) + ms);
  }

  // Time CONCURRENT work — accumulates into the separate busy bucket. Use for
  // ops launched together in a `Promise.all` (their elapsed times overlap, so
  // the sum is busy-time, not wall-clock).
  async busyTime<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    let start = Date.now();
    try {
      return await fn();
    } finally {
      this.addBusy(stage, Date.now() - start);
    }
  }

  addBusy(stage: string, ms: number): void {
    this.#busy.set(stage, (this.#busy.get(stage) ?? 0) + ms);
  }

  // Integer tallies that aren't durations — result counts, per-instance
  // cache hit/miss counts.
  incr(counter: string, n = 1): void {
    this.#counters.set(counter, (this.#counters.get(counter) ?? 0) + n);
  }

  stages(): Record<string, number> {
    return roundedEntries(this.#stages);
  }

  busy(): Record<string, number> {
    return roundedEntries(this.#busy);
  }

  counters(): Record<string, number> {
    return Object.fromEntries(this.#counters);
  }

  // Compact fragment for a single log line, e.g.
  //   sql=41 loadLinks=120 stringify=210 | busyMs(parallel-sum) populate=900 cacheRead=120 cacheWrite=80 | results=312 cacheHit=18 cacheMiss=3
  // The `busyMs(parallel-sum)` section is summed across concurrent ops, so it
  // is NOT wall-clock — read it as a ratio, or divide by `results` for a
  // per-item average. Only the first section is the wall-clock timeline.
  toLogFragment(): string {
    let render = (m: Map<string, number>) =>
      [...m].map(([k, v]) => `${k}=${Math.round(v)}`).join(' ');
    let out = render(this.#stages);
    if (this.#busy.size > 0) {
      out += ` | busyMs(parallel-sum) ${render(this.#busy)}`;
    }
    if (this.#counters.size > 0) {
      out += ` | ${[...this.#counters].map(([k, v]) => `${k}=${v}`).join(' ')}`;
    }
    return out;
  }
}

function roundedEntries(m: Map<string, number>): Record<string, number> {
  let out: Record<string, number> = {};
  for (let [k, v] of m) {
    out[k] = Math.round(v);
  }
  return out;
}
