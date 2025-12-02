import { logger, uuidv4 } from '@cardstack/runtime-common';
import type { ConsoleMessage, Page } from 'puppeteer';
import type { BrowserContext } from 'puppeteer';
import { resolvePrerenderManagerURL } from './config';
import type { BrowserManager } from './browser-manager';

type PoolEntry = {
  realm: string;
  context: BrowserContext;
  page: Page;
  pageId: string;
  lastUsedAt: number;
};

const log = logger('prerenderer');

export class PagePool {
  #pool = new Map<string, PoolEntry>();
  #lru = new Set<string>();
  #maxPages: number;
  #silent: boolean;
  #serverURL: string;
  #browserManager: BrowserManager;

  constructor(options: {
    maxPages: number;
    silent: boolean;
    serverURL: string;
    browserManager: BrowserManager;
  }) {
    this.#maxPages = options.maxPages;
    this.#silent = options.silent;
    this.#serverURL = options.serverURL;
    this.#browserManager = options.browserManager;
  }

  getWarmRealms(): string[] {
    return [...this.#pool.keys()];
  }

  async getPage(realm: string): Promise<{
    page: Page;
    reused: boolean;
    launchMs: number;
    pageId: string;
  }> {
    let t0 = Date.now();
    let reused = false;
    let entry = this.#pool.get(realm);
    if (!entry) {
      if (this.#pool.size >= this.#maxPages) {
        let lruRealm = this.#lru.keys().next().value as string | undefined;
        if (lruRealm && this.#pool.has(lruRealm)) {
          await this.disposeRealm(lruRealm);
        }
      }
      let browser = await this.#browserManager.getBrowser();
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const pageId = uuidv4();
      if (!this.#silent) {
        this.#attachPageConsole(page, realm, pageId);
      }
      entry = {
        realm,
        context,
        page,
        pageId,
        lastUsedAt: Date.now(),
      };
      this.#pool.set(realm, entry);
    } else {
      reused = true;
      entry.lastUsedAt = Date.now();
    }
    // move realm to most recently used
    if (this.#lru.has(realm)) this.#lru.delete(realm);
    this.#lru.add(realm);
    return {
      page: entry.page,
      pageId: entry.pageId,
      reused,
      launchMs: Date.now() - t0,
    };
  }

  async disposeRealm(realm: string): Promise<void> {
    let entry = this.#pool.get(realm);
    if (!entry) return;
    this.#pool.delete(realm);
    this.#lru.delete(realm);
    try {
      await entry.context.close();
    } catch (e) {
      log.warn(`Error closing context for realm ${realm}:`, e);
    }
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
  }

  async closeAll(): Promise<void> {
    for (let [realm, entry] of this.#pool) {
      try {
        await entry.context.close();
      } catch (e) {
        log.warn(`Error closing context for realm ${realm}:`, e);
      }
      this.#lru.delete(realm);
    }
    this.#pool.clear();
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
        return log.error.bind(log);
      case 'warn':
        return log.warn.bind(log);
      case 'info':
        return log.info.bind(log);
      case 'debug':
        return log.debug.bind(log);
      default:
        return log.info.bind(log);
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
