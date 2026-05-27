import {
  delay,
  logger,
  type PrerenderQueue,
  uuidv4,
} from '@cardstack/runtime-common';
import type { ConsoleMessage, Page } from 'puppeteer';
import type { BrowserContext } from 'puppeteer';
import { resolvePrerenderManagerURL } from './config';
import type { BrowserManager } from './browser-manager';
import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel';
import { AsyncSemaphore } from './async-semaphore';
import { attachRuntimeExceptionCapture } from './runtime-exception-capture';

type RenderSemaphore = {
  acquire(signal?: AbortSignal, priority?: number): Promise<() => void>;
  // Optional resize hook used by dynamic pool expansion / contraction.
  // Concrete `AsyncSemaphore` injections always provide it; legacy
  // tests that stub a minimal acquire-only object are still accepted.
  setCapacity?: (n: number) => void;
};

// Exported so cancellation-plumbing unit tests can drive it
// directly — it's a per-tab serializer with no Chrome dependency.
//
// Priority-bucketed dequeue: higher priority first, FIFO within the
// same priority. Default priority is `0` so callers that don't
// specify get straight FIFO.
export class TabQueue {
  // `held` is true while a caller holds the lease (post-acquire,
  // pre-release). Subsequent acquires queue rather than running.
  #held = false;
  #queue: Array<{
    resolve: () => void;
    reject: (err: unknown) => void;
    priority: number;
    settled: boolean;
  }> = [];

  async acquire(
    signal?: AbortSignal,
    priority: number = 0,
  ): Promise<() => void> {
    throwIfAborted(signal);
    if (!this.#held) {
      this.#held = true;
      return this.#makeRelease();
    }
    // Queue and wait for the lease. On abort while queued, splice the
    // entry out so downstream waiters aren't blocked on a cancelled
    // holder; throw a `'queued'`-state cancellation so `getPage` can
    // bail out cleanly.
    let entry: {
      resolve: () => void;
      reject: (err: unknown) => void;
      priority: number;
      settled: boolean;
    };
    let onAbort: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        entry = { resolve, reject, priority, settled: false };
        // Priority-ordered insertion (matches `AsyncSemaphore`):
        // highest priority first, FIFO within priority.
        let insertIdx = this.#queue.findIndex((e) => e.priority < priority);
        if (insertIdx === -1) {
          this.#queue.push(entry);
        } else {
          this.#queue.splice(insertIdx, 0, entry);
        }
        if (signal) {
          onAbort = () => {
            if (entry.settled) return;
            entry.settled = true;
            let idx = this.#queue.indexOf(entry);
            if (idx !== -1) this.#queue.splice(idx, 1);
            reject(
              new PrerenderCancelledError({
                state: 'queued',
                reason:
                  typeof signal.reason === 'string' ? signal.reason : undefined,
              }),
            );
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
    // Lease handed off — `#held` was already true before our resolve.
    return this.#makeRelease();
  }

  #makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Highest-priority oldest waiter (front of queue) gets the lease.
      // Skip already-settled (cancelled) entries — they were spliced
      // by `onAbort` but for safety we tolerate stale entries here.
      while (this.#queue.length > 0) {
        let next = this.#queue.shift()!;
        if (next.settled) continue;
        next.settled = true;
        // `#held` stays true: the lease just transferred.
        next.resolve();
        return;
      }
      this.#held = false;
    };
  }

  // Live count = (active holder ? 1 : 0) + queued waiters. Matches the
  // pre-PR-4 semantics: callers use `pendingCount === 0` to mean "idle"
  // and `pendingCount > 1` to mean "queue is forming behind the holder".
  get pendingCount(): number {
    return (this.#held ? 1 : 0) + this.#queue.length;
  }

  // Per-priority count of *queued* waiters (excludes the holder).
  // Used by `getQueueDepthSnapshot` to build the per-priority breakdown
  // surfaced in `prerender-queue-snapshot` logs.
  pendingByPriority(): Map<number, number> {
    let m = new Map<number, number>();
    for (let entry of this.#queue) {
      m.set(entry.priority, (m.get(entry.priority) ?? 0) + 1);
    }
    return m;
  }
}

type PoolEntry = {
  type: 'pool';
  affinityKey: string | null;
  context: BrowserContext;
  page: Page;
  pageId: string;
  lastUsedAt: number;
  queue: TabQueue;
  // Which PagePool queue ('file' / 'module' / 'command') the tab is
  // currently serving, if any. Set when a getPage caller acquires the
  // tab and cleared when they release. Powers the per-queue breakdown
  // in `getQueueDepthSnapshot` / `getVacancySnapshot` and the
  // `affinitySnapshot` diagnostic.
  currentQueue?: PrerenderQueue;
  closing?: boolean;
  transitioning?: boolean;
};
// BrowserContext shared across all Pages that belong to the same
// affinity. `pageCount` tracks live pages attached to the context;
// when it drops to zero the row is kept as an orphan for re-warm
// reuse and only closed when the affinity is explicitly disposed
// (without `retainSharedContext`) or when the orphan LRU evicts it.
// Invariant: exactly one BrowserContext per affinity at any time —
// the close path only tears down the single tracked context, so
// binding a second BrowserContext to the same affinity would leak.
type SharedContext = {
  context: BrowserContext;
  affinityKey: string;
  pageCount: number;
  lastUsedAt: number;
  closing?: boolean;
};
type StandbyEntry = {
  type: 'standby';
  context: BrowserContext;
  page: Page;
  pageId: string;
  lastUsedAt: number;
  queue: TabQueue;
  closing?: boolean;
  transitioning?: boolean;
};
type Entry = PoolEntry | StandbyEntry;
export type ConsoleErrorLocation = {
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};
export type ConsoleErrorEntry = {
  type: ReturnType<ConsoleMessage['type']>;
  text: string;
  location?: ConsoleErrorLocation;
  // Captured CDP stack frames from the originating site. Populated by
  // both the `source: 'console'` path (via `ConsoleMessage.stackTrace()`
  // — Chrome attaches frames to `console.error` and "Uncaught (in
  // promise)" log lines, which is the desync-detector's only lead
  // back at the offending template / getter / helper) and by the
  // `source: 'exception'` path (V8's `stackTrace.callFrames` from a
  // `Runtime.exceptionThrown` event).
  stackFrames?: ConsoleErrorLocation[];
  // Discriminates 'console' (page.on('console')) vs 'exception'
  // (Runtime.exceptionThrown over CDP). The two share storage and
  // serialisation so they flow through the same `additionalErrors`
  // pipeline in render-runner, but the title and stack-header are
  // distinct so an operator can tell which layer surfaced the error.
  // Default 'console' so existing call sites stay backward-compat.
  source?: 'console' | 'exception';
  // Set on `source: 'exception'` entries when V8 later fires
  // `Runtime.exceptionRevoked` for the same exceptionId — i.e. some
  // downstream code attached a `.catch` after V8 had already reported
  // the rejection as uncaught (RSVP / Backburner / Ember runloop
  // commonly do this). The original design dropped these as
  // "transient noise", but the whitepaper-class render bug IS exactly
  // this pattern: RSVP swallows the rejection so `unhandledrejection`
  // never fires, the render is wedged anyway, and the only signal we
  // had was being silently discarded. We now keep revoked entries in
  // the bucket so they reach `additionalErrors`; render-runner adds
  // a `(revoked by late .catch)` marker to the surfaced title so
  // operators can see the lifecycle.
  revoked?: boolean;
};

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');
const STANDBY_CREATION_RETRIES = 3;
const STANDBY_BACKOFF_MS = 500;
const STANDBY_BACKOFF_CAP_MS = 4000;
const CONSOLE_ERROR_LIMIT = 50;

export class StandbyTargetNotReadyError extends Error {}

// Strict positive-integer env-var parser used by the dynamic-pool
// configuration. Returns `undefined` for unset, empty, or otherwise
// invalid input — including `0` and negatives — which is what the
// MIN/MAX/INITIAL plumbing expects so it can fall back to the legacy
// fixed-size path.
function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  let n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

function isExpectedStandbyTargetNotReadyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error instanceof StandbyTargetNotReadyError ||
    /ERR_CONNECTION_REFUSED|returned HTTP 50[23]/.test(error.message)
  );
}

function isExpectedStandbyConsoleError(args: {
  affinityKey: string;
  type: ReturnType<ConsoleMessage['type']>;
  formatted: string;
  locationURL?: string;
}): boolean {
  return (
    args.affinityKey === 'standby' &&
    args.type === 'error' &&
    /status of 50[23]/.test(args.formatted) &&
    args.locationURL?.includes('/_standby') === true
  );
}

export class PagePool {
  #affinityPages = new Map<string, Set<PoolEntry>>();
  #standbys = new Set<StandbyEntry>();
  #lru = new Set<string>();
  // Per-affinity shared BrowserContext cache. Populated on standby
  // adoption, consulted on every getPage (see
  // `#tryClaimOrphanContext`), and cap-managed by
  // `#maybeEvictOrphanContexts`. Bounded by `#sharedContextCap`.
  #sharedContexts = new Map<string, SharedContext>();
  #sharedContextCap: number;
  // Live tab-pool capacity. Mutable across the pool's lifetime: starts
  // at `#minPages` (or `PRERENDER_PAGE_POOL_INITIAL` if set), grows up
  // to `#maxBurstPages` under saturation, contracts back to `#minPages`
  // after sustained idle. The standby ceiling tracks `#maxPages + 1`,
  // and the render semaphore's capacity is kept in sync via
  // `setCapacity` whenever this changes.
  #maxPages: number;
  // Idle floor — `#maxPages` never goes below this on contraction. When
  // `PRERENDER_PAGE_POOL_MIN` is unset, `options.maxPages` drives the
  // configuration, `#minPages === #maxBurstPages === options.maxPages`
  // → no expansion or contraction, identical to a fixed-size pool.
  #minPages: number;
  // Burst ceiling reachable by any priority on saturation. Equal to
  // `#minPages` when the legacy fixed-size config drives the pool.
  #maxBurstPages: number;
  // High-priority ceiling. Reachable only when the saturating request's
  // own priority is at or above `#highPriorityThreshold`. Defaults to
  // `#maxBurstPages` (no separate tier) so deployments that don't set
  // the env var see the single-tier behaviour from the previous PR.
  // The value is the structural guarantee that a low-priority workload
  // cannot consume the entire memory envelope: there is always
  // expansion budget that only a high-priority request can claim.
  #highPriorityMaxPages: number;
  // Priority value at or above which an arriving request can drive
  // expansion past `#maxBurstPages` into the high-priority tier.
  // Defaults to `Infinity` when the tier is unset; the upstream
  // `parsePositiveInt` validation rejects non-integers so no real-
  // world priority value can satisfy `priority >= +Infinity`. (Note:
  // a literal `Number.POSITIVE_INFINITY` *would* satisfy it, but no
  // production code path produces that value — priorities arrive as
  // integers from the worker queue.)
  #highPriorityThreshold: number;
  // Wall-time threshold for the contraction tick: `#maxPages > #minPages`
  // AND no pending waiters anywhere on the pool for at least this long
  // → drop one slot. Reset every time pending appears or expansion
  // fires; see `#contractionLoop`.
  #idleContractionMs: number;
  // Background tick that drives contraction. Started in the
  // constructor whenever the dynamic-pool envelope can grow
  // (`#maxBurstPages > #minPages`), even before the first expansion;
  // cleared on `closeAll` for test isolation.
  #contractionInterval: NodeJS.Timeout | undefined;
  // Re-entrancy guard for the contraction tick. `setInterval` fires
  // ticks regardless of whether the previous async tick has resolved,
  // so two slow ticks could otherwise both pass the cooldown gate and
  // double-decrement `#maxPages` (or double-shrink the render
  // semaphore). The flag is held across the awaited `#contractByOne`
  // call and cleared in `finally`.
  #contractionInFlight = false;
  // Wall-clock timestamp the pool last became fully idle (no pending
  // waiters on any tab queue or admission semaphore, no in-flight
  // operations the contraction loop should respect). Updated by
  // `#observeIdleness` and consumed by `#contractionLoop`. `undefined`
  // means we're either non-idle right now or haven't observed an idle
  // tick yet since the last burst.
  #idleObservedAt: number | undefined;
  #affinityTabMax: number;
  #serverURL: string;
  #browserManager: BrowserManager;
  #boxelHostURL: string;
  #standbyTimeoutMs: number;
  #renderSemaphore: RenderSemaphore | undefined;
  #disableStandbyRefill: boolean;
  #ensuringStandbys: Promise<void> | null = null;
  #creatingStandbys = 0;
  #consoleErrorsByPageId = new Map<string, Map<string, ConsoleErrorEntry>>();
  // Per-pageId map of CDP exceptionId -> bucket key, owned alongside
  // the bucket so it's cleared in lockstep on resetConsoleErrors /
  // takeConsoleErrors / page disposal. Lets the runtime-exception
  // capture module find the right entry to remove when V8 reports
  // a previously-thrown exception was revoked (e.g. RSVP /
  // Backburner attached a late `.catch`).
  #exceptionKeysByPageId = new Map<string, Map<number, string>>();
  // Per-pageId tracker of the *current* affinityKey, so the long-
  // lived runtime-exception capture session attached on a standby
  // page can resolve the right affinityKey at log-emit time after
  // the page transitions through standby → real-affinity → maybe
  // re-tagged. Kept in lockstep with `entry.affinityKey` mutations
  // throughout this file so a single source of truth flows into
  // both PagePool's own logs and the capture module's logs.
  #affinityKeyByPageId = new Map<string, string>();
  // Fired from `disposeAffinity` after an affinity's tabs are torn down.
  // Consumed by the Prerenderer to clear `clearCache` batch ownership
  // for the affinity (CS-10758 step 3) — stale ownership across a page
  // disposal would otherwise prevent the next batch from taking the
  // affinity without a successor replacement.
  #onAffinityDisposed: ((affinityKey: string) => void) | undefined;

  // Per-affinity admission semaphore for the `file` queue. Capacity is
  // `#fileAdmissionCap` — at most that many concurrent file renders on
  // the affinity, reserving at least one tab slot for `module` /
  // `command` work that the in-flight file renders may be waiting on
  // (the self-referential prerender deadlock). Module and command
  // calls bypass this semaphore entirely. Lazily created on first file
  // call per affinity; lifecycle is tied to the affinity itself,
  // cleared in `closeAll`.
  #fileAdmission = new Map<string, AsyncSemaphore>();
  // Effective per-affinity file-admission capacity.
  //
  // Under the legacy fixed-pool config (MIN === MAX), the default is
  // the deadlock-safety ceiling `max(1, #affinityTabMax − 1)` — one
  // tab is reserved for module/command work that file renders may be
  // waiting on, preventing the self-referential prerender deadlock.
  //
  // Under the dynamic-pool config (MIN < MAX), expansion subsumes the
  // reservation: a same-affinity `prerenderModule` triggered by a
  // file render in flight no longer needs a pre-reserved tab slot —
  // saturation drives `#tryExpand`, which lifts `#maxPages` and
  // unblocks the sub-render. The default becomes "no reservation"
  // (= `#affinityTabMax`, the per-affinity tab cap), so file callers
  // can hold all the affinity's tabs concurrently. (Module / command
  // sub-calls use the per-affinity escape hatch in
  // `#selectEntryForAffinity` to spawn past `#affinityTabMax` when
  // the pool can still grow — that's what actually breaks the
  // self-referential deadlock under this default.)
  //
  // The `PRERENDER_AFFINITY_FILE_CONCURRENCY` knob still works as an
  // explicit operator override for cross-realm fairness — operators
  // who want to cap one realm's file workload can still set it. The
  // override is clamped to `#affinityTabMax` (not the
  // deadlock-safety ceiling) under dynamic mode, preserving the
  // operator's intent without re-introducing the reservation.
  //
  // Resolved once at construction so tests that mutate env vars see
  // the value frozen against the pool they're driving.
  #fileAdmissionCap: number;
  // When true, `#acquireFileAdmission` becomes a no-op. Used by existing
  // PagePool unit tests that predate the admission feature and exercise
  // tab-routing semantics directly — those tests assume `getPage` doesn't
  // gate file calls on an affinity-level semaphore. Production call sites
  // never set this; Prerenderer constructs PagePool without the flag.
  #disableFileAdmission: boolean;

  constructor(options: {
    maxPages: number;
    serverURL: string;
    browserManager: BrowserManager;
    boxelHostURL: string;
    standbyTimeoutMs?: number;
    renderSemaphore?: RenderSemaphore;
    disableStandbyRefill?: boolean;
    onAffinityDisposed?: (affinityKey: string) => void;
    disableFileAdmission?: boolean;
    // Test-only override: when set, the contraction loop ticks at this
    // interval (in ms) instead of `#idleContractionMs`. Production
    // callers leave this undefined and the loop period equals the
    // contraction wall-time threshold.
    contractionTickMs?: number;
  }) {
    // Resolve the dynamic-pool envelope. `PRERENDER_PAGE_POOL_MIN` and
    // `_MAX` are the dynamic knobs; when either is unset the pool
    // collapses to a single fixed size driven by `options.maxPages` —
    // `#minPages === #maxBurstPages` means no expansion or contraction
    // can fire. `_INITIAL` only matters when MIN < MAX; it's the
    // boot-time count and defaults to MIN.
    let envMin = parsePositiveInt(process.env.PRERENDER_PAGE_POOL_MIN);
    let envMax = parsePositiveInt(process.env.PRERENDER_PAGE_POOL_MAX);
    let envInitial = parsePositiveInt(process.env.PRERENDER_PAGE_POOL_INITIAL);
    if (envMin !== undefined && envMax !== undefined) {
      if (envMax < envMin) {
        log.warn(
          `PRERENDER_PAGE_POOL_MAX=${envMax} < PRERENDER_PAGE_POOL_MIN=${envMin}; clamping MAX to MIN`,
        );
        envMax = envMin;
      }
      this.#minPages = envMin;
      this.#maxBurstPages = envMax;
      this.#maxPages =
        envInitial !== undefined
          ? Math.min(Math.max(envInitial, envMin), envMax)
          : envMin;
    } else {
      // Legacy fixed pool. Drives both the floor and the ceiling from
      // the same value, so contraction and expansion are no-ops.
      this.#minPages = options.maxPages;
      this.#maxBurstPages = options.maxPages;
      this.#maxPages = options.maxPages;
    }
    // High-priority tier. Reachable only when the saturating request's
    // own priority is at or above `PRERENDER_HIGH_PRIORITY_THRESHOLD`.
    // The defaults pin the tier to `#maxBurstPages` (no separate tier)
    // so the previous PR's single-tier behaviour is preserved when the
    // env vars are unset — even with the dynamic-pool envelope active,
    // expansion stops at `#maxBurstPages`. Operators opt in by setting
    // both env vars; partial config (one of the pair) keeps the tier
    // dormant on the conservative assumption that a missing knob is a
    // misconfiguration, not an opt-in.
    let envHighPriorityMax = parsePositiveInt(
      process.env.PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX,
    );
    let envHighPriorityThreshold = parsePositiveInt(
      process.env.PRERENDER_HIGH_PRIORITY_THRESHOLD,
    );
    if (
      envHighPriorityMax !== undefined &&
      envHighPriorityThreshold !== undefined &&
      this.#maxBurstPages > this.#minPages
    ) {
      if (envHighPriorityMax < this.#maxBurstPages) {
        log.warn(
          `PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX=${envHighPriorityMax} < PRERENDER_PAGE_POOL_MAX=${this.#maxBurstPages}; clamping HIGH_PRIORITY_MAX to MAX`,
        );
        envHighPriorityMax = this.#maxBurstPages;
      }
      this.#highPriorityMaxPages = envHighPriorityMax;
      this.#highPriorityThreshold = envHighPriorityThreshold;
    } else {
      // Tier dormant: real-world (integer) priority values can never
      // satisfy `priority >= +Infinity`, so `#tryExpand` will stop at
      // `#maxBurstPages`.
      this.#highPriorityMaxPages = this.#maxBurstPages;
      this.#highPriorityThreshold = Number.POSITIVE_INFINITY;
    }
    let envContractionMs = parsePositiveInt(
      process.env.PRERENDER_POOL_IDLE_CONTRACTION_MS,
    );
    this.#idleContractionMs = envContractionMs ?? 60_000;
    let envTabMax = Number(process.env.PRERENDER_AFFINITY_TAB_MAX ?? 5);
    if (!Number.isFinite(envTabMax) || envTabMax <= 0) {
      envTabMax = 1;
    }
    // Cap by the burst ceiling (`#maxBurstPages`), NOT the high-
    // priority tier ceiling. Capping at `#highPriorityMaxPages`
    // would let the per-affinity tab budget exceed the burst-tier
    // capacity (e.g. envTabMax=5, MAX=4, HP_MAX=8 →
    // affinityTabMax=5), and the legacy reservation formula
    // `max(1, affinityTabMax − 1)` would yield fileAdmissionCap=4.
    // Low-priority file workload could fill all 4 burst slots with
    // no slot left for the module/command sub-call the file render
    // is waiting on, re-introducing the self-referential prerender
    // deadlock the reservation is meant to prevent. Capping at
    // `#maxBurstPages` keeps `affinityTabMax − 1 < #maxBurstPages`,
    // preserving the deadlock-safety invariant for low/medium-
    // priority workload.
    //
    // The per-affinity cap *intentionally* doesn't track HP_MAX —
    // the tier exists to give the global pool burst budget for
    // high-priority traffic, not to multiply the per-realm tab
    // budget. Operators wanting more per-realm headroom raise
    // `PRERENDER_AFFINITY_TAB_MAX` and `PRERENDER_PAGE_POOL_MAX`
    // together.
    this.#affinityTabMax = Math.min(
      Math.max(1, envTabMax),
      this.#maxBurstPages,
    );
    if (this.#maxBurstPages <= this.#minPages && this.#affinityTabMax < 2) {
      // Degenerate legacy-pool configuration: with only one tab per
      // affinity AND no expansion budget, the file-queue admission
      // cap clamps to 1 and no tab slot can be held back for
      // module / command work. A card render that triggers a same-
      // affinity `.gts` extraction will deadlock. Bump
      // `PRERENDER_AFFINITY_TAB_MAX` to at least 2 for the deadlock-
      // free guarantee, OR opt into the dynamic-pool envelope by
      // setting `PRERENDER_PAGE_POOL_MIN` < `PRERENDER_PAGE_POOL_MAX`
      // — expansion replaces the reservation as the deadlock-
      // prevention mechanism in that mode.
      log.warn(
        `PRERENDER_AFFINITY_TAB_MAX=${this.#affinityTabMax} below 2 with no dynamic-pool expansion budget; file-queue admission can't reserve a slot for module/command work and the self-referential prerender deadlock is not prevented`,
      );
    }
    // Cap on total shared contexts (active + orphaned). Default
    // scales by the high-priority tier ceiling (the largest the pool
    // can grow to under any priority) rather than the live `#maxPages`,
    // so the cap stays stable across expansion / contraction —
    // otherwise it would balloon during a burst and evict during
    // contraction, defeating the warm-cache benefit of keeping orphan
    // contexts. Enforced by `#maybeEvictOrphanContexts` on each
    // release.
    let envSharedCap = Number(
      process.env.PRERENDER_SHARED_CONTEXT_CAP ??
        this.#highPriorityMaxPages * 2,
    );
    if (!Number.isFinite(envSharedCap) || envSharedCap <= 0) {
      envSharedCap = this.#highPriorityMaxPages * 2;
    }
    this.#sharedContextCap = Math.max(1, envSharedCap);
    this.#serverURL = options.serverURL;
    this.#browserManager = options.browserManager;
    this.#boxelHostURL = options.boxelHostURL;
    this.#standbyTimeoutMs = options.standbyTimeoutMs ?? 30_000;
    this.#renderSemaphore = options.renderSemaphore;
    this.#disableStandbyRefill = options.disableStandbyRefill ?? false;
    this.#onAffinityDisposed = options.onAffinityDisposed;
    this.#disableFileAdmission = options.disableFileAdmission ?? false;
    // Resolve the per-affinity file-admission cap.
    //
    // Two ceilings depending on whether the dynamic-pool envelope is
    // active:
    //
    // - Legacy fixed pool (MIN === MAX): the default cap is the
    //   deadlock-safety reservation `max(1, affinityTabMax − 1)` —
    //   one tab is held back for the module/command work a file
    //   render may be waiting on. Operator override via
    //   `PRERENDER_AFFINITY_FILE_CONCURRENCY` is clamped at this
    //   ceiling so the deadlock-safety invariant can never be lost.
    //
    // - Dynamic pool (MIN < MAX): the default cap is "no
    //   reservation" (= `#affinityTabMax`). Pool expansion replaces
    //   the reservation as the deadlock-prevention mechanism — when
    //   a file render's same-affinity sub-`prerenderModule` arrives
    //   and the pool is saturated, `#tryExpand` lifts `#maxPages`
    //   and unblocks the sub-render. Operator override is clamped to
    //   `#affinityTabMax` only (no deadlock-safety floor needed) and
    //   stays available as a cross-realm fairness lever.
    let isDynamicPool = this.#maxBurstPages > this.#minPages;
    let deadlockSafetyCeiling = Math.max(1, this.#affinityTabMax - 1);
    let defaultCap = isDynamicPool
      ? this.#affinityTabMax
      : deadlockSafetyCeiling;
    let overrideCeiling = isDynamicPool
      ? this.#affinityTabMax
      : deadlockSafetyCeiling;
    let raw = process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
    let override: number | undefined;
    if (raw !== undefined && raw !== '') {
      let parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1) {
        override = parsed;
      } else {
        log.warn(
          `PRERENDER_AFFINITY_FILE_CONCURRENCY=${raw} invalid (must be an integer ≥ 1); falling back to default cap=${defaultCap}`,
        );
      }
    }
    this.#fileAdmissionCap =
      override === undefined ? defaultCap : Math.min(override, overrideCeiling);
    if (
      !this.#disableFileAdmission &&
      override !== undefined &&
      this.#fileAdmissionCap < defaultCap
    ) {
      // Operator has explicitly lowered the cap below the default.
      // Log so the effective value is visible without grepping env.
      // No log line when the env is unset (common case) — nothing
      // changed.
      log.info(
        `file-queue admission: cap=${this.#fileAdmissionCap} (affinityTabMax=${this.#affinityTabMax}, default=${defaultCap}${isDynamicPool ? '' : `, deadlock-safety ceiling=${deadlockSafetyCeiling}`})`,
      );
    }
    // Sync the injected render semaphore's capacity to the resolved
    // `#maxPages`. Prerenderer constructs `AsyncSemaphore(options.
    // maxPages)` and hands it in; under the dynamic-pool config the
    // pool's live cap may be smaller (MIN < legacy maxPages) or
    // larger (INITIAL > legacy maxPages) than that initial value, and
    // without this sync the saturation trigger
    // (`inUseCount >= capacity`) reads the wrong cap — expansion
    // either never fires (live cap < semaphore cap, so the semaphore
    // never saturates) or global concurrency is silently floored
    // below `#minPages`.
    if (this.#renderSemaphore?.setCapacity) {
      this.#renderSemaphore.setCapacity(this.#maxPages);
    }
    // Contraction loop is only useful when expansion is reachable —
    // i.e. when the pool is configured to grow beyond `#minPages`.
    // Pools running on the legacy fixed-size config skip the timer
    // entirely so test isolation and process exit cleanup don't have
    // to chase a ticker that does nothing.
    if (this.#maxBurstPages > this.#minPages) {
      let tickMs = options.contractionTickMs ?? this.#idleContractionMs;
      this.#contractionInterval = setInterval(
        () => this.#contractionTick(),
        tickMs,
      );
      this.#contractionInterval.unref?.();
    }
  }

  set serverURL(url: string) {
    this.#serverURL = url;
  }

  getWarmAffinities(): string[] {
    return [...this.#affinityPages.keys()];
  }

  // Observability into the shared-context cache — one row per
  // affinity, with `pageCount === 0` rows representing orphans
  // eligible for re-warm reuse or LRU eviction.
  getSharedContextSnapshot(): {
    cap: number;
    entries: Array<{
      affinityKey: string;
      pageCount: number;
      lastUsedAt: number;
      closing: boolean;
    }>;
  } {
    let entries: Array<{
      affinityKey: string;
      pageCount: number;
      lastUsedAt: number;
      closing: boolean;
    }> = [];
    for (let shared of this.#sharedContexts.values()) {
      entries.push({
        affinityKey: shared.affinityKey,
        pageCount: shared.pageCount,
        lastUsedAt: shared.lastUsedAt,
        closing: shared.closing === true,
      });
    }
    return { cap: this.#sharedContextCap, entries };
  }

  // Per-affinity vacancy snapshot consumed by the prerender manager for
  // warm-vacancy-first routing (CS-10758). `idle: true` means every tab
  // currently owned by this affinity has an empty render queue — the next
  // visit can run without waiting. `tabCount` tracks how many pages the
  // affinity has claimed (bounded by PRERENDER_AFFINITY_TAB_MAX).
  //
  // `maxPendingPriority` is the highest priority across all queued
  // waiters for this affinity (per-tab queues + the per-affinity file-
  // admission semaphore). It excludes in-flight holders because the
  // queue tracks only what's still waiting. The manager's
  // scoreCandidate uses it to route an arriving high-priority request
  // away from servers whose existing waiters would still leapfrog it.
  // Omitted when no waiters are queued — a strictly-idle affinity has
  // no priority bar to clear.
  getVacancySnapshot(): Record<
    string,
    { idle: boolean; tabCount: number; maxPendingPriority?: number }
  > {
    let snapshot: Record<
      string,
      { idle: boolean; tabCount: number; maxPendingPriority?: number }
    > = {};
    for (let [affinityKey, entries] of this.#affinityPages) {
      let tabCount = entries.size;
      let tabsIdle = [...entries].every(
        (entry) => entry.queue.pendingCount === 0,
      );
      let maxPendingPriority: number | undefined;
      for (let entry of entries) {
        for (let prio of entry.queue.pendingByPriority().keys()) {
          if (maxPendingPriority === undefined || prio > maxPendingPriority) {
            maxPendingPriority = prio;
          }
        }
      }
      let sem = this.#fileAdmission.get(affinityKey);
      let admissionIdle = true;
      if (sem) {
        if (sem.pendingCount > 0) admissionIdle = false;
        for (let prio of sem.pendingByPriority().keys()) {
          if (maxPendingPriority === undefined || prio > maxPendingPriority) {
            maxPendingPriority = prio;
          }
        }
      }
      // `idle` must mean "an arriving request can run immediately on
      // this affinity" — true only when no queueing layer has waiters.
      // Folding admission-semaphore queue depth in here matches the
      // semantics `maxPendingPriority` uses (which incorporates both
      // layers): otherwise an affinity with admission waiters would
      // report `idle: true` and the manager would route to it as
      // bucket-0 even though new work would queue behind admission.
      let idle = tabsIdle && admissionIdle;
      let snapshotEntry: {
        idle: boolean;
        tabCount: number;
        maxPendingPriority?: number;
      } = { idle, tabCount };
      if (maxPendingPriority !== undefined) {
        snapshotEntry.maxPendingPriority = maxPendingPriority;
      }
      snapshot[affinityKey] = snapshotEntry;
    }
    return snapshot;
  }

  // CS-10872: richer periodic-log snapshot. Whereas `getVacancySnapshot`
  // collapses each affinity to {idle, tabCount} for routing, this exposes
  // the raw per-affinity queue depth plus totals, so the prerender-app
  // can log a single-line "fleet health" summary every N seconds.
  getQueueDepthSnapshot(): {
    totalTabs: number;
    totalPending: number;
    affinities: Array<{
      affinityKey: string;
      tabCount: number;
      pendingTotal: number;
      maxPending: number;
      idle: boolean;
      // Per-queue breakdown of what the affinity's tabs are serving
      // right now (queue types in use). Tabs without `currentQueue`
      // are idle. The counts sum to ≤ tabCount.
      byQueue: { file: number; module: number; command: number };
      // Per-affinity file-admission state. `cap` is the semaphore's
      // capacity (= max(1, affinity tab max − 1); when affinity tab
      // max ≥ 2 this leaves at least one tab reserved for
      // module/command work). `pending` is the number of file callers
      // currently queued behind an exhausted semaphore waiting for a
      // slot. Both are 0 when the semaphore hasn't been lazily created
      // yet, or was deleted once it returned to idle.
      admission: { pending: number; cap: number };
      // Per-priority breakdown of the affinity's *queued* waiters.
      // Counts waiters only — it deliberately does NOT include the
      // in-flight render holding the tab right now. That's why the
      // field is `*Queued*` rather than `*Pending*`: `pendingTotal`
      // (above) does include the holder per legacy semantics, and the
      // rename keeps the two from being read as synonyms in
      // `prerender-queue-snapshot` triage. `tab*` is the per-tab
      // queues; `admission*` is the per-affinity file-admission
      // semaphore. Empty when no waiters are queued. Surfaced in the
      // `prerender-queue-snapshot` log so operators can see whether a
      // saturation event was dominated by user-priority work or
      // background work.
      tabQueuedByPriority: Record<number, number>;
      admissionQueuedByPriority: Record<number, number>;
    }>;
  } {
    let totalTabs = 0;
    let totalPending = 0;
    let affinities: Array<{
      affinityKey: string;
      tabCount: number;
      pendingTotal: number;
      maxPending: number;
      idle: boolean;
      byQueue: { file: number; module: number; command: number };
      admission: { pending: number; cap: number };
      tabQueuedByPriority: Record<number, number>;
      admissionQueuedByPriority: Record<number, number>;
    }> = [];
    for (let [affinityKey, entries] of this.#affinityPages) {
      let tabCount = entries.size;
      let pendingTotal = 0;
      let maxPending = 0;
      let byQueue = { file: 0, module: 0, command: 0 };
      let tabQueuedByPriority: Record<number, number> = {};
      for (let entry of entries) {
        let p = entry.queue.pendingCount;
        pendingTotal += p;
        if (p > maxPending) maxPending = p;
        if (entry.currentQueue) byQueue[entry.currentQueue]++;
        // Aggregate per-priority pending counts across all of this
        // affinity's tabs. `pendingByPriority` returns queued waiters
        // only (excludes the holder); summing those is the right
        // signal for "what's backlogged behind these tabs".
        for (let [prio, n] of entry.queue.pendingByPriority()) {
          tabQueuedByPriority[prio] = (tabQueuedByPriority[prio] ?? 0) + n;
        }
      }
      let sem = this.#fileAdmission.get(affinityKey);
      let admission = sem
        ? { pending: sem.pendingCount, cap: sem.capacity }
        : { pending: 0, cap: 0 };
      let admissionQueuedByPriority: Record<number, number> = {};
      if (sem) {
        for (let [prio, n] of sem.pendingByPriority()) {
          admissionQueuedByPriority[prio] = n;
        }
      }
      totalTabs += tabCount;
      totalPending += pendingTotal;
      affinities.push({
        affinityKey,
        tabCount,
        pendingTotal,
        maxPending,
        idle: pendingTotal === 0,
        byQueue,
        admission,
        tabQueuedByPriority,
        admissionQueuedByPriority,
      });
    }
    return { totalTabs, totalPending, affinities };
  }

  resetConsoleErrors(pageId: string): void {
    this.#consoleErrorsByPageId.set(pageId, new Map());
    this.#exceptionKeysByPageId.delete(pageId);
  }

  takeConsoleErrors(pageId: string): ConsoleErrorEntry[] {
    let bucket = this.#consoleErrorsByPageId.get(pageId);
    this.#consoleErrorsByPageId.delete(pageId);
    this.#exceptionKeysByPageId.delete(pageId);
    return bucket ? [...bucket.values()] : [];
  }

  async warmStandbys(): Promise<void> {
    await this.#ensureStandbyPool();
  }

  async evictIdleAffinities(maxIdleMs: number): Promise<string[]> {
    if (!Number.isFinite(maxIdleMs) || maxIdleMs <= 0) {
      return [];
    }
    let now = Date.now();
    let evicted: string[] = [];
    for (let [affinityKey, entries] of [...this.#affinityPages.entries()]) {
      let lastUsedAt = Math.max(
        ...[...entries].map((entry) => entry.lastUsedAt),
      );
      if (now - lastUsedAt < maxIdleMs) {
        continue;
      }
      await this.disposeAffinity(affinityKey);
      evicted.push(affinityKey);
    }
    return evicted;
  }

  // `queue` defaults to `'file'` so existing tests and call sites that
  // don't care about the queue split keep working unchanged. Production
  // call sites in RenderRunner always pass an explicit queue type.
  async getPage(
    affinityKey: string,
    queue: PrerenderQueue = 'file',
    opts?: { signal?: AbortSignal; priority?: number },
  ): Promise<{
    page: Page;
    reused: boolean;
    launchMs: number;
    // Per-stage breakdown so operators can tell "waited for the global
    // render semaphore" (saturation) apart from "waited behind the
    // per-affinity file-admission cap" apart from "waited behind the
    // affinity's tab queue" apart from "warmed a new tab." All four
    // are operationally distinct.
    waits: {
      semaphoreMs: number;
      admissionMs: number;
      tabQueueMs: number;
      tabStartupMs: number;
    };
    pageId: string;
    release: () => void;
  }> {
    let signal = opts?.signal;
    // Priority threaded from the producer side. Higher priority
    // requests jump to the head of the per-server file admission
    // semaphore, the per-affinity tab queue, and the global render
    // semaphore — without preempting in-flight work. `0` is the back-
    // compat default so callers that don't care continue to FIFO.
    let priority = opts?.priority ?? 0;
    throwIfAborted(signal);
    let t0 = Date.now();
    // File-queue admission control. Acquired BEFORE tab selection so
    // an over-capacity file caller waits in its own queue rather than
    // blocking other queues' access to tabs. Module and command calls
    // bypass admission — they're the ones a stuck file caller may be
    // waiting on.
    let releaseAdmission: (() => void) | undefined;
    let admissionMs = 0;
    if (queue === 'file') {
      let admissionStart = Date.now();
      releaseAdmission = await this.#acquireFileAdmission(
        affinityKey,
        signal,
        priority,
      );
      admissionMs = Date.now() - admissionStart;
    }
    // Every release path (success + the error paths below) funnels
    // through `releaseAdmission?.()`, which already runs idle cleanup
    // via the wrapper installed in `#acquireFileAdmission`.
    //
    // Saturation expansion: if the render semaphore is full, the
    // request will queue. Try to grow the pool first so the standby
    // refill kicked off by `#ensureStandbyPool` below has a slot to
    // create into. Bumps the semaphore's capacity in lockstep, which
    // also un-blocks the `#renderSemaphore.acquire` call further down
    // for this caller. No-op once `#maxPages` has reached its tier
    // ceiling (`#maxBurstPages` for low/medium priority,
    // `#highPriorityMaxPages` for callers at or above the threshold),
    // and a no-op when the pool is configured at a legacy fixed size
    // (`#minPages === #maxBurstPages === #highPriorityMaxPages`).
    this.#maybeExpandUnderSaturation(priority);
    // Standby refill is fire-and-forget. The dedup'd `#ensuringStandbys`
    // promise used to be awaited synchronously here, which meant any
    // concurrent `getPage` caller paid the worst-case refill time even
    // when they would have ended up on a warm reused tab (CS-11139 — a
    // single slow `page.close()` on a stuck LRU eviction stalled the
    // refill for >120s and propagated to every caller on the server,
    // including reused-tab callers in unrelated affinities).
    //
    // `#selectEntryForAffinity` only needs a standby when all warm-tab /
    // orphan-claim / cross-affinity-steal paths fail, and it awaits the
    // refill itself in that case (returning the wait time as
    // `tabStartupMs`). Callers that find a warm tab or orphan never
    // touch `#ensuringStandbys` at all.
    this.#kickStandbyRefill('getPage pre-acquire');
    try {
      throwIfAborted(signal);
    } catch (e) {
      releaseAdmission?.();
      throw e;
    }
    let tabQueueStart = Date.now();
    let entry: PoolEntry;
    let reused: boolean;
    let releaseTab: () => void;
    let tabStartupMs: number;
    try {
      ({ entry, reused, releaseTab, tabStartupMs } =
        await this.#selectEntryForAffinity(
          affinityKey,
          queue,
          signal,
          priority,
        ));
    } catch (e) {
      releaseAdmission?.();
      throw e;
    }
    // `tabQueueMs` is the time spent waiting on the per-affinity tab
    // queue / orphan-spawn / cross-affinity-steal selection — i.e. the
    // wall time inside `#selectEntryForAffinity` MINUS any standby-
    // refill wait the function performed (which is reported separately
    // as `tabStartupMs`).
    let tabQueueMs = Math.max(0, Date.now() - tabQueueStart - tabStartupMs);
    // Race between the tab being acquired and the signal firing:
    // if the signal fired while `#selectEntryForAffinity` was
    // resolving, release the tab we just got so the next
    // queued acquirer isn't blocked, then throw.
    if (signal?.aborted) {
      releaseTab();
      releaseAdmission?.();
      throwIfAborted(signal);
    }
    if (entry.affinityKey !== affinityKey) {
      // The only path that returns an entry tagged for a different
      // affinity is the brand-new-affinity cross-affinity-steal
      // fallback in `#selectEntryForAffinity`. It runs only when
      // `#ensureStandbyPool` couldn't produce a standby — usually a
      // transient browser-context creation failure. The reassignment
      // below keeps the donor entry's `pageId`, so callers that ask
      // "did I get a distinct page from the previous render?" will
      // observe equality across two different affinities. Surfacing
      // the path here gives CI logs the breadcrumb when that
      // assertion trips. Kept at `warn` because hitting this path
      // also means we're rendering one affinity's content on a tab
      // whose CDP runtime state was warmed for a different affinity.
      log.warn(
        `cross-affinity steal: reassigning pageId=${entry.pageId} ` +
          `from ${entry.affinityKey} to ${affinityKey} ` +
          `(standby refill failed to produce a fresh tab; ` +
          `standbys=${this.#standbys.size} creating=${this.#creatingStandbys} ` +
          `active=${this.#poolEntryCount()} maxPages=${this.#maxPages})`,
      );
      entry = this.#reassignAffinityTab(entry, affinityKey);
      reused = false;
    }
    if (entry.transitioning) {
      entry.transitioning = false;
    }
    entry.currentQueue = queue;
    let semaphoreStart = Date.now();
    let releaseGlobal: (() => void) | undefined;
    try {
      releaseGlobal = this.#renderSemaphore
        ? await this.#renderSemaphore.acquire(signal, priority)
        : undefined;
    } catch (e) {
      // Semaphore cancelled before we got a slot. Release the tab
      // (we acquired it before queueing on the semaphore) so
      // downstream requests for the same affinity aren't stuck.
      releaseTab();
      releaseAdmission?.();
      entry.currentQueue = undefined;
      throw e;
    }
    let semaphoreMs = Date.now() - semaphoreStart;
    entry.lastUsedAt = Date.now();
    this.#touchLRU(affinityKey);
    this.#kickStandbyRefill('getPage post-acquire');
    let released = false;
    let release = () => {
      if (released) return;
      released = true;
      try {
        releaseGlobal?.();
      } catch (_e) {
        // best-effort release
      }
      releaseTab();
      entry.currentQueue = undefined;
      entry.lastUsedAt = Date.now();
      releaseAdmission?.();
    };
    return {
      page: entry.page,
      pageId: entry.pageId,
      reused,
      launchMs: Date.now() - t0,
      waits: { semaphoreMs, admissionMs, tabQueueMs, tabStartupMs },
      release,
    };
  }

  async disposeAffinity(
    affinityKey: string,
    options?: {
      awaitIdle?: boolean;
      retainConsoleErrors?: boolean;
      // CS-10817 step 6: when true, tear down the page(s) for this
      // affinity but keep the shared BrowserContext alive as an
      // orphan so the next visit for the same affinity can reuse its
      // warm HTTP cache + localStorage. Callers that need realm
      // state wiped (auth change, explicit reset) should leave this
      // false (default) so the context is closed too.
      retainSharedContext?: boolean;
    },
  ): Promise<void> {
    let entries = this.#affinityPages.get(affinityKey);
    let hasEntries = !!entries && entries.size > 0;
    let hasOrphan = this.#sharedContexts.has(affinityKey);
    if (!hasEntries && !hasOrphan) return;
    this.#lru.delete(affinityKey);
    let awaitIdle = options?.awaitIdle !== false;
    let retainConsoleErrors = options?.retainConsoleErrors ?? false;
    let retainSharedContext = options?.retainSharedContext === true;
    // Snapshot the shared-context entry we're tearing down BEFORE
    // any await. Marking `closing = true` synchronously here is the
    // key to closing the orphan-claim race: a concurrent
    // `#assignStandbyToAffinity` that arrives during the in-flight
    // close sees `existing.closing === true` in
    // `#recordSharedContextForFirstPage` and falls through to the
    // `set` branch, replacing the closing entry with its fresh
    // context. Pre-CS-11140, the closing flag was only set inside
    // `#closeSharedContext` at the very end of `disposeAffinity` —
    // long after the entry-close loop had given concurrent callers
    // plenty of microtask slots to enter and trigger the
    // `Shared-context invariant violated` warning.
    let oldShared = !retainSharedContext
      ? this.#sharedContexts.get(affinityKey)
      : undefined;
    if (oldShared) {
      oldShared.closing = true;
    }
    if (awaitIdle) {
      this.#affinityPages.delete(affinityKey);
      if (entries) {
        for (let entry of entries) {
          await this.#closeEntry(entry, retainConsoleErrors);
        }
      }
      if (oldShared) {
        // Close the specific BrowserContext we snapshotted, not
        // whatever is currently in `#sharedContexts` for this
        // affinity. A concurrent caller may have overwritten the map
        // entry with a fresh context (above), and `#closeEntry`'s
        // `entryOwnsContext` path also closed `oldShared.context`
        // directly if the map had been overwritten. `BrowserContext.close`
        // is idempotent, so the duplicate close in that case is a
        // no-op or a benign protocol-error caught here.
        try {
          await oldShared.context.close();
        } catch (e) {
          log.warn(`Error closing shared context for ${affinityKey}:`, e);
        }
        // Clean up the map entry only if it still points to our
        // snapshot. If overwritten by a concurrent caller, the new
        // entry stays in place — the affinity is live again under a
        // fresh context.
        if (this.#sharedContexts.get(affinityKey) === oldShared) {
          this.#sharedContexts.delete(affinityKey);
        }
      }
      await this.#notifyManagerAffinityEvicted(affinityKey);
    } else {
      // Keep entries in `#affinityPages` until their close
      // completes — `entry.closing = true` filters them from
      // routing via `#selectEntryForAffinity`, and counting them
      // toward `#poolEntryCount` prevents `#prepareSlotForStandby`
      // from oversubscribing the pool by creating a fresh standby
      // while the old contexts are still alive in memory.
      // The per-entry `.finally` removes each entry from
      // `#affinityPages` once Chrome has actually released it.
      let closePromises: Promise<void>[] = [];
      if (entries) {
        for (let entry of entries) {
          entry.closing = true;
          let p = this.#closeEntry(entry, retainConsoleErrors).finally(() => {
            let currentEntries = this.#affinityPages.get(affinityKey);
            if (!currentEntries) return;
            currentEntries.delete(entry);
            if (currentEntries.size === 0) {
              this.#affinityPages.delete(affinityKey);
            }
          });
          closePromises.push(p);
          void p;
        }
      }
      if (oldShared) {
        // Same race-closure as the awaitIdle path, just sequenced
        // after the async close-promise settle: close the snapshotted
        // context (idempotent) and clean up the map entry only if
        // it's still our snapshot.
        void Promise.allSettled(closePromises).then(async () => {
          try {
            await oldShared.context.close();
          } catch (e) {
            log.warn(`Error closing shared context for ${affinityKey}:`, e);
          }
          if (this.#sharedContexts.get(affinityKey) === oldShared) {
            this.#sharedContexts.delete(affinityKey);
          }
        });
      }
      void this.#notifyManagerAffinityEvicted(affinityKey);
    }
    // Notify subscribers (e.g. Prerenderer's batch-ownership tracker) that
    // this affinity has been torn down. Best-effort: subscriber failures
    // must not leak back into the dispose path.
    try {
      this.#onAffinityDisposed?.(affinityKey);
    } catch (e) {
      log.warn(`onAffinityDisposed subscriber threw for ${affinityKey}:`, e);
    }
    // Intentionally do NOT delete the file-queue admission semaphore
    // for this affinity here. `disposeAffinity` with `awaitIdle: false`
    // (the RenderRunner eviction path) returns before in-flight getPage
    // callers have released their admission permits — deleting the
    // semaphore now would let a subsequent file call on the same
    // affinity lazy-create a fresh full-capacity semaphore concurrently
    // with the old one's still-held permits, violating the
    // `fileTabsBusy <= affinityTabMax - 1` invariant and reopening the
    // deadlock. Let the existing semaphore persist; in-flight callers
    // drain it normally via their `releaseAdmission` closures, and a
    // resurrected affinity shares the same semaphore. Fully dead
    // affinities leak a small constant per key; cleared on
    // `closeAll()`.
    void this.#browserManager.cleanupUserDataDirs();
    this.#kickStandbyRefill('disposeAffinity');
  }

  async closeAll(): Promise<void> {
    if (this.#contractionInterval) {
      clearInterval(this.#contractionInterval);
      this.#contractionInterval = undefined;
    }
    let ensuring = this.#ensuringStandbys;
    this.#ensuringStandbys = null;
    if (ensuring) {
      try {
        await ensuring;
      } catch (_e) {
        // best effort
      }
    }
    for (let entries of this.#affinityPages.values()) {
      for (let entry of entries) {
        await this.#closeEntry(entry);
      }
    }
    for (let entry of this.#standbys.values()) {
      await this.#closeEntry(entry);
    }
    // CS-10817 step 5: explicitly close orphans. `#closeEntry` retains
    // them on the assumption that the next visit will reuse; during
    // shutdown there is no next visit, so close them via the shared
    // helper (safe if already closing / missing).
    for (let affinityKey of [...this.#sharedContexts.keys()]) {
      await this.#closeSharedContext(affinityKey);
    }
    this.#affinityPages.clear();
    this.#standbys.clear();
    this.#sharedContexts.clear();
    this.#lru.clear();
    this.#fileAdmission.clear();
    this.#ensuringStandbys = null;
    this.#creatingStandbys = 0;
  }

  async #ensureStandbyPool(): Promise<void> {
    if (this.#ensuringStandbys) {
      return await this.#ensuringStandbys;
    }
    this.#ensuringStandbys = this.#ensureStandbyPoolInternal().finally(() => {
      this.#ensuringStandbys = null;
    });
    return await this.#ensuringStandbys;
  }

  // Fire-and-forget kick used by call sites that don't need to await
  // refill completion (post-acquire warming, post-eviction warming,
  // pre-acquire warming inside `getPage`). Always attaches `.catch`
  // so an unhandled rejection from `#ensureStandbyPool` — e.g. when
  // the browser is unreachable — can't crash the process under
  // Node's `--unhandled-rejections=strict` mode.
  #kickStandbyRefill(reason: string): void {
    void this.#ensureStandbyPool().catch((e) => {
      log.debug(`background standby refill failed (${reason}):`, e);
    });
  }

  async #ensureStandbyPoolInternal(): Promise<void> {
    for (;;) {
      let desired = this.#desiredStandbyCount();
      let current = this.#currentStandbyCount();
      if (current >= desired) {
        return;
      }
      let prepared = await this.#prepareSlotForStandby();
      if (!prepared) {
        return;
      }
      let standby = await this.#createStandbyWithRetries();
      if (!standby) {
        return;
      }
    }
  }

  #desiredStandbyCount(): number {
    let activeTabs = this.#poolEntryCount();
    if (this.#disableStandbyRefill && activeTabs > 0) {
      return 0;
    }
    if (activeTabs >= this.#maxPages) {
      return 1;
    }
    return this.#maxPages - activeTabs;
  }

  #currentStandbyCount(): number {
    return this.#standbys.size + this.#creatingStandbys;
  }

  #totalContextCount(): number {
    return (
      this.#poolEntryCount() + this.#standbys.size + this.#creatingStandbys
    );
  }

  async #prepareSlotForStandby(): Promise<boolean> {
    if (this.#totalContextCount() < this.#maxPages + 1) {
      return true;
    }
    if (this.#poolEntryCount() > this.#maxPages) {
      await this.#evictLRUAffinity();
      return this.#totalContextCount() < this.#maxPages + 1;
    }
    return false;
  }

  async #evictLRUAffinity(): Promise<void> {
    let lruAffinity = this.#lru.values().next().value as string | undefined;
    if (!lruAffinity) {
      return;
    }
    // Default `awaitIdle: true` is intentional: the refill loop
    // here serializes on the eviction's `page.close()`. Concurrent
    // `getPage` callers awaiting the shared `#ensuringStandbys`
    // promise see the completed post-close state — including a
    // fresh standby — so cross-affinity-steal racing on a single
    // remaining tab is avoided. Pre-CS-11139, that dedup leaked
    // the wait to every caller fleet-wide; CS-11139's structural
    // fix keeps independent callers off this critical section, so
    // only the refill loop pays for the stuck-page close, which is
    // the right tradeoff. The CS-11140 wins (orphan-claim race fix,
    // supplementary-tab bookkeeping) still apply through the
    // `disposeAffinity` body.
    await this.disposeAffinity(lruAffinity);
  }

  async #createStandbyWithRetries(): Promise<StandbyEntry | undefined> {
    let attempt = 0;
    let backoffMs = STANDBY_BACKOFF_MS;
    while (attempt < STANDBY_CREATION_RETRIES) {
      attempt++;
      try {
        return await this.#createStandby();
      } catch (e) {
        let message = `Standby creation attempt ${attempt} failed (page pool capacity ${this.#totalContextCount()}/${this.#maxPages + 1}):`;
        if (isExpectedStandbyTargetNotReadyError(e)) {
          log.debug(message, e);
        } else {
          log.error(message, e);
        }
        if (attempt >= STANDBY_CREATION_RETRIES) {
          return undefined;
        }
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, STANDBY_BACKOFF_CAP_MS);
      }
    }
    return undefined;
  }

  async #createStandby(): Promise<StandbyEntry> {
    this.#creatingStandbys++;
    let context: BrowserContext | undefined;
    try {
      let browser = await this.#browserManager.getBrowser();
      context = await browser.createBrowserContext();
      let page = await context.newPage();
      if (page.browserContext() !== context) {
        throw new Error(
          'Expected each prerender page to use its own browser context for localStorage isolation',
        );
      }
      await this.#markPageAsInPrerender(page);
      let pageId = uuidv4();
      await this.#attachPageObservability(page, 'standby', pageId);
      await this.#loadStandbyPage(page, pageId);
      let entry: StandbyEntry = {
        type: 'standby',
        context,
        page,
        pageId,
        lastUsedAt: Date.now(),
        queue: new TabQueue(),
      };
      this.#standbys.add(entry);
      return entry;
    } catch (e) {
      if (isExpectedStandbyTargetNotReadyError(e)) {
        log.debug('Standby page target is not ready yet:', e);
      } else {
        log.error('Error creating standby page:', e);
      }
      if (context) {
        try {
          await context.close();
        } catch (closeErr) {
          log.debug('Error closing failed standby context:', closeErr);
        }
      }
      throw e;
    } finally {
      this.#creatingStandbys--;
    }
  }

  async #loadStandbyPage(page: Page, pageId: string): Promise<void> {
    let standbyURL = `${this.#boxelHostURL}/_standby`;
    try {
      let response = await page.goto(standbyURL, {
        waitUntil: 'domcontentloaded',
        timeout: this.#standbyTimeoutMs,
      });
      let status = response?.status();
      if (status === 502 || status === 503) {
        throw new StandbyTargetNotReadyError(
          `Standby target ${standbyURL} returned HTTP ${status}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/.test(
          error.message,
        )
      ) {
        throw new StandbyTargetNotReadyError(
          `Standby target ${standbyURL} is not reachable yet: ${error.message}`,
        );
      }
      throw error;
    }
    await this.#withStandbyTimeout(
      () =>
        page.waitForFunction(() => {
          let marker = document.querySelector('#standby-ready');
          return !!marker;
        }),
      pageId,
    );
  }

  async #withStandbyTimeout<T>(
    fn: () => Promise<T>,
    pageId: string,
  ): Promise<T> {
    let result: T | { timeout: true } = await Promise.race([
      fn(),
      new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), this.#standbyTimeoutMs),
      ),
    ]);
    if (result && typeof result === 'object' && 'timeout' in result) {
      let message = `Standby page ${pageId} timed out after ${this.#standbyTimeoutMs}ms`;
      log.error(message);
      throw new Error(message);
    }
    return result;
  }

  #touchLRU(affinityKey: string) {
    if (this.#lru.has(affinityKey)) this.#lru.delete(affinityKey);
    this.#lru.add(affinityKey);
  }

  // File-queue admission control: per-affinity semaphore with capacity
  // `#fileAdmissionCap` (default = `max(1, affinityTabMax − 1)`,
  // lowerable via `PRERENDER_AFFINITY_FILE_CONCURRENCY` but always
  // clamped at that ceiling). Guarantees at least one tab slot is
  // always available to module / command calls on a given affinity,
  // which is what breaks the self-referential prerender deadlock where
  // a file render's search is waiting on a module extraction that's
  // queued behind it. Lazy-initialized per affinity.
  async #acquireFileAdmission(
    affinityKey: string,
    signal?: AbortSignal,
    priority: number = 0,
  ): Promise<() => void> {
    if (this.#disableFileAdmission) {
      // Test opt-out — existing tab-routing unit tests predate the
      // admission feature and assert concurrency that an enabled
      // admission cap would block. Production PagePools never set
      // this flag.
      return () => {};
    }
    let semaphore = this.#fileAdmission.get(affinityKey);
    if (!semaphore) {
      semaphore = new AsyncSemaphore(this.#fileAdmissionCap);
      this.#fileAdmission.set(affinityKey, semaphore);
    }
    let rawRelease = await semaphore.acquire(signal, priority);
    // Wrap the raw release so every release path (success or any of
    // `getPage`'s mid-setup error bailouts) also attempts idle cleanup
    // of the semaphore map entry. Without this, an erroring file call
    // would leave a permanently-idle semaphore in `#fileAdmission`
    // until the next successful file call on the same affinity swept
    // it away — bounded but not zero leak.
    return () => {
      rawRelease();
      this.#maybeDropIdleFileAdmission(affinityKey);
    };
  }

  // Called after each file release. Drops the semaphore entry for
  // `affinityKey` only when no callers hold permits and no waiters
  // are queued — safe because a subsequent file call on the same
  // affinity lazy-creates a new semaphore with the same capacity.
  // Keeps `#fileAdmission` bounded by the number of affinities
  // currently serving a file call, not by total affinities ever seen.
  #maybeDropIdleFileAdmission(affinityKey: string): void {
    let semaphore = this.#fileAdmission.get(affinityKey);
    if (!semaphore) return;
    if (semaphore.inUseCount === 0 && semaphore.pendingCount === 0) {
      this.#fileAdmission.delete(affinityKey);
    }
  }

  #poolEntryCount(): number {
    let count = 0;
    for (let entries of this.#affinityPages.values()) {
      count += entries.size;
    }
    return count;
  }

  // Live pool capacity. Equal to the static `maxPages` when the pool
  // is configured at a legacy fixed size; mutates between `#minPages`
  // and `#maxBurstPages` under the dynamic-pool config. Exposed for
  // diagnostics and tests; production routing reads it indirectly via
  // the render semaphore's `capacity`.
  get currentMaxPages(): number {
    return this.#maxPages;
  }

  get minPages(): number {
    return this.#minPages;
  }

  get maxBurstPages(): number {
    return this.#maxBurstPages;
  }

  get highPriorityMaxPages(): number {
    return this.#highPriorityMaxPages;
  }

  get highPriorityThreshold(): number {
    return this.#highPriorityThreshold;
  }

  // Inspect the render-semaphore state and trigger expansion when the
  // arriving caller would otherwise queue on a saturated cap. Hot-path
  // hook off `getPage` — kept defensively narrow (only acts when the
  // semaphore is a concrete `AsyncSemaphore` with the expected fields)
  // so test stubs don't get unexpected expansion behaviour. The
  // arriving caller's `priority` is threaded through so the high-
  // priority tier can be unlocked when the caller qualifies.
  #maybeExpandUnderSaturation(priority: number = 0): void {
    if (this.#highPriorityMaxPages <= this.#minPages) return;
    let renderSem = this.#renderSemaphore;
    if (
      !renderSem ||
      !('inUseCount' in renderSem) ||
      typeof (renderSem as AsyncSemaphore).inUseCount !== 'number' ||
      typeof (renderSem as AsyncSemaphore).capacity !== 'number'
    ) {
      return;
    }
    let sem = renderSem as AsyncSemaphore;
    if (sem.inUseCount >= sem.capacity) {
      this.#tryExpand(priority);
    }
  }

  // Best-effort synchronous expansion of the live pool capacity. Bumps
  // `#maxPages` by one, forwards the resize to the render semaphore,
  // and resets the contraction loop's idle observation. Returns true
  // if `#maxPages` grew. Caller is expected to follow up with whatever
  // spawn / refill path it was about to take — expansion just lifts
  // the ceiling, it doesn't itself create a tab.
  //
  // Two-tier ceiling:
  //   - up to `#maxBurstPages`: any priority can drive expansion
  //     (default tier, available to background and user work alike)
  //   - past `#maxBurstPages` and up to `#highPriorityMaxPages`: only
  //     callers with `priority >= #highPriorityThreshold` can drive
  //     the expansion. The structural guarantee: a low-priority
  //     workload cannot consume the entire memory envelope on its own
  //     — there's always reserved expansion budget that requires a
  //     qualifying priority to claim.
  //
  // The defaults (`#highPriorityMaxPages === #maxBurstPages` and
  // `#highPriorityThreshold === +Infinity`) collapse this into the
  // single-tier behaviour from the previous PR.
  //
  // Requires a resize-capable render semaphore. Without `setCapacity`,
  // `#maxPages` would drift away from the actual global concurrency
  // gate (the semaphore's fixed capacity), and the saturation
  // heuristic would misreport state. Test stubs that supply only
  // `acquire` keep working by skipping expansion — same as legacy
  // fixed-pool mode for them.
  #tryExpand(priority: number = 0): boolean {
    let cap =
      priority >= this.#highPriorityThreshold
        ? this.#highPriorityMaxPages
        : this.#maxBurstPages;
    if (this.#maxPages >= cap) return false;
    if (!this.#renderSemaphore?.setCapacity) return false;
    let prev = this.#maxPages;
    this.#maxPages = prev + 1;
    this.#renderSemaphore.setCapacity(this.#maxPages);
    this.#idleObservedAt = undefined;
    let tier = this.#maxPages > this.#maxBurstPages ? 'high-priority' : 'burst';
    log.info(
      `pool expansion: maxPages=${prev}→${this.#maxPages} tier=${tier} (burst=${this.#maxBurstPages}, hp=${this.#highPriorityMaxPages}, priority=${priority})`,
    );
    return true;
  }

  // Periodic check that drives contraction. Runs on a `setInterval`
  // started in the constructor only when the pool is configured to
  // grow (`#maxBurstPages > #minPages`). All gates have to pass on a
  // single tick before any tab is dropped:
  //
  //   - the live cap must be above `#minPages` (room to shrink),
  //   - no waiters anywhere on the pool (per-tab queues, file-
  //     admission semaphores, render semaphore) — checked via
  //     `#observeIdleness`,
  //   - the idle state must have held continuously for at least
  //     `#idleContractionMs` (hysteresis),
  //   - at least two idle pool entries OR an idle standby exist
  //     (don't contract through saturation; the warmth-preserving
  //     drop rule below will pick one).
  //
  // Bounded rate: at most one tab is dropped per tick. When a drop
  // happens the loop continues running and will fire again after the
  // next cooldown window if conditions still hold, walking the pool
  // back to `#minPages` over multiple ticks instead of all at once.
  async #contractionTick(): Promise<void> {
    if (this.#contractionInFlight) return;
    this.#contractionInFlight = true;
    try {
      if (this.#maxPages <= this.#minPages) return;
      let idle = this.#observeIdleness();
      if (!idle) {
        this.#idleObservedAt = undefined;
        return;
      }
      let now = Date.now();
      if (this.#idleObservedAt === undefined) {
        this.#idleObservedAt = now;
        return;
      }
      if (now - this.#idleObservedAt < this.#idleContractionMs) return;
      // All gates passed: shrink. Reset the observation so the next
      // contraction respects the cooldown window from this point.
      this.#idleObservedAt = now;
      await this.#contractByOne();
    } catch (e) {
      log.warn('contraction tick failed:', e);
    } finally {
      this.#contractionInFlight = false;
    }
  }

  // Returns true when the pool has no work in flight and no waiters
  // queued — the precondition for considering contraction. Folds in
  // every queueing layer: per-tab queues, per-affinity file-admission
  // semaphores, and (when wired) the global render semaphore in both
  // its in-flight and queued-waiter dimensions. Standbys are not pool
  // entries and do not block idleness — they're the resource we may
  // be about to drop.
  #observeIdleness(): boolean {
    for (let entries of this.#affinityPages.values()) {
      for (let entry of entries) {
        if (entry.closing) continue;
        if (entry.queue.pendingCount !== 0) return false;
      }
    }
    for (let sem of this.#fileAdmission.values()) {
      if (sem.pendingCount > 0) return false;
      if (sem.inUseCount > 0) return false;
    }
    let renderSem = this.#renderSemaphore;
    if (renderSem) {
      let asAsync = renderSem as Partial<AsyncSemaphore>;
      if (typeof asAsync.inUseCount === 'number' && asAsync.inUseCount > 0) {
        return false;
      }
      if (
        typeof asAsync.pendingCount === 'number' &&
        asAsync.pendingCount > 0
      ) {
        return false;
      }
    }
    return true;
  }

  // Drop one slot. Warmth-preserving rule: prefer a standby (no
  // affinity warmth to lose) over an active pool entry. When dropping
  // an active entry, pick the affinity whose tabs have the oldest LRU
  // touch among currently-idle entries — that affinity has been
  // quietest, so dropping it sacrifices the least warm-routing
  // value. The dropped entry's BrowserContext is preserved as an
  // orphan in `#sharedContexts` (existing `disposeAffinity` /
  // `#closeEntry` behaviour), so an immediate re-burst can re-warm
  // via `#tryClaimOrphanContext` without re-fetching.
  async #contractByOne(): Promise<void> {
    // Pick a victim BEFORE shrinking the cap. If no eligible target
    // exists (no standby, no fully-idle affinity), abort the tick —
    // shrinking `#maxPages` without disposing anything would leave
    // the live cap inconsistent with the actual tab count and
    // artificially throttle concurrency.
    let standbyVictim: StandbyEntry | undefined;
    let oldestAffinity: string | undefined;
    if (this.#standbys.size > 0) {
      standbyVictim = this.#selectLRUTab([...this.#standbys]);
    } else {
      let oldestStamp = Infinity;
      for (let [affinityKey, entries] of this.#affinityPages.entries()) {
        let allIdle = [...entries].every(
          (entry) =>
            !entry.closing &&
            !entry.transitioning &&
            entry.queue.pendingCount === 0,
        );
        if (!allIdle) continue;
        let lastUsedAt = Math.max(
          ...[...entries].map((entry) => entry.lastUsedAt),
        );
        if (lastUsedAt < oldestStamp) {
          oldestStamp = lastUsedAt;
          oldestAffinity = affinityKey;
        }
      }
    }
    let actualTabs = this.#poolEntryCount() + this.#standbys.size;
    // Three cases allow shrinking the cap by one:
    //   1. A standby exists → drop it.
    //   2. A fully-idle affinity exists → dispose it.
    //   3. No standbys and no eligible affinity, but the cap is
    //      over-provisioned vs the actual resource count
    //      (`#maxPages - 1 >= actualTabs`) → shrink alone. This case
    //      handles a fully-quiet pool where contraction can drop
    //      headroom without dropping any resource.
    // Any other state — there are tabs / standbys but none eligible
    // (closing, transitioning, pending) — leaves `#maxPages` alone;
    // the next tick retries once an idle window opens.
    let canShrinkCapAlone =
      !standbyVictim && !oldestAffinity && this.#maxPages - 1 >= actualTabs;
    if (!standbyVictim && !oldestAffinity && !canShrinkCapAlone) {
      return;
    }

    // Now shrink the cap and forward the resize to the render
    // semaphore. Doing the dispose first then the shrink would race
    // any expand call that observes the still-current cap; doing the
    // shrink first (after the victim is picked) keeps the visible
    // state consistent.
    let prev = this.#maxPages;
    this.#maxPages = prev - 1;
    if (this.#renderSemaphore?.setCapacity) {
      this.#renderSemaphore.setCapacity(this.#maxPages);
    }
    log.info(
      `pool contraction: maxPages=${prev}→${this.#maxPages} (min=${this.#minPages})`,
    );
    // Standby drop preferred first — it has no affinity warmth. Use
    // the canonical `#closeEntry` teardown path so per-page
    // diagnostic state (`#consoleErrorsByPageId`,
    // `#exceptionKeysByPageId`, `#affinityKeyByPageId`) is cleaned
    // up; otherwise repeated expand/contract cycles would leak stale
    // entries for dead standby pages.
    if (standbyVictim) {
      this.#standbys.delete(standbyVictim);
      try {
        await this.#closeEntry(standbyVictim);
      } catch (e) {
        log.debug('error closing standby during contraction:', e);
      }
      return;
    }
    // Otherwise dispose the whole affinity whose tabs are oldest in
    // LRU touch. The affinity's BrowserContext is kept in
    // `#sharedContexts` as an orphan for re-warming on the next
    // burst.
    if (oldestAffinity) {
      await this.disposeAffinity(oldestAffinity);
    }
  }

  async #selectEntryForAffinity(
    affinityKey: string,
    queue: PrerenderQueue,
    signal?: AbortSignal,
    priority: number = 0,
  ): Promise<{
    entry: PoolEntry;
    reused: boolean;
    releaseTab: () => void;
    // Time this call spent awaiting the standby-refill machinery
    // (`#ensureStandbyPool`). Non-zero only on the paths that needed
    // a fresh standby because no warm tab / orphan / cross-affinity
    // tab was available. Reported to `getPage` so the caller's
    // `tabStartupMs` only attributes the wait actually paid for —
    // dedup-amplified waits from unrelated callers no longer leak in.
    tabStartupMs: number;
  }> {
    let tabStartupMs = 0;
    // The two standby-refill await sites below are intentionally
    // INLINED as `if (current < desired) { await ... }` rather than
    // pulled into a helper. `await asyncHelper()` yields one
    // microtask even when the helper returns synchronously (the
    // resolved Promise still rounds through the microtask queue).
    // That extra hop shifts the relative microtask order against a
    // sibling caller hitting the simpler same-affinity
    // `least-pending` branch — the sibling reaches
    // `entry.queue.acquire` earlier, inflates `pendingCount` past
    // the cross-affinity scan's `> 1` filter, and forces this
    // caller to throw `'No standby page available for prerender'`
    // despite a valid stealable candidate existing. Inlining the
    // check keeps the no-op path strictly synchronous so the
    // relative ordering matches the pre-CS-11139 shape.
    let entries = this.#affinityPages.get(affinityKey);
    let entryList = entries
      ? [...entries].filter((entry) => !entry.closing)
      : [];
    let idle = entryList.filter((entry) => entry.queue.pendingCount === 0);
    if (idle.length > 0) {
      let entry = this.#selectLRUTab(idle);
      let releaseTab = await entry.queue.acquire(signal, priority);
      return { entry, reused: true, releaseTab, tabStartupMs };
    }
    // Per-affinity spawn gate. Two paths to admission here:
    //
    // 1. Headroom under the per-affinity cap: standard fairness rule
    //    — one realm can't claim more than `#affinityTabMax` tabs at
    //    once. Spawn into the affinity's shared context or commandeer
    //    a dormant standby.
    //
    // 2. The pool can still expand AND the request is `module` or
    //    `command`. This is the dynamic-pool deadlock escape hatch:
    //    `module` / `command` calls bypass file admission, so they
    //    can land on an affinity that's already at `#affinityTabMax`
    //    via in-flight file renders — the wait-shape that produces
    //    the self-referential deadlock if no tab can be conjured.
    //    Allowing the spawn here lets `#tryExpand` lift the global
    //    cap and the standby refill / commandeer path produce a tab
    //    for the queued sub-render. File renders still respect the
    //    per-affinity cap (via the admission semaphore upstream) so
    //    cross-realm fairness for the file workload is preserved.
    let canExpandPastAffinityCap =
      this.#highPriorityMaxPages > this.#minPages &&
      this.#maxPages < this.#highPriorityMaxPages &&
      queue !== 'file';
    if (entryList.length < this.#affinityTabMax || canExpandPastAffinityCap) {
      // Prefer spawning into the affinity's shared context over
      // adopting a fresh standby — whether that context is orphan
      // (carries the realm's warm HTTP cache from before eviction)
      // or already has active pages (keeps "one BrowserContext per
      // affinity" intact so additional standby contexts don't leak
      // through the close path).
      let shared = this.#tryClaimOrphanContext(affinityKey);
      if (shared) {
        return {
          ...(await this.#spawnPoolEntryInSharedContext(shared, affinityKey)),
          reused: false,
          tabStartupMs,
        };
      }
      let commandeered = this.#commandeerDormantTab(affinityKey, {
        standbyOnly: true,
      });
      if (commandeered) {
        let releaseTab = await commandeered.queue.acquire(signal, priority);
        return { entry: commandeered, reused: false, releaseTab, tabStartupMs };
      }
      // module / command callers must produce the reserved tab the
      // file-admission cap is supposed to keep room for. The cap
      // bounds file workload at `affinityTabMax − 1`, leaving global-
      // pool headroom for a non-file call — but the headroom is only
      // a reservation, not a spawned tab. Without this synchronous
      // refill+retry, the call falls through to the busy-tab fallback
      // below and queues behind the file render that's awaiting this
      // sub-render: the self-referential prerender deadlock.
      // `#ensureStandbyPool` respects `#maxPages` via
      // `#prepareSlotForStandby`, so this can't oversubscribe the
      // global pool. Note this path only fires under
      // `entryList.length < #affinityTabMax` — the at-cap case (every
      // tab held by file renders, no dynamic-expansion budget) still
      // falls through to busy-tab below. That residual deadlock
      // requires either operator-side capacity tuning or the high-
      // priority tier escape hatch beneath this branch.
      //
      // We await `#ensureStandbyPool` UNCONDITIONALLY here (not gated
      // on `current < desired`). Reason: `#currentStandbyCount` =
      // `#standbys.size + #creatingStandbys`. If the file render that
      // arrived just before this caller consumed the only standby and
      // its post-acquire `#kickStandbyRefill` is already creating a
      // replacement, `creatingStandbys > 0` inflates `current` to
      // meet `desired` while `#standbys.size` is still 0. A
      // `current < desired` guard would skip the await; the
      // subsequent `commandeerDormantTab(standbyOnly:true)` would
      // then fail to find a real standby and the caller would fall
      // through to the busy-tab branch — exactly the deadlock this
      // change is meant to prevent. Two scenarios produce no-op
      // behavior: (a) the pool is genuinely healthy with
      // `#standbys.size >= desired` and no refill in flight —
      // `#ensureStandbyPoolInternal`'s loop returns at line 1266
      // (`current >= desired`); (b) a refill is in flight —
      // `#ensureStandbyPool` returns the existing `#ensuringStandbys`
      // promise via dedup at line 1242 and we wait for it. Both
      // produce the right shape: no spurious creation when not needed,
      // wait when needed.
      if (queue !== 'file' && entryList.length < this.#affinityTabMax) {
        let startedAt = Date.now();
        await this.#ensureStandbyPool();
        tabStartupMs += Date.now() - startedAt;
        let refilled = this.#commandeerDormantTab(affinityKey, {
          standbyOnly: true,
        });
        if (refilled) {
          let releaseTab = await refilled.queue.acquire(signal, priority);
          return { entry: refilled, reused: false, releaseTab, tabStartupMs };
        }
      }
      // No orphan, no commandeer-able tab/standby. If we got here
      // through the dynamic-expansion escape hatch, drive an
      // expansion + fresh spawn so the saturated module/command
      // sub-render isn't forced to queue behind the file render
      // it's blocking.
      if (canExpandPastAffinityCap && this.#tryExpand(priority)) {
        if (this.#currentStandbyCount() < this.#desiredStandbyCount()) {
          let startedAt = Date.now();
          await this.#ensureStandbyPool();
          tabStartupMs += Date.now() - startedAt;
        }
        let after = this.#commandeerDormantTab(affinityKey, {
          standbyOnly: true,
        });
        if (after) {
          let releaseTab = await after.queue.acquire(signal, priority);
          return { entry: after, reused: false, releaseTab, tabStartupMs };
        }
      }
    }
    if (entryList.length > 0) {
      let entry = this.#selectLeastPendingTab(entryList);
      let releaseTab = await entry.queue.acquire(signal, priority);
      return { entry, reused: true, releaseTab, tabStartupMs };
    }
    let fallbackShared = this.#tryClaimOrphanContext(affinityKey);
    if (fallbackShared) {
      return {
        ...(await this.#spawnPoolEntryInSharedContext(
          fallbackShared,
          affinityKey,
        )),
        reused: false,
        tabStartupMs,
      };
    }
    let fallback = this.#commandeerDormantTab(affinityKey, {
      standbyOnly: true,
    });
    if (fallback) {
      let releaseTab = await fallback.queue.acquire(signal, priority);
      return { entry: fallback, reused: false, releaseTab, tabStartupMs };
    }
    if (entryList.length === 0) {
      // Brand-new affinity: no warm tabs of its own to fall back on.
      // Wait once on the fire-and-forget refill before considering
      // cross-affinity steals — queueing behind another realm's in-
      // flight render would serialize this caller against unrelated
      // work, and a fresh standby is typically much faster than
      // whatever a busy donor tab is currently rendering. Pre-fix
      // (CS-11139), the upfront synchronous `await
      // #ensureStandbyPool()` in `getPage` made this ordering implicit;
      // now we make it explicit here so brand-new affinities still get
      // a fresh standby in preference to busy-tab queueing.
      //
      // The gate here is intentional and asymmetric with the non-file
      // spawn-branch above. There the deadlock cost of skipping is
      // unbounded (the caller queues on the very tab whose work it
      // blocks), so we await unconditionally. Here the cost of
      // skipping is only a cross-affinity-steal hop — itself a
      // designed fallback — so paying an extra microtask for a no-op
      // await is the wrong trade. It also shifts microtask ordering
      // against a concurrent same-affinity file caller arriving on
      // an idle tab, which the
      // `queues same-realm request when tab is transitioning` test in
      // `prerendering-test.ts` pins.
      if (this.#currentStandbyCount() < this.#desiredStandbyCount()) {
        let startedAt = Date.now();
        await this.#ensureStandbyPool();
        tabStartupMs += Date.now() - startedAt;
      }
      throwIfAborted(signal);
      let retryShared = this.#tryClaimOrphanContext(affinityKey);
      if (retryShared) {
        return {
          ...(await this.#spawnPoolEntryInSharedContext(
            retryShared,
            affinityKey,
          )),
          reused: false,
          tabStartupMs,
        };
      }
      let retryCommandeered = this.#commandeerDormantTab(affinityKey, {
        standbyOnly: true,
      });
      if (retryCommandeered) {
        let releaseTab = await retryCommandeered.queue.acquire(
          signal,
          priority,
        );
        return {
          entry: retryCommandeered,
          reused: false,
          releaseTab,
          tabStartupMs,
        };
      }
      // Refill couldn't produce a tab (e.g. `createBrowserContext`
      // exhausted retries). Fall back to cross-affinity steal so the
      // caller has *some* path to a tab — better than throwing while
      // there are idle tabs on other affinities.
      let crossAffinityEntries: PoolEntry[] = [];
      for (let [assignedAffinity, entries] of this.#affinityPages.entries()) {
        if (assignedAffinity === affinityKey) continue;
        for (let entry of entries) {
          if (entry.closing || entry.transitioning) continue;
          if (entry.queue.pendingCount > 1) continue;
          crossAffinityEntries.push(entry);
        }
      }
      if (crossAffinityEntries.length > 0) {
        let entry = this.#selectLeastPendingTab(crossAffinityEntries);
        entry.transitioning = true;
        try {
          let releaseTab = await entry.queue.acquire(signal, priority);
          return { entry, reused: false, releaseTab, tabStartupMs };
        } catch (error) {
          entry.transitioning = false;
          throw error;
        }
      }
    }
    throw new Error('No standby page available for prerender');
  }

  #selectLRUTab<T extends Entry>(entries: T[]): T {
    return entries.reduce((lru, entry) =>
      entry.lastUsedAt < lru.lastUsedAt ? entry : lru,
    );
  }

  #selectLeastPendingTab(entries: PoolEntry[]): PoolEntry {
    return entries.reduce((best, entry) => {
      let pending = entry.queue.pendingCount;
      let bestPending = best.queue.pendingCount;
      if (pending < bestPending) {
        return entry;
      }
      if (pending === bestPending) {
        return entry.lastUsedAt < best.lastUsedAt ? entry : best;
      }
      return best;
    });
  }

  // Synchronously claim an ORPHAN shared context (pageCount was 0,
  // not closing). Incrementing `pageCount` here is atomic w.r.t. the
  // microtask queue, so a concurrent caller sees the orphan as taken
  // and falls through to the standby path.
  //
  // Only orphans are claimed; an already-active shared context is
  // not incremented here because spawning an extra page inside it
  // would require a `/_standby` bootstrap on every additional
  // concurrent visit — measurably slower than adopting a standby's
  // pre-loaded page. The "additional standby has its own
  // BrowserContext" case is handled in `#closeEntry`, which closes
  // the entry's own context when it isn't the one tracked by
  // `#sharedContexts`.
  #tryClaimOrphanContext(affinityKey: string): SharedContext | undefined {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared || shared.closing) return undefined;
    if (shared.pageCount !== 0) return undefined;
    shared.pageCount = 1;
    shared.lastUsedAt = Date.now();
    return shared;
  }

  // Spawn a pool entry inside a previously-claimed shared context.
  // Bootstraps the page via `/_standby` so render-runner can invoke
  // `globalThis.boxelTransitionTo` on first use (Copilot review
  // #2/#7 on PR #4465). The queue slot is acquired synchronously
  // before `#addAffinityEntry` so concurrent callers never observe
  // the new entry with `pendingCount === 0`.
  async #spawnPoolEntryInSharedContext(
    shared: SharedContext,
    affinityKey: string,
  ): Promise<{ entry: PoolEntry; releaseTab: () => void }> {
    let page: Page | undefined;
    try {
      page = await shared.context.newPage();
      await this.#markPageAsInPrerender(page);
      let pageId = uuidv4();
      await this.#attachPageObservability(page, affinityKey, pageId);
      await this.#loadStandbyPage(page, pageId);
      let entry: PoolEntry = {
        type: 'pool',
        affinityKey,
        context: shared.context,
        page,
        pageId,
        lastUsedAt: Date.now(),
        queue: new TabQueue(),
      };
      let releaseTabPromise = entry.queue.acquire();
      this.#addAffinityEntry(affinityKey, entry);
      let releaseTab = await releaseTabPromise;
      return { entry, releaseTab };
    } catch (err) {
      if (page) {
        try {
          await page.close();
        } catch (closeErr) {
          log.debug(
            `Error closing half-initialized shared-context page for ${affinityKey}:`,
            closeErr,
          );
        }
      }
      let rollback = this.#releaseSharedContextForClosedPage(
        affinityKey,
        shared.context,
      );
      if (rollback) {
        await rollback.catch(() => {
          // close error is logged inside the helper
        });
      }
      throw err;
    }
  }

  #commandeerDormantTab(
    affinityKey: string,
    opts?: { standbyOnly?: boolean },
  ): PoolEntry | undefined {
    if (this.#standbys.size > 0) {
      let standby = this.#selectLRUTab([...this.#standbys]);
      this.#standbys.delete(standby);
      return this.#assignStandbyToAffinity(standby, affinityKey);
    }
    // CS-11139: `standbyOnly: true` in the eager step-2 path so a
    // caller doesn't preemptively cross-affinity-steal an idle tab
    // from another realm whose runtime state (cached modules,
    // localStorage, deps tracking) would leak into this caller's
    // prerender. The pre-CS-11139 upfront `await
    // #ensureStandbyPool()` in `getPage` made this implicit — by
    // the time `commandeerDormantTab` ran, a fresh standby was
    // always available. Now cross-affinity steal is reserved for
    // the awaited-refill fallback in `#selectEntryForAffinity`'s
    // entryList===0 branch.
    if (opts?.standbyOnly) {
      return undefined;
    }

    let idleCandidates: PoolEntry[] = [];
    for (let [assignedAffinity, entries] of this.#affinityPages.entries()) {
      if (assignedAffinity === affinityKey) continue;
      for (let entry of entries) {
        if (entry.closing) continue;
        if (entry.queue.pendingCount === 0) {
          idleCandidates.push(entry);
        }
      }
    }
    if (idleCandidates.length === 0) {
      return undefined;
    }
    let chosen = this.#selectLRUTab(idleCandidates);
    return this.#reassignAffinityTab(chosen, affinityKey);
  }

  #assignStandbyToAffinity(
    standby: StandbyEntry,
    affinityKey: string,
  ): PoolEntry {
    let entry: PoolEntry = {
      type: 'pool',
      affinityKey,
      context: standby.context,
      page: standby.page,
      pageId: standby.pageId,
      lastUsedAt: Date.now(),
      queue: standby.queue,
    };
    // Adoption path: the page is keeping its standby pageId, so the
    // CDP runtime-exception session attached at standby creation is
    // still valid and stays connected. The console listener gets
    // re-bound below to pick up the new affinityKey for its own log
    // lines. The CDP capture reads affinityKey via the lookup map
    // (see `#attachPageObservability`), so updating the map here
    // flows the new affinityKey into its log lines too without
    // re-attaching the CDP session.
    this.#affinityKeyByPageId.set(entry.pageId, affinityKey);
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, affinityKey, entry.pageId);
    this.#addAffinityEntry(affinityKey, entry);
    // Register the standby's BrowserContext as the affinity's primary
    // shared context — but ONLY when the affinity doesn't already have
    // an active one. A second concurrent caller on the same affinity
    // (typical: `file` render + same-affinity `module` sub-call) used
    // to register its standby's context unconditionally here, which:
    //   1. Fired `Shared-context invariant violated` because the
    //      already-tracked primary differed from the standby's context.
    //   2. Inflated `pageCount` on the existing primary every time,
    //      permanently preventing orphan-claim recovery for the
    //      affinity (CS-11140).
    // The standby's context is still owned by this entry — `#closeEntry`'s
    // `entryOwnsContext` path closes it directly when the entry is torn
    // down — but it's not the affinity's *shared* context for
    // bookkeeping purposes.
    let existing = this.#sharedContexts.get(affinityKey);
    if (!existing || existing.closing) {
      this.#recordSharedContextForFirstPage(standby.context, affinityKey);
    }
    return entry;
  }

  // Register an affinity's first adopted context. Callers are
  // expected to have gone through `#tryClaimOrphanContext` first:
  // that way, if the affinity already owns a non-closing shared
  // context we reuse it (via spawn) instead of ending up here with
  // a second BrowserContext. Hitting the "existing + different
  // context" branch below would be a leak — pool entries now close
  // through the shared bookkeeping and only the first-registered
  // context would get closed.
  #recordSharedContextForFirstPage(
    context: BrowserContext,
    affinityKey: string,
  ): void {
    let existing = this.#sharedContexts.get(affinityKey);
    if (existing && !existing.closing) {
      if (existing.context !== context) {
        log.error(
          `Shared-context invariant violated for ${affinityKey}: ` +
            `existing BrowserContext does not match the one being registered. ` +
            `This would leak the second context once its page closes. ` +
            `Callers must route through #tryClaimOrphanContext first.`,
        );
      }
      existing.pageCount++;
      existing.lastUsedAt = Date.now();
      return;
    }
    this.#sharedContexts.set(affinityKey, {
      context,
      affinityKey,
      pageCount: 1,
      lastUsedAt: Date.now(),
    });
  }

  #reassignAffinityTab(entry: PoolEntry, affinityKey: string): PoolEntry {
    let oldAffinityKey = entry.affinityKey;
    this.#detachAffinityEntry(entry);
    // CS-10817 step 2/3: the moving page takes its BrowserContext with
    // it — the context is still in use, just under a different
    // affinity. Transfer the shared-context row rather than running
    // `#releaseSharedContextForClosedPage` on the old key (which would
    // close the context when pageCount hit zero and take the moving
    // page down with it).
    //
    // The entry's context is passed in so `#transferSharedContextBookkeeping`
    // can verify it's actually the old affinity's primary. With CS-11140's
    // supplementary-tab guard in `#assignStandbyToAffinity`, an entry on
    // a multi-tab affinity may have a context that's NOT the affinity's
    // primary shared context. Decrementing the primary's `pageCount` in
    // that case would wrongly evict the primary's bookkeeping while
    // some other (sibling) entry is still using it.
    if (oldAffinityKey) {
      this.#transferSharedContextBookkeeping(oldAffinityKey, entry.context);
    }
    entry.affinityKey = affinityKey;
    // Re-tagging path: pageId is unchanged, so the CDP runtime-
    // exception session stays attached to the same page. The console
    // listener gets re-bound below to pick up the new affinityKey;
    // the CDP capture reads affinityKey via the lookup map (see
    // `#attachPageObservability`), so updating the map here flows
    // the new affinityKey into its log lines too without re-attaching
    // the CDP session.
    this.#affinityKeyByPageId.set(entry.pageId, affinityKey);
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, affinityKey, entry.pageId);
    this.#addAffinityEntry(affinityKey, entry);
    // Same supplementary-context guard as `#assignStandbyToAffinity`:
    // only register this entry's BrowserContext as the new affinity's
    // primary when no active primary exists. The reassigned entry's
    // context is owned by the entry; `#closeEntry`'s `entryOwnsContext`
    // path handles its teardown without affecting whichever primary
    // shared context the new affinity already has.
    let existing = this.#sharedContexts.get(affinityKey);
    if (!existing || existing.closing) {
      this.#recordSharedContextForFirstPage(entry.context, affinityKey);
    }
    entry.lastUsedAt = Date.now();
    return entry;
  }

  // Drop the old affinity's shared-context row without closing the
  // underlying BrowserContext — used by `#reassignAffinityTab` when a
  // page moves between affinities but keeps its context.
  //
  // The `entryContext` argument is the moving entry's `BrowserContext`.
  // The bookkeeping only decrements if that context IS the old
  // affinity's primary shared context — supplementary tabs (whose
  // contexts aren't tracked in `#sharedContexts`, per CS-11140's
  // `#assignStandbyToAffinity` guard) leave the primary untouched.
  #transferSharedContextBookkeeping(
    oldAffinityKey: string,
    entryContext: BrowserContext,
  ): void {
    let shared = this.#sharedContexts.get(oldAffinityKey);
    if (!shared) return;
    if (shared.context !== entryContext) {
      // The moving entry was supplementary to the old affinity's
      // primary shared context — its context wasn't contributing to
      // `pageCount`. Leave the primary's bookkeeping intact.
      return;
    }
    shared.pageCount = Math.max(0, shared.pageCount - 1);
    shared.lastUsedAt = Date.now();
    if (shared.pageCount === 0) {
      this.#sharedContexts.delete(oldAffinityKey);
    }
  }

  #addAffinityEntry(affinityKey: string, entry: PoolEntry): void {
    let entries = this.#affinityPages.get(affinityKey);
    if (!entries) {
      entries = new Set();
      this.#affinityPages.set(affinityKey, entries);
    }
    entries.add(entry);
    this.#touchLRU(affinityKey);
  }

  #detachAffinityEntry(entry: PoolEntry): void {
    let affinityKey = entry.affinityKey;
    if (!affinityKey) return;
    let entries = this.#affinityPages.get(affinityKey);
    if (!entries) return;
    entries.delete(entry);
    if (entries.size === 0) {
      this.#affinityPages.delete(affinityKey);
      this.#lru.delete(affinityKey);
      void this.#notifyManagerAffinityEvicted(affinityKey);
    }
  }

  async #notifyManagerAffinityEvicted(affinityKey: string): Promise<void> {
    try {
      const managerURL = resolvePrerenderManagerURL();
      let target = new URL(
        `${managerURL}/prerender-servers/affinities/${encodeURIComponent(affinityKey)}`,
      );
      target.searchParams.set('url', this.#serverURL);
      await fetch(target.toString(), { method: 'DELETE' }).catch((e) => {
        log.debug('Manager affinity eviction notify failed:', e);
      });
    } catch (_e) {
      // do best attempt
    }
  }

  async #closeEntry(entry: Entry, retainConsoleErrors = false): Promise<void> {
    let release: (() => void) | undefined;
    let affinityKey = entry.type === 'pool' ? entry.affinityKey : null;
    try {
      entry.closing = true;
      release = await entry.queue.acquire();
      if (entry.type === 'standby') {
        // Standbys own their BrowserContext entirely — no other pool
        // entry references it. Close the whole context.
        await entry.context.close();
      } else {
        // Pool entries: the entry's context is the affinity's shared
        // context in the common case, but when `affinityTabMax > 1`
        // a concurrent second-tab request can adopt another standby
        // whose BrowserContext is different from the one recorded in
        // `#sharedContexts` for this affinity. Closing only the page
        // in that scenario would leak the standby's context, because
        // the shared-context bookkeeping only ever tears down the
        // single tracked context. Detect the mismatch up front and
        // close the entry's own context directly.
        let shared = affinityKey
          ? this.#sharedContexts.get(affinityKey)
          : undefined;
        let entryOwnsContext = !shared || shared.context !== entry.context;
        if (entryOwnsContext) {
          await entry.context.close();
        } else {
          // Close only this page; `#releaseSharedContextForClosedPage`
          // below decrements the shared row so orphan retention,
          // orphan LRU, and `disposeAffinity` can decide whether to
          // retain or close the context.
          //
          // The release runs in a `finally` so a `page.close()` throw
          // (target closed / protocol error) can't leave `pageCount`
          // permanently inflated — pageCount would otherwise wedge the
          // context, blocking both orphan LRU and dispose cleanup.
          let closePromise: Promise<void> | undefined;
          try {
            await entry.page.close();
          } finally {
            if (affinityKey) {
              closePromise = this.#releaseSharedContextForClosedPage(
                affinityKey,
                entry.context,
              );
            }
          }
          if (closePromise) {
            // `#closeEntry` returns only after the BrowserContext is
            // fully torn down. Awaiting here prevents the caller
            // (e.g. `disposeAffinity`) from returning to code that
            // starts a new render while chrome is still disposing
            // the old context — confusing module errors during
            // incremental re-indexing otherwise.
            await closePromise;
          }
        }
      }
    } catch (e) {
      log.warn(
        `Error closing entry for ${
          entry.type === 'pool' ? entry.affinityKey : 'standby'
        }:`,
        e,
      );
    } finally {
      release?.();
    }
    if (!retainConsoleErrors) {
      this.#consoleErrorsByPageId.delete(entry.pageId);
      this.#exceptionKeysByPageId.delete(entry.pageId);
    }
    // affinityKey lookup map mirrors the page's identity, not its
    // per-render state — clear it whenever the page itself is going
    // away, which is exactly when this method runs (regardless of
    // retainConsoleErrors, which is a separate per-render flag).
    this.#affinityKeyByPageId.delete(entry.pageId);
  }

  // Returns a Promise when the release forces a context close —
  // happens only via the orphan LRU sweep when the cap is exceeded,
  // so callers can still await for deterministic teardown. The common
  // case (pageCount hits zero) keeps the context alive as an orphan
  // so step-5's standby-adoption path can reuse it on the next
  // same-affinity getPage and inherit the realm's HTTP cache +
  // localStorage.
  //
  // `entryContext` is the closing entry's `BrowserContext`. If a
  // concurrent caller replaced the affinity's map entry with a fresh
  // context (e.g. `disposeAffinity` race where the old primary is
  // mid-`page.close()` and a sibling caller registered a new primary
  // for the same affinity), the entry we're closing and the entry in
  // `#sharedContexts` no longer refer to the same context. Skip the
  // decrement in that case — `disposeAffinity`'s snapshot-based
  // cleanup path is responsible for the old primary, and the new
  // primary's `pageCount` must stay intact.
  #releaseSharedContextForClosedPage(
    affinityKey: string,
    entryContext: BrowserContext,
  ): Promise<void> | undefined {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared) return;
    if (shared.context !== entryContext) {
      // Map entry was replaced — leave the new primary's bookkeeping
      // alone. The closing context is being torn down by whichever
      // path owned the snapshot (typically `disposeAffinity`).
      return;
    }
    shared.pageCount = Math.max(0, shared.pageCount - 1);
    shared.lastUsedAt = Date.now();
    if (shared.pageCount !== 0) return;
    // CS-10817 step 5: retain as orphan for potential reuse.
    // `#maybeEvictOrphanContexts` only closes anything if we are over
    // the configured cap (`PRERENDER_SHARED_CONTEXT_CAP`).
    return this.#maybeEvictOrphanContexts();
  }

  // Close oldest orphans (pageCount === 0, not already closing) until
  // `#sharedContexts.size` is back under `#sharedContextCap`. Active
  // contexts are never evicted — they belong to live traffic.
  async #maybeEvictOrphanContexts(): Promise<void> {
    if (this.#sharedContexts.size <= this.#sharedContextCap) return;
    let orphans: SharedContext[] = [];
    for (let shared of this.#sharedContexts.values()) {
      if (shared.pageCount === 0 && !shared.closing) {
        orphans.push(shared);
      }
    }
    if (orphans.length === 0) return;
    let excess = this.#sharedContexts.size - this.#sharedContextCap;
    orphans.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    let toEvict = orphans.slice(0, excess);
    for (let shared of toEvict) {
      await this.#closeSharedContext(shared.affinityKey);
    }
  }

  // Detach a shared-context row from the map and tear down its
  // BrowserContext. Used by `#releaseSharedContextForClosedPage`,
  // `disposeAffinity`, `closeAll`, and the orphan-LRU sweep so every
  // close goes through a single code path.
  async #closeSharedContext(affinityKey: string): Promise<void> {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared) return;
    if (shared.closing) {
      this.#sharedContexts.delete(affinityKey);
      return;
    }
    shared.closing = true;
    this.#sharedContexts.delete(affinityKey);
    try {
      await shared.context.close();
    } catch (e) {
      log.warn(`Error closing shared context for ${affinityKey}:`, e);
    }
  }

  // Inject a window global into every page before any document
  // loads, so the host SPA can synchronously detect at boot that it's
  // running inside a prerender tab. Used by the host's
  // realm-server fetch wrapper to attach `x-boxel-during-prerender`
  // on _federated-search / _search calls only — narrowly scoped so
  // unrelated services (icons, vite, etc.) don't see the header on
  // their CORS preflights. The inbound signal the realm server reads
  // tells it to pass cacheOnlyDefinitions:true to searchCards,
  // short-circuiting the recursive lookupDefinition fan-out in
  // populateQueryFields that causes self-referential prerender
  // deadlocks under parallel indexing.
  async #markPageAsInPrerender(page: Page): Promise<void> {
    // Test stubs of Page in prerender-deadlock-test.ts don't expose
    // every puppeteer method — guard the call so this stays optional
    // observability rather than a load-bearing side effect.
    if (typeof page.evaluateOnNewDocument !== 'function') {
      return;
    }
    await page.evaluateOnNewDocument(() => {
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = true;
    });
  }

  // Attach all per-page error/exception observability surfaces. The
  // console-message listener catches things that surfaced via the JS
  // event layer (page logs, Chrome's late "Uncaught (in promise)..."
  // tracker output); the runtime-exception capture catches things at
  // V8's first-layer throw notification, even when the WebAPI dispatch
  // would later get retracted by an upstream `.catch` (the whitepaper-
  // class bug). Both feed the same per-page bucket so render-runner
  // sees a unified additionalErrors stream.
  //
  // Awaited (not fire-and-forget) so the CDP `Runtime.enable` round-
  // trip completes before callers begin page navigation — otherwise
  // we'd miss exceptions thrown during early page boot. Attach
  // failures inside the helper still resolve cleanly without throwing
  // (best-effort observability must not break the render path).
  async #attachPageObservability(
    page: Page,
    affinityKey: string,
    pageId: string,
  ): Promise<void> {
    // Seed the affinityKey lookup map BEFORE attaching the CDP
    // capture, so the capture's `getAffinityKey` callback can resolve
    // immediately if an exception lands during attach.
    this.#affinityKeyByPageId.set(pageId, affinityKey);
    this.#attachPageConsole(page, affinityKey, pageId);
    await attachRuntimeExceptionCapture({
      page,
      // Resolved at log-emit time so adoption / re-tagging that
      // updates `#affinityKeyByPageId` flows through to the capture's
      // log lines without re-attaching the CDP session.
      getAffinityKey: () =>
        this.#affinityKeyByPageId.get(pageId) ?? affinityKey,
      pageId,
      recorder: {
        recordThrown: (exceptionId, entry) =>
          this.#recordThrownException(pageId, exceptionId, entry),
        recordRevoked: (exceptionId) =>
          this.#recordRevokedException(pageId, exceptionId),
      },
    });
  }

  // Returns false if the entry could not be recorded (storage at
  // limit or duplicate exceptionId), so the capture module knows
  // not to expect a matching `recordRevoked` to do anything.
  #recordThrownException(
    pageId: string,
    exceptionId: number,
    entry: ConsoleErrorEntry,
  ): boolean {
    let bucket = this.#consoleErrorsByPageId.get(pageId);
    if (!bucket) {
      bucket = new Map();
      this.#consoleErrorsByPageId.set(pageId, bucket);
    }
    if (bucket.size >= CONSOLE_ERROR_LIMIT) return false;
    let key = `exception:${exceptionId}`;
    if (bucket.has(key)) return false;
    bucket.set(key, entry);
    let exceptionKeys = this.#exceptionKeysByPageId.get(pageId);
    if (!exceptionKeys) {
      exceptionKeys = new Map();
      this.#exceptionKeysByPageId.set(pageId, exceptionKeys);
    }
    exceptionKeys.set(exceptionId, key);
    return true;
  }

  #recordRevokedException(pageId: string, exceptionId: number): void {
    let exceptionKeys = this.#exceptionKeysByPageId.get(pageId);
    let key = exceptionKeys?.get(exceptionId);
    if (!key) return;
    let bucket = this.#consoleErrorsByPageId.get(pageId);
    let entry = bucket?.get(key);
    if (entry) {
      // Tag the existing entry instead of deleting it. The whitepaper-
      // class render bug fits the "thrown then revoked" pattern (RSVP
      // / Backburner attaches a late `.catch` that retracts V8's
      // uncaught status), and dropping these entries was actively
      // discarding the actionable stack we'd captured. Render-runner
      // surfaces revoked entries with `(revoked by late .catch)` in
      // the title so operators can see the lifecycle without losing
      // the lead.
      entry.revoked = true;
    }
    // Keep the exceptionKeys mapping — there's no further follow-up
    // event to dispatch, but a stale-but-harmless entry is better
    // than a phantom remove if V8 ever re-fires for the same id.
  }

  // Test-only seam: drives one expansion tick. Production callers go
  // through `getPage` → `#maybeExpandUnderSaturation`, but unit tests
  // exercising the dynamic-pool envelope shouldn't need a real Chrome
  // round-trip. Returns `true` if `#maxPages` grew on this call.
  // `priority` selects which tier the expansion can reach:
  // `priority >= #highPriorityThreshold` unlocks the high-priority
  // ceiling; lower (or omitted) priorities stop at `#maxBurstPages`.
  __test_tryExpand(priority?: number): boolean {
    return this.#tryExpand(priority ?? 0);
  }

  // Test-only seam: invokes the saturation-detection hook the way
  // `getPage` does, so unit tests can assert that expansion fires
  // when the render semaphore is at capacity. Forwards `priority` so
  // the high-priority tier path can be exercised in unit tests too.
  __test_maybeExpandUnderSaturation(priority?: number): void {
    this.#maybeExpandUnderSaturation(priority ?? 0);
  }

  // Test-only seam: writes a `source: 'exception'` entry directly
  // into the per-page bucket and tags it as revoked, mimicking the
  // end state of a real CDP `Runtime.exceptionThrown` ->
  // `Runtime.exceptionRevoked` pair without needing V8 to actually
  // fire the events. We can't synthesize a card-level fixture that
  // produces real CDP exception events (Ember's runloop catches
  // synthetic throws before V8 classifies them as uncaught), so
  // this seam lets the integration tests pin down that the
  // bucket-to-additionalErrors merge happens at every error-doc
  // call site (timeout, render error, unusable, fileExtract,
  // fileRender). Production code never calls this.
  __test_seedRevokedException(
    pageId: string,
    entry: ConsoleErrorEntry,
    exceptionId: number,
  ): void {
    // Force `source: 'exception'` so the seam can't be silently
    // misused with a `source: 'console'` entry — that would serialize
    // through render-runner as a "Console error", not the
    // "Uncaught exception (revoked by late .catch)" we're trying to
    // pin down. Clone so we don't mutate the caller's object.
    let seededEntry: ConsoleErrorEntry = {
      ...entry,
      source: 'exception',
    };
    this.#recordThrownException(pageId, exceptionId, seededEntry);
    this.#recordRevokedException(pageId, exceptionId);
  }

  #attachPageConsole(page: Page, affinityKey: string, pageId: string): void {
    page.on('console', async (message: ConsoleMessage) => {
      try {
        let logFn = this.#logMethodForConsole(message.type());
        let formatted = await this.#formatConsoleMessage(message);
        let location = message.location();
        let locationData = location?.url
          ? {
              url: location.url,
              lineNumber: location.lineNumber,
              columnNumber: location.columnNumber,
            }
          : undefined;
        let locationInfo = '';
        if (locationData?.url) {
          let segments: number[] = [];
          if (typeof locationData.lineNumber === 'number') {
            segments.push(locationData.lineNumber + 1);
          }
          if (typeof locationData.columnNumber === 'number') {
            segments.push(locationData.columnNumber + 1);
          }
          let suffix = segments.length ? `:${segments.join(':')}` : '';
          locationInfo = ` (${locationData.url}${suffix})`;
        }
        let type = message.type();
        if (
          isExpectedStandbyConsoleError({
            affinityKey,
            type,
            formatted,
            locationURL: locationData?.url,
          })
        ) {
          return;
        }
        logFn(
          'Console[%s] affinity=%s pageId=%s%s %s',
          type,
          affinityKey,
          pageId,
          locationInfo,
          formatted,
        );
        if (type === 'error' || type === 'assert') {
          // Puppeteer's ConsoleMessage.stackTrace() returns the CDP-reported
          // call stack at the point the message was emitted. Chrome
          // populates this for "Uncaught (in promise) ..." logs even when
          // no JS-level error event fires, so it's our best lead for the
          // desync class of failures.
          let pptrStackTrace = message.stackTrace?.();
          let stackFrames: ConsoleErrorLocation[] | undefined =
            Array.isArray(pptrStackTrace) && pptrStackTrace.length > 0
              ? pptrStackTrace
                  .filter((frame) => !!frame?.url)
                  .map((frame) => ({
                    url: frame.url,
                    lineNumber: frame.lineNumber,
                    columnNumber: frame.columnNumber,
                  }))
              : undefined;
          if (stackFrames && stackFrames.length === 0) {
            stackFrames = undefined;
          }
          this.#recordConsoleError(pageId, {
            type,
            text: formatted,
            location: locationData,
            stackFrames,
          });
        }
      } catch (e) {
        log.debug(
          'Failed to process console output for affinity %s page %s:',
          affinityKey,
          pageId,
          e,
        );
      }
    });
  }

  #recordConsoleError(pageId: string, entry: ConsoleErrorEntry): void {
    let bucket = this.#consoleErrorsByPageId.get(pageId);
    if (!bucket) {
      bucket = new Map();
      this.#consoleErrorsByPageId.set(pageId, bucket);
    }
    if (bucket.size >= CONSOLE_ERROR_LIMIT) {
      return;
    }
    // Dedup key falls back to the top stack frame when the message has
    // no location of its own. Browser-internal "Uncaught (in promise)
    // ..." logs typically have no `message.location()`, so two distinct
    // throws with the same exception text but different originating sites
    // would otherwise collapse into one entry — and we'd lose the stack
    // frames that are the only debugging signal for the desync class.
    let location = entry.location ?? entry.stackFrames?.[0];
    let key = [
      entry.type,
      entry.text,
      location?.url ?? '',
      location?.lineNumber ?? '',
      location?.columnNumber ?? '',
    ].join('|');
    if (!bucket.has(key)) {
      bucket.set(key, entry);
    }
  }

  #logMethodForConsole(
    type: ReturnType<ConsoleMessage['type']>,
  ): (...args: any[]) => void {
    switch (type) {
      case 'assert':
      case 'error':
        return chromeLog.error.bind(chromeLog);
      case 'warn':
        return chromeLog.warn.bind(chromeLog);
      case 'info':
        return chromeLog.info.bind(chromeLog);
      case 'debug':
        return chromeLog.debug.bind(chromeLog);
      default:
        return chromeLog.info.bind(chromeLog);
    }
  }

  async #formatConsoleMessage(message: ConsoleMessage): Promise<string> {
    try {
      let args = message.args();
      if (!args.length) {
        return message.text();
      }
      let parts = await Promise.all(
        args.map(async (arg) => {
          try {
            let value = await arg.jsonValue();
            if (typeof value === 'string') {
              return value;
            }
            if (typeof value === 'undefined') {
              return arg.toString();
            }
            return JSON.stringify(value);
          } catch (_e) {
            return arg.toString();
          }
        }),
      );
      let joined = parts.filter((part) => part.length > 0).join(' ');
      return joined.length ? joined : message.text();
    } catch (_e) {
      return message.text();
    }
  }
}
