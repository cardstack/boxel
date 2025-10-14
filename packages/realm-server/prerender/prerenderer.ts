import {
  type PrerenderMeta,
  type RealmPermissions,
  type RenderResponse,
  type RenderError,
  type RenderRouteOptions,
  uuidv4,
  logger,
  Deferred,
  serializeRenderRouteOptions,
} from '@cardstack/runtime-common';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from 'puppeteer';
import { createJWT } from '../jwt';
import {
  captureResult,
  isRenderError,
  renderAncestors,
  renderHTML,
  renderIcon,
  renderMeta,
  RenderCapture,
  type CaptureOptions,
  withTimeout,
  transitionTo,
} from './utils';

const log = logger('prerenderer');
const boxelHostURL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';

export class Prerenderer {
  #browser: Browser | null = null;
  #pool = new Map<
    string,
    {
      realm: string;
      context: BrowserContext;
      page: Page;
      pageId: string;
      lastUsedAt: number;
    }
  >();
  #nonce = 0;
  #lru = new Set<string>();
  #pendingByRealm = new Map<string, Promise<void>>();
  #maxPages: number;
  #secretSeed: string;
  #stopped = false;
  #evictionMetrics = {
    byRealm: new Map<string, { unusable: number; timeout: number }>(),
  };
  #silent: boolean;

  constructor(options: {
    secretSeed: string;
    maxPages?: number;
    silent?: boolean;
  }) {
    this.#secretSeed = options.secretSeed;
    this.#maxPages = options.maxPages ?? 4;
    this.#silent = options.silent || process.env.PRERENDER_SILENT === 'true';
  }

  #incEvictionMetric(realm: string, reason: 'unusable' | 'timeout') {
    let current = this.#evictionMetrics.byRealm.get(realm) ?? {
      unusable: 0,
      timeout: 0,
    };
    current[reason]++;
    this.#evictionMetrics.byRealm.set(realm, current);
  }

  #evictionReason(renderError: RenderError): 'timeout' | 'unusable' | null {
    if (renderError.error.title === 'Render timeout') {
      return 'timeout';
    }
    if (renderError.evict) {
      return 'unusable';
    }
    return null;
  }

  async #evictRealm(
    realm: string,
    step: string,
    reason: 'timeout' | 'unusable',
  ) {
    let pageId = this.#pool.get(realm)?.pageId;
    this.#incEvictionMetric(realm, reason);
    log.warn(
      `Evicting realm %s (pageId=%s) due to %s during %s`,
      realm,
      pageId,
      reason,
      step,
    );
    try {
      await this.disposeRealm(realm);
    } catch (e) {
      log.warn(`Error disposing realm %s on %s:`, realm, reason, e);
    }
  }

  async #maybeEvict(
    realm: string,
    step: string,
    err?: RenderError,
  ): Promise<boolean> {
    if (!err) {
      return false;
    }
    let reason = this.#evictionReason(err);
    if (!reason) {
      return false;
    }
    await this.#evictRealm(realm, step, reason);
    return true;
  }

  #captureToError(capture: RenderCapture): RenderError | undefined {
    if (capture.status === 'error' || capture.status === 'unusable') {
      let parsed = JSON.parse(capture.value) as RenderError;
      return {
        ...(parsed as unknown as RenderError),
        evict: capture.status === 'unusable',
      };
    }
    return undefined;
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

  async #step<T>(
    realm: string,
    step: string,
    fn: () => Promise<T | RenderError>,
  ): Promise<
    { ok: true; value: T } | { ok: false; error: RenderError; evicted: boolean }
  > {
    let r = await fn();
    if (isRenderError(r)) {
      let evicted = await this.#maybeEvict(realm, step, r as RenderError);
      return { ok: false, error: r as RenderError, evicted };
    }
    return { ok: true, value: r as T };
  }

  async stop(): Promise<void> {
    // Close all pages and contexts, then browser
    for (let [realm, entry] of this.#pool) {
      try {
        await entry.context.close();
      } catch (e) {
        log.warn(`Error closing context for realm ${realm}:`, e);
      }
      this.#lru.delete(realm);
    }
    this.#pool.clear();
    if (this.#browser) {
      try {
        await this.#browser.close();
      } catch (e) {
        log.warn('Error closing browser:', e);
      } finally {
        this.#browser = null;
      }
    }
    this.#stopped = true;
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
      const managerURL =
        process.env.PRERENDER_MANAGER_URL ?? 'http://localhost:4222';
      await fetch(
        `${managerURL.replace(/\/$/, '')}/prerender-servers/realms/${encodeURIComponent(realm)}`,
        { method: 'DELETE' },
      ).catch((e) => {
        log.debug('Manager realm eviction notify failed:', e);
      });
    } catch (_e) {
      // do best attempt
    }
  }

  async prerenderCard({
    realm,
    url,
    userId,
    permissions,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: RenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: { pageId: string; realm: string; reused: boolean; evicted: boolean };
  }> {
    this.#nonce++;
    log.info(
      `prerendering url ${url}, nonce=${this.#nonce} realm=${realm} userId=${userId}`,
    );
    log.debug(
      `prerendering url ${url} with permissions=${JSON.stringify(permissions)}`,
    );
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    // chain requests for the same realm together so they happen in serial
    let prev = this.#pendingByRealm.get(realm) ?? Promise.resolve();
    let deferred = new Deferred<void>();
    this.#pendingByRealm.set(
      realm,
      prev.then(() => deferred.promise),
    );

    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      }); // ensure chain continues even after errors
      const { page, reused, launchMs } = await this.#getPage(realm);
      const poolInfo = {
        pageId: this.#pool.get(realm)?.pageId ?? 'unknown',
        realm,
        reused,
        evicted: false,
      };

      let sessions: { [realm: string]: string } = {};
      for (let [realmURL, realmPermissions] of Object.entries(
        permissions ?? {},
      )) {
        sessions[realmURL] = createJWT(
          {
            user: userId,
            realm: realmURL,
            permissions: realmPermissions,
            sessionRoom: '',
          },
          '1d',
          this.#secretSeed,
        );
      }
      let auth = JSON.stringify(sessions);

      if (!reused) {
        page.evaluateOnNewDocument((auth) => {
          localStorage.setItem('boxel-session', auth);
        }, auth);
      } else {
        // Only set immediately when reusing an already-loaded document; on a fresh
        // navigation, calling localStorage on about:blank can throw a SecurityError.
        await page.evaluate((auth) => {
          localStorage.setItem('boxel-session', auth);
        }, auth);
      }

      let renderStart = Date.now();
      let error: RenderError | undefined;
      let shortCircuit = false;
      let options = renderOptions ?? {};
      let serializedOptions = serializeRenderRouteOptions(options);
      let optionsSegment = encodeURIComponent(serializedOptions);
      const captureOptions: CaptureOptions = {
        expectedId: url.replace(/\.json$/i, ''),
        expectedNonce: String(this.#nonce),
        simulateTimeoutMs: opts?.simulateTimeoutMs,
      };

      // We need to render the isolated HTML view first, as the template will pull linked fields.
      let result = await withTimeout(
        page,
        async () => {
          if (reused) {
            await transitionTo(
              page,
              'render.html',
              url,
              String(this.#nonce),
              serializedOptions,
              'isolated',
              '0',
            );
          } else {
            await page.goto(
              `${boxelHostURL}/render/${encodeURIComponent(url)}/${this.#nonce}/${optionsSegment}/html/isolated/0`,
            );
          }
          return await captureResult(page, 'innerHTML', captureOptions);
        },
        opts?.timeoutMs,
      );
      let isolatedHTML: string | null = null;
      if (isRenderError(result)) {
        error = result;
        let evicted = await this.#maybeEvict(
          realm,
          'isolated render',
          result as RenderError,
        );
        if (evicted) {
          poolInfo.evicted = true;
          shortCircuit = true;
        }
      } else {
        let capture = result as RenderCapture;
        if (capture.status === 'ready') {
          isolatedHTML = capture.value;
        } else {
          let capErr = this.#captureToError(capture);
          if (!error && capErr) {
            error = capErr;
          }
          let evicted = await this.#maybeEvict(
            realm,
            'isolated render',
            capErr,
          );
          if (evicted) {
            poolInfo.evicted = true;
            shortCircuit = true;
          }
        }
      }

      if (shortCircuit) {
        let meta: PrerenderMeta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
        return {
          response: {
            ...meta,
            ...(error ? { error } : {}),
            iconHTML: null,
            isolatedHTML,
            atomHTML: null,
            embeddedHTML: null,
            fittedHTML: null,
          },
          timings: { launchMs, renderMs: Date.now() - renderStart },
          pool: poolInfo,
        };
      }

      // TODO consider breaking out rendering search doc into its own route so
      // that we can fully understand all the linked fields that are used in all
      // the html formats and generate a search doc that is well populated. Right
      // now we only consider linked fields used in the isolated template.
      let metaMaybeError = await withTimeout(
        page,
        () => renderMeta(page, captureOptions),
        opts?.timeoutMs,
      );
      // TODO also consider introducing a mechanism in the API to track and reset
      // field usage for an instance recursively so that the depth that an
      // instance is loaded from a different rendering context in the same realm
      // doesn't elide fields that this rendering context cares about. in that
      // manner we can get a complete picture of how to build the search doc's linked
      // fields for each rendering context.
      let meta: PrerenderMeta;
      if (isRenderError(metaMaybeError)) {
        if (
          await this.#maybeEvict(
            realm,
            'render.meta',
            metaMaybeError as RenderError,
          )
        ) {
          poolInfo.evicted = true;
          shortCircuit = true;
        }
        error = error ?? (metaMaybeError as RenderError);
        meta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
      } else {
        meta = metaMaybeError;
      }
      let atomHTML: string | null = null,
        iconHTML: string | null = null,
        embeddedHTML: Record<string, string> | null = null,
        fittedHTML: Record<string, string> | null = null;
      if (!shortCircuit && meta.types) {
        // Render sequentially and short-circuit on unusable page/timeout
        const steps: Array<{
          name: string;
          cb: () => Promise<string | Record<string, string> | RenderError>;
          assign: (value: string | Record<string, string>) => void;
        }> = [
          {
            name: 'fitted render',
            cb: () =>
              renderAncestors(page, 'fitted', meta.types!, captureOptions),
            assign: (v: string | Record<string, string>) => {
              fittedHTML = v as Record<string, string>;
            },
          },
          {
            name: 'embedded render',
            cb: () =>
              renderAncestors(page, 'embedded', meta.types!, captureOptions),
            assign: (v: string | Record<string, string>) => {
              embeddedHTML = v as Record<string, string>;
            },
          },
          {
            name: 'atom render',
            cb: () => renderHTML(page, 'atom', 0, captureOptions),
            assign: (v: string | Record<string, string>) => {
              atomHTML = v as string;
            },
          },
          {
            name: 'icon render',
            cb: () => renderIcon(page, captureOptions),
            assign: (v: string | Record<string, string>) => {
              iconHTML = v as string;
            },
          },
        ];

        for (let step of steps) {
          if (shortCircuit) break;
          let res = await this.#step(realm, step.name, () =>
            withTimeout(page, step.cb, opts?.timeoutMs),
          );
          if (res.ok) {
            step.assign(res.value);
          } else {
            error = error ?? res.error;
            if (res.evicted) {
              poolInfo.evicted = true;
              shortCircuit = true;
              break;
            }
          }
        }
      }

      let response: RenderResponse = {
        ...(meta as PrerenderMeta),
        ...(error ? { error } : {}),
        iconHTML,
        isolatedHTML,
        atomHTML,
        embeddedHTML,
        fittedHTML,
      };
      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart },
        pool: poolInfo,
      };
    } finally {
      deferred.fulfill();
    }
  }

  async #getBrowser(): Promise<Browser> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot start browser');
    }
    if (this.#browser) {
      return this.#browser;
    }
    this.#browser = await puppeteer.launch({
      headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
      args: process.env.CI ? ['--no-sandbox'] : [],
    });
    return this.#browser;
  }

  async #getPage(
    realm: string,
  ): Promise<{ page: Page; reused: boolean; launchMs: number }> {
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
      let browser = await this.#getBrowser();
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
    return { page: entry.page, reused, launchMs: Date.now() - t0 };
  }
}
