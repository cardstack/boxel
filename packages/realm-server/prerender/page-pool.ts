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
  realm: string | null;
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

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');
const STANDBY_CREATION_RETRIES = 3;
const STANDBY_BACKOFF_MS = 500;
const STANDBY_BACKOFF_CAP_MS = 4000;

export class PagePool {
  #realmPages = new Map<string, Set<PoolEntry>>();
  #standbys = new Set<StandbyEntry>();
  #lru = new Set<string>();
  #maxPages: number;
  #realmTabMax: number;
  #serverURL: string;
  #browserManager: BrowserManager;
  #boxelHostURL: string;
  #standbyTimeoutMs: number;
  #renderSemaphore: RenderSemaphore | undefined;
  #ensuringStandbys: Promise<void> | null = null;
  #creatingStandbys = 0;

  constructor(options: {
    maxPages: number;
    serverURL: string;
    browserManager: BrowserManager;
    boxelHostURL: string;
    standbyTimeoutMs?: number;
    renderSemaphore?: RenderSemaphore;
  }) {
    this.#maxPages = options.maxPages;
    let envTabMax = Number(process.env.PRERENDER_REALM_TAB_MAX ?? 1);
    if (!Number.isFinite(envTabMax) || envTabMax <= 0) {
      envTabMax = 1;
    }
    this.#realmTabMax = Math.min(Math.max(1, envTabMax), this.#maxPages);
    this.#serverURL = options.serverURL;
    this.#browserManager = options.browserManager;
    this.#boxelHostURL = options.boxelHostURL;
    this.#standbyTimeoutMs = options.standbyTimeoutMs ?? 30_000;
    this.#renderSemaphore = options.renderSemaphore;
  }

  getWarmRealms(): string[] {
    return [...this.#realmPages.keys()];
  }

  async warmStandbys(): Promise<void> {
    await this.#ensureStandbyPool();
  }

  async evictIdleRealms(maxIdleMs: number): Promise<string[]> {
    if (!Number.isFinite(maxIdleMs) || maxIdleMs <= 0) {
      return [];
    }
    let now = Date.now();
    let evicted: string[] = [];
    for (let [realm, entries] of [...this.#realmPages.entries()]) {
      let lastUsedAt = Math.max(
        ...[...entries].map((entry) => entry.lastUsedAt),
      );
      if (now - lastUsedAt < maxIdleMs) {
        continue;
      }
      await this.disposeRealm(realm);
      evicted.push(realm);
    }
    return evicted;
  }

  async getPage(realm: string): Promise<{
    page: Page;
    reused: boolean;
    launchMs: number;
    pageId: string;
    release: () => void;
  }> {
    let t0 = Date.now();
    await this.#ensureStandbyPool();
    let { entry, reused, releaseTab } = await this.#selectEntryForRealm(realm);
    if (entry.realm !== realm) {
      entry = this.#reassignRealmTab(entry, realm);
      reused = false;
    }
    if (entry.transitioning) {
      entry.transitioning = false;
    }
    let releaseGlobal = this.#renderSemaphore
      ? await this.#renderSemaphore.acquire()
      : undefined;
    entry.lastUsedAt = Date.now();
    this.#touchLRU(realm);
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

  async disposeRealm(
    realm: string,
    options?: { awaitIdle?: boolean },
  ): Promise<void> {
    let entries = this.#realmPages.get(realm);
    if (!entries || entries.size === 0) return;
    this.#realmPages.delete(realm);
    this.#lru.delete(realm);
    let awaitIdle = options?.awaitIdle !== false;
    if (awaitIdle) {
      for (let entry of entries) {
        await this.#closeEntry(entry);
      }
    } else {
      for (let entry of entries) {
        void this.#closeEntry(entry);
      }
    }
    await this.#notifyManagerRealmEvicted(realm);
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
    for (let entries of this.#realmPages.values()) {
      for (let entry of entries) {
        await this.#closeEntry(entry);
      }
    }
    for (let entry of this.#standbys.values()) {
      await this.#closeEntry(entry);
    }
    this.#realmPages.clear();
    this.#standbys.clear();
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
      await this.#evictLRURealm();
      return this.#totalContextCount() < this.#maxPages + 1;
    }
    return false;
  }

  async #evictLRURealm(): Promise<void> {
    let lruRealm = this.#lru.values().next().value as string | undefined;
    if (!lruRealm) {
      return;
    }
    await this.disposeRealm(lruRealm);
  }

  async #createStandbyWithRetries(): Promise<StandbyEntry | undefined> {
    let attempt = 0;
    let backoffMs = STANDBY_BACKOFF_MS;
    while (attempt < STANDBY_CREATION_RETRIES) {
      attempt++;
      try {
        return await this.#createStandby();
      } catch (e) {
        log.error(
          `Standby creation attempt ${attempt} failed (page pool capacity ${this.#totalContextCount()}/${this.#maxPages + 1}):`,
          e,
        );
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
      log.error('Error creating standby page:', e);
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
    await page.goto(`${this.#boxelHostURL}/standby`, {
      waitUntil: 'domcontentloaded',
      timeout: this.#standbyTimeoutMs,
    });
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

  #touchLRU(realm: string) {
    if (this.#lru.has(realm)) this.#lru.delete(realm);
    this.#lru.add(realm);
  }

  #poolEntryCount(): number {
    let count = 0;
    for (let entries of this.#realmPages.values()) {
      count += entries.size;
    }
    return count;
  }

  async #selectEntryForRealm(
    realm: string,
  ): Promise<{ entry: PoolEntry; reused: boolean; releaseTab: () => void }> {
    let entries = this.#realmPages.get(realm);
    let entryList = entries
      ? [...entries].filter((entry) => !entry.closing && !entry.transitioning)
      : [];
    let idle = entryList.filter((entry) => entry.queue.pendingCount === 0);
    if (idle.length > 0) {
      let entry = this.#selectLRUTab(idle);
      let releaseTab = await entry.queue.acquire();
      return { entry, reused: true, releaseTab };
    }
    if (entryList.length < this.#realmTabMax) {
      let commandeered = this.#commandeerDormantTab(realm);
      if (commandeered) {
        let releaseTab = await commandeered.queue.acquire();
        return { entry: commandeered, reused: false, releaseTab };
      }
    }
    if (entryList.length > 0) {
      let entry = this.#selectLeastPendingTab(entryList);
      let releaseTab = await entry.queue.acquire();
      return { entry, reused: true, releaseTab };
    }
    let fallback = this.#commandeerDormantTab(realm);
    if (fallback) {
      let releaseTab = await fallback.queue.acquire();
      return { entry: fallback, reused: false, releaseTab };
    }
    if (entryList.length === 0) {
      let crossRealmEntries: PoolEntry[] = [];
      for (let [assignedRealm, entries] of this.#realmPages.entries()) {
        if (assignedRealm === realm) continue;
        for (let entry of entries) {
          if (entry.closing || entry.transitioning) continue;
          if (entry.queue.pendingCount > 1) continue;
          crossRealmEntries.push(entry);
        }
      }
      if (crossRealmEntries.length > 0) {
        let entry = this.#selectLeastPendingTab(crossRealmEntries);
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

  #commandeerDormantTab(realm: string): PoolEntry | undefined {
    if (this.#standbys.size > 0) {
      let standby = this.#selectLRUTab([...this.#standbys]);
      this.#standbys.delete(standby);
      return this.#assignStandbyToRealm(standby, realm);
    }

    let idleCandidates: PoolEntry[] = [];
    for (let [assignedRealm, entries] of this.#realmPages.entries()) {
      if (assignedRealm === realm) continue;
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
    return this.#reassignRealmTab(chosen, realm);
  }

  #assignStandbyToRealm(standby: StandbyEntry, realm: string): PoolEntry {
    let entry: PoolEntry = {
      type: 'pool',
      realm,
      context: standby.context,
      page: standby.page,
      pageId: standby.pageId,
      lastUsedAt: Date.now(),
      queue: standby.queue,
    };
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, realm, entry.pageId);
    this.#addRealmEntry(realm, entry);
    return entry;
  }

  #reassignRealmTab(entry: PoolEntry, realm: string): PoolEntry {
    this.#detachRealmEntry(entry);
    entry.realm = realm;
    entry.page.removeAllListeners('console');
    this.#attachPageConsole(entry.page, realm, entry.pageId);
    this.#addRealmEntry(realm, entry);
    entry.lastUsedAt = Date.now();
    return entry;
  }

  #addRealmEntry(realm: string, entry: PoolEntry): void {
    let entries = this.#realmPages.get(realm);
    if (!entries) {
      entries = new Set();
      this.#realmPages.set(realm, entries);
    }
    entries.add(entry);
    this.#touchLRU(realm);
  }

  #detachRealmEntry(entry: PoolEntry): void {
    let realm = entry.realm;
    if (!realm) return;
    let entries = this.#realmPages.get(realm);
    if (!entries) return;
    entries.delete(entry);
    if (entries.size === 0) {
      this.#realmPages.delete(realm);
      this.#lru.delete(realm);
      void this.#notifyManagerRealmEvicted(realm);
    }
  }

  async #notifyManagerRealmEvicted(realm: string): Promise<void> {
    try {
      const managerURL = resolvePrerenderManagerURL();
      let target = new URL(
        `${managerURL}/prerender-servers/realms/${encodeURIComponent(realm)}`,
      );
      target.searchParams.set('url', this.#serverURL);
      await fetch(target.toString(), { method: 'DELETE' }).catch((e) => {
        log.debug('Manager realm eviction notify failed:', e);
      });
    } catch (_e) {
      // do best attempt
    }
  }

  async #closeEntry(entry: Entry): Promise<void> {
    let release: (() => void) | undefined;
    try {
      entry.closing = true;
      release = await entry.queue.acquire();
      await entry.context.close();
    } catch (e) {
      log.warn(
        `Error closing context for ${entry.type === 'pool' ? entry.realm : 'standby'}:`,
        e,
      );
    } finally {
      release?.();
    }
  }

  #attachPageConsole(page: Page, realm: string, pageId: string): void {
    page.on('console', async (message: ConsoleMessage) => {
      try {
        let logFn = this.#logMethodForConsole(message.type());
        let formatted = await this.#formatConsoleMessage(message);
        let location = message.location();
        let locationInfo = '';
        if (location?.url) {
          let segments: number[] = [];
          if (typeof location.lineNumber === 'number') {
            segments.push(location.lineNumber + 1);
          }
          if (typeof location.columnNumber === 'number') {
            segments.push(location.columnNumber + 1);
          }
          let suffix = segments.length ? `:${segments.join(':')}` : '';
          locationInfo = ` (${location.url}${suffix})`;
        }
        logFn(
          'Console[%s] realm=%s pageId=%s%s %s',
          message.type(),
          realm,
          pageId,
          locationInfo,
          formatted,
        );
      } catch (e) {
        log.debug(
          'Failed to process console output for realm %s page %s:',
          realm,
          pageId,
          e,
        );
      }
    });
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
