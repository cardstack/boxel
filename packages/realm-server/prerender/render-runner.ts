import {
  type PrerenderMeta,
  type RenderError,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type RenderRouteOptions,
  serializeRenderRouteOptions,
  logger,
} from '@cardstack/runtime-common';
import type { PagePool } from './page-pool';
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
    let pageInfo = await this.#pagePool.getPage(realm);
    let lastAuth = this.#lastAuthByRealm.get(realm);
    if (pageInfo.reused && lastAuth) {
      let lastKeys = this.#authKeys(lastAuth);
      let nextKeys = this.#authKeys(auth);
      let authChanged =
        lastKeys && nextKeys
          ? lastKeys.length !== nextKeys.length ||
            lastKeys.some((k) => !nextKeys.includes(k))
          : lastAuth !== auth;
      if (authChanged) {
        await this.#pagePool.disposeRealm(realm);
        pageInfo = await this.#pagePool.getPage(realm);
      }
    }
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

    const { page, reused, launchMs, pageId } = await this.#getPageForRealm(
      realm,
      auth,
    );
    const poolInfo = {
      pageId: pageId ?? 'unknown',
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
        let evicted = await this.#maybeEvict(realm, 'isolated render', capErr);
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
    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart },
      pool: poolInfo,
    };
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

    const { page, reused, launchMs, pageId } = await this.#getPageForRealm(
      realm,
      auth,
    );
    const poolInfo = {
      pageId: pageId ?? 'unknown',
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

    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart },
      pool: poolInfo,
    };
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

    const { page, reused, launchMs, pageId } = await this.#getPageForRealm(
      realm,
      auth,
    );
    const poolInfo = {
      pageId: pageId ?? 'unknown',
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
        if (await this.#maybeEvict(realm, 'file extract render', renderError)) {
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

    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart },
      pool: poolInfo,
    };
  }

  shouldRetryWithClearCache(
    response: RenderResponse | ModuleRenderResponse,
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
      await this.#pagePool.disposeRealm(realm);
    } catch (e) {
      log.warn(`Error disposing realm %s on %s:`, realm, reason, e);
    }
  }
}
