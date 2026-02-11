import {
  type PrerenderMeta,
  type RenderError,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type FileRenderResponse,
  type FileRenderArgs,
  type RenderRouteOptions,
  serializeRenderRouteOptions,
  logger,
} from '@cardstack/runtime-common';
import type { SerializedError } from '@cardstack/runtime-common/error';
import type { ConsoleErrorEntry, PagePool } from './page-pool';
import {
  captureResult,
  captureModule,
  captureFileExtract,
  isRenderError,
  renderAncestors,
  renderHTML,
  renderIcon,
  renderMeta,
  type RenderCapture,
  type CaptureOptions,
  type ModuleCapture,
  type FileExtractCapture,
  withTimeout,
  transitionTo,
  buildInvalidModuleResponseError,
  buildInvalidFileExtractResponseError,
} from './utils';

const log = logger('prerenderer');

const CLEAR_CACHE_RETRY_SIGNATURES: readonly (readonly string[])[] = [
  // this is a side effect of glimmer scoped styles moving a DOM node that
  // glimmer is tracking. when we go to teardown the component glimmer gets mad
  // that a node it was tracking is no longer there. performing a new prerender
  // capture with a cleared store/loader cache will workaround this issue.
  [`Failed to execute 'removeChild' on 'Node'`, 'NotFoundError'],
];

export class RenderRunner {
  #pagePool: PagePool;
  #boxelHostURL: string;
  #nonce = 0;
  #evictionMetrics = {
    byRealm: new Map<string, { unusable: number; timeout: number }>(),
  };
  #lastAuthByRealm = new Map<string, string>();

  constructor(options: { pagePool: PagePool; boxelHostURL: string }) {
    this.#pagePool = options.pagePool;
    this.#boxelHostURL = options.boxelHostURL;
  }

  async #getPageForRealm(realm: string, auth: string) {
    let lastAuth = this.#lastAuthByRealm.get(realm);
    if (lastAuth) {
      let lastKeys = this.#authKeys(lastAuth);
      let nextKeys = this.#authKeys(auth);
      let authChanged =
        lastKeys && nextKeys
          ? lastKeys.length !== nextKeys.length ||
            lastKeys.some((k) => !nextKeys.includes(k))
          : lastAuth !== auth;
      if (authChanged) {
        await this.#pagePool.disposeRealm(realm);
        this.#lastAuthByRealm.delete(realm);
      }
    }
    let pageInfo = await this.#pagePool.getPage(realm);
    this.#lastAuthByRealm.set(realm, auth);
    return pageInfo;
  }

  clearAuthCache(realm: string) {
    this.#lastAuthByRealm.delete(realm);
  }

  #authKeys(auth: string): string[] | null {
    try {
      let parsed = JSON.parse(auth) as Record<string, string>;
      return Object.keys(parsed).sort();
    } catch (_e) {
      return null;
    }
  }

  async prerenderCardAttempt({
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
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
    log.info(`prerendering url ${url}, nonce=${this.#nonce} realm=${realm}`);

    const { page, reused, launchMs, pageId, release } =
      await this.#getPageForRealm(realm, auth);
    const poolInfo = {
      pageId: pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    try {
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);

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

      log.debug(
        `manually visit prerendered url ${url} at: ${this.#boxelHostURL}/render/${encodeURIComponent(url)}/${this.#nonce}/${optionsSegment}/html/isolated/0 with localStorage boxel-session=${auth}`,
      );

      // We need to render the isolated HTML view first, as the template will pull linked fields.
      let result = await withTimeout(
        page,
        async () => {
          await transitionTo(
            page,
            'render.html',
            url,
            String(this.#nonce),
            serializedOptions,
            'isolated',
            '0',
          );
          return await captureResult(page, 'innerHTML', captureOptions);
        },
        opts?.timeoutMs,
      );
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
        if (this.#isAuthError(error)) {
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
          markTimeout(capErr);
          let evicted = await this.#maybeEvict(
            realm,
            'isolated render',
            capErr,
          );
          if (evicted) {
            poolInfo.evicted = true;
            shortCircuit = true;
          }
          if (this.#isAuthError(error)) {
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
        let response: RenderResponse = {
          ...meta,
          ...(error ? { error } : {}),
          iconHTML: null,
          isolatedHTML,
          headHTML: null,
          atomHTML: null,
          embeddedHTML: null,
          fittedHTML: null,
        };
        response.error = this.#mergeConsoleErrors(pageId, response.error);
        return {
          response,
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
        if (this.#isAuthError(error)) {
          shortCircuit = true;
        }
        meta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
      } else {
        meta = metaMaybeError as PrerenderMeta;
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
            if (this.#isAuthError(error)) {
              shortCircuit = true;
              break;
            }
          }
        }
      }

      // Host-mode capture: do a full page navigation to the card's URL so
      // Ember boots fresh with the serialize builder.  This ensures the
      // serialized block markers match the exact structure that the
      // client-side rehydration builder expects (a route transition would
      // produce stale block depths from the transition lifecycle).
      const HOST_MODE_CAPTURE_TIMEOUT_MS = 10_000;
      if (isolatedHTML && !shortCircuit) {
        let forceHostModeScript: { identifier: string } | undefined;
        let requestHandler: ((req: import('puppeteer').HTTPRequest) => void) | undefined;
        try {
          let cardUrl = url.replace(/\.json$/i, '');
          let parsedUrl = new URL(cardUrl);
          let origin = parsedUrl.origin;
          let cardPath = parsedUrl.pathname.replace(/^\//, '');

          // Register a script that sets __boxelForceHostMode before Ember
          // boots on the next navigation.  This must be evaluateOnNewDocument
          // (not page.evaluate) because page.goto clears the JS context.
          forceHostModeScript = await page.evaluateOnNewDocument(
            (config: { origin: string }) => {
              (globalThis as any).__boxelForceHostMode = config;

              // Intercept fetch to capture card JSON responses for the shoebox.
              // This runs before any app code, so we wrap the native fetch.
              let shoeboxData: Record<string, unknown> = {};
              (globalThis as any).__boxelShoeboxData = shoeboxData;
              (globalThis as any).__boxelPendingFetches = 0;
              let originalFetch = globalThis.fetch;
              globalThis.fetch = async function (...args: Parameters<typeof fetch>) {
                (globalThis as any).__boxelPendingFetches++;
                let firstArg = args[0] as any;
                try {
                let response = await originalFetch.apply(globalThis, args);
                try {
                  let contentType = response.headers.get('content-type') || '';
                  if (
                    contentType.includes('card+source') ||
                    contentType.includes('card+json')
                  ) {
                    let clone = response.clone();
                    let json = await clone.json();
                    if (json?.data?.id) {
                      shoeboxData[json.data.id] = json;
                    } else if (Array.isArray(json?.data)) {
                      let requestUrl = typeof firstArg === 'string' ? firstArg : firstArg?.url || '';
                      let method = (firstArg instanceof Request ? firstArg.method : ((args[1] as any)?.method || 'GET')).toUpperCase();
                      let body = typeof (args[1] as any)?.body === 'string' ? (args[1] as any).body : '';
                      let key = '__search:' + method + ':' + requestUrl + ':' + body;
                      shoeboxData[key] = json;
                    }
                  }
                } catch (e: any) {
                  console.error('[shoebox-intercept] error capturing:', e?.message || e);
                }
                return response;
                } finally {
                  (globalThis as any).__boxelPendingFetches--;
                }
              };
            },
            { origin },
          );

          // Intercept network requests to add auth headers for realm
          // module imports.  During a fresh page.goto the Ember loader
          // hasn't established realm sessions yet, so ES module imports
          // would fail with 401.  We parse the JWTs from boxel-session
          // and inject them as Authorization headers.
          let authMap: Record<string, string> = {};
          try {
            authMap = JSON.parse(auth) as Record<string, string>;
          } catch {
            // auth might not be JSON; ignore
          }
          // Build a map from origin to JWT token for request interception
          let originTokenMap = new Map<string, string>();
          for (let [realmUrl, token] of Object.entries(authMap)) {
            if (token) {
              try {
                originTokenMap.set(new URL(realmUrl).origin, token);
              } catch {
                // ignore invalid URLs
              }
            }
          }

          await page.setRequestInterception(true);
          requestHandler = (
            interceptedRequest: import('puppeteer').HTTPRequest,
          ) => {
            let reqUrl = interceptedRequest.url();
            let matchedToken: string | undefined;
            try {
              matchedToken = originTokenMap.get(new URL(reqUrl).origin);
            } catch {
              // ignore invalid URLs
            }
            if (matchedToken) {
              interceptedRequest.continue({
                headers: {
                  ...interceptedRequest.headers(),
                  Authorization: matchedToken,
                },
              });
            } else {
              interceptedRequest.continue();
            }
          };
          page.on('request', requestHandler);

          // Full page navigation — Ember boots fresh with the serialize
          // builder, producing block markers that match a fresh render.
          await page.goto(`${this.#boxelHostURL}/${cardPath}`, {
            waitUntil: 'domcontentloaded',
            timeout: HOST_MODE_CAPTURE_TIMEOUT_MS,
          });

          await page.waitForFunction(
            () => {
              return (
                document.querySelector('[data-test-host-mode-card]') !== null
              );
            },
            { timeout: HOST_MODE_CAPTURE_TIMEOUT_MS },
          );

          // Wait for all in-flight fetches to complete (e.g., search results
          // from PrerenderedCardSearch) so the captured HTML is fully rendered.
          await page.waitForFunction(
            () => (globalThis as any).__boxelPendingFetches === 0,
            { timeout: HOST_MODE_CAPTURE_TIMEOUT_MS },
          );

          // After fetches complete, give Ember time to process responses
          // and re-render (trackedFunction updates → Glimmer re-render).
          await page.evaluate(
            () => new Promise((resolve) => setTimeout(resolve, 500)),
          );

          let hostModeHTML = await page.evaluate(() => {
            let root = document.getElementById('boxel-root');
            if (!root) return null;
            return root.innerHTML;
          });

          if (hostModeHTML) {
            log.info(
              `Captured host-mode HTML for ${url} (${hostModeHTML.length} chars)`,
            );

            // Extract captured card JSON from the fetch interceptor
            let shoeboxJSON: string | undefined;
            try {
              shoeboxJSON = await page.evaluate(() => {
                let data = (globalThis as any).__boxelShoeboxData;
                if (data && Object.keys(data).length > 0) {
                  return JSON.stringify(data);
                }
                return undefined;
              });
            } catch {
              // ignore shoebox extraction errors
            }

            if (shoeboxJSON) {
              log.info(
                `Captured shoebox data for ${url} (${shoeboxJSON.length} chars, ${Object.keys(JSON.parse(shoeboxJSON)).length} cards)`,
              );

              // --- Second pass ---
              // The first render's {{#each}} iterations were produced by a
              // Glimmer UPDATE (loading→response transition), so they lack
              // per-iteration block markers.  Re-navigate with shoebox data
              // pre-injected so `initFromShoebox` populates search results
              // synchronously during the INITIAL render, causing the
              // SerializeBuilder to emit correct per-iteration markers.
              let shoeboxScript: { identifier: string } | undefined;
              try {
                let parsedShoebox = JSON.parse(shoeboxJSON);
                shoeboxScript = await page.evaluateOnNewDocument(
                  (sbData: Record<string, unknown>) => {
                    (globalThis as any).__boxelShoeboxData = sbData;
                  },
                  parsedShoebox,
                );

                await page.goto(`${this.#boxelHostURL}/${cardPath}`, {
                  waitUntil: 'domcontentloaded',
                  timeout: HOST_MODE_CAPTURE_TIMEOUT_MS,
                });

                await page.waitForFunction(
                  () =>
                    document.querySelector('[data-test-host-mode-card]') !==
                    null,
                  { timeout: HOST_MODE_CAPTURE_TIMEOUT_MS },
                );

                // Brief wait for Ember to finish rendering
                await page.evaluate(
                  () => new Promise((resolve) => setTimeout(resolve, 500)),
                );

                let pass2HTML = await page.evaluate(() => {
                  let root = document.getElementById('boxel-root');
                  if (!root) return null;
                  return root.innerHTML;
                });

                if (pass2HTML) {
                  log.info(
                    `Second-pass host-mode HTML for ${url} (${pass2HTML.length} chars)`,
                  );
                  hostModeHTML = pass2HTML;
                }
              } catch (e) {
                log.warn(
                  'Second-pass prerender failed, using first-pass HTML',
                  e,
                );
              } finally {
                if (shoeboxScript) {
                  await page
                    .removeScriptToEvaluateOnNewDocument(
                      shoeboxScript.identifier,
                    )
                    .catch(() => {});
                }
              }

              // Encode shoebox as base64 comment appended to isolatedHTML
              // so it's stored alongside the HTML without DB schema changes.
              let encoded = Buffer.from(shoeboxJSON).toString('base64');
              hostModeHTML += `<!--boxel-shoebox:${encoded}-->`;
            }

            isolatedHTML = hostModeHTML;
          }
        } catch (e) {
          log.warn(
            'Host-mode capture failed, falling back to render route isolated HTML',
            e,
          );
        } finally {
          // Clean up request interception
          if (requestHandler) {
            page.off('request', requestHandler);
            await page.setRequestInterception(false).catch(() => {});
          }
          // Remove the temporary evaluateOnNewDocument script so it
          // doesn't affect subsequent navigations on this page.
          if (forceHostModeScript) {
            await page
              .removeScriptToEvaluateOnNewDocument(
                forceHostModeScript.identifier,
              )
              .catch(() => {});
          }
          // Navigate back to standby so the page is reusable by the pool.
          // Use a fresh page.goto (not a route transition) to fully reset
          // the Ember app state and avoid stale component teardown errors.
          try {
            await page.goto(`${this.#boxelHostURL}/standby`, {
              waitUntil: 'domcontentloaded',
              timeout: HOST_MODE_CAPTURE_TIMEOUT_MS,
            });
            await page.waitForFunction(
              () => document.querySelector('#standby-ready') !== null,
              { timeout: HOST_MODE_CAPTURE_TIMEOUT_MS },
            );
          } catch {
            // best-effort: page will be disposed on next use if unusable
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
      response.error = this.#mergeConsoleErrors(pageId, response.error);
      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  async prerenderModuleAttempt({
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
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
      `module prerendering url ${url}, nonce=${this.#nonce} realm=${realm}`,
    );

    const { page, reused, launchMs, pageId, release } =
      await this.#getPageForRealm(realm, auth);
    const poolInfo = {
      pageId: pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    try {
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);

      let renderStart = Date.now();
      let options = renderOptions ?? {};
      let serializedOptions = serializeRenderRouteOptions(options);
      const captureOptions: CaptureOptions = {
        expectedId: url,
        expectedNonce: String(this.#nonce),
        simulateTimeoutMs: opts?.simulateTimeoutMs,
      };

      let capture = await withTimeout(
        page,
        async () => {
          await transitionTo(
            page,
            'module',
            url,
            String(this.#nonce),
            serializedOptions,
          );
          return await captureModule(page, captureOptions);
        },
        opts?.timeoutMs,
      );

      let response: ModuleRenderResponse;
      if (isRenderError(capture)) {
        let renderError = capture as RenderError;
        renderError.type = 'module-error';
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
                type: 'module-error',
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

      response.error = this.#mergeConsoleErrors(pageId, response.error);
      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  async prerenderFileExtractAttempt({
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: FileExtractResponse;
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
      `file extract prerendering url ${url}, nonce=${this.#nonce} realm=${realm}`,
    );

    const { page, reused, launchMs, pageId, release } =
      await this.#getPageForRealm(realm, auth);
    const poolInfo = {
      pageId: pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    try {
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);

      let renderStart = Date.now();
      let options = renderOptions ?? {};
      let serializedOptions = serializeRenderRouteOptions(options);
      const captureOptions: CaptureOptions = {
        expectedId: url,
        expectedNonce: String(this.#nonce),
        simulateTimeoutMs: opts?.simulateTimeoutMs,
      };

      let capture = await withTimeout(
        page,
        async () => {
          await transitionTo(
            page,
            'render.file-extract',
            url,
            String(this.#nonce),
            serializedOptions,
          );
          return await captureFileExtract(page, captureOptions);
        },
        opts?.timeoutMs,
      );

      let response: FileExtractResponse;
      if (isRenderError(capture)) {
        let renderError = capture as RenderError;
        markTimeout(renderError);
        if (await this.#maybeEvict(realm, 'file extract render', renderError)) {
          poolInfo.evicted = true;
        }
        response = {
          id: url,
          nonce: String(this.#nonce),
          status: 'error',
          searchDoc: null,
          deps: renderError.error.deps ?? [],
          error: renderError,
        };
      } else {
        let fileCapture = capture as FileExtractCapture;
        try {
          response = JSON.parse(fileCapture.value) as FileExtractResponse;
          if (response.status !== fileCapture.status) {
            let renderError = buildInvalidFileExtractResponseError(
              page,
              `file extract status mismatch (${fileCapture.status} vs ${response.status})`,
              { title: 'Invalid file extract response', evict: true },
            );
            markTimeout(renderError);
            if (
              await this.#maybeEvict(realm, 'file extract render', renderError)
            ) {
              poolInfo.evicted = true;
            }
            response = {
              id: url,
              nonce: fileCapture.nonce ?? String(this.#nonce),
              status: 'error',
              searchDoc: null,
              deps: renderError.error.deps ?? [],
              error: {
                type: 'file-error',
                error: renderError.error,
              },
            };
          }
        } catch (_e) {
          let renderError = buildInvalidFileExtractResponseError(
            page,
            `file extract returned invalid payload: ${fileCapture.value}`,
            { title: 'Invalid file extract response' },
          );
          markTimeout(renderError);
          if (
            await this.#maybeEvict(realm, 'file extract render', renderError)
          ) {
            poolInfo.evicted = true;
          }
          response = {
            id: url,
            nonce: fileCapture.nonce ?? String(this.#nonce),
            status: 'error',
            searchDoc: null,
            deps: renderError.error.deps ?? [],
            error: renderError,
          };
        }
      }

      response.error = this.#mergeConsoleErrors(pageId, response.error);
      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  async prerenderFileRenderAttempt({
    realm,
    url,
    auth,
    fileData,
    types: _types,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    fileData: FileRenderArgs['fileData'];
    types: string[];
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: FileRenderResponse;
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
      `file render prerendering url ${url}, nonce=${this.#nonce} realm=${realm}`,
    );

    const { page, reused, launchMs, pageId, release } =
      await this.#getPageForRealm(realm, auth);
    const poolInfo = {
      pageId: pageId ?? 'unknown',
      realm,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    try {
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);

      // Stash file data on globalThis for the render route to consume
      await page.evaluate((data) => {
        (globalThis as any).__boxelFileRenderData = data;
      }, fileData);

      let renderStart = Date.now();
      let error: RenderError | undefined;
      let options: RenderRouteOptions = {
        ...(renderOptions ?? {}),
        fileRender: true,
        fileDefCodeRef: fileData.fileDefCodeRef,
      };
      let serializedOptions = serializeRenderRouteOptions(options);
      let optionsSegment = encodeURIComponent(serializedOptions);
      // File render uses the full file URL (including extension) as the ID,
      // unlike card render which strips .json. The render route's fileRender
      // branch sets cardId to the raw url parameter, so expectedId must match.
      const captureOptions: CaptureOptions = {
        expectedId: url,
        expectedNonce: String(this.#nonce),
        simulateTimeoutMs: opts?.simulateTimeoutMs,
      };

      log.debug(
        `file render: visit ${url} at: ${this.#boxelHostURL}/render/${encodeURIComponent(url)}/${this.#nonce}/${optionsSegment}/html/isolated/0`,
      );

      // Render isolated HTML only – additional formats (head, atom, icon,
      // fitted, embedded) are deferred to keep boot-indexing fast.  Each
      // Puppeteer transition costs 2-3 s, so rendering all formats for every
      // file would make boot-time O(files × formats × 3 s) which easily
      // exceeds test timeouts.
      let result = await withTimeout(
        page,
        async () => {
          await transitionTo(
            page,
            'render.html',
            url,
            String(this.#nonce),
            serializedOptions,
            'isolated',
            '0',
          );
          return await captureResult(page, 'innerHTML', captureOptions);
        },
        opts?.timeoutMs,
      );
      let isolatedHTML: string | null = null;
      if (isRenderError(result)) {
        error = result;
        markTimeout(error);
        let evicted = await this.#maybeEvict(
          realm,
          'file isolated render',
          result as RenderError,
        );
        if (evicted) {
          poolInfo.evicted = true;
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
          markTimeout(capErr);
          let evicted = await this.#maybeEvict(
            realm,
            'file isolated render',
            capErr,
          );
          if (evicted) {
            poolInfo.evicted = true;
          }
        }
      }

      let response: FileRenderResponse = {
        ...(error ? { error } : {}),
        iconHTML: null,
        isolatedHTML,
        headHTML: null,
        atomHTML: null,
        embeddedHTML: null,
        fittedHTML: null,
      };
      response.error = this.#mergeConsoleErrors(pageId, response.error);
      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart },
        pool: poolInfo,
      };
    } finally {
      // Clean up globalThis data
      await page
        .evaluate(() => {
          delete (globalThis as any).__boxelFileRenderData;
        })
        .catch(() => {
          /* best-effort cleanup */
        });
      release();
    }
  }

  shouldRetryWithClearCache(
    response:
      | RenderResponse
      | ModuleRenderResponse
      | FileExtractResponse
      | FileRenderResponse,
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

  #isAuthError(err?: RenderError): boolean {
    let status = Number(err?.error?.status);
    return status === 401 || status === 403;
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

  #captureToError(capture: RenderCapture): RenderError | undefined {
    if (capture.status === 'error' || capture.status === 'unusable') {
      let parsed: RenderError | undefined;
      try {
        parsed = JSON.parse(capture.value);
      } catch (_e) {
        parsed = {
          type: 'instance-error',
          error: {
            status: 500,
            title: 'Render capture parse error',
            message: `Error during prerendering: "${capture.value}"`,
            additionalErrors: null,
          },
        } as RenderError;
      }
      if (parsed) {
        let parsedType = (parsed as { type?: string }).type;
        if (parsedType === 'error') {
          parsed.type = 'instance-error';
        }
        return {
          ...parsed,
          evict: capture.status === 'unusable',
        } as RenderError;
      }
    }
    return undefined;
  }

  #mergeConsoleErrors<T extends { error: SerializedError }>(
    pageId: string,
    error?: T,
  ): T | undefined {
    let consoleErrors = this.#pagePool.takeConsoleErrors(pageId);
    if (consoleErrors.length === 0 || !error) {
      return error;
    }
    let existing = Array.isArray(error.error.additionalErrors)
      ? [...error.error.additionalErrors]
      : [];
    let consoleAdditional = this.#serializeConsoleErrors(consoleErrors);
    if (consoleAdditional.length === 0) {
      return error;
    }
    return {
      ...error,
      error: {
        ...error.error,
        additionalErrors: [...existing, ...consoleAdditional],
      },
    };
  }

  #serializeConsoleErrors(
    consoleErrors: ConsoleErrorEntry[],
  ): SerializedError[] {
    return consoleErrors.map((entry) => ({
      status: 500,
      title: entry.type === 'assert' ? 'Console assert' : 'Console error',
      message: this.#formatConsoleError(entry),
      additionalErrors: null,
    }));
  }

  #formatConsoleError(entry: ConsoleErrorEntry): string {
    let message = entry.text;
    let location = entry.location?.url;
    if (location) {
      let segments: number[] = [];
      if (typeof entry.location?.lineNumber === 'number') {
        segments.push(entry.location.lineNumber + 1);
      }
      if (typeof entry.location?.columnNumber === 'number') {
        segments.push(entry.location.columnNumber + 1);
      }
      let suffix = segments.length ? `:${segments.join(':')}` : '';
      message = `${message} (${location}${suffix})`;
    }
    return message;
  }

  #evictionReason(renderError: RenderError): 'timeout' | 'unusable' | null {
    let status = Number(renderError.error?.status);
    if (status === 401 || status === 403) {
      // Auth failures are not signs of a bad page; do not evict on auth errors.
      return null;
    }
    if (renderError.error?.title === 'Render timeout') {
      return 'timeout';
    }
    if ((renderError as any).evict) {
      return 'unusable';
    }
    return null;
  }

  #incEvictionMetric(realm: string, reason: 'unusable' | 'timeout') {
    let current = this.#evictionMetrics.byRealm.get(realm) ?? {
      unusable: 0,
      timeout: 0,
    };
    current[reason]++;
    this.#evictionMetrics.byRealm.set(realm, current);
  }

  async #maybeEvict(
    realm: string,
    step: string,
    err?: RenderError,
  ): Promise<boolean> {
    if (!err) {
      return false;
    }
    let status = Number(err.error?.status);
    if (status === 401 || status === 403) {
      return false;
    }
    let reason = this.#evictionReason(err);
    if (!reason) {
      return false;
    }
    await this.#evictRealm(realm, step, reason);
    return true;
  }

  async #evictRealm(
    realm: string,
    step: string,
    reason: 'timeout' | 'unusable',
  ) {
    this.#incEvictionMetric(realm, reason);
    log.warn(`Evicting realm %s due to %s during %s`, realm, reason, step);
    try {
      await this.#pagePool.disposeRealm(realm, {
        awaitIdle: false,
        retainConsoleErrors: true,
      });
    } catch (e) {
      log.warn(`Error disposing realm %s on %s:`, realm, reason, e);
    }
  }
}
