import { delay, logger, uuidv4 } from '@cardstack/runtime-common';
import type { ConsoleMessage, Page } from 'puppeteer';
import type { BrowserContext } from 'puppeteer';
import { resolvePrerenderManagerURL } from './config';
import type { BrowserManager } from './browser-manager';

type PoolEntry = {
  type: 'pool';
  realm: string | null;
  context: BrowserContext;
  page: Page;
  pageId: string;
  lastUsedAt: number;
};
type StandbyEntry = {
  type: 'standby';
  context: BrowserContext;
  page: Page;
  pageId: string;
  lastUsedAt: number;
};
type Entry = PoolEntry | StandbyEntry;

const log = logger('prerenderer');
const chromeLog = logger('prerenderer-chrome');
const STANDBY_CREATION_RETRIES = 3;
const STANDBY_BACKOFF_MS = 500;
const STANDBY_BACKOFF_CAP_MS = 4000;

export class PagePool {
  #realmPages = new Map<string, Entry>();
  #standbys = new Set<StandbyEntry>();
  #lru = new Set<string>();
  #maxPages: number;
  #serverURL: string;
  #browserManager: BrowserManager;
  #boxelHostURL: string;
  #standbyTimeoutMs: number;
  #ensuringStandbys: Promise<void> | null = null;
  #creatingStandbys = 0;

  constructor(options: {
    maxPages: number;
    serverURL: string;
    browserManager: BrowserManager;
    boxelHostURL: string;
    standbyTimeoutMs?: number;
  }) {
    this.#maxPages = options.maxPages;
    this.#serverURL = options.serverURL;
    this.#browserManager = options.browserManager;
    this.#boxelHostURL = options.boxelHostURL;
    this.#standbyTimeoutMs = options.standbyTimeoutMs ?? 30_000;
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
    for (let [realm, entry] of [...this.#realmPages.entries()]) {
      if (entry.type !== 'pool') {
        continue;
      }
      if (now - entry.lastUsedAt < maxIdleMs) {
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
  }> {
    let t0 = Date.now();
    await this.#ensureStandbyPool();
    let reused = false;
    let entry = this.#realmPages.get(realm);
    if (!entry) {
      let standby = await this.#checkoutStandby();
      if (!standby) {
        await this.#ensureStandbyPool();
        standby = await this.#checkoutStandby();
      }
      if (!standby) {
        throw new Error('No standby page available for prerender');
      }
      entry = standby as unknown as PoolEntry;
      entry.type = 'pool';
      entry.realm = realm;
      standby.page.removeAllListeners('console');
      this.#attachPageConsole(standby.page, realm, standby.pageId);
      this.#realmPages.set(realm, entry);
      reused = false;
    } else {
      reused = true;
    }
    entry.lastUsedAt = Date.now();
    this.#touchLRU(realm);
    void this.#ensureStandbyPool();
    return {
      page: entry.page,
      pageId: entry.pageId,
      reused,
      launchMs: Date.now() - t0,
    };
  }

  async disposeRealm(realm: string): Promise<void> {
    let entry = this.#realmPages.get(realm);
    if (!entry || entry.type !== 'pool') return;
    this.#realmPages.delete(realm);
    this.#lru.delete(realm);
    await this.#closeEntry(entry);
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
    for (let entry of this.#realmPages.values()) {
      await this.#closeEntry(entry);
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
    let activeRealms = this.#realmPages.size;
    if (activeRealms >= this.#maxPages) {
      return 1;
    }
    return this.#maxPages - activeRealms;
  }

  #currentStandbyCount(): number {
    return this.#standbys.size + this.#creatingStandbys;
  }

  #totalContextCount(): number {
    return this.#realmPages.size + this.#standbys.size + this.#creatingStandbys;
  }

  async #prepareSlotForStandby(): Promise<boolean> {
    if (this.#totalContextCount() < this.#maxPages + 1) {
      return true;
    }
    if (this.#realmPages.size > this.#maxPages) {
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

  async #checkoutStandby(): Promise<StandbyEntry | undefined> {
    let standby = this.#standbys.values().next().value;
    if (standby) {
      this.#standbys.delete(standby);
      return standby;
    }
    if (this.#ensuringStandbys) {
      try {
        await this.#ensuringStandbys;
      } catch (_e) {
        // best effort
      }
      standby = this.#standbys.values().next().value;
      if (standby) {
        this.#standbys.delete(standby);
        return standby;
      }
    }
    return undefined;
  }

  #touchLRU(realm: string) {
    if (this.#lru.has(realm)) this.#lru.delete(realm);
    this.#lru.add(realm);
  }

  async #closeEntry(entry: Entry): Promise<void> {
    try {
      await entry.context.close();
    } catch (e) {
      log.warn(
        `Error closing context for ${entry.type === 'pool' ? entry.realm : 'standby'}:`,
        e,
      );
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
