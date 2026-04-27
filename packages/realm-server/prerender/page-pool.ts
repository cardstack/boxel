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

type RenderSemaphore = {
  acquire(signal?: AbortSignal): Promise<() => void>;
};

// Exported so cancellation-plumbing unit tests can drive it
// directly — it's a pure in-memory FIFO with no Chrome dependency.
export class TabQueue {
  #pending: Promise<void> = Promise.resolve();
  #depth = 0;

  async acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    let release!: () => void;
    let next = new Promise<void>((resolve) => {
      release = resolve;
    });
    let prev = this.#pending;
    this.#pending = prev.catch(() => {}).then(() => next);
    this.#depth++;
    // Race the prior-slot wait against the caller's abort signal.
    // If the signal fires first, release our slot immediately so
    // downstream waiters aren't blocked on a cancelled holder,
    // then throw so `getPage` can bail out.
    let onAbortPromise: Promise<never> | null = null;
    let onAbortCleanup: (() => void) | undefined;
    if (signal) {
      onAbortPromise = new Promise<never>((_, reject) => {
        let onAbort = () => {
          reject(
            new PrerenderCancelledError({
              state: 'queued',
              reason:
                typeof signal.reason === 'string' ? signal.reason : undefined,
            }),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        onAbortCleanup = () => signal.removeEventListener('abort', onAbort);
      });
    }
    try {
      if (onAbortPromise) {
        await Promise.race([prev.catch(() => {}), onAbortPromise]);
      } else {
        await prev.catch(() => {});
      }
    } catch (e) {
      this.#depth--;
      release();
      throw e;
    } finally {
      onAbortCleanup?.();
    }
    // A late abort between Promise.race resolving and us returning
    // — treat as the same cancellation.
    if (signal?.aborted) {
      this.#depth--;
      release();
      throwIfAborted(signal);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#depth--;
      release();
    };
  }

  get pendingCount(): number {
    return this.#depth;
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
type ConsoleErrorLocation = {
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};
export type ConsoleErrorEntry = {
  type: ReturnType<ConsoleMessage['type']>;
  text: string;
  location?: ConsoleErrorLocation;
};

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');
const STANDBY_CREATION_RETRIES = 3;
const STANDBY_BACKOFF_MS = 500;
const STANDBY_BACKOFF_CAP_MS = 4000;
const CONSOLE_ERROR_LIMIT = 50;

export class StandbyTargetNotReadyError extends Error {}

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
  #maxPages: number;
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
  // Effective per-affinity file-admission capacity. Defaults to the
  // deadlock-safety ceiling `max(1, #affinityTabMax − 1)` (same as
  // before the operator knob existed). When
  // `PRERENDER_AFFINITY_FILE_CONCURRENCY` is set and ≥ 1, the value is
  // clamped at the ceiling to preserve the deadlock-safety invariant.
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
  }) {
    this.#maxPages = options.maxPages;
    let envTabMax = Number(process.env.PRERENDER_AFFINITY_TAB_MAX ?? 5);
    if (!Number.isFinite(envTabMax) || envTabMax <= 0) {
      envTabMax = 1;
    }
    this.#affinityTabMax = Math.min(Math.max(1, envTabMax), this.#maxPages);
    if (this.#affinityTabMax < 2) {
      // Degenerate configuration: with only one tab per affinity, the
      // file-queue admission cap clamps to 1 (see `#acquireFileAdmission`)
      // and no tab slot can be held back for module / command work.
      // A card render that triggers a same-affinity `.gts` extraction
      // will still deadlock — there's no room to run the extraction
      // while the render occupies the sole tab. Bump
      // `PRERENDER_AFFINITY_TAB_MAX` to at least 2 for the deadlock-
      // free guarantee.
      log.warn(
        `PRERENDER_AFFINITY_TAB_MAX=${this.#affinityTabMax} below 2; file-queue admission can't reserve a slot for module/command work and the self-referential prerender deadlock is not prevented`,
      );
    }
    // Cap on total shared contexts (active + orphaned). Default to
    // 2× maxPages so there's headroom for a handful of recently-
    // evicted contexts to survive as orphans for reuse. Enforced by
    // `#maybeEvictOrphanContexts` on each release.
    let envSharedCap = Number(
      process.env.PRERENDER_SHARED_CONTEXT_CAP ?? this.#maxPages * 2,
    );
    if (!Number.isFinite(envSharedCap) || envSharedCap <= 0) {
      envSharedCap = this.#maxPages * 2;
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
    // Resolve the per-affinity file-admission cap. Ceiling is the
    // deadlock-safety `max(1, affinityTabMax − 1)`. Operator override
    // via `PRERENDER_AFFINITY_FILE_CONCURRENCY`; invalid or missing
    // values fall through to the ceiling — i.e. the pre-knob behavior.
    let ceiling = Math.max(1, this.#affinityTabMax - 1);
    let raw = process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
    let override: number | undefined;
    if (raw !== undefined && raw !== '') {
      let parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1) {
        override = parsed;
      } else {
        log.warn(
          `PRERENDER_AFFINITY_FILE_CONCURRENCY=${raw} invalid (must be an integer ≥ 1); falling back to deadlock-safety ceiling=${ceiling}`,
        );
      }
    }
    this.#fileAdmissionCap =
      override === undefined ? ceiling : Math.min(override, ceiling);
    if (
      !this.#disableFileAdmission &&
      override !== undefined &&
      this.#fileAdmissionCap < ceiling
    ) {
      // Operator has explicitly lowered the cap below the ceiling.
      // Log so the effective value is visible without grepping env.
      // No log line when the env is unset (common case) — nothing
      // changed.
      log.info(
        `file-queue admission: cap=${this.#fileAdmissionCap} (affinityTabMax=${this.#affinityTabMax}, deadlock-safety ceiling=${ceiling})`,
      );
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
  getVacancySnapshot(): Record<string, { idle: boolean; tabCount: number }> {
    let snapshot: Record<string, { idle: boolean; tabCount: number }> = {};
    for (let [affinityKey, entries] of this.#affinityPages) {
      let tabCount = entries.size;
      let idle = [...entries].every((entry) => entry.queue.pendingCount === 0);
      snapshot[affinityKey] = { idle, tabCount };
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
    }> = [];
    for (let [affinityKey, entries] of this.#affinityPages) {
      let tabCount = entries.size;
      let pendingTotal = 0;
      let maxPending = 0;
      let byQueue = { file: 0, module: 0, command: 0 };
      for (let entry of entries) {
        let p = entry.queue.pendingCount;
        pendingTotal += p;
        if (p > maxPending) maxPending = p;
        if (entry.currentQueue) byQueue[entry.currentQueue]++;
      }
      let sem = this.#fileAdmission.get(affinityKey);
      let admission = sem
        ? { pending: sem.pendingCount, cap: sem.capacity }
        : { pending: 0, cap: 0 };
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
      });
    }
    return { totalTabs, totalPending, affinities };
  }

  resetConsoleErrors(pageId: string): void {
    this.#consoleErrorsByPageId.set(pageId, new Map());
  }

  takeConsoleErrors(pageId: string): ConsoleErrorEntry[] {
    let bucket = this.#consoleErrorsByPageId.get(pageId);
    this.#consoleErrorsByPageId.delete(pageId);
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
    opts?: { signal?: AbortSignal },
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
      releaseAdmission = await this.#acquireFileAdmission(affinityKey, signal);
      admissionMs = Date.now() - admissionStart;
    }
    // Every release path (success + the error paths below) funnels
    // through `releaseAdmission?.()`, which already runs idle cleanup
    // via the wrapper installed in `#acquireFileAdmission`.
    let startupStart = Date.now();
    try {
      await this.#ensureStandbyPool();
    } catch (e) {
      releaseAdmission?.();
      throw e;
    }
    let tabStartupMs = Date.now() - startupStart;
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
    try {
      ({ entry, reused, releaseTab } = await this.#selectEntryForAffinity(
        affinityKey,
        signal,
      ));
    } catch (e) {
      releaseAdmission?.();
      throw e;
    }
    let tabQueueMs = Date.now() - tabQueueStart;
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
        ? await this.#renderSemaphore.acquire(signal)
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
    void this.#ensureStandbyPool();
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
    if (awaitIdle) {
      this.#affinityPages.delete(affinityKey);
      if (entries) {
        for (let entry of entries) {
          await this.#closeEntry(entry, retainConsoleErrors);
        }
      }
      if (!retainSharedContext) {
        await this.#closeSharedContext(affinityKey);
      }
      await this.#notifyManagerAffinityEvicted(affinityKey);
    } else {
      let closePromises: Promise<void>[] = [];
      if (entries) {
        for (let entry of entries) {
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
      if (!retainSharedContext) {
        // Close the orphan after all page-closes settle so a concurrent
        // `#spawnPoolEntryInSharedContext` on the same affinity is not
        // racing a mid-flight context.close() (Codex P1 review #1 on
        // PR #4465).
        void Promise.allSettled(closePromises).then(() =>
          this.#closeSharedContext(affinityKey),
        );
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
    void this.#ensureStandbyPool();
  }

  async closeAll(): Promise<void> {
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
      let pageId = uuidv4();
      this.#attachPageConsole(page, 'standby', pageId);
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
    let rawRelease = await semaphore.acquire(signal);
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

  async #selectEntryForAffinity(
    affinityKey: string,
    signal?: AbortSignal,
  ): Promise<{ entry: PoolEntry; reused: boolean; releaseTab: () => void }> {
    let entries = this.#affinityPages.get(affinityKey);
    let entryList = entries
      ? [...entries].filter((entry) => !entry.closing)
      : [];
    let idle = entryList.filter((entry) => entry.queue.pendingCount === 0);
    if (idle.length > 0) {
      let entry = this.#selectLRUTab(idle);
      let releaseTab = await entry.queue.acquire(signal);
      return { entry, reused: true, releaseTab };
    }
    if (entryList.length < this.#affinityTabMax) {
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
        };
      }
      let commandeered = this.#commandeerDormantTab(affinityKey);
      if (commandeered) {
        let releaseTab = await commandeered.queue.acquire(signal);
        return { entry: commandeered, reused: false, releaseTab };
      }
    }
    if (entryList.length > 0) {
      let entry = this.#selectLeastPendingTab(entryList);
      let releaseTab = await entry.queue.acquire(signal);
      return { entry, reused: true, releaseTab };
    }
    let fallbackShared = this.#tryClaimOrphanContext(affinityKey);
    if (fallbackShared) {
      return {
        ...(await this.#spawnPoolEntryInSharedContext(
          fallbackShared,
          affinityKey,
        )),
        reused: false,
      };
    }
    let fallback = this.#commandeerDormantTab(affinityKey);
    if (fallback) {
      let releaseTab = await fallback.queue.acquire(signal);
      return { entry: fallback, reused: false, releaseTab };
    }
    if (entryList.length === 0) {
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
          let releaseTab = await entry.queue.acquire(signal);
          return { entry, reused: false, releaseTab };
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
      let pageId = uuidv4();
      this.#attachPageConsole(page, affinityKey, pageId);
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
      let rollback = this.#releaseSharedContextForClosedPage(affinityKey);
      if (rollback) {
        await rollback.catch(() => {
          // close error is logged inside the helper
        });
      }
      throw err;
    }
  }

  #commandeerDormantTab(affinityKey: string): PoolEntry | undefined {
    if (this.#standbys.size > 0) {
      let standby = this.#selectLRUTab([...this.#standbys]);
      this.#standbys.delete(standby);
      return this.#assignStandbyToAffinity(standby, affinityKey);
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
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, affinityKey, entry.pageId);
    this.#addAffinityEntry(affinityKey, entry);
    // CS-10817 step 2: record this page's context as the affinity's
    // shared context if we don't have one yet. Subsequent steps start
    // reusing this context; for now it's purely bookkeeping — behavior
    // is unchanged from main.
    this.#recordSharedContextForFirstPage(standby.context, affinityKey);
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
    if (oldAffinityKey) {
      this.#transferSharedContextBookkeeping(oldAffinityKey);
    }
    entry.affinityKey = affinityKey;
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, affinityKey, entry.pageId);
    this.#addAffinityEntry(affinityKey, entry);
    this.#recordSharedContextForFirstPage(entry.context, affinityKey);
    entry.lastUsedAt = Date.now();
    return entry;
  }

  // Drop the old affinity's shared-context row without closing the
  // underlying BrowserContext — used by `#reassignAffinityTab` when a
  // page moves between affinities but keeps its context.
  #transferSharedContextBookkeeping(oldAffinityKey: string): void {
    let shared = this.#sharedContexts.get(oldAffinityKey);
    if (!shared) return;
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
              closePromise =
                this.#releaseSharedContextForClosedPage(affinityKey);
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
    }
  }

  // Returns a Promise when the release forces a context close —
  // happens only via the orphan LRU sweep when the cap is exceeded,
  // so callers can still await for deterministic teardown. The common
  // case (pageCount hits zero) keeps the context alive as an orphan
  // so step-5's standby-adoption path can reuse it on the next
  // same-affinity getPage and inherit the realm's HTTP cache +
  // localStorage.
  #releaseSharedContextForClosedPage(
    affinityKey: string,
  ): Promise<void> | undefined {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared) return;
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
          this.#recordConsoleError(pageId, {
            type,
            text: formatted,
            location: locationData,
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
    let location = entry.location;
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
