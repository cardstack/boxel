import { delay, logger, uuidv4 } from '@cardstack/runtime-common';
import type { ConsoleMessage, Page } from 'puppeteer';
import type { BrowserContext } from 'puppeteer';
import { resolvePrerenderManagerURL } from './config';
import type { BrowserManager } from './browser-manager';

type RenderSemaphore = {
  acquire(): Promise<() => void>;
};

class TabQueue {
  #pending: Promise<void> = Promise.resolve();
  #depth = 0;

  async acquire(): Promise<() => void> {
    let release!: () => void;
    let next = new Promise<void>((resolve) => {
      release = resolve;
    });
    let prev = this.#pending;
    this.#pending = prev.catch(() => {}).then(() => next);
    this.#depth++;
    await prev.catch(() => {});
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
  closing?: boolean;
  transitioning?: boolean;
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

// A BrowserContext shared by every page serving one affinity (CS-10817).
// Pages attach via pageCount++ and detach via pageCount-- on close. The
// context OUTLIVES individual pages — that's the point of sharing: when a
// tab evicts and gets replaced, the replacement page attaches to this same
// context and inherits Chrome's HTTP cache + localStorage (the auth token).
// Contexts are only closed on: `disposeAffinity` (affinity fully torn down),
// `closeAll` (Prerenderer shutdown), or LRU eviction of an orphaned context
// (pageCount === 0 and the cache is over the cap).
type SharedContext = {
  context: BrowserContext;
  affinityKey: string;
  pageCount: number;
  lastUsedAt: number;
  closing?: boolean;
};

export class PagePool {
  #affinityPages = new Map<string, Set<PoolEntry>>();
  #standbys = new Set<StandbyEntry>();
  #lru = new Set<string>();
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
  // Per-affinity shared BrowserContext (CS-10817). Pages serving the same
  // affinity share one BrowserContext so Chrome's HTTP cache + localStorage
  // survive individual page disposals. An entry stays alive with
  // `pageCount === 0` (orphan) across page churn; it's closed by
  // disposeAffinity, auth-rotation-driven disposal, shutdown, or when the
  // total shared-context count exceeds `#sharedContextCap` (LRU among
  // orphans only — active contexts are never forcibly evicted).
  #sharedContexts = new Map<string, SharedContext>();
  // Caps the TOTAL number of shared BrowserContexts retained. When the
  // count grows past this, oldest orphans (pageCount === 0) are closed
  // to release the excess. Active contexts (pageCount > 0) are not
  // eligible for eviction — they belong to live traffic.
  #sharedContextCap: number;

  constructor(options: {
    maxPages: number;
    serverURL: string;
    browserManager: BrowserManager;
    boxelHostURL: string;
    standbyTimeoutMs?: number;
    renderSemaphore?: RenderSemaphore;
    disableStandbyRefill?: boolean;
    onAffinityDisposed?: (affinityKey: string) => void;
    sharedContextCap?: number;
  }) {
    this.#maxPages = options.maxPages;
    let envTabMax = Number(process.env.PRERENDER_AFFINITY_TAB_MAX ?? 4);
    if (!Number.isFinite(envTabMax) || envTabMax <= 0) {
      envTabMax = 1;
    }
    this.#affinityTabMax = Math.min(Math.max(1, envTabMax), this.#maxPages);
    this.#serverURL = options.serverURL;
    this.#browserManager = options.browserManager;
    this.#boxelHostURL = options.boxelHostURL;
    this.#standbyTimeoutMs = options.standbyTimeoutMs ?? 30_000;
    this.#renderSemaphore = options.renderSemaphore;
    this.#disableStandbyRefill = options.disableStandbyRefill ?? false;
    this.#onAffinityDisposed = options.onAffinityDisposed;
    let envCap = Number(
      process.env.PRERENDER_SHARED_CONTEXT_CAP ??
        options.sharedContextCap ??
        16,
    );
    this.#sharedContextCap = Number.isFinite(envCap) ? Math.max(0, envCap) : 16;
  }

  set serverURL(url: string) {
    this.#serverURL = url;
  }

  getWarmAffinities(): string[] {
    return [...this.#affinityPages.keys()];
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

  // CS-10817: read-only accessors used by tests. Not a stable API.
  getSharedContextKeys(): string[] {
    return [...this.#sharedContexts.keys()];
  }

  getSharedContextPageCount(affinityKey: string): number | undefined {
    return this.#sharedContexts.get(affinityKey)?.pageCount;
  }

  // Returns the raw Puppeteer BrowserContext for an affinity so tests can
  // assert shared-identity invariants (`pageA.browserContext() === pageB.browserContext()`).
  getSharedContext(affinityKey: string): BrowserContext | undefined {
    return this.#sharedContexts.get(affinityKey)?.context;
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

  async getPage(affinityKey: string): Promise<{
    page: Page;
    reused: boolean;
    launchMs: number;
    pageId: string;
    release: () => void;
  }> {
    let t0 = Date.now();
    let entry: PoolEntry;
    let reused: boolean;
    let releaseTab: () => void;
    // Retry if the entry we end up holding was torn down while we were
    // queued on its TabQueue. This happens when a cross-realm request
    // reassigned the entry we were waiting behind: the old entry's page
    // has been closed and it's been detached from its affinity, so handing
    // it to the caller would yield a dead page.
    for (;;) {
      await this.#ensureStandbyPool();
      ({ entry, reused, releaseTab } =
        await this.#selectEntryForAffinity(affinityKey));
      if (entry.closing) {
        releaseTab();
        continue;
      }
      if (entry.affinityKey !== affinityKey) {
        let oldReleaseTab = releaseTab;
        ({ entry, releaseTab } = await this.#reassignAffinityTab(
          entry,
          affinityKey,
          oldReleaseTab,
        ));
        reused = false;
      }
      break;
    }
    if (entry.transitioning) {
      entry.transitioning = false;
    }
    let releaseGlobal = this.#renderSemaphore
      ? await this.#renderSemaphore.acquire()
      : undefined;
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
      entry.lastUsedAt = Date.now();
    };
    return {
      page: entry.page,
      pageId: entry.pageId,
      reused,
      launchMs: Date.now() - t0,
      release,
    };
  }

  async disposeAffinity(
    affinityKey: string,
    options?: { awaitIdle?: boolean; retainConsoleErrors?: boolean },
  ): Promise<void> {
    let entries = this.#affinityPages.get(affinityKey);
    let hasEntries = !!entries && entries.size > 0;
    let hasSharedContext = this.#sharedContexts.has(affinityKey);
    if (!hasEntries && !hasSharedContext) return;
    this.#lru.delete(affinityKey);
    let awaitIdle = options?.awaitIdle !== false;
    let retainConsoleErrors = options?.retainConsoleErrors ?? false;
    if (awaitIdle) {
      this.#affinityPages.delete(affinityKey);
      if (entries) {
        for (let entry of entries) {
          await this.#closeEntry(entry, retainConsoleErrors);
        }
      }
      // CS-10817: close the shared BrowserContext once all pages are
      // released. This unblocks a fresh context on the next visit —
      // important for the auth-rotation path where render-runner
      // calls disposeAffinity on an auth change.
      await this.#closeSharedContext(affinityKey);
      await this.#notifyManagerAffinityEvicted(affinityKey);
    } else {
      // CS-10817: detach the shared context from `#sharedContexts`
      // immediately so any concurrent getPage() call can't attach a
      // replacement page to the context we're about to close. The
      // detached reference is closed in the background once all the old
      // entries' page.close() calls settle. A parallel acquire for this
      // affinity during this window will create a FRESH context, which
      // is the correct outcome — the affinity is being torn down.
      let detached = this.#sharedContexts.get(affinityKey);
      if (detached) {
        detached.closing = true;
        this.#sharedContexts.delete(affinityKey);
      }
      let closePromises: Promise<void>[] = [];
      if (entries) {
        for (let entry of entries) {
          let closePromise = this.#closeEntry(entry, retainConsoleErrors)
            .catch((e) => {
              log.warn(`Error closing entry for ${affinityKey}:`, e);
            })
            .finally(() => {
              let currentEntries = this.#affinityPages.get(affinityKey);
              if (!currentEntries) return;
              currentEntries.delete(entry);
              if (currentEntries.size === 0) {
                this.#affinityPages.delete(affinityKey);
              }
            });
          closePromises.push(closePromise);
        }
      }
      // Close the detached context after all pages have been released.
      // Because it's already removed from the cache, this closes only
      // the pre-disposal context — newly-attached pages (in a fresh
      // context) are unaffected.
      if (detached) {
        void Promise.allSettled(closePromises).then(async () => {
          try {
            await detached.context.close();
          } catch (e) {
            log.warn(
              `Error closing detached shared context for ${affinityKey}:`,
              e,
            );
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
    // CS-10817: close all shared BrowserContexts (including orphans
    // whose pages have all been released but whose context is still
    // alive waiting for a new attach).
    let sharedKeys = [...this.#sharedContexts.keys()];
    for (let key of sharedKeys) {
      await this.#closeSharedContext(key);
    }
    this.#affinityPages.clear();
    this.#standbys.clear();
    this.#sharedContexts.clear();
    this.#lru.clear();
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
      // Standby pages keep their own ad-hoc context (no sharing — the
      // standby is realm-agnostic until assigned). On assignment the
      // context may be adopted as the affinity's shared context (see
      // `#adoptStandbyContextForAffinity`) or closed and replaced with a
      // page inside the existing shared context (see
      // `#assignStandbyToAffinity`).
      context = await browser.createBrowserContext();
      let page = await context.newPage();
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

  #poolEntryCount(): number {
    let count = 0;
    for (let entries of this.#affinityPages.values()) {
      count += entries.size;
    }
    return count;
  }

  async #selectEntryForAffinity(
    affinityKey: string,
  ): Promise<{ entry: PoolEntry; reused: boolean; releaseTab: () => void }> {
    let entries = this.#affinityPages.get(affinityKey);
    let entryList = entries
      ? [...entries].filter((entry) => !entry.closing)
      : [];
    let idle = entryList.filter((entry) => entry.queue.pendingCount === 0);
    if (idle.length > 0) {
      let entry = this.#selectLRUTab(idle);
      let releaseTab = await entry.queue.acquire();
      return { entry, reused: true, releaseTab };
    }
    if (entryList.length < this.#affinityTabMax) {
      let commandeered = await this.#commandeerDormantTab(affinityKey);
      if (commandeered) {
        return {
          entry: commandeered.entry,
          reused: false,
          releaseTab: commandeered.releaseTab,
        };
      }
    }
    if (entryList.length > 0) {
      let entry = this.#selectLeastPendingTab(entryList);
      let releaseTab = await entry.queue.acquire();
      return { entry, reused: true, releaseTab };
    }
    let fallback = await this.#commandeerDormantTab(affinityKey);
    if (fallback) {
      return {
        entry: fallback.entry,
        reused: false,
        releaseTab: fallback.releaseTab,
      };
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
          let releaseTab = await entry.queue.acquire();
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

  // Returns a freshly-allocated PoolEntry for `affinityKey` plus an
  // acquired queue slot. Two sources: (1) a standby page that's adopted
  // or replaced into the affinity's shared context, or (2) an idle page
  // from another affinity which is closed and re-spawned in this
  // affinity's context (see `#reassignAffinityTab` for rationale).
  //
  // The queue slot is acquired before returning so callers don't need a
  // second async acquire step. Callers MUST invoke the returned
  // `releaseTab` to release the slot.
  async #commandeerDormantTab(
    affinityKey: string,
  ): Promise<{ entry: PoolEntry; releaseTab: () => void } | undefined> {
    if (this.#standbys.size > 0) {
      let standby = this.#selectLRUTab([...this.#standbys]);
      this.#standbys.delete(standby);
      return await this.#assignStandbyToAffinity(standby, affinityKey);
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
    // Acquire the chosen entry's queue so it won't be picked up by any
    // other concurrent caller during reassignment; pass the handle in so
    // reassignAffinityTab can release it before closing the page.
    let chosenReleaseTab = await chosen.queue.acquire();
    return await this.#reassignAffinityTab(
      chosen,
      affinityKey,
      chosenReleaseTab,
    );
  }

  // CS-10817: assign a standby page to an affinity. If the affinity has no
  // shared context yet, adopt the standby's context as the shared context
  // (the standby only loaded /_standby, so its HTTP cache and localStorage
  // are realm-agnostic — safe to promote). If a shared context already
  // exists, close the standby's page+context and spawn a fresh page in
  // the existing shared context so the new page inherits the cache +
  // localStorage accumulated by earlier pages.
  //
  // Returns the entry with its queue slot already acquired — callers must
  // release via the returned `releaseTab`. The queue slot is taken before
  // the entry is added to `#affinityPages` so that concurrent `getPage`
  // callers observe the new entry as busy (pendingCount >= 1) rather than
  // as idle, which would let both callers land on the same tab.
  async #assignStandbyToAffinity(
    standby: StandbyEntry,
    affinityKey: string,
  ): Promise<{ entry: PoolEntry; releaseTab: () => void }> {
    let existing = this.#sharedContexts.get(affinityKey);
    if (!existing || existing.closing) {
      this.#adoptStandbyContextForAffinity(standby, affinityKey);
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
      // acquire() increments pendingCount synchronously before yielding,
      // so the entry is never observable with depth 0.
      let releaseTabPromise = entry.queue.acquire();
      this.#addAffinityEntry(affinityKey, entry);
      let releaseTab = await releaseTabPromise;
      return { entry, releaseTab };
    }
    // The affinity already has a warm shared context. Close the standby's
    // ad-hoc context in the background (we don't need to block on it) and
    // attach a new page to the shared context. Blocking here would stall
    // the caller on an unrelated browser close — and since the standby's
    // context isn't shared with anything else, any eventual close error
    // only affects bookkeeping.
    void standby.context.close().catch((e) => {
      log.warn(
        `Error closing displaced standby context for ${affinityKey}:`,
        e,
      );
    });
    this.#consoleErrorsByPageId.delete(standby.pageId);
    return await this.#spawnPoolEntryInSharedContext(affinityKey);
  }

  // CS-10817: fresh pool entry attached to an affinity's shared context.
  // The new page has no realm-specific state yet (auth is set by
  // render-runner on first use), but it DOES need the host app booted
  // via /_standby so render-runner can invoke `globalThis.boxelTransitionTo`
  // later. Without this bootstrap, first use of the replacement page
  // fails at `transitionTo()` / `page.evaluate()`.
  //
  // Returns the entry with its queue slot already acquired (see
  // `#assignStandbyToAffinity` for the race this closes).
  async #spawnPoolEntryInSharedContext(
    affinityKey: string,
  ): Promise<{ entry: PoolEntry; releaseTab: () => void }> {
    let { context } = await this.#acquireSharedContext(affinityKey);
    let page: Page | undefined;
    try {
      page = await context.newPage();
      let pageId = uuidv4();
      this.#attachPageConsole(page, affinityKey, pageId);
      await this.#loadStandbyPage(page, pageId);
      let entry: PoolEntry = {
        type: 'pool',
        affinityKey,
        context,
        page,
        pageId,
        lastUsedAt: Date.now(),
        queue: new TabQueue(),
      };
      let releaseTabPromise = entry.queue.acquire();
      this.#addAffinityEntry(affinityKey, entry);
      let releaseTab = await releaseTabPromise;
      return { entry, releaseTab };
    } catch (e) {
      // Roll back the pageCount bump from #acquireSharedContext and
      // close the half-initialized page so we don't leak a Chrome tab.
      if (page) {
        try {
          await page.close();
        } catch (closeErr) {
          log.debug(
            `Error closing page after failed shared-context attach for ${affinityKey}:`,
            closeErr,
          );
        }
      }
      this.#releaseSharedContext(affinityKey);
      throw e;
    }
  }

  // CS-10817: reassign an idle page from one affinity to another. Under
  // shared-context sharing, we cannot reuse the old entry's page — the
  // old affinity's context holds that realm's auth in localStorage, so
  // mixing in traffic for a different realm would leak state. Instead,
  // close the old page (releasing its shared context, which survives as
  // an orphan or is LRU-evicted later) and spawn a fresh page in the
  // destination affinity's shared context.
  //
  // Takes the caller's queue-acquire handle and returns a fresh one for
  // the new entry — the old entry's queue handle is released inside.
  //
  // Spawn-before-release: we spawn the replacement entry FIRST, then
  // release the old TabQueue slot (which wakes any queued waiter). If
  // we released first, a queued same-realm waiter could re-enter
  // `#selectEntryForAffinity` while the replacement entry wasn't yet in
  // `#affinityPages` and the old entry was already marked closing — no
  // candidates anywhere, throw "No standby page available" (the retry
  // loop in `getPage` would also observe the empty state on its next
  // pass). Spawning first guarantees the new entry is visible before any
  // waiter wakes.
  async #reassignAffinityTab(
    oldEntry: PoolEntry,
    affinityKey: string,
    oldReleaseTab: () => void,
  ): Promise<{ entry: PoolEntry; releaseTab: () => void }> {
    let oldAffinityKey = oldEntry.affinityKey;
    oldEntry.closing = true;
    // Spawn the replacement in the destination affinity's shared context,
    // including the /_standby bootstrap so RenderRunner's transitionTo /
    // page.evaluate calls work on first use. The spawn helper returns the
    // entry with its queue slot already acquired synchronously; no extra
    // acquire here would race against concurrent getPage callers.
    let result = await this.#spawnPoolEntryInSharedContext(affinityKey);
    try {
      oldReleaseTab();
    } catch (_e) {
      // best-effort release
    }
    this.#detachAffinityEntry(oldEntry);
    try {
      await oldEntry.page.close();
    } catch (e) {
      log.warn(
        `Error closing page during reassign from ${oldAffinityKey} to ${affinityKey}:`,
        e,
      );
    }
    if (oldAffinityKey) {
      this.#releaseSharedContext(oldAffinityKey);
    }
    this.#consoleErrorsByPageId.delete(oldEntry.pageId);
    return result;
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

  // CS-10817: acquire (or create) the shared BrowserContext for an
  // affinity, bumping the attached-page counter. Callers pair this with
  // `#releaseSharedContext` when the page is closed.
  async #acquireSharedContext(
    affinityKey: string,
  ): Promise<{ context: BrowserContext; shared: SharedContext }> {
    let existing = this.#sharedContexts.get(affinityKey);
    if (existing && !existing.closing) {
      existing.pageCount++;
      existing.lastUsedAt = Date.now();
      return { context: existing.context, shared: existing };
    }
    let browser = await this.#browserManager.getBrowser();
    let context = await browser.createBrowserContext();
    let shared: SharedContext = {
      context,
      affinityKey,
      pageCount: 1,
      lastUsedAt: Date.now(),
    };
    this.#sharedContexts.set(affinityKey, shared);
    // Creating a new shared context is also a trigger for LRU eviction:
    // we just grew the total count, and orphans may need to be shed to
    // stay within the cap. Fire-and-forget — the eviction itself is a
    // best-effort cleanup path.
    void this.#maybeEvictOrphanContexts();
    return { context, shared };
  }

  // Adopt a standby's BrowserContext as an affinity's shared context when
  // no shared context for that affinity exists yet. The standby's page
  // was never realm-specific (it only loaded `/_standby`), so its HTTP
  // cache is safe to inherit — and the context already contains a warm
  // page, avoiding an extra `context.newPage()` call on the first visit.
  #adoptStandbyContextForAffinity(
    standby: StandbyEntry,
    affinityKey: string,
  ): SharedContext {
    if (this.#sharedContexts.has(affinityKey)) {
      throw new Error(
        `Cannot adopt standby context for ${affinityKey}; a shared context already exists`,
      );
    }
    let shared: SharedContext = {
      context: standby.context,
      affinityKey,
      pageCount: 1,
      lastUsedAt: Date.now(),
    };
    this.#sharedContexts.set(affinityKey, shared);
    return shared;
  }

  #releaseSharedContext(affinityKey: string): void {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared) return;
    shared.pageCount = Math.max(0, shared.pageCount - 1);
    shared.lastUsedAt = Date.now();
    // DO NOT close here — context lives on for the next page attach.
    // Orphans (pageCount === 0) may later be evicted by the cap below.
    void this.#maybeEvictOrphanContexts();
  }

  async #closeSharedContext(affinityKey: string): Promise<void> {
    let shared = this.#sharedContexts.get(affinityKey);
    if (!shared) return;
    if (shared.closing) return;
    shared.closing = true;
    this.#sharedContexts.delete(affinityKey);
    try {
      await shared.context.close();
    } catch (e) {
      log.warn(`Error closing shared context for ${affinityKey}:`, e);
    }
  }

  // When the total shared-context count exceeds `#sharedContextCap`, evict
  // the oldest-lastUsedAt orphans (pageCount === 0) until we're back under
  // the cap — or until we run out of orphans, whichever comes first. Active
  // contexts (pageCount > 0) are never evicted; they belong to live traffic.
  // Keeps Chrome's per-context memory bounded in long-running prerender
  // servers where realms come and go.
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
      log.debug(
        `Evicting orphan shared context for ${shared.affinityKey} (lastUsedAt=${new Date(shared.lastUsedAt).toISOString()})`,
      );
      await this.#closeSharedContext(shared.affinityKey);
    }
  }

  async #closeEntry(entry: Entry, retainConsoleErrors = false): Promise<void> {
    let release: (() => void) | undefined;
    entry.closing = true;
    try {
      release = await entry.queue.acquire();
      if (entry.type === 'standby') {
        // Standbys own their BrowserContext entirely — no one else
        // references it. Close the full context.
        try {
          await entry.context.close();
        } catch (e) {
          log.warn(`Error closing standby context:`, e);
        }
      } else {
        // CS-10817: the context is shared across pages for this
        // affinity. Close only the page; release the context, which may
        // survive as an orphan for the next attach or be LRU-evicted.
        // Release the shared context in a `finally` so a page.close()
        // throw doesn't leak pageCount on the shared context.
        try {
          await entry.page.close();
        } catch (e) {
          log.warn(`Error closing pool page for ${entry.affinityKey}:`, e);
        } finally {
          if (entry.affinityKey) {
            this.#releaseSharedContext(entry.affinityKey);
          }
        }
      }
    } finally {
      release?.();
    }
    if (!retainConsoleErrors) {
      this.#consoleErrorsByPageId.delete(entry.pageId);
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
