import {
  type PrerenderResponseMeta,
  type RenderTimeoutDiagnostics,
  logger,
} from '@cardstack/runtime-common';
import type { PagePool } from './page-pool';
import type { AffinityActivityTracker } from './affinity-activity';

const log = logger('prerenderer');

// CS-10872: concerns bundled here are about "compute the diagnostic
// payload to attach to the response at render settle":
//   - Sample the shared affinity state to catch a deadlock fingerprint
//     while it's happening (AffinitySnapshotSampler).
//   - Merge the host-lifted RenderError.diagnostics with server-side
//     timings + the captured affinity snapshot onto response.meta
//     (decorateRenderErrorsWithTimings).
// Both end up in `RenderTimeoutDiagnostics` on the eventual
// `boxel_index.timing_diagnostics` JSONB column.

// One registration with the shared peak sampler. `currentPeak()` samples
// on demand and returns the richest observation seen so far; `stop()`
// unregisters and, if this was the last registration, tears down the
// shared interval.
export type PeakRegistration = {
  currentPeak: () => NonNullable<RenderTimeoutDiagnostics['affinitySnapshot']>;
  stop: () => void;
};

// Shared peak-sampling state for `affinitySnapshot`. Reason for peak
// sampling: the self-referential deadlock's smoking gun is a sub-
// prerender *queued* on our tab *during* the render, but by the time
// the outer call returns the tab has been evicted and the queued
// siblings have been released — a one-shot end-of-call snapshot sees
// an empty affinity. Sampling periodically and keeping the peak
// catches the deadlock state while it's happening.
//
// One shared timer (not one per call) iterates every active
// registration on each tick so that an incident-time backlog of queued
// calls doesn't multiply timer overhead.
export class AffinitySnapshotSampler {
  #pagePool: Pick<PagePool, 'getQueueDepthSnapshot'>;
  #tracker: Pick<AffinityActivityTracker, 'sameAffinityActivity'>;
  #intervalMs: number;
  #peaks = new Map<
    symbol,
    {
      affinityKey: string;
      selfHandle: symbol;
      peak: NonNullable<RenderTimeoutDiagnostics['affinitySnapshot']>;
    }
  >();
  #interval: NodeJS.Timeout | undefined;

  constructor(options: {
    pagePool: Pick<PagePool, 'getQueueDepthSnapshot'>;
    tracker: Pick<AffinityActivityTracker, 'sameAffinityActivity'>;
    intervalMs?: number;
  }) {
    this.#pagePool = options.pagePool;
    this.#tracker = options.tracker;
    this.#intervalMs = options.intervalMs ?? 3000;
  }

  register(affinityKey: string, selfHandle: symbol): PeakRegistration {
    let id = Symbol(`peak:${affinityKey}`);
    let initial = this.#sample(affinityKey, selfHandle);
    this.#peaks.set(id, { affinityKey, selfHandle, peak: initial });
    this.#ensureSamplerRunning();
    return {
      currentPeak: () => {
        let entry = this.#peaks.get(id);
        if (!entry) return initial;
        let cur = this.#sample(entry.affinityKey, entry.selfHandle);
        if (isPeakBetter(cur, entry.peak)) entry.peak = cur;
        return entry.peak;
      },
      stop: () => {
        this.#peaks.delete(id);
        if (this.#peaks.size === 0 && this.#interval) {
          clearInterval(this.#interval);
          this.#interval = undefined;
        }
      },
    };
  }

  // Called from `Prerenderer.stop()` for clean test isolation.
  shutdown(): void {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
    this.#peaks.clear();
  }

  #ensureSamplerRunning(): void {
    if (this.#interval) return;
    this.#interval = setInterval(() => {
      // Per-entry try/catch: a snapshot failure for one affinity
      // (e.g. edge state during a concurrent restart/dispose) must
      // not prevent the rest of this tick's entries from sampling.
      for (let entry of this.#peaks.values()) {
        try {
          let cur = this.#sample(entry.affinityKey, entry.selfHandle);
          if (isPeakBetter(cur, entry.peak)) entry.peak = cur;
        } catch (e) {
          log.warn(
            `affinity-snapshot peak sampler failed for ${entry.affinityKey}`,
            e,
          );
        }
      }
    }, this.#intervalMs);
    this.#interval.unref();
  }

  // Snapshot the same affinity, excluding the caller's own entry.
  // Combines the tracker's view of same-affinity activity with the
  // PagePool's tab / pending counts so operators can correlate
  // "tabs/pending" with the specific URLs sharing the affinity right
  // now.
  #sample(
    affinityKey: string,
    selfHandle: symbol,
  ): NonNullable<RenderTimeoutDiagnostics['affinitySnapshot']> {
    let tabCount = 0;
    let pendingTotal = 0;
    let maxPending = 0;
    for (let a of this.#pagePool.getQueueDepthSnapshot().affinities) {
      if (a.affinityKey === affinityKey) {
        tabCount = a.tabCount;
        pendingTotal = a.pendingTotal;
        maxPending = a.maxPending;
        break;
      }
    }
    return {
      affinityKey,
      tabCount,
      pendingTotal,
      maxPending,
      sameAffinityActivity: this.#tracker.sameAffinityActivity(
        affinityKey,
        selfHandle,
      ),
    };
  }
}

function isPeakBetter(
  candidate: NonNullable<RenderTimeoutDiagnostics['affinitySnapshot']>,
  incumbent: NonNullable<RenderTimeoutDiagnostics['affinitySnapshot']>,
): boolean {
  let c = candidate.sameAffinityActivity.length;
  let i = incumbent.sameAffinityActivity.length;
  if (c !== i) return c > i;
  return candidate.pendingTotal > incumbent.pendingTotal;
}

// Merges timings + (optionally) affinitySnapshot onto `response.meta`,
// lifting any host-side RenderError.diagnostics the handler attached
// onto the inner error wrapper. Callers read `response.meta.diagnostics`
// to persist into `timing_diagnostics`.
//
// Why two channels: the response body carries the rendered HTML / card
// JSON and needs to stay minimal; `response.meta` is the opt-in place
// for infrastructure metadata (timings, correlation IDs, deferred
// diagnostics). `remote-prerenderer` only forwards `data.attributes`,
// not the envelope, so the values have to live inside the response
// body's meta rather than the HTTP envelope meta.
// Optional metadata attached to the diagnostics block alongside the
// always-present timing fields. Folded into a single options object
// rather than trailing positional parameters so future signals
// (e.g. fleet capacity, expansion telemetry) can be added without
// reshuffling call sites.
export interface RenderSettlementMeta {
  affinitySnapshot?: RenderTimeoutDiagnostics['affinitySnapshot'];
  // Worker-job priority of the request that produced this render.
  // Stamped into `response.meta.diagnostics.priority` so the indexer
  // persists it on `boxel_index.timing_diagnostics`. `0` means
  // system-priority / undefined caller (default).
  priority?: number;
  // Whether this render landed on a reused / warm tab vs a freshly
  // created one. `true` means PagePool returned a tab that was already
  // bound to this affinity (warm cache, fast launch); `false` means a
  // fresh tab was spawned or commandeered (cold). Useful for triage: a
  // slow render with `tabReused=false` is a cold-start tax; with
  // `tabReused=true` it's a real render-side stall.
  tabReused?: boolean;
}

export function decorateRenderErrorsWithTimings(
  response: unknown,
  timings: {
    launchMs: number;
    renderMs: number;
    waits: RenderTimeoutDiagnostics['waits'];
  },
  totalMs: number,
  meta: RenderSettlementMeta = {},
): void {
  if (!response || typeof response !== 'object') {
    return;
  }
  let r = response as Record<string, unknown>;
  // Walk every embedded RenderError and lift its `.diagnostics` into a
  // single aggregated block on response.meta. Typical case: one
  // RenderError carries the full payload; aggregation covers the rare
  // case where multiple pass errors each contributed fields.
  let lifted: RenderTimeoutDiagnostics = {};
  let lift = (wrapper: unknown) => {
    if (!wrapper || typeof wrapper !== 'object') return;
    let w = wrapper as { diagnostics?: RenderTimeoutDiagnostics };
    if (!w.diagnostics || typeof w.diagnostics !== 'object') return;
    lifted = { ...lifted, ...w.diagnostics };
    delete w.diagnostics;
  };
  lift(r.error);
  lift(r.pageUnusableError);
  for (let key of ['card', 'fileExtract', 'fileRender'] as const) {
    let sub = r[key];
    if (sub && typeof sub === 'object') {
      lift((sub as { error?: unknown }).error);
      // Card sub-responses also carry a success-path host diagnostics
      // block — captured by render.meta and spread onto the card
      // response as `diagnostics`. Lift the same way as error-path
      // diagnostics so the computed-field counters reach the indexer's
      // `boxel_index.timing_diagnostics` column.
      if (key === 'card') {
        lift(sub);
      }
    }
  }
  let { affinitySnapshot, priority, tabReused } = meta;
  let diagnostics: RenderTimeoutDiagnostics = {
    ...lifted,
    launchMs: timings.launchMs,
    waits: timings.waits,
    renderElapsedMs: timings.renderMs,
    totalElapsedMs: totalMs,
    ...(affinitySnapshot ? { affinitySnapshot } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(tabReused !== undefined ? { tabReused } : {}),
  };
  let existingMeta = (r.meta as PrerenderResponseMeta | undefined) ?? {};
  r.meta = {
    ...existingMeta,
    diagnostics,
  };
}
