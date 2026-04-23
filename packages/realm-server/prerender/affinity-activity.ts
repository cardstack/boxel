// CS-10872 (affinity-snapshot diagnostic): per-affinity tracker of
// in-flight + queued Prerenderer calls. Each entry records its URL,
// call-kind, state, and start time. The Prerenderer reads the same
// data at render-settle time and attaches it to
// `response.meta.diagnostics.affinitySnapshot`. A non-empty
// `sameAffinityActivity` on a render stuck in `waiting-stability` is
// the signature of a self-referential prerender deadlock: the host
// is waiting on a `/_search` → `definitionLookup` response that's
// waiting on a sub-`prerenderModule` queued behind this same call.

export type ActivityKind = 'visit' | 'module';
export type ActivityState = 'queued' | 'running';

export interface ActivityEntry {
  url: string;
  kind: ActivityKind;
  state: ActivityState;
  startedAt: number;
}

export interface SameAffinityActivity {
  url: string;
  kind: ActivityKind;
  state: ActivityState;
  ageMs: number;
}

export interface ActivityHandle {
  handle: symbol;
  markRunning: () => void;
  release: () => void;
}

export class AffinityActivityTracker {
  #entries = new Map<string, Map<symbol, ActivityEntry>>();
  #now: () => number;

  constructor(options?: { now?: () => number }) {
    this.#now = options?.now ?? (() => Date.now());
  }

  record(affinityKey: string, url: string, kind: ActivityKind): ActivityHandle {
    let handle = Symbol(`activity:${kind}:${url}`);
    let entries = this.#entries.get(affinityKey);
    if (!entries) {
      entries = new Map();
      this.#entries.set(affinityKey, entries);
    }
    entries.set(handle, {
      url,
      kind,
      state: 'queued',
      startedAt: this.#now(),
    });
    return {
      handle,
      markRunning: () => {
        let e = this.#entries.get(affinityKey)?.get(handle);
        if (e) e.state = 'running';
      },
      release: () => {
        let e = this.#entries.get(affinityKey);
        if (!e) return;
        e.delete(handle);
        if (e.size === 0) this.#entries.delete(affinityKey);
      },
    };
  }

  // Return the same-affinity activity excluding the caller's own entry.
  // `selfHandle` may be omitted when a snapshot is wanted without
  // exclusion (e.g. diagnostic dumps).
  sameAffinityActivity(
    affinityKey: string,
    selfHandle?: symbol,
  ): SameAffinityActivity[] {
    let now = this.#now();
    let entries = this.#entries.get(affinityKey);
    if (!entries) return [];
    let out: SameAffinityActivity[] = [];
    for (let [h, e] of entries) {
      if (h === selfHandle) continue;
      out.push({
        url: e.url,
        kind: e.kind,
        state: e.state,
        ageMs: now - e.startedAt,
      });
    }
    return out;
  }
}
