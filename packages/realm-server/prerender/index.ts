import {
  type PrerenderMeta,
  type CardErrorJSONAPI,
  delay,
  uuidv4,
  logger,
  Deferred,
} from '@cardstack/runtime-common';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
} from 'puppeteer';
import { createJWT } from '../jwt';

const boxelHostURL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';
const renderTimeoutMs = 15_000;
const log = logger('prerenderer');

interface RenderError extends CardErrorJSONAPI {
  error: string;
}
interface RenderCapture {
  status: 'ready' | 'error';
  value: string;
}

export interface RenderResponse extends PrerenderMeta {
  isolatedHTML: string | null;
  atomHTML: string | null;
  embeddedHTML: Record<string, string> | null;
  fittedHTML: Record<string, string> | null;
  iconHTML: string | null;
  error?: CardErrorJSONAPI;
}
export type PermissionsMap = {
  [realm: string]: ('read' | 'write' | 'realm-owner')[];
};

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
  #lru = new Set<string>();
  #pendingByRealm = new Map<string, Promise<void>>();
  #maxPages: number;
  #secretSeed: string;
  #stopped = false;

  constructor(options: { secretSeed: string; maxPages?: number }) {
    this.#secretSeed = options.secretSeed;
    this.#maxPages = options.maxPages ?? 4;
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
  }

  async prerenderCard({
    realm,
    url,
    userId,
    permissions,
    opts,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: PermissionsMap;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
  }): Promise<{
    response: RenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: { pageId: string; realm: string; reused: boolean };
  }> {
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
      await prev.catch(() => {}); // ensure chain continues even after errors
      const { page, reused, launchMs } = await this.#getPage(realm);

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
      let error: CardErrorJSONAPI | undefined;

      // We need to render the isolated HTML view first, as the template will pull linked fields.
      let result = await withTimeout(
        page,
        async () => {
          if (reused) {
            await transitionTo(page, 'render.html', url, 'isolated', '0');
          } else {
            await page.goto(
              `${boxelHostURL}/render/${encodeURIComponent(url)}/html/isolated/0`,
            );
          }
          return await captureResult(page, 'innerHTML', opts);
        },
        opts?.timeoutMs,
      );
      if (result.status === 'error') {
        error = JSON.parse(result.value) as CardErrorJSONAPI;
      } else if (isRenderError(result)) {
        error = result;
      }
      const isolatedHTML = result.status === 'ready' ? result.value : null;

      // TODO consider breaking out rendering search doc into its own route so
      // that we can fully understand all the linked fields that are used in all
      // the html formats and generate a search doc that is well populated. Right
      // now we only consider linked fields used in the isolated template.
      let metaMaybeError = await withTimeout(
        page,
        () => renderMeta(page),
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
        error = error ? error : metaMaybeError;
        meta = {
          serialized: null,
          searchDoc: null,
          displayName: null,
          types: null,
        };
      } else {
        meta = metaMaybeError;
      }
      let atomHTML: string | null = null,
        iconHTML: string | null = null,
        embeddedHTML: Record<string, string> | null = null,
        fittedHTML: Record<string, string> | null = null;
      if (meta?.types) {
        let results = [
          await withTimeout(
            page,
            () => renderAncestors(page, 'fitted', meta.types!),
            opts?.timeoutMs,
          ),
          await withTimeout(
            page,
            () => renderAncestors(page, 'embedded', meta.types!),
            opts?.timeoutMs,
          ),
          await withTimeout(
            page,
            () => renderHTML(page, 'atom', 0),
            opts?.timeoutMs,
          ),
          await withTimeout(page, () => renderIcon(page), opts?.timeoutMs),
        ];
        let maybeError = results.find((r) => isRenderError(r)) as
          | RenderError
          | undefined;
        error = error ? error : maybeError;
        [fittedHTML, embeddedHTML, atomHTML, iconHTML] = results.map((r) =>
          isRenderError(r) ? null : r,
        ) as [
          // map is pretty dumb about the types so we have to remind TS
          Record<string, string> | null,
          Record<string, string> | null,
          string | null,
          string | null,
        ];
      }

      let response: RenderResponse = {
        ...meta,
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
        pool: { pageId: this.#pool.get(realm)!.pageId, realm, reused },
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
      entry = {
        realm,
        context,
        page,
        pageId: uuidv4(),
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

async function transitionTo(
  page: Page,
  routeName: string,
  ...params: string[]
): Promise<void> {
  await page.evaluate(
    (routeName, params) => {
      (globalThis as any).boxelTransitionTo(routeName, ...params);
    },
    routeName,
    params,
  );
}

async function renderAncestors(
  page: Page,
  format: string,
  types: string[],
): Promise<Record<string, string> | RenderError> {
  let html: Record<string, string> = {};
  for (let ancestorLevel = 0; ancestorLevel < types.length; ancestorLevel++) {
    let resultMaybeError = await renderHTML(page, format, ancestorLevel);
    if (typeof resultMaybeError !== 'string') {
      return { ...resultMaybeError, error: resultMaybeError.message };
    }
    html[types[ancestorLevel]] = resultMaybeError;
  }
  return html;
}

async function renderMeta(page: Page): Promise<PrerenderMeta | RenderError> {
  await transitionTo(page, 'render.meta');
  let result = await captureResult(page, 'textContent');
  if (result.status === 'error') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    return { ...error, error: error.message };
  }
  const meta: PrerenderMeta = JSON.parse(result.value);
  return meta;
}

async function renderHTML(
  page: Page,
  format: string,
  ancestorLevel: number,
): Promise<string | RenderError> {
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  let result = await captureResult(page, 'innerHTML');
  if (result.status === 'error') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    return { ...error, error: error.message };
  }
  return result.value;
}

async function renderIcon(page: Page): Promise<string | RenderError> {
  await transitionTo(page, 'render.icon');
  let result = await captureResult(page, 'outerHTML');
  if (result.status === 'error') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    return { ...error, error: error.message };
  }
  return result.value;
}

async function captureResult(
  page: Page,
  capture: 'textContent' | 'innerHTML' | 'outerHTML',
  opts?: { simulateTimeoutMs?: number },
): Promise<RenderCapture> {
  await page.waitForSelector(
    '[data-prerender-status="ready"], [data-prerender-status="error"]',
  );
  let result = await page.evaluate(
    (capture: 'textContent' | 'innerHTML' | 'outerHTML') => {
      let element = document.querySelector('[data-prerender]') as HTMLElement;
      let status = element.dataset.prerenderStatus as 'ready' | 'error';
      if (status === 'error') {
        // there is a strange <anonymous> tag that is being appended to the
        // innerHTML that this strips out
        return {
          status,
          value: element.innerHTML!.replace(/}[^}]*?<\/anonymous>$/, '}'),
        };
      } else {
        return { status, value: element.children[0][capture]! };
      }
    },
    capture,
  );
  if (opts?.simulateTimeoutMs) {
    await delay(opts?.simulateTimeoutMs);
  }
  return result;
}

async function withTimeout<T>(
  page: Page,
  fn: () => Promise<T>,
  timeoutMs = renderTimeoutMs,
): Promise<T | RenderError> {
  let result = await Promise.race([
    fn(),
    new Promise<{ timeout: true }>((r) =>
      setTimeout(() => {
        r({ timeout: true });
      }, timeoutMs),
    ),
  ]);
  if (result && typeof result == 'object' && 'timeout' in result) {
    let message = `Render timed-out after ${timeoutMs} ms`;
    let url = new URL(page.url());
    let [_a, _b, encodedId] = url.pathname.split('/');
    let id = encodedId ? decodeURIComponent(encodedId) : undefined;

    return {
      error: message,
      id,
      status: 504,
      title: 'Render timeout',
      message,
      realm: undefined,
      meta: {
        lastKnownGoodHtml: null,
        cardTitle: null,
        scopedCssUrls: [],
        stack: null,
      },
    };
  } else {
    return result;
  }
}

function isRenderError(value: any): value is RenderError {
  return typeof value === 'object' && 'error' in value;
}

export type { PrerenderMeta };
