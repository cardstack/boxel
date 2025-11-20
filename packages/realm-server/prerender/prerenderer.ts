import {
  type PrerenderMeta,
  type RealmPermissions,
  type RenderResponse,
  type RenderError,
  type ModuleRenderResponse,
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
import type { RenderCapture } from './utils';
import {
  captureResult,
  captureModule,
  isRenderError,
  renderAncestors,
  renderHTML,
  renderIcon,
  renderMeta,
  type CaptureOptions,
  type ModuleCapture,
  withTimeout,
  transitionTo,
  buildInvalidModuleResponseError,
} from './utils';
import { resolvePrerenderManagerURL } from './config';

const log = logger('prerenderer');
const boxelHostURL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';
const CLEAR_CACHE_RETRY_SIGNATURES: readonly (readonly string[])[] = [
  // this is a side effect of glimmer scoped styles moving a DOM node that
  // glimmer is tracking. when we go to teardown the component glimmer gets mad
  // that a node it was tracking is no longer there. performing a new prerender
  // capture with a cleared store/loader cache will workaround this issue.
  [`Failed to execute 'removeChild' on 'Node'`, 'NotFoundError'],
];

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
  #serverURL: string;

  constructor(options: {
    secretSeed: string;
    serverURL: string;
    maxPages?: number;
    silent?: boolean;
  }) {
    this.#secretSeed = options.secretSeed;
    this.#maxPages = options.maxPages ?? 4;
    this.#silent = options.silent || process.env.PRERENDER_SILENT === 'true';
    this.#serverURL = options.serverURL;
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
      let parsed: RenderError | undefined;
      try {
        parsed = JSON.parse(capture.value);
      } catch (e) {
        parsed = {
          type: 'error',
          error: {
            status: 500,
            title: 'Render capture parse error',
            message: `Error result could not be during prerendering: "${capture.value}"`,
            additionalErrors: null,
          },
        };
      }
      if (parsed) {
        return {
          ...parsed,
          evict: capture.status === 'unusable',
        };
      }
    }
    return undefined;
  }

  async #collectTimeoutDiagnostics(
    page: Page,
    fallbackHtml?: string | null,
  ): Promise<{
    hasContainer: boolean;
    status: string | null;
    hasError: boolean;
    docsInFlight: number | null;
    childCount: number;
    html: string | null;
  }> {
    let [domInfo, docsInFlight] = await Promise.all([
      page.evaluate(() => {
        let container = document.querySelector(
          '[data-prerender]',
        ) as HTMLElement | null;
        let errorElement = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        let errorText = (
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          ''
        ).trim();
        return {
          hasContainer: Boolean(container),
          status: container?.dataset.prerenderStatus ?? null,
          childCount: container?.children.length ?? 0,
          hasError: Boolean(errorElement && errorText.length > 0),
          html: container?.outerHTML ?? errorElement?.outerHTML ?? null,
        };
      }),
      page
        .evaluate(() => {
          try {
            return (globalThis as any).__docsInFlight();
          } catch {
            return null;
          }
        })
        .catch(() => null),
    ]);
    return {
      hasContainer: domInfo.hasContainer,
      status: domInfo.status,
      hasError: domInfo.hasError,
      docsInFlight: typeof docsInFlight === 'number' ? docsInFlight : null,
      childCount: domInfo.childCount,
      html: domInfo.html ?? fallbackHtml ?? null,
    };
  }

  async #captureDomWithoutReady(
    page: Page,
    capture: 'textContent' | 'innerHTML' | 'outerHTML',
    captureOptions: CaptureOptions,
  ): Promise<RenderCapture | null> {
    return await page
      .evaluate(
        (
          captureKind: 'textContent' | 'innerHTML' | 'outerHTML',
          expectedId: string | undefined,
          expectedNonce: string | undefined,
        ) => {
          let container = document.querySelector(
            '[data-prerender]',
          ) as HTMLElement | null;
          if (!container) {
            return null;
          }
          let errorElement = container.querySelector(
            '[data-prerender-error]',
          ) as HTMLElement | null;
          let errorText = (
            errorElement?.textContent ??
            errorElement?.innerHTML ??
            ''
          ).trim();
          if (errorElement && errorText.length > 0) {
            return null;
          }
          let resolved: {
            textContent: string;
            innerHTML: string;
            outerHTML: string;
          };
          if (container.children.length > 0) {
            resolved = container.children[0] as HTMLElement & {
              textContent: string;
              innerHTML: string;
              outerHTML: string;
            };
          } else {
            resolved = {
              textContent: container.textContent ?? '',
              innerHTML: container.innerHTML ?? '',
              outerHTML: container.outerHTML ?? '',
            };
          }
          return {
            status: 'ready' as const,
            value: resolved[captureKind] ?? '',
            alive:
              container.dataset.emberAlive === 'true' ||
              container.dataset.emberAlive === 'false'
                ? (container.dataset.emberAlive as 'true' | 'false')
                : undefined,
            id: container.dataset.prerenderId ?? expectedId,
            nonce: container.dataset.prerenderNonce ?? expectedNonce,
            timedOut: true,
          } satisfies RenderCapture;
        },
        capture,
        captureOptions.expectedId,
        captureOptions.expectedNonce,
      )
      .catch(() => null);
  }

  async #captureSerializedDom(
    page: Page,
    html: string,
    capture: 'textContent' | 'innerHTML' | 'outerHTML',
    opts: CaptureOptions,
  ): Promise<RenderCapture | null> {
    if (!html) {
      return null;
    }
    return await page
      .evaluate(
        (
          html: string,
          captureKind: 'textContent' | 'innerHTML' | 'outerHTML',
          expectedId: string | undefined,
          expectedNonce: string | undefined,
        ) => {
          let template = document.createElement('template');
          template.innerHTML = html;
          let container = template.content.querySelector(
            '[data-prerender]',
          ) as HTMLElement | null;
          let errorElement = template.content.querySelector(
            '[data-prerender-error]',
          ) as HTMLElement | null;
          const errorText = (
            errorElement?.textContent ??
            errorElement?.innerHTML ??
            ''
          ).trim();
          if (!container && errorElement && errorText.length > 0) {
            let raw = errorElement.textContent ?? errorElement.innerHTML ?? '';
            let start = raw.indexOf('{');
            let end = raw.lastIndexOf('}');
            let json =
              start !== -1 && end !== -1 && end > start
                ? raw.slice(start, end + 1)
                : raw;
            return {
              status: 'error',
              value: json.trim(),
              id: errorElement.getAttribute('data-prerender-id') ?? undefined,
              nonce:
                errorElement.getAttribute('data-prerender-nonce') ?? undefined,
            } as RenderCapture;
          }
          if (!container) {
            return null;
          }
          if (errorElement && errorText.length > 0) {
            return null;
          }
          let firstChild = container.firstElementChild as HTMLElement | null;
          let value: string;
          if (firstChild) {
            if (captureKind === 'textContent') {
              value = firstChild.textContent ?? '';
            } else if (captureKind === 'innerHTML') {
              value = firstChild.innerHTML ?? '';
            } else {
              value = firstChild.outerHTML ?? '';
            }
          } else {
            if (captureKind === 'textContent') {
              value = container.textContent ?? '';
            } else if (captureKind === 'innerHTML') {
              value = container.innerHTML ?? '';
            } else {
              value = container.outerHTML ?? '';
            }
          }
          let idAttr =
            container.getAttribute('data-prerender-id') ?? expectedId;
          let nonceAttr =
            container.getAttribute('data-prerender-nonce') ?? expectedNonce;
          let aliveAttr = container.getAttribute('data-ember-alive');
          return {
            status: 'ready',
            value,
            alive:
              aliveAttr === 'true' || aliveAttr === 'false'
                ? (aliveAttr as 'true' | 'false')
                : undefined,
            id: idAttr ?? undefined,
            nonce: nonceAttr ?? undefined,
            timedOut: true,
          } as RenderCapture;
        },
        html,
        capture,
        opts.expectedId,
        opts.expectedNonce,
      )
      .catch(() => null);
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

  async #restartBrowser(): Promise<void> {
    log.warn('Restarting prerender browser');
    for (let [realm, entry] of this.#pool) {
      try {
        await entry.context.close();
      } catch (e) {
        log.warn(`Error closing context for realm ${realm} during restart:`, e);
      }
      this.#lru.delete(realm);
    }
    this.#pool.clear();
    if (this.#browser) {
      try {
        await this.#browser.close();
      } catch (e) {
        log.warn('Error closing browser during restart:', e);
      }
    }
    this.#browser = null;
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
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
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
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      }); // ensure chain continues even after errors

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

      let attemptOptions = renderOptions;
      let lastResult:
        | {
            response: RenderResponse;
            timings: { launchMs: number; renderMs: number };
            pool: {
              pageId: string;
              realm: string;
              reused: boolean;
              evicted: boolean;
              timedOut: boolean;
            };
          }
        | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        let result: {
          response: RenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: {
            pageId: string;
            realm: string;
            reused: boolean;
            evicted: boolean;
            timedOut: boolean;
          };
        };
        try {
          result = await this.#prerenderAttempt({
            realm,
            url,
            userId,
            permissions,
            auth,
            opts,
            renderOptions: attemptOptions,
          });
        } catch (e) {
          log.error(
            `prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
            e,
          );
          await this.#restartBrowser();
          try {
            result = await this.#prerenderAttempt({
              realm,
              url,
              userId,
              permissions,
              auth,
              opts,
              renderOptions: attemptOptions,
            });
          } catch (e2) {
            log.error(
              `prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
              e2,
            );
            // Optionally, set result to an error response or continue the loop
            // For now, rethrow to break the loop and propagate the error
            throw e2;
          }
        }
        lastResult = result;

        let retrySignature = this.#shouldRetryWithClearCache(result.response);
        let isClearCacheAttempt = attemptOptions?.clearCache === true;

        if (!isClearCacheAttempt && retrySignature) {
          log.warn(
            `retrying prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
              ' | ',
            )}`,
          );
          attemptOptions = {
            ...(attemptOptions ?? {}),
            clearCache: true,
          };
          continue;
        }

        if (isClearCacheAttempt && retrySignature && result.response.error) {
          log.warn(
            `prerender retry with clearCache did not resolve error signature ${retrySignature.join(
              ' | ',
            )} for ${url}`,
          );
        }

        return result;
      }
      if (lastResult) {
        if (lastResult.response.error) {
          log.error(
            `prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
          );
        }
        return lastResult;
      }
      throw new Error(`prerender attempts exhausted for ${url}`);
    } finally {
      deferred.fulfill();
    }
  }

  async prerenderModule({
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
    response: ModuleRenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let prev = this.#pendingByRealm.get(realm) ?? Promise.resolve();
    let deferred = new Deferred<void>();
    this.#pendingByRealm.set(
      realm,
      prev.then(() => deferred.promise),
    );

    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      });

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

      try {
        return await this.#prerenderModuleAttempt({
          realm,
          url,
          userId,
          permissions,
          auth,
          opts,
          renderOptions,
        });
      } catch (e) {
        log.error(
          `module prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
          e,
        );
        await this.#restartBrowser();
        return await this.#prerenderModuleAttempt({
          realm,
          url,
          userId,
          permissions,
          auth,
          opts,
          renderOptions,
        });
      }
    } finally {
      deferred.fulfill();
    }
  }

  async #prerenderAttempt({
    realm,
    url,
    userId,
    permissions,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: RenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  }> {
    this.#nonce++;
    log.info(
      `prerendering url ${url}, nonce=${this.#nonce} realm=${realm} userId=${userId}`,
    );
    log.debug(
      `prerendering url ${url} with permissions=${JSON.stringify(permissions)}`,
    );

    const { page, reused, launchMs } = await this.#getPage(realm);
    const poolInfo = {
      pageId: this.#pool.get(realm)?.pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    let pendingEviction: RenderError | undefined;
    const finalizePendingEviction = async () => {
      if (!pendingEviction) {
        return;
      }
      if (await this.#maybeEvict(realm, 'timeout recovery', pendingEviction)) {
        poolInfo.evicted = true;
      }
      pendingEviction = undefined;
    };

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
    let recoveredFromTimeout = false;
    let timeoutErrorForEviction: RenderError | undefined;
    let shouldEvictAfterTimeout = true;
    if (isRenderError(result) && result.error.title === 'Render timeout') {
      timeoutErrorForEviction = result;
      let capturedDom = (result as any)?.capturedDom as string | undefined;
      let diagnostics = await this.#collectTimeoutDiagnostics(
        page,
        capturedDom,
      );
      const docsSettled =
        diagnostics.docsInFlight !== null && diagnostics.docsInFlight === 0;
      if (!diagnostics.hasError && docsSettled) {
        let recovered: RenderCapture | null = null;
        if (diagnostics.hasContainer) {
          recovered = await this.#captureDomWithoutReady(
            page,
            'innerHTML',
            captureOptions,
          );
        }
        if (!recovered && diagnostics.html) {
          recovered = await this.#captureSerializedDom(
            page,
            diagnostics.html,
            'innerHTML',
            captureOptions,
          );
        }
        if (recovered) {
          recoveredFromTimeout = true;
          result = recovered;
          shouldEvictAfterTimeout = false;
          captureOptions.simulateTimeoutMs = undefined;
          log.warn(
            `Recovered prerender output for ${url} after timeout; proceeding with captured DOM`,
          );
        }
      }
    }
    let isolatedHTML: string | null = null;
    if (isRenderError(result)) {
      error = result;
      markTimeout(error);
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
        if (recoveredFromTimeout && timeoutErrorForEviction) {
          markTimeout(timeoutErrorForEviction);
          poolInfo.timedOut = true;
          capture.timedOut = true;
          if (shouldEvictAfterTimeout) {
            pendingEviction = pendingEviction ?? timeoutErrorForEviction;
          }
        }
      } else {
        let capErr = this.#captureToError(capture);
        if (!error && capErr) {
          error = capErr;
        }
        markTimeout(capErr);
        let evicted = await this.#maybeEvict(realm, 'isolated render', capErr);
        if (evicted) {
          poolInfo.evicted = true;
          shortCircuit = true;
        }
      }
    }

    if (shortCircuit) {
      await finalizePendingEviction();
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
          headHTML: null,
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
      markTimeout(metaMaybeError as RenderError);
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
      markTimeout(error);
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
    let headHTML: string | null = null,
      atomHTML: string | null = null,
      iconHTML: string | null = null,
      embeddedHTML: Record<string, string> | null = null,
      fittedHTML: Record<string, string> | null = null;

    if (!shortCircuit) {
      let headHTMLResult = await this.#step(realm, 'head render', () =>
        withTimeout(
          page,
          () => renderHTML(page, 'head', 0, captureOptions),
          opts?.timeoutMs,
        ),
      );
      if (headHTMLResult.ok) {
        headHTML = headHTMLResult.value as string;
      } else {
        error = error ?? headHTMLResult.error;
        markTimeout(headHTMLResult.error);
        if (headHTMLResult.evicted) {
          poolInfo.evicted = true;
          shortCircuit = true;
        }
      }
    }

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
          markTimeout(res.error);
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
      headHTML,
      atomHTML,
      embeddedHTML,
      fittedHTML,
    };
    await finalizePendingEviction();
    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart },
      pool: poolInfo,
    };
  }

  async #prerenderModuleAttempt({
    realm,
    url,
    userId,
    permissions,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: ModuleRenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  }> {
    this.#nonce++;
    log.info(
      `module prerendering url ${url}, nonce=${this.#nonce} realm=${realm} userId=${userId}`,
    );
    log.debug(
      `module prerendering url ${url} with permissions=${JSON.stringify(permissions)}`,
    );

    const { page, reused, launchMs } = await this.#getPage(realm);
    const poolInfo = {
      pageId: this.#pool.get(realm)?.pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };

    if (!reused) {
      page.evaluateOnNewDocument((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);
    } else {
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);
    }

    let renderStart = Date.now();
    let options = renderOptions ?? {};
    let serializedOptions = serializeRenderRouteOptions(options);
    let optionsSegment = encodeURIComponent(serializedOptions);
    const captureOptions: CaptureOptions = {
      expectedId: url,
      expectedNonce: String(this.#nonce),
      simulateTimeoutMs: opts?.simulateTimeoutMs,
    };

    let capture = await withTimeout(
      page,
      async () => {
        if (reused) {
          await transitionTo(
            page,
            'module',
            url,
            String(this.#nonce),
            serializedOptions,
          );
        } else {
          await page.goto(
            `${boxelHostURL}/module/${encodeURIComponent(url)}/${this.#nonce}/${optionsSegment}`,
          );
        }
        return await captureModule(page, captureOptions);
      },
      opts?.timeoutMs,
    );

    let response: ModuleRenderResponse;
    if (isRenderError(capture)) {
      let renderError = capture as RenderError;
      markTimeout(renderError);
      if (await this.#maybeEvict(realm, 'module render', renderError)) {
        poolInfo.evicted = true;
      }
      response = {
        id: url,
        status: 'error',
        nonce: String(this.#nonce),
        isShimmed: false,
        lastModified: 0,
        createdAt: 0,
        deps: renderError.error.deps ?? [],
        definitions: {},
        error: renderError,
      };
    } else {
      let moduleCapture = capture as ModuleCapture;
      try {
        response = JSON.parse(moduleCapture.value) as ModuleRenderResponse;
        if (response.status !== moduleCapture.status) {
          let renderError = buildInvalidModuleResponseError(
            page,
            `module prerender status mismatch (${moduleCapture.status} vs ${response.status})`,
            { title: 'Invalid module response', evict: true },
          );
          markTimeout(renderError);
          if (await this.#maybeEvict(realm, 'module render', renderError)) {
            poolInfo.evicted = true;
          }
          response = {
            id: url,
            status: 'error',
            nonce: moduleCapture.nonce ?? String(this.#nonce),
            isShimmed: false,
            lastModified: 0,
            createdAt: 0,
            deps: renderError.error.deps ?? [],
            definitions: {},
            error: {
              type: 'error',
              error: renderError.error,
            },
          };
        }
      } catch (_e) {
        let renderError = buildInvalidModuleResponseError(
          page,
          `module prerender returned invalid payload: ${moduleCapture.value}`,
          { title: 'Invalid module response' },
        );
        markTimeout(renderError);
        if (await this.#maybeEvict(realm, 'module render', renderError)) {
          poolInfo.evicted = true;
        }
        response = {
          id: url,
          status: 'error',
          nonce: moduleCapture.nonce ?? String(this.#nonce),
          isShimmed: false,
          lastModified: 0,
          createdAt: 0,
          deps: renderError.error.deps ?? [],
          definitions: {},
          error: renderError,
        };
      }
    }

    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart },
      pool: poolInfo,
    };
  }

  #shouldRetryWithClearCache(
    response: RenderResponse,
  ): readonly string[] | undefined {
    let renderError = response.error?.error;
    if (!renderError) {
      return undefined;
    }
    let parts = [renderError.message, renderError.stack].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );
    if (parts.length === 0) {
      return undefined;
    }
    let haystack = parts.join('\n');
    for (let signature of CLEAR_CACHE_RETRY_SIGNATURES) {
      if (signature.every((fragment) => haystack.includes(fragment))) {
        return signature;
      }
    }
    return undefined;
  }

  async #getBrowser(): Promise<Browser> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot start browser');
    }
    if (this.#browser) {
      return this.#browser;
    }
    let launchArgs: string[] = [];
    let disableSandbox =
      process.env.CI === 'true' ||
      process.env.PUPPETEER_DISABLE_SANDBOX === 'true';
    if (disableSandbox) {
      launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    let extraArgs =
      process.env.PUPPETEER_CHROME_ARGS?.split(/\s+/).filter(Boolean);
    if (extraArgs && extraArgs.length > 0) {
      launchArgs.push(...extraArgs);
    }
    this.#browser = await puppeteer.launch({
      headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
      ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
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
