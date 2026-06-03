// A request-scoped wall-clock collector for the realm-server search path.
//
// One instance is created per instrumented `_search` request in
// `handle-search` and threaded into search opts. Each stage of the
// server-side pipeline that runs *after* the request is received —
// the SQL query, the post-SQL `loadLinks` relationship assembly (the
// per-instance cache reads/writes), and the JSON wire-format
// serialization — stamps its elapsed time here, so the handler can emit
// a single line attributing the request's wall-clock across stages.
//
// It is deliberately plain (no Node-only APIs) so it can live in
// runtime-common alongside the search pipeline it instruments. In
// practice it is only ever instantiated by the realm-server: the host's
// store fetches search results over HTTP and never runs
// `RealmIndexQueryEngine`, so in the browser the threaded collector is
// always `undefined` and every `opts?.timings?.…` call is a no-op.
export class RequestTimings {
  #stages = new Map<string, number>();
  #counters = new Map<string, number>();

  // Time an async stage and accumulate its elapsed ms under `stage`.
  // Repeated stages (e.g. one `loadLinks` per realm in a federated
  // search) sum, so the line reports total time in each stage.
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

  // Integer tallies that aren't durations — result counts, per-instance
  // cache hit/miss counts.
  incr(counter: string, n = 1): void {
    this.#counters.set(counter, (this.#counters.get(counter) ?? 0) + n);
  }

  stages(): Record<string, number> {
    let out: Record<string, number> = {};
    for (let [k, v] of this.#stages) {
      out[k] = Math.round(v);
    }
    return out;
  }

  counters(): Record<string, number> {
    return Object.fromEntries(this.#counters);
  }

  // Compact fragment for a single log line, e.g.
  //   `sql=41 loadLinks=120 stringify=210 | results=312 cacheHit=18 cacheMiss=3`
  toLogFragment(): string {
    let stages = [...this.#stages]
      .map(([k, v]) => `${k}=${Math.round(v)}`)
      .join(' ');
    let counters = [...this.#counters].map(([k, v]) => `${k}=${v}`).join(' ');
    return counters ? `${stages} | ${counters}` : stages;
  }
}
