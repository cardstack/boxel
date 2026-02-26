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
      let applyStepError = (stepError: RenderError, evicted: boolean) => {
        error = error ?? stepError;
        markTimeout(stepError);
        if (evicted) {
          poolInfo.evicted = true;
          shortCircuit = true;
        }
        if (this.#isAuthError(error)) {
          shortCircuit = true;
        }
      };
      let handleDirectStepError = async (
        step: string,
        stepError: RenderError,
      ) => {
        let evicted = await this.#maybeEvict(realm, step, stepError);
        applyStepError(stepError, evicted);
      };
      let runTimedStep = async <T>(
        step: string,
        fn: () => Promise<T | RenderError>,
      ): Promise<T | undefined> => {
        if (shortCircuit) {
          return;
        }
        let stepResult = await this.#step(realm, step, () =>
          withTimeout(page, fn, opts?.timeoutMs),
        );
        if (stepResult.ok) {
          return stepResult.value as T;
        }
        applyStepError(stepResult.error, stepResult.evicted);
        return;
      };

      log.debug(
        `manually visit prerendered url ${url} at: ${this.#boxelHostURL}/render/${encodeURIComponent(url)}/${this.#nonce}/${optionsSegment}/html/isolated/0 with localStorage boxel-session=${auth}`,
      );

      // We need to render the isolated HTML view first, as the template will pull linked fields.
      log.debug(`isolated render start url=${url} realm=${realm}`);
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
          return await renderHTML(page, 'isolated', 0, captureOptions);
        },
        opts?.timeoutMs,
      );
      log.debug(
        `isolated render completed url=${url} realm=${realm} isError=${isRenderError(
          result,
        )}`,
      );
      let isolatedHTML: string | null = null;
      if (isRenderError(result)) {
        // If isolated fails we cannot reliably render downstream formats for
        // this card; continuing causes long timeout cascades (for example while
        // indexing broken cards), so short-circuit immediately.
        shortCircuit = true;
        await handleDirectStepError('isolated render', result as RenderError);
      } else {
        isolatedHTML = result as string;
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

      let emptyMeta: PrerenderMeta = {
        serialized: null,
        searchDoc: null,
        displayNames: null,
        deps: null,
        types: null,
      };
      let meta = emptyMeta;
      let metaForTypes = emptyMeta;
      let headHTML: string | null = null,
        atomHTML: string | null = null,
        iconHTML: string | null = null,
        embeddedHTML: Record<string, string> | null = null,
        fittedHTML: Record<string, string> | null = null;

      const formatSteps: Array<{
        name: string;
        cb: () => Promise<string | RenderError>;
        assign: (value: string) => void;
      }> = [
        {
          name: 'head render',
          cb: () => renderHTML(page, 'head', 0, captureOptions),
          assign: (value: string) => {
            headHTML = value;
          },
        },
        {
          name: 'atom render',
          cb: () => renderHTML(page, 'atom', 0, captureOptions),
          assign: (value: string) => {
            atomHTML = value;
          },
        },
        {
          name: 'icon render',
          cb: () => renderIcon(page, captureOptions),
          assign: (value: string) => {
            iconHTML = value;
          },
        },
      ];
      for (let step of formatSteps) {
        if (shortCircuit) {
          break;
        }
        let stepValue = await runTimedStep<string>(step.name, step.cb);
        if (stepValue !== undefined) {
          step.assign(stepValue);
        }
      }

      if (!shortCircuit) {
        // Obtain type hierarchy for ancestor rendering. We capture final meta
        // again at the end so searchDoc/deps reflect every format's loads.
        let metaForTypesResult = await runTimedStep<PrerenderMeta>(
          'render.meta (types)',
          () => renderMeta(page, captureOptions),
        );
        if (metaForTypesResult !== undefined) {
          metaForTypes = metaForTypesResult;
        }
      }

      if (!shortCircuit && metaForTypes.types) {
        // Render sequentially and short-circuit on unusable page/timeout
        const steps: Array<{
          name: string;
          cb: () => Promise<string | Record<string, string> | RenderError>;
          assign: (value: string | Record<string, string>) => void;
        }> = [
          {
            name: 'fitted render',
            cb: () =>
              renderAncestors(
                page,
                'fitted',
                metaForTypes.types!,
                captureOptions,
              ),
            assign: (v: string | Record<string, string>) => {
              fittedHTML = v as Record<string, string>;
            },
          },
          {
            name: 'embedded render',
            cb: () =>
              renderAncestors(
                page,
                'embedded',
                metaForTypes.types!,
                captureOptions,
              ),
            assign: (v: string | Record<string, string>) => {
              embeddedHTML = v as Record<string, string>;
            },
          },
        ];

        for (let step of steps) {
          if (shortCircuit) {
            break;
          }
          let stepValue = await runTimedStep<string | Record<string, string>>(
            step.name,
            step.cb,
          );
          if (stepValue !== undefined) {
            step.assign(stepValue);
          }
        }
      }

      if (!shortCircuit) {
        let finalMetaResult = await runTimedStep<PrerenderMeta>(
          'render.meta (final)',
          () => renderMeta(page, captureOptions),
        );
        if (finalMetaResult !== undefined) {
          meta = finalMetaResult;
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
    log.debug(`prerender step start realm=${realm} step=${step}`);
    let r = await fn();
    if (isRenderError(r)) {
      let evicted = await this.#maybeEvict(realm, step, r as RenderError);
      log.debug(
        `prerender step error realm=${realm} step=${step} status=${
          (r as RenderError).error?.status
        } title=${(r as RenderError).error?.title} evicted=${evicted}`,
      );
      return { ok: false, error: r as RenderError, evicted };
    }
    log.debug(`prerender step done realm=${realm} step=${step}`);
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
    let normalizedTitle = (renderError.error?.title ?? '').trim().toLowerCase();
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
    let normalizedMessage = (renderError.error?.message ?? '')
      .trim()
      .toLowerCase();
    if (
      status >= 500 &&
      (normalizedTitle === '' || normalizedTitle === 'unknown') &&
      (normalizedMessage.includes('reject') ||
        normalizedMessage.includes('rsvp'))
    ) {
      // Promise rejections can leave pooled pages in an unreliable state,
      // even when the payload is not explicitly marked as evictable.
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
