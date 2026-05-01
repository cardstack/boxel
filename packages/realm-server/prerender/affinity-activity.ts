// CS-10872 (affinity-snapshot diagnostic): per-affinity tracker of
// in-flight + queued Prerenderer calls. Each entry records its URL,
// call-kind, state, and start time. The Prerenderer reads the same
// data at render-settle time and attaches it to
// `response.meta.diagnostics.affinitySnapshot`. A non-empty
// `sameAffinityActivity` on a render stuck in `waiting-stability` is
// the signature of a self-referential prerender deadlock: the host
// is waiting on a `/_search` → `definitionLookup` response that's
// waiting on a sub-`prerenderModule` queued behind this same call.

import type { PrerenderQueue } from '@cardstack/runtime-common';

export type ActivityKind = 'visit' | 'module';
export type ActivityState = 'queued' | 'running';

export interface ActivityEntry {
  url: string;
  kind: ActivityKind;
  queue: PrerenderQueue;
  state: ActivityState;
  startedAt: number;
  // Worker-job priority of the call that produced this entry.
  // Surfaced in `sameAffinityActivity` so post-mortems can see what
  // priorities were competing during a stall — e.g. a priority-10
  // file render stuck behind a priority-0 module call sticks out
  // cleanly in the diagnostic snapshot.
  priority: number;
}

export interface SameAffinityActivity {
  url: string;
  kind: ActivityKind;
  queue: PrerenderQueue;
  state: ActivityState;
  ageMs: number;
  priority: number;
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

  record(
    affinityKey: string,
    url: string,
    kind: ActivityKind,
    queue: PrerenderQueue,
    priority: number = 0,
  ): ActivityHandle {
    let handle = Symbol(`activity:${kind}:${url}`);
    let entries = this.#entries.get(affinityKey);
    if (!entries) {
      entries = new Map();
      this.#entries.set(affinityKey, entries);
    }
    entries.set(handle, {
      url,
      kind,
      queue,
      state: 'queued',
      startedAt: this.#now(),
      priority,
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
        queue: e.queue,
        state: e.state,
        ageMs: now - e.startedAt,
        priority: e.priority,
      });
    }
    return out;
  }
}
