import {
  type PrerenderMeta,
  type PrerenderTypes,
  type RenderError,
  type RenderResponse,
  type RenderTimeoutDiagnostics,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type FileRenderResponse,
  type RenderRouteOptions,
  type RunCommandResponse,
  type ScreenshotPrerenderResponse,
  type AffinityType,
  type PrerenderQueue,
  type RenderVisitResponse,
  type PrerenderVisitArgs,
  VISIT_PASS_ORDER,
  serializeRenderRouteOptions,
  logger,
} from '@cardstack/runtime-common';
import type { SerializedError } from '@cardstack/runtime-common/error';
import type { ConsoleErrorEntry, PagePool } from './page-pool.ts';
import { toAffinityKey } from './affinity.ts';
import { throwIfAborted } from './prerender-cancel.ts';
import {
  captureResult,
  captureModule,
  captureFileExtract,
  captureScreenshot,
  isRenderError,
  renderAncestors,
  renderHTML,
  renderIcon,
  renderMeta,
  renderTypes,
  type RenderCapture,
  type CaptureOptions,
  type ModuleCapture,
  type FileExtractCapture,
  type ScreenshotCapture,
  cardRenderTimeout,
  withTimeout,
  transitionTo,
  buildCommandRunnerURL,
  buildInvalidModuleResponseError,
  buildInvalidFileExtractResponseError,
  type RenderProfileContext,
} from './utils.ts';
import { randomUUID } from 'crypto';
import type { Page } from 'puppeteer';

const log = logger('prerenderer');
const reproduceLog = logger('prerenderer-reproduce');
const commandRequestStorageKeyPrefix = 'boxel-command-request:';

// Surfaces the per-stage wait breakdown from PagePool.getPage so
// operators can tell "waited for the render semaphore" (saturation) apart
// from "waited for the per-affinity file-admission cap" apart from
// "waited for an affinity tab" (warm-tab serialization) apart from
// "warmed a new tab". All four arrive tagged on every prerender response.
export type LaunchWaits = {
  semaphoreMs: number;
  admissionMs: number;
  tabQueueMs: number;
  tabStartupMs: number;
};

export type Timings = {
  launchMs: number;
  renderMs: number;
  waits: LaunchWaits;
};

type PoolInfo = {
  pageId: string;
  affinityType: AffinityType;
  affinityValue: string;
  reused: boolean;
  evicted: boolean;
  timedOut: boolean;
};

const CLEAR_CACHE_RETRY_SIGNATURES: readonly (readonly string[])[] = [
  // this is a side effect of glimmer scoped styles moving a DOM node that
  // glimmer is tracking. when we go to teardown the component glimmer gets mad
  // that a node it was tracking is no longer there. performing a new prerender
  // capture with a cleared store/loader cache will workaround this issue.
  [`Failed to execute 'removeChild' on 'Node'`, 'NotFoundError'],
];

// Title shown on the SerializedError that wraps a captured console
// or runtime-exception entry. Distinct labels make it obvious in the
// error doc which CDP layer surfaced the signal:
//
//   • 'Uncaught exception' → Runtime.exceptionThrown (V8 layer; the
//     primary signal for the whitepaper-class bug where unhandled-
//     rejection / window.error never fire)
//   • 'Uncaught exception (revoked by late .catch)' → V8 fired
//     `Runtime.exceptionRevoked` for this id, meaning RSVP / Backburner
//     attached a `.catch` after V8 had already reported the rejection
//     as uncaught. The render is still wedged (the late catch doesn't
//     un-poison Glimmer's render tree) — surfacing the entry preserves
//     the actionable stack while making the lifecycle visible.
//   • 'Console assert'     → console.assert(...) failure
//   • 'Console error'      → console.error(...) or Chrome's late
//     "Uncaught (in promise) ..." console tracker line
export function titleForConsoleErrorEntry(entry: ConsoleErrorEntry): string {
  if (entry.source === 'exception') {
    return entry.revoked
      ? 'Uncaught exception (revoked by late .catch)'
      : 'Uncaught exception';
  }
  return entry.type === 'assert' ? 'Console assert' : 'Console error';
}

// Stack-trace header line. Same source-distinction logic as the
// title above, formatted as `<HeaderName>: <message>` so the existing
// error viewer renders these identically to native Node stacks.
export function stackHeaderForConsoleErrorEntry(
  entry: ConsoleErrorEntry,
): string {
  if (entry.source === 'exception') {
    return entry.revoked ? 'UncaughtExceptionRevoked' : 'UncaughtException';
  }
  return entry.type === 'assert' ? 'AssertionError' : 'ConsoleError';
}

export class RenderRunner {
  #pagePool: PagePool;
  #boxelHostURL: string;
  #nonce = 0;
  #evictionMetrics = {
    byAffinity: new Map<string, { unusable: number; timeout: number }>(),
  };
  #lastAuthByAffinity = new Map<string, string>();

  constructor(options: { pagePool: PagePool; boxelHostURL: string }) {
    this.#pagePool = options.pagePool;
    this.#boxelHostURL = options.boxelHostURL;
  }

  async #getPageForAffinity(
    affinityKey: string,
    auth: string,
    queue: PrerenderQueue,
    signal?: AbortSignal,
    priority?: number,
  ) {
    let lastAuth = this.#lastAuthByAffinity.get(affinityKey);
    if (lastAuth) {
      let lastKeys = this.#authKeys(lastAuth);
      let nextKeys = this.#authKeys(auth);
      let authChanged =
        lastKeys && nextKeys
          ? lastKeys.length !== nextKeys.length ||
            lastKeys.some((k) => !nextKeys.includes(k))
          : lastAuth !== auth;
      if (authChanged) {
        await this.#pagePool.disposeAffinity(affinityKey);
        this.#lastAuthByAffinity.delete(affinityKey);
      }
    }
    let pageInfo = await this.#pagePool.getPage(affinityKey, queue, {
      signal,
      ...(priority !== undefined ? { priority } : {}),
    });
    this.#lastAuthByAffinity.set(affinityKey, auth);
    return pageInfo;
  }

  clearAuthCache(affinityKey: string) {
    this.#lastAuthByAffinity.delete(affinityKey);
  }

  // Builds the per-render profile context threaded into `withTimeout`.
  // The affinity key drives the airtight affinity-scoped CPU-profiler
  // gate (only the render whose affinity exactly matches
  // `PRERENDER_PROFILE_AFFINITY` is ever profiled); the label keys the
  // profiler's per-render log line by card url + render step.
  #profileContext(
    affinityKey: string,
    url: string,
    step: string,
    jobId?: string,
  ): RenderProfileContext {
    // `card`/`step` mirror what `label` concatenates but stay structured so
    // the artifact sink can key on them; `jobId` is threaded only by the
    // visit path (on-demand screenshot/module/command renders carry none).
    return { affinityKey, label: `${url} ${step}`, card: url, step, jobId };
  }

  #authKeys(auth: string): string[] | null {
    try {
      let parsed = JSON.parse(auth) as Record<string, string>;
      return Object.keys(parsed).sort();
    } catch (_e) {
      return null;
    }
  }

  async runCommandAttempt({
    affinityType,
    affinityValue,
    auth,
    command,
    commandInput,
    opts,
    priority,
    signal,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    auth: string;
    command: string;
    commandInput?: Record<string, unknown> | null;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    priority?: number;
    signal?: AbortSignal;
  }): Promise<{
    response: RunCommandResponse;
    timings: Timings;
    pool: PoolInfo;
  }> {
    this.#nonce++;
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    log.info(
      `running command ${command ?? '<unknown>'}, nonce=${this.#nonce} affinity=${affinityKey}`,
    );

    const { page, reused, launchMs, waits, pageId, release } =
      await this.#getPageForAffinity(
        affinityKey,
        auth,
        'command',
        signal,
        priority,
      );
    const poolInfo: PoolInfo = {
      pageId: pageId ?? 'unknown',
      affinityType,
      affinityValue,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    const markTimeout = (status?: RunCommandResponse['status']) => {
      if (!poolInfo.timedOut && status === 'unusable') {
        poolInfo.timedOut = true;
      }
    };
    try {
      // Page acquired but untouched — a cancel in this window doesn't
      // need eviction (the tab is still clean), so tag it `'queued'`.
      // Once `page.evaluate` runs below, any further cancel becomes a
      // `'rendering'` cancel and does trigger affinity disposal. The
      // check lives inside the try so `finally { release() }` frees the
      // tab slot if the caller aborted during the getPage handoff.
      throwIfAborted(signal, 'queued');
      let renderStart = Date.now();
      let requestId = randomUUID();
      let nonce = String(this.#nonce);
      let storageKey = `${commandRequestStorageKeyPrefix}${requestId}`;
      await page.evaluate(
        (sessionAuth, key, commandToRun, input, requestNonce, createdAt) => {
          localStorage.setItem('boxel-session', sessionAuth);
          localStorage.setItem(
            key,
            JSON.stringify({
              command: commandToRun,
              input,
              nonce: requestNonce,
              createdAt,
            }),
          );
        },
        auth,
        storageKey,
        command,
        commandInput ?? null,
        nonce,
        Date.now(),
      );
      await transitionTo(page, 'command-runner', requestId, nonce);
      log.info(
        'command-runner url: %s',
        buildCommandRunnerURL(page, nonce, requestId),
      );

      let waitResult = await withTimeout(
        page,
        async () => {
          const jsHandle = await page.waitForFunction(
            (expectedNonce: string) => {
              let containers = Array.from(
                document.querySelectorAll(
                  '[data-prerender][data-prerender-id="command-runner"]',
                ),
              ) as HTMLElement[];
              let container =
                containers.find(
                  (candidate) =>
                    candidate.dataset.prerenderNonce === expectedNonce,
                ) ?? null;
              if (!container) {
                return false;
              }
              let status = container.dataset.prerenderStatus ?? '';
              if (!['ready', 'error', 'unusable'].includes(status)) {
                return false;
              }
              let errorElement = container.querySelector(
                '[data-prerender-error]',
              ) as HTMLElement | null;
              let cardResultStringElement = container.querySelector(
                '[data-command-result]',
              ) as HTMLElement | null;
              let domError = (errorElement?.textContent ?? '').trim() || null;
              let cardResultString = (
                cardResultStringElement?.textContent ?? ''
              ).trim();
              return {
                status: status as 'ready' | 'error' | 'unusable',
                domError,
                cardResultString:
                  cardResultString.length > 0 ? cardResultString : null,
              };
            },
            { timeout: opts?.timeoutMs ?? cardRenderTimeout },
            nonce,
          );
          try {
            const payload = (await jsHandle.jsonValue()) as {
              status: 'ready' | 'error' | 'unusable';
              domError: string | null;
              cardResultString: string | null;
            };
            if (opts?.simulateTimeoutMs) {
              await new Promise((resolve) =>
                setTimeout(resolve, opts.simulateTimeoutMs),
              );
            }
            return payload;
          } finally {
            await jsHandle.dispose();
          }
        },
        opts?.timeoutMs,
        this.#profileContext(affinityKey, command, 'command-runner'),
      );

      if (isRenderError(waitResult)) {
        let response: RunCommandResponse = {
          status: 'unusable',
          error: waitResult.error.message,
        };
        markTimeout(response.status);
        return {
          response,
          timings: { launchMs, renderMs: Date.now() - renderStart, waits },
          pool: poolInfo,
        };
      }

      const payload = waitResult;

      let consoleErrors = this.#pagePool.takeConsoleErrors(pageId);

      let response: RunCommandResponse = {
        status: payload.status,
        cardResultString: payload.cardResultString ?? undefined,
      };

      if (payload.status !== 'ready') {
        let consoleErrorSummary =
          consoleErrors.length > 0
            ? consoleErrors.map((e) => this.#formatConsoleError(e)).join('\n')
            : undefined;
        let errorDetail = [payload.domError, consoleErrorSummary]
          .filter(Boolean)
          .join('\n---\n');
        response.error = errorDetail.length > 0 ? errorDetail : undefined;

        log.error(
          `command runner returned error status command=${command} domError=${payload.domError ?? 'null'} consoleErrors=${consoleErrors.length}`,
        );
      }

      markTimeout(response.status);

      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart, waits },
        pool: poolInfo,
      };
    } catch (e) {
      log.error('Error running command in headless chrome:', e);
      let response: RunCommandResponse = {
        status: 'error',
        error: e instanceof Error ? `${e.name}: ${e.message}` : `${e}`,
      };
      return {
        response,
        timings: { launchMs, renderMs: 0, waits },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  async captureScreenshotAttempt({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    format,
    opts,
    priority,
    signal,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    format: 'isolated' | 'embedded';
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    priority?: number;
    signal?: AbortSignal;
  }): Promise<{
    response: ScreenshotPrerenderResponse;
    timings: Timings;
    pool: PoolInfo;
  }> {
    this.#nonce++;
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    log.info(
      `screenshot prerendering url=${url} format=${format} nonce=${this.#nonce} affinity=${affinityKey} realm=${realm} priority=${priority ?? 0}`,
    );

    const { page, reused, launchMs, waits, pageId, release } =
      await this.#getPageForAffinity(
        affinityKey,
        auth,
        'file',
        signal,
        priority,
      );
    const poolInfo: PoolInfo = {
      pageId: pageId ?? 'unknown',
      affinityType,
      affinityValue,
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
      // See runCommandAttempt: tag as 'queued' and keep the check inside the
      // try so `finally { release() }` frees the tab slot if the caller
      // aborted during the getPage handoff.
      throwIfAborted(signal, 'queued');
      await page.evaluate((sessionAuth) => {
        localStorage.setItem('boxel-session', sessionAuth);
      }, auth);

      let renderStart = Date.now();
      let nonce = String(this.#nonce);
      let renderOptions: RenderRouteOptions = { cardRender: true };
      let serializedOptions = serializeRenderRouteOptions(renderOptions);
      const captureOptions: CaptureOptions = {
        expectedId: url.replace(/\.json$/i, ''),
        expectedNonce: nonce,
        simulateTimeoutMs: opts?.simulateTimeoutMs,
        timeoutMs: opts?.timeoutMs,
      };

      let capture = await withTimeout(
        page,
        async () => {
          await transitionTo(
            page,
            'render.html',
            url,
            nonce,
            serializedOptions,
            format,
            '0',
          );
          return await captureScreenshot(page, format, 0, captureOptions);
        },
        opts?.timeoutMs,
        this.#profileContext(affinityKey, url, `screenshot ${format}`),
      );

      let response: ScreenshotPrerenderResponse;
      if (isRenderError(capture)) {
        let renderError = capture as RenderError;
        markTimeout(renderError);
        if (
          await this.#maybeEvict(affinityKey, 'screenshot render', renderError)
        ) {
          poolInfo.evicted = true;
        }
        let isUnusable = poolInfo.evicted || renderError.evict === true;
        response = {
          status: isUnusable ? 'unusable' : 'error',
          error: renderError.error.message ?? 'screenshot render failed',
        };
      } else {
        let shot = capture as ScreenshotCapture;
        response = {
          status: 'ready',
          base64: shot.base64,
          width: shot.width,
          height: shot.height,
          contentType: 'image/png',
        };
      }

      return {
        response,
        timings: { launchMs, renderMs: Date.now() - renderStart, waits },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  async prerenderModuleAttempt({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    opts,
    renderOptions,
    priority,
    signal,
    onTabAcquired,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
    priority?: number;
    signal?: AbortSignal;
    // Fires after `getPageForAffinity` resolves AND the per-page
    // console/exception bucket has been reset — i.e. when this attempt
    // has a page AND the bucket is empty for THIS render. The reset
    // happens before the callback so a test fixture that seeds the
    // bucket via `Prerenderer.__test_seedRevokedException` doesn't
    // get its seed wiped out by reset. Originally introduced as a
    // CS-10872 diagnostic hook (used by the Prerenderer to flip
    // `affinitySnapshot.sameAffinityActivity[*].state` from `queued`
    // to `running`); the post-reset position adds a fraction of a
    // ms to that transition but keeps the deadlock fingerprint
    // accurate.
    onTabAcquired?: (info: { pageId: string }) => void;
  }): Promise<{
    response: ModuleRenderResponse;
    timings: Timings;
    pool: PoolInfo;
  }> {
    this.#nonce++;
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    log.info(
      `module prerendering url ${url}, nonce=${this.#nonce} affinity=${affinityKey} realm=${realm}`,
    );

    const { page, reused, launchMs, waits, pageId, release } =
      await this.#getPageForAffinity(
        affinityKey,
        auth,
        'module',
        signal,
        priority,
      );
    const poolInfo: PoolInfo = {
      pageId: pageId ?? 'unknown',
      affinityType,
      affinityValue,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    onTabAcquired?.({ pageId: pageId ?? 'unknown' });
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };
    try {
      // See runCommandAttempt: tag as 'queued' and keep the check
      // inside the try so `finally { release() }` frees the tab slot
      // if the caller aborted during the getPage handoff.
      throwIfAborted(signal, 'queued');
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
        timeoutMs: opts?.timeoutMs,
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
        this.#profileContext(affinityKey, url, 'module'),
      );

      let response: ModuleRenderResponse;
      if (isRenderError(capture)) {
        let renderError = capture as RenderError;
        renderError.type = 'module-error';
        markTimeout(renderError);
        if (await this.#maybeEvict(affinityKey, 'module render', renderError)) {
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
            if (
              await this.#maybeEvict(affinityKey, 'module render', renderError)
            ) {
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
          if (
            await this.#maybeEvict(affinityKey, 'module render', renderError)
          ) {
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
        timings: { launchMs, renderMs: Date.now() - renderStart, waits },
        pool: poolInfo,
      };
    } finally {
      release();
    }
  }

  // Composite "visit" prerender — acquires one page and runs whichever of the
  // fileExtract/cardRender/fileRender passes the caller requests, returning a
  // union response. Passes execute in VISIT_PASS_ORDER and short-circuit when
  // the page becomes unusable (eviction or auth failure).
  //
  // `visitType` bifurcates the pass internals along the search-doc/HTML seam
  // (see PrerenderVisitType): an 'index' visit runs the extract, the card's
  // icon + meta and the file's icon — never the `html` route; a
  // 'prerender-html' visit runs only the `html` route formats + markdown for
  // the card and file renderings. No `visitType` runs the fused union.
  async prerenderVisitAttempt({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    visitType,
    opts,
    renderOptions,
    fileData,
    types,
    cardTypes,
    priority,
    jobId,
    signal,
    onTabAcquired,
  }: PrerenderVisitArgs & {
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    signal?: AbortSignal;
    // See the matching param on `prerenderModuleAttempt`.
    onTabAcquired?: (info: { pageId: string }) => void;
  }): Promise<{
    response: RenderVisitResponse;
    timings: Timings;
    pool: PoolInfo;
  }> {
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    // Which halves of the bifurcated visit run. The fused visit (no
    // visitType) runs both.
    let runIndexSteps = visitType !== 'prerender-html';
    let runHtmlSteps = visitType !== 'index';
    let requested = {
      // The extract belongs to the index half. A standalone 'prerender-html'
      // visit still runs it when its fileRender pass wasn't handed
      // `fileData` — that is what makes the visit self-sufficient: it
      // resolves the file's resource + types from source instead of
      // chaining off a prior index visit's outputs.
      fileExtract:
        Boolean(renderOptions?.fileExtract) &&
        (runIndexSteps ||
          (Boolean(renderOptions?.fileRender) && fileData == null)),
      cardRender: Boolean(renderOptions?.cardRender),
      fileRender: Boolean(renderOptions?.fileRender),
    };
    log.info(
      `visit prerender url=${url} affinity=${affinityKey} realm=${realm} visitType=${
        visitType ?? 'fused'
      } passes=${VISIT_PASS_ORDER.filter((p) => requested[p]).join(',')}`,
    );

    const { page, reused, launchMs, waits, pageId, release } =
      await this.#getPageForAffinity(
        affinityKey,
        auth,
        'file',
        signal,
        priority,
      );
    const poolInfo: PoolInfo = {
      pageId: pageId ?? 'unknown',
      affinityType,
      affinityValue,
      reused,
      evicted: false,
      timedOut: false,
    };
    this.#pagePool.resetConsoleErrors(pageId);
    onTabAcquired?.({ pageId: pageId ?? 'unknown' });
    const markTimeout = (err?: RenderError) => {
      if (!poolInfo.timedOut && err?.error?.title === 'Render timeout') {
        poolInfo.timedOut = true;
      }
    };

    let renderStart = Date.now();
    let response: RenderVisitResponse = {};
    let baseOptions: RenderRouteOptions = { ...(renderOptions ?? {}) };
    let didStashFileRenderData = false;
    // Per-format wall-clock of the html-route steps, recorded directly onto
    // `response.meta.diagnostics.renderFormatsMs` as each step completes so
    // every return path — including the early short-circuits — carries
    // whatever formats had run by then. A step that errors still records:
    // its time-to-failure is exactly what a triage of `renderElapsedMs`
    // wants to see. `decorateRenderErrorsWithTimings` merges its own timing
    // fields around this block without disturbing it.
    let recordFormatMs = (
      rendering: 'card' | 'file',
      format: string,
      ms: number,
    ) => {
      let meta = (response.meta ??= {});
      let diagnostics = (meta.diagnostics ??= {});
      let renderFormatsMs: NonNullable<
        RenderTimeoutDiagnostics['renderFormatsMs']
      > = (diagnostics.renderFormatsMs ??= {});
      (renderFormatsMs[rendering] ??= {})[format] = ms;
    };

    try {
      // Page acquired but untouched — tag as 'queued'. The between-pass
      // checks below use 'rendering' since by then page.evaluate has run.
      // The check lives inside the try so `finally { release() }` frees
      // the tab slot if the caller aborted during the getPage handoff.
      throwIfAborted(signal, 'queued');
      // Single CDP round-trip that sets the session auth and the
      // indexing job's id + priority on the page. Both surface to the
      // host's `_federated-search` fetch wrapper via
      // `globalThis.__boxelJobId` / `__boxelJobPriority` — the
      // realm-server's handle-search gate pairs the id with
      // `x-boxel-consuming-realm` to decide whether to consult the
      // JobScopedSearchCache, and threads the priority into
      // `LookupContext.priority` so any sub-`prerenderModule` fired by
      // `CachingDefinitionLookup` for a missed definition inherits the
      // originating priority instead of silently dropping to 0. Always
      // overwrite (including with undefined) so a tab reused across
      // multiple visits never bleeds a prior visit's values into the
      // next render.
      await page.evaluate(
        (
          sessionAuth: string,
          id: string | undefined,
          jobPriority: number | undefined,
        ) => {
          localStorage.setItem('boxel-session', sessionAuth);
          (globalThis as unknown as { __boxelJobId?: string }).__boxelJobId =
            id;
          (
            globalThis as unknown as { __boxelJobPriority?: number }
          ).__boxelJobPriority = jobPriority;
        },
        auth,
        jobId,
        priority,
      );
      // defense-in-depth: clear any stale file render data left on globalThis
      // from a prior visit before we start running passes.
      await page
        .evaluate(() => {
          delete (globalThis as any).__boxelFileRenderData;
        })
        .catch(() => {
          /* best-effort */
        });

      // Serialized options carry the pass flags into the route — the host
      // render/module routes consume these to decide which mode to run. The
      // first pass in the visit keeps any clearCache flag; subsequent passes
      // must not attempt another loader reset, so we strip it after first use.
      let clearCacheConsumed = false;
      let optionsForPass = (
        pass: 'fileExtract' | 'cardRender' | 'fileRender',
      ) => {
        let optionsForThisPass: RenderRouteOptions = {
          ...baseOptions,
          // Always set only the flag for the current pass so the host route
          // picks the right branch in #buildModel regardless of what other
          // passes are part of this visit.
          fileExtract: pass === 'fileExtract' ? true : undefined,
          fileRender: pass === 'fileRender' ? true : undefined,
          cardRender: pass === 'cardRender' ? true : undefined,
        };
        if (!clearCacheConsumed && baseOptions.clearCache) {
          optionsForThisPass.clearCache = true;
          clearCacheConsumed = true;
        } else {
          delete optionsForThisPass.clearCache;
        }
        // Clean undefined keys so serializeRenderRouteOptions stays stable.
        for (let k of Object.keys(
          optionsForThisPass,
        ) as (keyof RenderRouteOptions)[]) {
          if (optionsForThisPass[k] === undefined) {
            delete optionsForThisPass[k];
          }
        }
        return optionsForThisPass;
      };

      // ── fileExtract pass ───────────────────────────────────────────────
      if (requested.fileExtract) {
        let extractOptions = optionsForPass('fileExtract');
        let serializedOptions = serializeRenderRouteOptions(extractOptions);
        let captureOptions: CaptureOptions = {
          expectedId: url,
          expectedNonce: String(++this.#nonce),
          simulateTimeoutMs: opts?.simulateTimeoutMs,
          timeoutMs: opts?.timeoutMs,
        };
        let capture = await withTimeout(
          page,
          async () => {
            await transitionTo(
              page,
              'render.file-extract',
              url,
              captureOptions.expectedNonce!,
              serializedOptions,
            );
            return await captureFileExtract(page, captureOptions);
          },
          opts?.timeoutMs,
          this.#profileContext(affinityKey, url, 'file-extract', jobId),
        );
        let extractResponse: FileExtractResponse;
        if (isRenderError(capture)) {
          let renderError = capture as RenderError;
          markTimeout(renderError);
          if (
            await this.#maybeEvict(
              affinityKey,
              'visit file extract',
              renderError,
            )
          ) {
            poolInfo.evicted = true;
          }
          extractResponse = {
            id: url,
            nonce: captureOptions.expectedNonce!,
            status: 'error',
            searchDoc: null,
            deps: renderError.error.deps ?? [],
            error: renderError,
          };
          if (poolInfo.evicted) {
            response.fileExtract = extractResponse;
            response.pageUnusableError = renderError;
            return this.#finalizeVisit(
              response,
              pageId,
              renderStart,
              launchMs,
              waits,
              poolInfo,
            );
          }
          if (this.#isAuthError(renderError)) {
            // Auth failure means the caller isn't allowed — the page itself
            // is still healthy. Record the per-pass error and short-circuit
            // subsequent passes (they'd hit the same auth failure) without
            // marking the page unusable.
            response.fileExtract = extractResponse;
            return this.#finalizeVisit(
              response,
              pageId,
              renderStart,
              launchMs,
              waits,
              poolInfo,
            );
          }
        } else {
          let fileCapture = capture as FileExtractCapture;
          try {
            extractResponse = JSON.parse(
              fileCapture.value,
            ) as FileExtractResponse;
            if (extractResponse.status !== fileCapture.status) {
              let renderError = buildInvalidFileExtractResponseError(
                page,
                `file extract status mismatch (${fileCapture.status} vs ${extractResponse.status})`,
                { title: 'Invalid file extract response', evict: true },
              );
              markTimeout(renderError);
              if (
                await this.#maybeEvict(
                  affinityKey,
                  'visit file extract',
                  renderError,
                )
              ) {
                poolInfo.evicted = true;
              }
              extractResponse = {
                id: url,
                nonce: fileCapture.nonce ?? captureOptions.expectedNonce!,
                status: 'error',
                searchDoc: null,
                deps: renderError.error.deps ?? [],
                error: renderError,
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
              await this.#maybeEvict(
                affinityKey,
                'visit file extract',
                renderError,
              )
            ) {
              poolInfo.evicted = true;
            }
            extractResponse = {
              id: url,
              nonce: fileCapture.nonce ?? captureOptions.expectedNonce!,
              status: 'error',
              searchDoc: null,
              deps: renderError.error.deps ?? [],
              error: renderError,
            };
          }
        }
        extractResponse.error = this.#mergeConsoleErrors(
          pageId,
          extractResponse.error,
        );
        response.fileExtract = extractResponse;
        if (poolInfo.evicted) {
          response.pageUnusableError =
            extractResponse.error ?? response.pageUnusableError;
          return this.#finalizeVisit(
            response,
            pageId,
            renderStart,
            launchMs,
            waits,
            poolInfo,
          );
        }
      }

      // ── cardRender pass ────────────────────────────────────────────────
      throwIfAborted(signal, 'rendering');
      if (requested.cardRender) {
        let cardOptions = optionsForPass('cardRender');
        let serializedOptions = serializeRenderRouteOptions(cardOptions);
        let optionsSegment = encodeURIComponent(serializedOptions);
        let nonce = String(++this.#nonce);
        let captureOptions: CaptureOptions = {
          expectedId: url.replace(/\.json$/i, ''),
          expectedNonce: nonce,
          simulateTimeoutMs: opts?.simulateTimeoutMs,
          timeoutMs: opts?.timeoutMs,
        };
        if (runHtmlSteps) {
          reproduceLog.debug(
            `manually visit prerendered url ${url} at: ${this.#boxelHostURL}/render/${encodeURIComponent(url)}/${nonce}/${optionsSegment}/html/isolated/0 with boxel-session = ${auth}`,
          );
        }

        let cardError: RenderError | undefined;
        let cardShortCircuit = false;
        let isolatedHTML: string | null = null;
        let iconHTML: string | null = null;
        let capturedDeps: string[] | null = null;
        let applyStepError = (stepError: RenderError, evicted: boolean) => {
          cardError = cardError ?? stepError;
          markTimeout(stepError);
          if (evicted) {
            poolInfo.evicted = true;
            cardShortCircuit = true;
          }
          if (this.#isAuthError(cardError)) {
            cardShortCircuit = true;
          }
        };
        let runTimedStep = async <T>(
          step: string,
          fn: () => Promise<T | RenderError>,
          format?: string,
        ): Promise<T | undefined> => {
          if (cardShortCircuit) {
            return;
          }
          let stepStart = Date.now();
          let stepResult = await this.#step(affinityKey, step, () =>
            withTimeout(
              page,
              fn,
              opts?.timeoutMs,
              this.#profileContext(affinityKey, url, step, jobId),
            ),
          );
          if (format) {
            recordFormatMs('card', format, Date.now() - stepStart);
          }
          if (stepResult.ok) {
            return stepResult.value as T;
          }
          applyStepError(stepResult.error, stepResult.evicted);
          return;
        };

        if (runHtmlSteps) {
          let isolatedStart = Date.now();
          let isolatedResult = await withTimeout(
            page,
            async () => {
              await transitionTo(
                page,
                'render.html',
                url,
                nonce,
                serializedOptions,
                'isolated',
                '0',
              );
              return await renderHTML(page, 'isolated', 0, captureOptions);
            },
            opts?.timeoutMs,
            this.#profileContext(affinityKey, url, 'card isolated/0', jobId),
          );
          recordFormatMs('card', 'isolated', Date.now() - isolatedStart);
          if (isRenderError(isolatedResult)) {
            cardShortCircuit = true;
            let renderError = isolatedResult as RenderError;
            let evicted = await this.#maybeEvict(
              affinityKey,
              'visit card isolated render',
              renderError,
            );
            applyStepError(renderError, evicted);
          } else {
            isolatedHTML = isolatedResult as string;
          }
          if (visitType === 'prerender-html' && !cardShortCircuit) {
            // The card's runtime deps normally ride on render.meta, which a
            // prerender-html visit never runs. The render route publishes the
            // settle-time dependency snapshot (unresolved form) on a global;
            // read it here so the HTML rendering still reports what it
            // pulled in — the indexing job unions this with the index
            // visit's meta deps.
            capturedDeps = await this.#readCapturedDeps(page);
          }
        } else {
          // An index visit never touches the html route, so the icon render
          // is its entry into the render app; subsequent steps are in-page
          // child transitions.
          let iconResult = await withTimeout(
            page,
            async () => {
              await transitionTo(
                page,
                'render.icon',
                url,
                nonce,
                serializedOptions,
              );
              return await renderIcon(page, captureOptions);
            },
            opts?.timeoutMs,
            this.#profileContext(affinityKey, url, 'card icon', jobId),
          );
          if (isRenderError(iconResult)) {
            cardShortCircuit = true;
            let renderError = iconResult as RenderError;
            let evicted = await this.#maybeEvict(
              affinityKey,
              'visit card icon render',
              renderError,
            );
            applyStepError(renderError, evicted);
          } else {
            iconHTML = iconResult as string;
          }
        }

        let emptyMeta: PrerenderMeta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
        let meta: PrerenderMeta = emptyMeta;
        let typesForAncestors: PrerenderTypes = { types: null };
        let headHTML: string | null = null;
        let atomHTML: string | null = null;
        let embeddedHTML: Record<string, string> | null = null;
        let fittedHTML: Record<string, string> | null = null;
        let markdown: string | null = null;

        if (!cardShortCircuit && runHtmlSteps) {
          const formatSteps: Array<{
            name: string;
            cb: () => Promise<string | RenderError>;
            assign: (v: string) => void;
            // html-route format key for `renderFormatsMs`; the icon step is
            // index-half work and records no format timing.
            format?: string;
          }> = [
            {
              name: 'visit card head render',
              cb: () => renderHTML(page, 'head', 0, captureOptions),
              assign: (v: string) => {
                headHTML = v;
              },
              format: 'head',
            },
            {
              name: 'visit card atom render',
              cb: () => renderHTML(page, 'atom', 0, captureOptions),
              assign: (v: string) => {
                atomHTML = v;
              },
              format: 'atom',
            },
            // The icon belongs to the index half; the fused visit renders it
            // between atom and markdown.
            ...(runIndexSteps
              ? [
                  {
                    name: 'visit card icon render',
                    cb: () => renderIcon(page, captureOptions),
                    assign: (v: string) => {
                      iconHTML = v;
                    },
                  },
                ]
              : []),
            {
              name: 'visit card markdown render',
              cb: () => renderHTML(page, 'markdown', 0, captureOptions),
              assign: (v: string) => {
                markdown = v;
              },
              format: 'markdown',
            },
          ];
          for (let step of formatSteps) {
            if (cardShortCircuit) break;
            let v = await runTimedStep<string>(step.name, step.cb, step.format);
            if (v !== undefined) step.assign(v);
          }
        }

        // The ancestor type chain drives the fitted/embedded format renders.
        // A caller that already holds the chain passes it in (the indexing
        // job forwards the index visit's types); otherwise the lightweight
        // /types route resolves it — just the chain, not the full
        // render.meta (serialized + searchDoc + deps + displayNames), which
        // belongs to the index half.
        if (!cardShortCircuit && runHtmlSteps) {
          if (cardTypes?.length) {
            typesForAncestors = { types: cardTypes };
          } else {
            let typesResult = await runTimedStep<PrerenderTypes>(
              'visit card render.types',
              () => renderTypes(page, captureOptions),
            );
            if (typesResult !== undefined) {
              typesForAncestors = typesResult;
            }
          }
        }

        if (!cardShortCircuit && runHtmlSteps && typesForAncestors.types) {
          const ancestorSteps = [
            {
              name: 'visit card fitted render',
              cb: () =>
                renderAncestors(
                  page,
                  'fitted',
                  typesForAncestors.types!,
                  captureOptions,
                ),
              assign: (v: Record<string, string>) => {
                fittedHTML = v;
              },
              format: 'fitted',
            },
            {
              name: 'visit card embedded render',
              cb: () =>
                renderAncestors(
                  page,
                  'embedded',
                  typesForAncestors.types!,
                  captureOptions,
                ),
              assign: (v: Record<string, string>) => {
                embeddedHTML = v;
              },
              format: 'embedded',
            },
          ];
          for (let step of ancestorSteps) {
            if (cardShortCircuit) break;
            let v = await runTimedStep<Record<string, string>>(
              step.name,
              step.cb,
              step.format,
            );
            if (v !== undefined) step.assign(v);
          }
        }

        if (!cardShortCircuit && runIndexSteps) {
          let finalMetaResult = await runTimedStep<PrerenderMeta>(
            'visit card render.meta',
            () => renderMeta(page, captureOptions),
          );
          if (finalMetaResult !== undefined) {
            meta = finalMetaResult;
          }
        }

        let cardResponse: RenderResponse = {
          ...(meta as PrerenderMeta),
          ...(capturedDeps ? { deps: capturedDeps } : {}),
          ...(cardError ? { error: cardError } : {}),
          iconHTML,
          isolatedHTML,
          headHTML,
          atomHTML,
          embeddedHTML,
          fittedHTML,
          markdown,
        };
        cardResponse.error = this.#mergeConsoleErrors(
          pageId,
          cardResponse.error,
        );
        response.card = cardResponse;
        if (poolInfo.evicted) {
          response.pageUnusableError =
            cardResponse.error ?? response.pageUnusableError;
          return this.#finalizeVisit(
            response,
            pageId,
            renderStart,
            launchMs,
            waits,
            poolInfo,
          );
        }
      }

      // ── fileRender pass ────────────────────────────────────────────────
      throwIfAborted(signal, 'rendering');
      if (requested.fileRender) {
        // If fileExtract ran earlier in this visit and produced a resource,
        // use it to populate fileData/types so the caller doesn't need to
        // thread extract output back through a second round-trip.
        let effectiveFileData =
          fileData ??
          (response.fileExtract?.resource && baseOptions.fileDefCodeRef
            ? {
                resource: response.fileExtract.resource,
                fileDefCodeRef: baseOptions.fileDefCodeRef,
              }
            : undefined);
        let effectiveTypes = types ?? response.fileExtract?.types ?? undefined;
        if (!effectiveFileData) {
          // Without fileData we can't populate the host route's model. This is
          // a caller error — mark the sub-response accordingly rather than
          // throwing so the other passes' results remain usable.
          response.fileRender = {
            isolatedHTML: null,
            headHTML: null,
            atomHTML: null,
            embeddedHTML: null,
            fittedHTML: null,
            iconHTML: null,
            markdown: null,
            error: {
              type: 'file-error',
              error: {
                message:
                  'prerenderVisit requested fileRender pass without fileData (and fileExtract did not supply a resource)',
                status: 500,
                additionalErrors: null,
              },
            },
          };
        } else {
          let fileOptions: RenderRouteOptions = {
            ...optionsForPass('fileRender'),
            fileDefCodeRef: effectiveFileData.fileDefCodeRef,
          };
          let serializedOptions = serializeRenderRouteOptions(fileOptions);
          let nonce = String(++this.#nonce);
          let captureOptions: CaptureOptions = {
            expectedId: url,
            expectedNonce: nonce,
            simulateTimeoutMs: opts?.simulateTimeoutMs,
            timeoutMs: opts?.timeoutMs,
          };

          // stash file data for the render route model hook to consume
          await page.evaluate((data) => {
            (globalThis as any).__boxelFileRenderData = data;
          }, effectiveFileData);
          didStashFileRenderData = true;

          let fileError: RenderError | undefined;
          let fileShortCircuit = false;
          let isolatedHTML: string | null = null;
          let headHTML: string | null = null;
          let atomHTML: string | null = null;
          let iconHTML: string | null = null;
          let embeddedHTML: Record<string, string> | null = null;
          let fittedHTML: Record<string, string> | null = null;
          let markdown: string | null = null;

          let applyStepError = (stepError: RenderError, evicted: boolean) => {
            fileError = fileError ?? stepError;
            markTimeout(stepError);
            if (evicted) {
              poolInfo.evicted = true;
              fileShortCircuit = true;
            }
            if (this.#isAuthError(fileError)) {
              fileShortCircuit = true;
            }
          };

          if (runHtmlSteps) {
            let isolatedStart = Date.now();
            let isolatedResult = await withTimeout(
              page,
              async () => {
                await transitionTo(
                  page,
                  'render.html',
                  url,
                  nonce,
                  serializedOptions,
                  'isolated',
                  '0',
                );
                return await captureResult(page, 'innerHTML', captureOptions);
              },
              opts?.timeoutMs,
              this.#profileContext(affinityKey, url, 'file isolated/0', jobId),
            );
            recordFormatMs('file', 'isolated', Date.now() - isolatedStart);
            if (isRenderError(isolatedResult)) {
              let renderError = isolatedResult as RenderError;
              let evicted = await this.#maybeEvict(
                affinityKey,
                'visit file isolated render',
                renderError,
              );
              applyStepError(renderError, evicted);
            } else {
              let capture = isolatedResult as RenderCapture;
              if (capture.status === 'ready') {
                isolatedHTML = capture.value;
              } else {
                let capErr = this.#captureToError(capture);
                let evicted = await this.#maybeEvict(
                  affinityKey,
                  'visit file isolated render',
                  capErr,
                );
                if (capErr) {
                  applyStepError(capErr, evicted);
                }
              }
            }
          } else {
            // The file's icon belongs to the index half, and an index visit
            // never touches the html route — so the icon render is its entry
            // into the render app for this file.
            let iconResult = await withTimeout(
              page,
              async () => {
                await transitionTo(
                  page,
                  'render.icon',
                  url,
                  nonce,
                  serializedOptions,
                );
                return await renderIcon(page, captureOptions);
              },
              opts?.timeoutMs,
              this.#profileContext(affinityKey, url, 'file icon', jobId),
            );
            if (isRenderError(iconResult)) {
              let renderError = iconResult as RenderError;
              let evicted = await this.#maybeEvict(
                affinityKey,
                'visit file icon render',
                renderError,
              );
              applyStepError(renderError, evicted);
            } else {
              iconHTML = iconResult as string;
            }
          }

          if (!fileShortCircuit && runHtmlSteps) {
            let headStart = Date.now();
            let headHTMLResult = await this.#step(
              affinityKey,
              'visit file head render',
              () =>
                withTimeout(
                  page,
                  () => renderHTML(page, 'head', 0, captureOptions),
                  opts?.timeoutMs,
                  this.#profileContext(affinityKey, url, 'file head/0', jobId),
                ),
            );
            recordFormatMs('file', 'head', Date.now() - headStart);
            if (headHTMLResult.ok) {
              headHTML = headHTMLResult.value as string;
            } else {
              applyStepError(headHTMLResult.error, headHTMLResult.evicted);
            }
          }

          if (!fileShortCircuit && runHtmlSteps) {
            let steps: Array<{
              name: string;
              cb: () => Promise<string | Record<string, string> | RenderError>;
              assign: (value: string | Record<string, string>) => void;
              // html-route format key for `renderFormatsMs`; the icon step
              // is index-half work and records no format timing.
              format?: string;
            }> = [];

            if (effectiveTypes && effectiveTypes.length > 0) {
              steps.push(
                {
                  name: 'visit file fitted render',
                  cb: () =>
                    renderAncestors(
                      page,
                      'fitted',
                      effectiveTypes!,
                      captureOptions,
                    ),
                  assign: (v) => {
                    fittedHTML = v as Record<string, string>;
                  },
                  format: 'fitted',
                },
                {
                  name: 'visit file embedded render',
                  cb: () =>
                    renderAncestors(
                      page,
                      'embedded',
                      effectiveTypes!,
                      captureOptions,
                    ),
                  assign: (v) => {
                    embeddedHTML = v as Record<string, string>;
                  },
                  format: 'embedded',
                },
              );
            }

            steps.push({
              name: 'visit file atom render',
              cb: () => renderHTML(page, 'atom', 0, captureOptions),
              assign: (v) => {
                atomHTML = v as string;
              },
              format: 'atom',
            });
            if (runIndexSteps) {
              // The icon belongs to the index half; the fused visit renders
              // it between atom and markdown.
              steps.push({
                name: 'visit file icon render',
                cb: () => renderIcon(page, captureOptions),
                assign: (v) => {
                  iconHTML = v as string;
                },
              });
            }
            steps.push({
              name: 'visit file markdown render',
              cb: () => renderHTML(page, 'markdown', 0, captureOptions),
              assign: (v) => {
                markdown = v as string;
              },
              format: 'markdown',
            });

            for (let step of steps) {
              if (fileShortCircuit) break;
              let stepStart = Date.now();
              let res = await this.#step(affinityKey, step.name, () =>
                withTimeout(
                  page,
                  step.cb,
                  opts?.timeoutMs,
                  this.#profileContext(affinityKey, url, step.name, jobId),
                ),
              );
              if (step.format) {
                recordFormatMs('file', step.format, Date.now() - stepStart);
              }
              if (res.ok) {
                step.assign(res.value);
              } else {
                applyStepError(res.error, res.evicted);
                if (fileShortCircuit) break;
              }
            }
          }

          let fileResponse: FileRenderResponse = {
            ...(fileError ? { error: fileError } : {}),
            iconHTML,
            isolatedHTML,
            headHTML,
            atomHTML,
            embeddedHTML,
            fittedHTML,
            markdown,
          };
          fileResponse.error = this.#mergeConsoleErrors(
            pageId,
            fileResponse.error,
          );
          response.fileRender = fileResponse;
          if (poolInfo.evicted) {
            response.pageUnusableError =
              fileResponse.error ?? response.pageUnusableError;
          }
        }
      }

      return this.#finalizeVisit(
        response,
        pageId,
        renderStart,
        launchMs,
        waits,
        poolInfo,
      );
    } finally {
      if (didStashFileRenderData) {
        await page
          .evaluate(() => {
            delete (globalThis as any).__boxelFileRenderData;
          })
          .catch(() => {
            /* best-effort cleanup */
          });
      }
      release();
    }
  }

  #finalizeVisit(
    response: RenderVisitResponse,
    pageId: string,
    renderStart: number,
    launchMs: number,
    waits: LaunchWaits,
    poolInfo: PoolInfo,
  ): {
    response: RenderVisitResponse;
    timings: Timings;
    pool: PoolInfo;
  } {
    if (response.pageUnusableError) {
      response.pageUnusableError = this.#mergeConsoleErrors(
        pageId,
        response.pageUnusableError,
      );
    }
    return {
      response,
      timings: { launchMs, renderMs: Date.now() - renderStart, waits },
      pool: poolInfo,
    };
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

  // Settle-time runtime-dependency snapshot the render route publishes on
  // `globalThis.__boxelRenderCapturedDeps` (already in unresolved/prefix
  // form). Best-effort: a page that died mid-read reports null rather than
  // failing the visit.
  async #readCapturedDeps(page: Page): Promise<string[] | null> {
    try {
      let deps = await page.evaluate(
        () =>
          (globalThis as { __boxelRenderCapturedDeps?: unknown })
            .__boxelRenderCapturedDeps ?? null,
      );
      if (!Array.isArray(deps)) {
        return null;
      }
      return deps.filter((dep): dep is string => typeof dep === 'string');
    } catch (_e) {
      return null;
    }
  }

  async #step<T>(
    affinityKey: string,
    step: string,
    fn: () => Promise<T | RenderError>,
  ): Promise<
    { ok: true; value: T } | { ok: false; error: RenderError; evicted: boolean }
  > {
    log.debug(`prerender step start affinity=${affinityKey} step=${step}`);
    let r = await fn();
    if (isRenderError(r)) {
      let evicted = await this.#maybeEvict(affinityKey, step, r as RenderError);
      log.debug(
        `prerender step error affinity=${affinityKey} step=${step} status=${
          (r as RenderError).error?.status
        } title=${(r as RenderError).error?.title} evicted=${evicted}`,
      );
      return { ok: false, error: r as RenderError, evicted };
    }
    log.debug(`prerender step done affinity=${affinityKey} step=${step}`);
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
      title: titleForConsoleErrorEntry(entry),
      message: this.#formatConsoleError(entry),
      stack: this.#formatConsoleErrorStack(entry),
      additionalErrors: null,
    }));
  }

  // Assembles a Node-style stack string (header line +
  // `    at <url>:<line>:<col>` frames) from whatever frames CDP
  // attached to the entry. Used for both console-error and
  // runtime-exception sources — the header line distinguishes them.
  // For the desync-detector path (host-side surfacing of a render
  // wedge with no JS-observable throw), this is the only lead back
  // at the offending template / getter / helper, since Chrome
  // populates the stack on its "Uncaught (in promise)" console line.
  #formatConsoleErrorStack(entry: ConsoleErrorEntry): string | undefined {
    let frames = entry.stackFrames;
    if (!Array.isArray(frames) || frames.length === 0) {
      return undefined;
    }
    let lines: string[] = [];
    for (let frame of frames) {
      if (!frame?.url) {
        continue;
      }
      let segments: number[] = [];
      if (typeof frame.lineNumber === 'number') {
        segments.push(frame.lineNumber + 1);
      }
      if (typeof frame.columnNumber === 'number') {
        segments.push(frame.columnNumber + 1);
      }
      let suffix = segments.length ? `:${segments.join(':')}` : '';
      lines.push(`    at ${frame.url}${suffix}`);
    }
    if (lines.length === 0) {
      return undefined;
    }
    let header = stackHeaderForConsoleErrorEntry(entry);
    return [`${header}: ${entry.text}`, ...lines].join('\n');
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

  #incEvictionMetric(affinityKey: string, reason: 'unusable' | 'timeout') {
    let current = this.#evictionMetrics.byAffinity.get(affinityKey) ?? {
      unusable: 0,
      timeout: 0,
    };
    current[reason]++;
    this.#evictionMetrics.byAffinity.set(affinityKey, current);
  }

  async #maybeEvict(
    affinityKey: string,
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
    await this.#evictAffinity(affinityKey, step, reason);
    return true;
  }

  async #evictAffinity(
    affinityKey: string,
    step: string,
    reason: 'timeout' | 'unusable',
  ) {
    this.#incEvictionMetric(affinityKey, reason);
    log.warn(
      `Evicting affinity %s due to %s during %s`,
      affinityKey,
      reason,
      step,
    );
    try {
      // CS-10817 step 6: the tab is dead but the realm's cache/auth
      // in the BrowserContext is still valid — keep it as an orphan
      // so the next visit for this affinity spawns a fresh page in
      // the warm context and skips the cold module-source waterfall.
      await this.#pagePool.disposeAffinity(affinityKey, {
        awaitIdle: false,
        retainConsoleErrors: true,
        retainSharedContext: true,
      });
    } catch (e) {
      log.warn(`Error disposing affinity %s on %s:`, affinityKey, reason, e);
    }
  }
}
