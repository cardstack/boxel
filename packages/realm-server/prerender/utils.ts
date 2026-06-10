import {
  cleanCapturedHTML,
  delay,
  logger,
  type PrerenderMeta,
  type PrerenderTypes,
  type RenderError,
  type RenderTimeoutDiagnostics,
} from '@cardstack/runtime-common';
import { prerenderRenderTimeoutMs } from './prerender-constants.ts';
import { getPendingNetworkRequests } from './network-inflight-tracker.ts';
import {
  profileWindow,
  formatTopFrames,
  getAffinityProfileTargets,
  shouldProfileAffinity,
} from './cpu-profiler.ts';
import { fromAffinityKey } from './affinity.ts';
import { captureTraceStream } from './trace-capture.ts';
import {
  ensureHeapSampling,
  captureHeapSamplingProfile,
} from './heap-sampler.ts';
import {
  artifactSinkEnabled,
  shouldCaptureCpuProfile,
  shouldCaptureTrace,
  shouldCaptureHeap,
  uploadArtifact,
  type ArtifactKeyParts,
} from './artifact-sink.ts';

import type { CDPSession, Page } from 'puppeteer';

const log = logger('prerenderer');

// Number of renders this prerender process is running concurrently.
// Every render funnels through `withTimeout`, which increments on entry
// and decrements when the race resolves, so on the timeout path this is
// the live count of co-tenant renders competing for the same Node
// process and shared Chrome — the signal that distinguishes a render
// starved by neighbours from one stalled on its own.
let activeRenderCount = 0;

// CDP `Performance` reports cumulative ScriptDuration / TaskDuration in
// seconds and JSHeapUsedSize in bytes. We sample twice across this
// window and diff against wall-clock to derive the busy fractions, so
// the window must be long enough for V8 to accrue a meaningful delta
// but short enough not to materially extend the already-timed-out call.
const CPU_SAMPLE_WINDOW_MS = 750;
// Budget for the main-thread responsiveness probe. If a trivial
// `page.evaluate` can't return inside this, the JS thread is wedged.
const RESPONSIVENESS_PROBE_MS = 2000;
// How long the timeout-path CPU sampler runs. At the timeout cap a
// wedged render is still spinning, so a short window of out-of-process
// sampling catches the hot loop. Kept brief because this runs while the
// caller is owed a RenderError — long enough for the profiler to collect
// meaningful self-time, short enough not to materially extend teardown.
const TIMEOUT_PATH_CPU_SAMPLE_MS = 1500;
// Sampling interval for the affinity-scoped trigger. Finer-grained than
// the timeout sampler's default because that trigger is opt-in on a
// single deliberately-targeted realm, where the extra resolution is
// worth the cost.
const AFFINITY_PROFILE_SAMPLING_INTERVAL_US = 250;
export const cardRenderTimeout = prerenderRenderTimeoutMs;
export const renderTimeoutMs = cardRenderTimeout;

export type RenderStatus = 'ready' | 'error' | 'unusable';

export interface RenderCapture {
  status: RenderStatus;
  value: string;
  alive?: 'true' | 'false';
  id?: string;
  nonce?: string;
  timedOut?: boolean;
}

export interface CaptureOptions {
  expectedId?: string;
  expectedNonce?: string;
  simulateTimeoutMs?: number;
  timeoutMs?: number;
}

export interface ModuleCapture {
  status: 'ready' | 'error';
  value: string;
  id?: string;
  nonce?: string;
}

export interface FileExtractCapture {
  status: 'ready' | 'error';
  value: string;
  id?: string;
  nonce?: string;
}

type TransitionParam =
  | string
  | {
      queryParams?: Record<string, string>;
    };

export async function transitionTo(
  page: Page,
  routeName: string,
  ...params: TransitionParam[]
): Promise<void> {
  await page.evaluate(
    (routeName, params) => {
      (globalThis as any).boxelTransitionTo(routeName, ...params);
    },
    routeName,
    params,
  );
}

export function buildCommandRunnerURL(
  page: Page,
  nonce: string,
  requestId: string,
): string {
  let origin = page.url();
  try {
    origin = new URL(origin).origin;
  } catch (error) {
    let detail =
      error instanceof Error ? error.message : 'Unknown URL parsing error';
    throw new Error(
      `Could not build command-runner URL from page URL "${origin}": ${detail}`,
    );
  }
  return `${origin}/command-runner/${encodeURIComponent(requestId)}/${encodeURIComponent(
    nonce,
  )}`;
}

export async function renderHTML(
  page: Page,
  format: string,
  ancestorLevel: number,
  opts?: CaptureOptions,
): Promise<string | RenderError> {
  log.debug(
    `renderHTML start format=${format} ancestorLevel=${ancestorLevel} url=${page.url()}`,
  );
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  await waitForRoutePathSuffix(page, `/html/${format}/${ancestorLevel}`, opts);
  await waitForPrerenderSettle(page);
  log.debug(
    `renderHTML capture format=${format} ancestorLevel=${ancestorLevel} url=${page.url()}`,
  );
  let captureMode: 'textContent' | 'innerHTML' | 'outerHTML';
  if (format === 'markdown') {
    // Markdown renders into a whitespace-preserving container (see CS-10781);
    // we capture textContent so the extracted string matches what the template
    // author wrote, without HTML markup or whitespace collapsing.
    captureMode = 'textContent';
  } else if (['isolated', 'atom', 'head'].includes(format)) {
    captureMode = 'innerHTML';
  } else {
    captureMode = 'outerHTML';
  }
  let result = await captureResult(page, captureMode, opts);
  log.debug(
    `renderHTML captured format=${format} ancestorLevel=${ancestorLevel} status=${result.status} id=${result.id} nonce=${result.nonce}`,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.html');
  }
  log.debug(
    `renderHTML success format=${format} ancestorLevel=${ancestorLevel} length=${result.value.length}`,
  );
  // Markdown output is plain text; the Ember-id/empty-data-attr cleanup only
  // makes sense for HTML captures, so pass markdown through untouched.
  return format === 'markdown' ? result.value : cleanCapturedHTML(result.value);
}

export async function renderIcon(
  page: Page,
  opts?: CaptureOptions,
): Promise<string | RenderError> {
  log.debug(`renderIcon start url=${page.url()}`);
  await transitionTo(page, 'render.icon');
  await waitForRoutePathSuffix(page, '/icon', opts);
  await waitForPrerenderSettle(page);
  log.debug(`renderIcon capture url=${page.url()}`);
  let result = await captureResult(page, 'outerHTML', opts);
  log.debug(
    `renderIcon captured status=${result.status} id=${result.id} nonce=${result.nonce}`,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.icon');
  }
  log.debug(`renderIcon success length=${result.value.length}`);
  return cleanCapturedHTML(result.value);
}

export async function renderMeta(
  page: Page,
  opts?: CaptureOptions,
): Promise<PrerenderMeta | RenderError> {
  log.debug(`renderMeta start url=${page.url()}`);
  await transitionTo(page, 'render.meta');
  await waitForRoutePathSuffix(page, '/meta', opts);
  await waitForPrerenderSettle(page);
  log.debug(`renderMeta capture url=${page.url()}`);
  let result = await captureResult(page, 'textContent', opts);
  log.debug(
    `renderMeta captured status=${result.status} id=${result.id} nonce=${result.nonce}`,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.meta');
  }
  if (opts?.expectedId && result.id && result.id !== opts.expectedId) {
    return buildInvalidRenderResponseError(
      page,
      `render.meta captured stale prerender output for ${result.id} (expected ${opts.expectedId})`,
      { title: 'Stale render response', evict: true },
    );
  }
  if (
    opts?.expectedNonce &&
    result.nonce &&
    result.nonce !== opts.expectedNonce
  ) {
    return buildInvalidRenderResponseError(
      page,
      `render.meta captured stale prerender output for nonce ${result.nonce} (expected ${opts.expectedNonce})`,
      { title: 'Stale render response', evict: true },
    );
  }
  try {
    return JSON.parse(result.value) as PrerenderMeta;
  } catch {
    await page.evaluate(() => {
      let el = document.querySelector('[data-prerender]') as HTMLElement;
      console.log(
        `capturing HTML for unknown meta result\n${el.outerHTML.trim()}`,
      );
    });
    return buildInvalidRenderResponseError(
      page,
      `render.meta returned a non-JSON response: ${result.value}`,
      { title: 'Invalid render meta response' },
    );
  }
}

// Lightweight first pass: the runner only needs the ancestor type chain
// to drive fitted/embedded format renders. Hitting /meta for that
// pulled in a full serializeCard + searchDoc walk we then threw away;
// /types returns just the type list. The full render.meta still runs
// after the format renders, where its searchDoc legitimately depends
// on the linksTo / linksToMany fields those renders marked as "used".
export async function renderTypes(
  page: Page,
  opts?: CaptureOptions,
): Promise<PrerenderTypes | RenderError> {
  log.debug(`renderTypes start url=${page.url()}`);
  await transitionTo(page, 'render.types');
  await waitForRoutePathSuffix(page, '/types', opts);
  await waitForPrerenderSettle(page);
  log.debug(`renderTypes capture url=${page.url()}`);
  let result = await captureResult(page, 'textContent', opts);
  log.debug(
    `renderTypes captured status=${result.status} id=${result.id} nonce=${result.nonce}`,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.types');
  }
  if (opts?.expectedId && result.id && result.id !== opts.expectedId) {
    return buildInvalidRenderResponseError(
      page,
      `render.types captured stale prerender output for ${result.id} (expected ${opts.expectedId})`,
      { title: 'Stale render response', evict: true },
    );
  }
  if (
    opts?.expectedNonce &&
    result.nonce &&
    result.nonce !== opts.expectedNonce
  ) {
    return buildInvalidRenderResponseError(
      page,
      `render.types captured stale prerender output for nonce ${result.nonce} (expected ${opts.expectedNonce})`,
      { title: 'Stale render response', evict: true },
    );
  }
  try {
    return JSON.parse(result.value) as PrerenderTypes;
  } catch {
    await page.evaluate(() => {
      let el = document.querySelector('[data-prerender]') as HTMLElement;
      console.log(
        `capturing HTML for unknown types result\n${el.outerHTML.trim()}`,
      );
    });
    return buildInvalidRenderResponseError(
      page,
      `render.types returned a non-JSON response: ${result.value}`,
      { title: 'Invalid render types response' },
    );
  }
}

async function waitForRoutePathSuffix(
  page: Page,
  suffix: string,
  opts?: CaptureOptions,
): Promise<void> {
  let waitTimeoutMs = effectiveRouteWaitTimeoutMs(opts);
  log.debug(`waitForRoutePathSuffix start suffix=${suffix} url=${page.url()}`);
  await page.waitForFunction(
    (
      targetSuffix: string,
      expectedId: string | null,
      expectedNonce: string | null,
    ) => {
      if (window.location.pathname.endsWith(targetSuffix)) {
        return true;
      }

      // If the render has already entered a terminal state (error/unusable),
      // do not wait for a route suffix that may never arrive.
      let elements = Array.from(
        document.querySelectorAll('[data-prerender]'),
      ) as HTMLElement[];
      if (!elements.length) {
        let errorElement = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        if (!errorElement) {
          return false;
        }
        let raw = errorElement.textContent ?? errorElement.innerHTML ?? '';
        return raw.trim().length > 0;
      }
      for (let element of elements) {
        let status = element.dataset.prerenderStatus ?? '';
        let errorElement = element.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        let errorText = (
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          ''
        ).trim();
        let isTerminal =
          status === 'error' || status === 'unusable' || errorText.length > 0;
        if (!isTerminal) {
          continue;
        }
        if (
          expectedId &&
          element.dataset.prerenderId &&
          element.dataset.prerenderId !== expectedId
        ) {
          continue;
        }
        if (
          expectedNonce &&
          element.dataset.prerenderNonce &&
          element.dataset.prerenderNonce !== expectedNonce
        ) {
          continue;
        }
        return true;
      }
      return false;
    },
    { timeout: waitTimeoutMs },
    suffix,
    opts?.expectedId ?? null,
    opts?.expectedNonce ?? null,
  );
  let matchedByPath = false;
  try {
    matchedByPath = new URL(page.url()).pathname.endsWith(suffix);
  } catch {
    matchedByPath = false;
  }
  log.debug(
    `waitForRoutePathSuffix done suffix=${suffix} url=${page.url()} matchedByPath=${matchedByPath}`,
  );
}

function effectiveRouteWaitTimeoutMs(opts?: CaptureOptions): number {
  if (typeof opts?.timeoutMs !== 'number') {
    return cardRenderTimeout;
  }

  // Keep the inner Puppeteer wait close to the caller timeout so it cannot
  // linger for the full cardRenderTimeout after withTimeout resolves, while
  // still allowing withTimeout to win the race and produce our canonical error.
  let withGrace = Math.ceil(opts.timeoutMs + 250);
  return Math.max(1, Math.min(cardRenderTimeout, withGrace));
}

async function waitForPrerenderSettle(page: Page): Promise<void> {
  log.debug(`waitForPrerenderSettle start url=${page.url()}`);
  let settleState = await page.evaluate(async () => {
    let hasTerminalPrerenderState = () => {
      let elements = Array.from(
        document.querySelectorAll('[data-prerender]'),
      ) as HTMLElement[];
      for (let element of elements) {
        let status = element.dataset.prerenderStatus ?? '';
        if (status === 'error' || status === 'unusable') {
          return true;
        }
        let errorElement = element.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        let errorText = (
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          ''
        ).trim();
        if (errorText.length > 0) {
          return true;
        }
      }
      let detachedErrorElement = document.querySelector(
        '[data-prerender-error]',
      ) as HTMLElement | null;
      if (!detachedErrorElement) {
        return false;
      }
      let detachedErrorText = (
        detachedErrorElement.textContent ??
        detachedErrorElement.innerHTML ??
        ''
      ).trim();
      return detachedErrorText.length > 0;
    };

    if (hasTerminalPrerenderState()) {
      return 'terminal-before-settle';
    }

    let settle = (globalThis as any).__waitForRenderLoadStability;
    if (typeof settle === 'function') {
      let stopPolling = false;
      let settleOutcome = settle()
        .then(() => ({ type: 'settled' as const }))
        .catch((error: unknown) => ({
          type: 'settle-rejected' as const,
          error,
        }))
        .finally(() => {
          stopPolling = true;
        });
      let waitForTerminal = async () => {
        while (!stopPolling) {
          if (hasTerminalPrerenderState()) {
            return 'terminal-during-settle';
          }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        return 'polling-stopped';
      };

      let winner = await Promise.race([settleOutcome, waitForTerminal()]);

      if (winner === 'terminal-during-settle') {
        return 'terminal-during-settle';
      }

      let finalOutcome = winner;
      if (winner === 'polling-stopped') {
        finalOutcome = await settleOutcome;
      }

      if (finalOutcome.type === 'settled') {
        return 'settled';
      }

      if (hasTerminalPrerenderState()) {
        return 'settle-rejected-terminal';
      }
      throw finalOutcome.error;
    }
    return 'missing-settle-hook';
  });
  log.debug(
    `waitForPrerenderSettle done url=${page.url()} state=${settleState}`,
  );
}

function renderCaptureToError(
  page: Page,
  capture: RenderCapture,
  context: string,
): RenderError {
  try {
    let error = JSON.parse(capture.value) as RenderError;
    error.evict = capture.status === 'unusable';
    return error;
  } catch {
    let title =
      context === 'render.meta'
        ? 'Invalid render meta response'
        : 'Invalid render response';
    return buildInvalidRenderResponseError(
      page,
      `${context} returned an invalid error payload: ${capture.value}`,
      {
        evict: capture.status === 'unusable',
        title,
      },
    );
  }
}

function buildInvalidRenderResponseError(
  page: Page,
  message: string,
  options?: { title?: string; evict?: boolean },
): RenderError {
  let id: string | null = null;
  try {
    let pathname = new URL(page.url()).pathname;
    let match = /\/render\/([^/]+)\//.exec(pathname);
    id = match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    id = null;
  }
  let deps = fallbackRenderDeps(id);
  return {
    type: 'instance-error',
    error: {
      id,
      status: 500,
      title: options?.title ?? 'Invalid render response',
      message,
      additionalErrors: null,
      deps,
    },
    ...(options?.evict ? { evict: true } : {}),
  };
}

function fallbackRenderDeps(id: string | null): string[] {
  if (!id) {
    return [];
  }
  let deps = new Set<string>([id]);
  if (id.endsWith('.json')) {
    deps.add(id.replace(/\.json$/, ''));
  } else {
    deps.add(`${id}.json`);
  }
  return [...deps];
}

export function buildInvalidModuleResponseError(
  page: Page,
  message: string,
  options?: { title?: string; evict?: boolean },
): RenderError {
  let id: string | null = null;
  try {
    let pathname = new URL(page.url()).pathname;
    let match = /\/module\/([^/]+)\//.exec(pathname);
    id = match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    id = null;
  }
  return {
    type: 'module-error',
    error: {
      id,
      status: 500,
      title: options?.title ?? 'Invalid module response',
      message,
      additionalErrors: null,
    },
    ...(options?.evict ? { evict: true } : {}),
  };
}

export async function renderAncestors(
  page: Page,
  format: 'embedded' | 'fitted',
  types: string[],
  opts?: CaptureOptions,
): Promise<Record<string, string> | RenderError> {
  let ancestors: Record<string, string> = {};
  for (let i = 0; i < types.length; i++) {
    let res = await renderHTML(page, format, i, opts);
    if (isRenderError(res)) return res;
    ancestors[types[i]] = res as string;
  }
  return ancestors;
}

export async function captureModule(
  page: Page,
  opts?: CaptureOptions,
): Promise<ModuleCapture | RenderError> {
  try {
    await page.waitForFunction(
      (expectedId: string | null, expectedNonce: string | null) => {
        let container = document.querySelector(
          '[data-prerender-module]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.dataset.prerenderModuleStatus ?? '';
        let id = container.dataset.prerenderModuleId ?? null;
        let nonce = container.dataset.prerenderModuleNonce ?? null;
        if (expectedId && id !== expectedId) {
          return false;
        }
        if (expectedNonce && nonce !== expectedNonce) {
          return false;
        }
        if (!status) {
          return false;
        }
        if (!id || !nonce) {
          return false;
        }
        let pre = container.querySelector('pre');
        let value = pre?.textContent ?? '';
        return value.trim().length > 0;
      },
      { timeout: cardRenderTimeout },
      opts?.expectedId ?? null,
      opts?.expectedNonce ?? null,
    );
  } catch (_e) {
    return buildInvalidModuleResponseError(
      page,
      'module prerender timed out waiting for module output',
      { title: 'Module capture timeout', evict: true },
    );
  }

  let capture = await page.evaluate(() => {
    let container = document.querySelector(
      '[data-prerender-module]',
    ) as HTMLElement | null;
    if (!container) {
      return null;
    }
    let pre = container.querySelector('pre');
    let value = pre?.textContent ?? '';
    let status = (container.dataset.prerenderModuleStatus ?? 'ready') as
      | 'ready'
      | 'error';
    return {
      status,
      value,
      id: container.dataset.prerenderModuleId ?? undefined,
      nonce: container.dataset.prerenderModuleNonce ?? undefined,
    } satisfies ModuleCapture;
  });

  if (!capture) {
    return buildInvalidModuleResponseError(
      page,
      'module prerender did not produce output',
      { title: 'Invalid module response' },
    );
  }

  if (opts?.expectedId && capture.id !== opts.expectedId) {
    return buildInvalidModuleResponseError(
      page,
      `module prerender captured stale output for ${capture.id ?? 'unknown id'} (expected ${opts.expectedId})`,
      { title: 'Stale module response', evict: true },
    );
  }
  if (opts?.expectedNonce && capture.nonce !== opts.expectedNonce) {
    return buildInvalidModuleResponseError(
      page,
      `module prerender captured stale nonce ${capture.nonce ?? 'unknown'} (expected ${opts.expectedNonce})`,
      { title: 'Stale module response', evict: true },
    );
  }

  if (opts?.simulateTimeoutMs) {
    await delay(opts.simulateTimeoutMs);
  }

  return capture;
}

export async function captureFileExtract(
  page: Page,
  opts?: CaptureOptions,
): Promise<FileExtractCapture | RenderError> {
  try {
    await page.waitForFunction(
      (expectedId: string | null, expectedNonce: string | null) => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.dataset.prerenderFileExtractStatus ?? '';
        let id = container.dataset.prerenderFileExtractId ?? null;
        let nonce = container.dataset.prerenderFileExtractNonce ?? null;
        if (expectedId && id !== expectedId) {
          return false;
        }
        if (expectedNonce && nonce !== expectedNonce) {
          return false;
        }
        if (!status) {
          return false;
        }
        if (!id || !nonce) {
          return false;
        }
        let pre = container.querySelector('pre');
        let value = pre?.textContent ?? '';
        return value.trim().length > 0;
      },
      { timeout: cardRenderTimeout },
      opts?.expectedId ?? null,
      opts?.expectedNonce ?? null,
    );
  } catch (_e) {
    return buildInvalidFileExtractResponseError(
      page,
      'file extract timed out waiting for output',
      { title: 'File extract capture timeout', evict: true },
    );
  }

  let capture = await page.evaluate(() => {
    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    if (!container) {
      return null;
    }
    let pre = container.querySelector('pre');
    let value = pre?.textContent ?? '';
    let status = (container.dataset.prerenderFileExtractStatus ?? 'ready') as
      | 'ready'
      | 'error';
    return {
      status,
      value,
      id: container.dataset.prerenderFileExtractId ?? undefined,
      nonce: container.dataset.prerenderFileExtractNonce ?? undefined,
    } satisfies FileExtractCapture;
  });

  if (!capture) {
    return buildInvalidFileExtractResponseError(
      page,
      'file extract did not produce output',
      { title: 'Invalid file extract response' },
    );
  }

  if (opts?.expectedId && capture.id !== opts.expectedId) {
    return buildInvalidFileExtractResponseError(
      page,
      `file extract captured stale output for ${capture.id ?? 'unknown id'} (expected ${opts.expectedId})`,
      { title: 'Stale file extract response', evict: true },
    );
  }
  if (opts?.expectedNonce && capture.nonce !== opts.expectedNonce) {
    return buildInvalidFileExtractResponseError(
      page,
      `file extract captured stale nonce ${capture.nonce ?? 'unknown'} (expected ${opts.expectedNonce})`,
      { title: 'Stale file extract response', evict: true },
    );
  }

  if (opts?.simulateTimeoutMs) {
    await delay(opts.simulateTimeoutMs);
  }

  return capture;
}

export function buildInvalidFileExtractResponseError(
  page: Page,
  message: string,
  options?: { title?: string; evict?: boolean },
): RenderError {
  let id: string | null = null;
  try {
    let pathname = new URL(page.url()).pathname;
    let match = /\/render\/([^/]+)\//.exec(pathname);
    id = match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    id = null;
  }
  return {
    type: 'file-error',
    error: {
      id,
      status: 500,
      title: options?.title ?? 'Invalid file extract response',
      message,
      additionalErrors: null,
    },
    ...(options?.evict ? { evict: true } : {}),
  };
}

// captureResult is only used by card prerenders. Cards surface their id/nonce
// through `[data-prerender]` elements, but those attributes can appear after
// the DOM has settled so we tolerate them being absent while waiting. Module
// prerenders capture via `captureModule`, which performs strict id/nonce parity
// checks once the module container is present.
export async function captureResult(
  page: Page,
  capture: 'textContent' | 'innerHTML' | 'outerHTML',
  opts?: CaptureOptions,
): Promise<RenderCapture> {
  const statuses: RenderStatus[] = ['ready', 'error', 'unusable'];
  await page.waitForFunction(
    (
      statuses: string[],
      expectedId: string | null,
      expectedNonce: string | null,
    ) => {
      let elements = Array.from(
        document.querySelectorAll('[data-prerender]'),
      ) as HTMLElement[];
      if (!elements.length) {
        let errorElement = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        if (!errorElement) {
          return false;
        }
        let raw = errorElement.textContent ?? errorElement.innerHTML ?? '';
        return raw.trim().length > 0;
      }
      let path = window.location.pathname;
      let expectingRender = path.includes('/render/');
      let targetId = expectedId;
      let targetNonce = expectedNonce;
      if (!expectingRender) {
        targetId = null;
        targetNonce = null;
      } else if (!targetId || !targetNonce) {
        try {
          let segments = path.split('/').filter(Boolean);
          let renderIdx = segments.indexOf('render');
          if (renderIdx !== -1) {
            if (!targetId && segments[renderIdx + 1]) {
              let decoded = decodeURIComponent(segments[renderIdx + 1]);
              if (decoded.endsWith('.json')) {
                decoded = decoded.slice(0, -5);
              }
              targetId = decoded;
            }
            if (!targetNonce && segments[renderIdx + 2]) {
              targetNonce = segments[renderIdx + 2];
            }
          }
        } catch {
          // ignore malformed URLs
        }
      }
      for (let element of elements) {
        let status = element.dataset.prerenderStatus ?? '';
        const errorElement = element.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        const errorText = (
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          ''
        ).trim();
        const errorHasText = errorText.length > 0;
        const hasError = errorElement !== null && errorHasText;
        if (!statuses.includes(status) && !hasError) {
          continue;
        }
        if (
          targetId &&
          element.dataset.prerenderId &&
          element.dataset.prerenderId !== targetId
        ) {
          continue;
        }
        if (
          targetNonce &&
          element.dataset.prerenderNonce &&
          element.dataset.prerenderNonce !== targetNonce
        ) {
          continue;
        }
        return true;
      }
      if (!expectingRender) {
        return elements.some((element) => {
          let status = element.dataset.prerenderStatus ?? '';
          const errorElement = element.querySelector(
            '[data-prerender-error]',
          ) as HTMLElement | null;
          const errorText = (
            errorElement?.textContent ??
            errorElement?.innerHTML ??
            ''
          ).trim();
          const errorHasText = errorText.length > 0;
          const hasError = errorElement !== null && errorHasText;
          if (statuses.includes(status)) {
            return true;
          }
          if (hasError) {
            return true;
          }
          return false;
        });
      }
      return false;
    },
    { timeout: cardRenderTimeout },
    statuses,
    opts?.expectedId ?? null,
    opts?.expectedNonce ?? null,
  );
  let result = await page.evaluate(
    (
      capture: 'textContent' | 'innerHTML' | 'outerHTML',
      statuses: string[],
      expectedId: string | null,
      expectedNonce: string | null,
    ) => {
      let elements = Array.from(
        document.querySelectorAll('[data-prerender]'),
      ) as HTMLElement[];
      let path = window.location.pathname;
      let expectingRender = path.includes('/render/');
      let targetId = expectedId;
      let targetNonce = expectedNonce;
      if (!expectingRender) {
        targetId = null;
        targetNonce = null;
      } else if (!targetId || !targetNonce) {
        try {
          let segments = path.split('/').filter(Boolean);
          let renderIdx = segments.indexOf('render');
          if (renderIdx !== -1) {
            if (!targetId && segments[renderIdx + 1]) {
              let decoded = decodeURIComponent(segments[renderIdx + 1]);
              if (decoded.endsWith('.json')) {
                decoded = decoded.slice(0, -5);
              }
              targetId = decoded;
            }
            if (!targetNonce && segments[renderIdx + 2]) {
              targetNonce = segments[renderIdx + 2];
            }
          }
        } catch {
          // ignore malformed URLs
        }
      }
      let element =
        elements.find((candidate) => {
          let status = candidate.dataset.prerenderStatus ?? '';
          const errorElement = candidate.querySelector(
            '[data-prerender-error]',
          ) as HTMLElement | null;
          const errorText = (
            errorElement?.textContent ??
            errorElement?.innerHTML ??
            ''
          ).trim();
          const errorHasText = errorText.length > 0;
          const hasError = errorElement !== null && errorHasText;
          if (!statuses.includes(status) && !hasError) {
            return false;
          }
          let candidateId =
            candidate.dataset.prerenderId ??
            errorElement?.dataset.prerenderId ??
            null;
          let candidateNonce =
            candidate.dataset.prerenderNonce ??
            errorElement?.dataset.prerenderNonce ??
            null;
          if (targetId && candidateId && candidateId !== targetId) {
            return false;
          }
          if (targetNonce && candidateNonce && candidateNonce !== targetNonce) {
            return false;
          }
          return true;
        }) ??
        elements.find((candidate) => {
          let status = candidate.dataset.prerenderStatus ?? '';
          if (statuses.includes(status)) {
            return true;
          }
          const fallbackErrorElement = candidate.querySelector(
            '[data-prerender-error]',
          ) as HTMLElement | null;
          const fallbackText = (
            fallbackErrorElement?.textContent ??
            fallbackErrorElement?.innerHTML ??
            ''
          ).trim();
          const fallbackHasError =
            fallbackErrorElement !== null && fallbackText.length > 0;
          return fallbackHasError;
        });
      let strayErrorElement: HTMLElement | null = null;
      if (!element) {
        strayErrorElement = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
      }
      if (!element && !strayErrorElement) {
        throw new Error('Unable to locate prerender result element');
      }
      if (!element && strayErrorElement) {
        let raw =
          strayErrorElement.textContent ?? strayErrorElement.innerHTML ?? '';
        let start = raw.indexOf('{');
        let end = raw.lastIndexOf('}');
        let json =
          start !== -1 && end !== -1 && end > start
            ? raw.slice(start, end + 1)
            : raw;
        return {
          status: 'error',
          value: json.trim(),
          id: strayErrorElement.getAttribute('data-prerender-id') ?? undefined,
          nonce:
            strayErrorElement.getAttribute('data-prerender-nonce') ?? undefined,
        } as RenderCapture;
      }
      let resolvedElement = element as HTMLElement;
      let statusAttr = resolvedElement.dataset.prerenderStatus ?? '';
      let alive =
        (resolvedElement.dataset.emberAlive as 'true' | 'false' | undefined) ??
        undefined;
      let errorElement = resolvedElement.querySelector(
        '[data-prerender-error]',
      ) as HTMLElement | null;
      let finalStatus: RenderStatus = statuses.includes(statusAttr)
        ? (statusAttr as RenderStatus)
        : 'error';
      if (finalStatus === 'unusable' || errorElement) {
        // Extract only the JSON payload (between the first '{' and the last '}')
        let raw =
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          resolvedElement.innerHTML ??
          '';
        let start = raw.indexOf('{');
        let end = raw.lastIndexOf('}');
        let json =
          start !== -1 && end !== -1 && end > start
            ? raw.slice(start, end + 1)
            : raw;
        let status: RenderStatus =
          finalStatus === 'unusable' ? 'unusable' : 'error';
        return {
          status,
          value: json.trim(),
          alive,
          id:
            resolvedElement.dataset.prerenderId ??
            errorElement?.dataset.prerenderId ??
            undefined,
          nonce:
            resolvedElement.dataset.prerenderNonce ??
            errorElement?.dataset.prerenderNonce ??
            undefined,
        } as RenderCapture;
      } else {
        if (capture === 'innerHTML') {
          return {
            status: finalStatus,
            value: resolvedElement.innerHTML ?? '',
            alive,
            id: resolvedElement.dataset.prerenderId ?? undefined,
            nonce: resolvedElement.dataset.prerenderNonce ?? undefined,
          } as RenderCapture;
        }
        if (capture === 'textContent') {
          // For markdown-format renders, prefer the most specific container.
          //   1. `[data-markdown-output]` (CS-10784) — emitted by the default
          //      `static markdown` fallback on CardDef/FieldDef/FileDef. The
          //      fallback also renders a hidden HTML source sibling that
          //      `display:none` does NOT exclude from `textContent`, so we
          //      MUST narrow the capture to this output node specifically;
          //      otherwise the source HTML's text would contaminate the
          //      converted markdown.
          //   2. `[data-markdown-render-container]` (CS-10781) — the route-
          //      level whitespace-preserving wrapper around any markdown
          //      template's output. Authored markdown templates render
          //      directly into this container.
          //   3. The resolved element itself — covers `renderMeta`, which
          //      uses textContent but has no markdown wrapper.
          let markdownOutput = resolvedElement.querySelector(
            '[data-markdown-output]',
          ) as HTMLElement | null;
          let markdownContainer = resolvedElement.querySelector(
            '[data-markdown-render-container]',
          ) as HTMLElement | null;
          let target = markdownOutput ?? markdownContainer ?? resolvedElement;
          return {
            status: finalStatus,
            value: target.textContent ?? '',
            alive,
            id: resolvedElement.dataset.prerenderId ?? undefined,
            nonce: resolvedElement.dataset.prerenderNonce ?? undefined,
          } as RenderCapture;
        }
        const firstChild = resolvedElement.children[0] as
          | (HTMLElement & {
              textContent: string;
              innerHTML: string;
              outerHTML: string;
            })
          | undefined;
        if (!firstChild) {
          let cardId = resolvedElement.dataset.prerenderId ?? null;
          let deps = cardId
            ? Array.from(
                new Set(
                  cardId.endsWith('.json')
                    ? [cardId, cardId.replace(/\.json$/, '')]
                    : [cardId, `${cardId}.json`],
                ),
              )
            : [];
          return {
            status: 'error',
            value: JSON.stringify({
              type: 'instance-error',
              error: {
                id: cardId,
                status: 500,
                title: 'Invalid render response',
                message:
                  '[data-prerender] has no child element to capture (render produced no root element)',
                additionalErrors: null,
                deps,
              },
            }),
            alive,
            id: resolvedElement.dataset.prerenderId ?? undefined,
            nonce: resolvedElement.dataset.prerenderNonce ?? undefined,
          } as RenderCapture;
        }
        return {
          status: finalStatus,
          value: (firstChild as any)[capture]!,
          alive,
          id: resolvedElement.dataset.prerenderId ?? undefined,
          nonce: resolvedElement.dataset.prerenderNonce ?? undefined,
        } as RenderCapture;
      }
    },
    capture,
    statuses,
    opts?.expectedId ?? null,
    opts?.expectedNonce ?? null,
  );
  if (opts?.simulateTimeoutMs) {
    await delay(opts.simulateTimeoutMs);
  }
  return result;
}

export interface ScreenshotCapture {
  base64: string;
  width: number;
  height: number;
}

// Block in the browser context until images, CSS background-image URLs, and
// fonts have finished loading, then yield one animation frame so the browser
// actually paints the result. Resolves on `error` events too — we'd rather
// screenshot a broken-image placeholder than hang the capture. Internal
// timeout (10s) guards against a slow or auth-failing image stalling the
// whole flow indefinitely.
async function waitForImagePaint(page: Page): Promise<void> {
  let log = logger('prerenderer');
  let summary = await page.evaluate(async () => {
    const TIMEOUT_MS = 10_000;
    let race = <T>(p: Promise<T>): Promise<T | 'timeout'> =>
      Promise.race([
        p,
        new Promise<'timeout'>((r) =>
          setTimeout(() => r('timeout'), TIMEOUT_MS),
        ),
      ]);

    let pendingImgs = Array.from(document.images).filter((i) => !i.complete);
    let imgWait = Promise.all(
      pendingImgs.map(
        (i) =>
          new Promise<void>((res) => {
            i.addEventListener('load', () => res(), { once: true });
            i.addEventListener('error', () => res(), { once: true });
          }),
      ),
    );

    let bgUrls = new Set<string>();
    for (let el of Array.from(document.querySelectorAll('*'))) {
      let bg = getComputedStyle(el as HTMLElement).backgroundImage;
      if (!bg || bg === 'none') continue;
      for (let m of bg.matchAll(/url\((["']?)(.+?)\1\)/g)) {
        let url = m[2];
        if (url && !url.startsWith('data:')) bgUrls.add(url);
      }
    }
    let bgWait = Promise.all(
      Array.from(bgUrls).map(
        (u) =>
          new Promise<void>((res) => {
            let probe = new Image();
            probe.addEventListener('load', () => res(), { once: true });
            probe.addEventListener('error', () => res(), { once: true });
            probe.src = u;
          }),
      ),
    );

    let fontWait = (document as any).fonts
      ? (document as any).fonts.ready
      : Promise.resolve();

    let outcome = await race(Promise.all([imgWait, bgWait, fontWait]));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return {
      pendingImgs: pendingImgs.length,
      bgUrls: bgUrls.size,
      timedOut: outcome === 'timeout',
    };
  });
  log.debug(
    `waitForImagePaint done url=${page.url()} pendingImgs=${summary.pendingImgs} bgUrls=${summary.bgUrls} timedOut=${summary.timedOut}`,
  );
}

export async function captureScreenshot(
  page: Page,
  format: 'isolated' | 'embedded',
  ancestorLevel: number,
  opts?: CaptureOptions,
): Promise<ScreenshotCapture | RenderError> {
  log.debug(
    `captureScreenshot start format=${format} ancestorLevel=${ancestorLevel} url=${page.url()}`,
  );
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  await waitForRoutePathSuffix(page, `/html/${format}/${ancestorLevel}`, opts);
  await waitForPrerenderSettle(page);
  // After settle, surface any terminal prerender error rather than
  // screenshotting a skeleton/error frame. Reuses the same data-attribute
  // signaling as the HTML capture path.
  let terminal = await page.evaluate(() => {
    let elements = Array.from(
      document.querySelectorAll('[data-prerender]'),
    ) as HTMLElement[];
    for (let element of elements) {
      let status = element.dataset.prerenderStatus ?? '';
      if (status === 'error' || status === 'unusable') {
        let errorElement = element.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        let raw = (
          errorElement?.textContent ??
          errorElement?.innerHTML ??
          ''
        ).trim();
        return { status: status as 'error' | 'unusable', raw };
      }
    }
    let stray = document.querySelector(
      '[data-prerender-error]',
    ) as HTMLElement | null;
    if (stray) {
      let raw = (stray.textContent ?? stray.innerHTML ?? '').trim();
      if (raw.length > 0) {
        return { status: 'error' as const, raw };
      }
    }
    return null;
  });
  if (terminal) {
    let capture: RenderCapture = {
      status: terminal.status,
      value: terminal.raw,
    };
    return renderCaptureToError(page, capture, 'render.screenshot');
  }
  // Settle hook only tracks store/loader generation + animation frames; it
  // does NOT wait for `<img>` element loads, CSS background-image fetches, or
  // fonts. Without this extra wait the screenshot races those resources and
  // produces empty avatars / missing thumbnails. Bounded by an internal
  // timeout so a slow / 401-looping image can't hang the capture.
  await waitForImagePaint(page);
  let dims = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  let base64 = (await page.screenshot({
    encoding: 'base64',
    type: 'png',
  })) as string;
  let pngBytes = Buffer.byteLength(base64, 'base64');
  log.debug(
    `captureScreenshot success format=${format} ancestorLevel=${ancestorLevel} bytes=${pngBytes} base64Chars=${base64.length} ${dims.width}x${dims.height}`,
  );
  return { base64, width: dims.width, height: dims.height };
}

// Best-effort main-thread responsiveness probe. Races a trivial
// `page.evaluate` against a short timer: if the evaluate can't even
// return `true` within the budget, the page's JS thread is wedged
// (a runaway sync loop or a never-settling render), which is exactly
// the condition where the in-page `__boxelRenderDiagnostics` hook also
// goes dark. Never throws — resolves to a boolean.
async function probeMainThreadResponsive(page: Page): Promise<boolean> {
  // Clear the loser timer so a fast `evaluate` doesn't leave a pending
  // timeout holding the event loop for the rest of the probe window.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page
        .evaluate(() => true)
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), RESPONSIVENESS_PROBE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort CPU / heap capture via the CDP `Performance` domain. Runs
// out-of-process, so it works even when the page's JS thread is pegged
// and `page.evaluate` would block. Samples `Performance.getMetrics`
// twice ~CPU_SAMPLE_WINDOW_MS apart and diffs the cumulative
// ScriptDuration / TaskDuration (seconds) against wall-clock to derive
// the fraction of the window the main thread spent running JS / any
// task; reads JSHeapUsedSize (bytes) for the in-use heap. Any field
// that can't be read is omitted. Never throws.
async function captureCpuMetrics(page: Page): Promise<{
  scriptBusyFraction?: number;
  taskBusyFraction?: number;
  jsHeapUsedMB?: number;
}> {
  let client: CDPSession | undefined;
  try {
    client = await page.createCDPSession();
    await client.send('Performance.enable');
    let readMetrics = async (): Promise<Map<string, number>> => {
      let { metrics } = (await client!.send('Performance.getMetrics')) as {
        metrics: Array<{ name: string; value: number }>;
      };
      let map = new Map<string, number>();
      for (let m of metrics) {
        map.set(m.name, m.value);
      }
      return map;
    };
    let firstWall = Date.now();
    let first = await readMetrics();
    await new Promise((r) => setTimeout(r, CPU_SAMPLE_WINDOW_MS));
    let secondWall = Date.now();
    let second = await readMetrics();

    let wallSec = (secondWall - firstWall) / 1000;
    let result: {
      scriptBusyFraction?: number;
      taskBusyFraction?: number;
      jsHeapUsedMB?: number;
    } = {};

    let s1 = first.get('ScriptDuration');
    let s2 = second.get('ScriptDuration');
    if (typeof s1 === 'number' && typeof s2 === 'number' && wallSec > 0) {
      result.scriptBusyFraction = (s2 - s1) / wallSec;
    }
    let t1 = first.get('TaskDuration');
    let t2 = second.get('TaskDuration');
    if (typeof t1 === 'number' && typeof t2 === 'number' && wallSec > 0) {
      result.taskBusyFraction = (t2 - t1) / wallSec;
    }
    let heap = second.get('JSHeapUsedSize');
    if (typeof heap === 'number') {
      result.jsHeapUsedMB = heap / (1024 * 1024);
    }
    return result;
  } catch {
    // CDP unavailable (page closing, session race) — omit these fields.
    return {};
  } finally {
    try {
      await client?.detach();
    } catch {
      // Session may already be gone with the page; ignore.
    }
  }
}

// Optional metadata about the render `withTimeout` is wrapping. Carries
// the affinity key (so the affinity-scoped CPU profiler can gate on the
// exact target realm) and a human-readable label keyed by card url +
// format/pass, surfaced in the profiler's per-render log line. Both
// triggers degrade gracefully when this is omitted — the timeout-path
// sampler runs regardless, and the affinity trigger simply never fires
// without an affinity key.
export interface RenderProfileContext {
  affinityKey?: string;
  // e.g. `<card-url> isolated/0` — identifies which render produced the
  // profile in the per-render affinity-trigger log line.
  label?: string;
  // Structured identifiers for keying the heavyweight artifacts in the S3
  // sink (`env/realm/jobId/card/step/...`). `card` and `step` mirror what
  // `label` concatenates; `jobId` is the indexing job and is set only for
  // visits. The realm is recovered from `affinityKey`, so it isn't carried
  // here. All optional — the sink falls back to `no-<field>` segments.
  card?: string;
  step?: string;
  jobId?: string;
}

// Derives the S3 artifact-key fields from a render's profile context. The
// realm is recovered from the affinity key (which encodes it); card / step
// / jobId pass through. Used only for keying the heavyweight artifacts.
function artifactKeyPartsFor(
  profileContext: RenderProfileContext | undefined,
): Omit<ArtifactKeyParts, 'kind'> {
  let realm: string | undefined;
  if (profileContext?.affinityKey) {
    realm = fromAffinityKey(profileContext.affinityKey)?.affinityValue;
  }
  return {
    realm,
    jobId: profileContext?.jobId,
    card: profileContext?.card,
    step: profileContext?.step,
  };
}

// Runs `fn` under the affinity-scoped CPU profile (always: logs the top
// self-time frames, keyed by the render's label and wall-duration) and,
// when the artifact sink is configured and the matching per-mode flag is
// on, also persists the heavyweight blobs that don't fit a log line:
//
//   * full `.cpuprofile` — the raw of the same profile the summary comes
//     from, so it adds a flush, not a second CPU profiler;
//   * a streaming CDP trace — the one capture that survives a fully-wedged
//     renderer (browser-process drain, no main-thread `stop`);
//   * the cumulative heap allocation-sampling profile, read after the
//     render window so its per-render series shows what kept allocating.
//
// Used only by the affinity-scoped trigger, for renders whose affinity
// exactly matches the configured target.
//
// The render promise drives the return value directly — this resolves or
// rejects exactly as `fn` does, so the caller's error/timeout handling is
// unchanged and a render that hangs leaves this awaiting (the outer
// `withTimeout` race owns the timeout). Every capture runs alongside as a
// detached best-effort task bounded by `timeoutMs`: a render that hangs
// past its own timeout still stops the profiler / ends the trace at the
// bound rather than holding a CDP session open on the wedged page, and any
// capture or upload failure is swallowed so it never perturbs the render.
async function runWithAffinityProfile<T>(
  page: Page,
  fn: () => Promise<T>,
  timeoutMs: number,
  profileContext: RenderProfileContext | undefined,
): Promise<T> {
  // The heavyweight captures only matter when the sink is configured AND
  // the operator has flipped the matching flag — every gate short-circuits
  // on a cheap env read otherwise, so the default affinity behaviour
  // (summary log only) issues no extra CDP calls and pays nothing.
  let sinkOn = artifactSinkEnabled();
  let wantCpuProfile = sinkOn && shouldCaptureCpuProfile();
  let wantTrace = sinkOn && shouldCaptureTrace();
  let wantHeap = sinkOn && shouldCaptureHeap();
  let keyParts = artifactKeyPartsFor(profileContext);

  // Heap sampling is cumulative across the tab and must be running BEFORE
  // the render starts: otherwise the first targeted render's early (route
  // transition / module load) allocations land before the sampler attaches,
  // and that early growth is exactly what this mode is meant to diagnose.
  // `ensureHeapSampling` is idempotent per tab and never throws, so this
  // awaits a one-time setup on the first profiled render and is a no-op
  // thereafter.
  if (wantHeap) {
    await ensureHeapSampling(page);
  }

  let render = fn();
  let observe = () =>
    render.then(
      () => undefined,
      () => undefined,
    );

  // The streaming trace starts as early as possible and ends at
  // render-settle / `timeoutMs`. Drained straight into the sink's managed
  // upload so memory stays bounded even for a large trace.
  if (wantTrace) {
    void captureTraceStream(page, { run: observe, maxRunMs: timeoutMs })
      .then((stream) => {
        if (stream) {
          return uploadArtifact({ ...keyParts, kind: 'trace', body: stream });
        }
        return undefined;
      })
      .catch(() => {
        // Best-effort: a missing trace is a missing diagnostic.
      });
  }

  // Detached: the profile's log line is diagnostic and must not gate the
  // render's return. `profileWindow` observes `render` only for timing
  // (it never consumes the result/rejection) and stops on whichever of
  // render-settles / `timeoutMs` comes first. When the cpuprofile flag is
  // on, the same run's raw profile is flushed to the sink.
  void profileWindow(page, {
    samplingIntervalUs: AFFINITY_PROFILE_SAMPLING_INTERVAL_US,
    maxRunMs: timeoutMs,
    run: observe,
    onRawProfile: wantCpuProfile
      ? (rawProfile) =>
          uploadArtifact({
            ...keyParts,
            kind: 'cpuprofile',
            body: Buffer.from(JSON.stringify(rawProfile), 'utf8'),
          })
      : undefined,
  })
    .then(async (summary) => {
      let top = formatTopFrames(summary);
      if (top && summary) {
        log.warn(
          `affinity CPU profile ${profileContext?.label ?? '<render>'}` +
            ` durationMs=${summary.durationMs}` +
            ` samples=${summary.totalSamples}` +
            ` topFrames: ${top}`,
        );
      }
      // The profiler window has closed (render settled or bound elapsed),
      // so the cumulative heap profile now reflects this render. Read and
      // flush it — each upload is a point in the per-render growth series.
      if (wantHeap) {
        let heapProfile = await captureHeapSamplingProfile(page);
        if (heapProfile) {
          await uploadArtifact({
            ...keyParts,
            kind: 'heap',
            body: heapProfile,
          });
        }
      }
    })
    .catch(() => {
      // Best-effort: profiling failures never perturb the render.
    });
  return render;
}

export async function withTimeout<T>(
  page: Page,
  fn: () => Promise<T>,
  timeoutMs = cardRenderTimeout,
  profileContext?: RenderProfileContext,
): Promise<T | RenderError> {
  // Every render funnels through here, so this counter is the live
  // count of concurrent renders in this process. Capture it (including
  // this render) at the moment the race resolves — the timeout block
  // below reports it to distinguish a render starved by neighbours from
  // one stalled on its own.
  activeRenderCount++;
  let concurrentRenders = activeRenderCount;
  // Affinity-scoped CPU profiling (opt-in). When
  // `PRERENDER_PROFILE_AFFINITY` lists one or more affinity keys and
  // this render's affinity key is one of them, wrap the render work in a
  // CDP CPU profile and log the top self-time frames once it completes.
  // The gate short-circuits on the env read for every other realm, so
  // unrelated affinities issue no CDP calls and pay nothing. Profiling
  // the targeted realms' renders (fine-grained sampling, every render)
  // is the accepted cost of this trigger.
  let affinityTargets = getAffinityProfileTargets();
  let profileThisRender = shouldProfileAffinity(
    profileContext?.affinityKey,
    affinityTargets,
  );
  let renderFn = fn;
  if (profileThisRender) {
    renderFn = () =>
      runWithAffinityProfile(page, fn, timeoutMs, profileContext);
  }
  let result!: T | { timeout: true };
  // Capture the timeout timer so we can clear it once the race settles —
  // otherwise a render that finishes fast leaves a pending timer holding
  // the event loop for the full `timeoutMs`.
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      renderFn().catch((err) => {
        // Puppeteer's own TimeoutError (from waitForFunction/waitForSelector)
        // should be treated the same as our outer timeout
        if (err instanceof Error && err.name === 'TimeoutError') {
          return { timeout: true } as { timeout: true };
        }
        throw err;
      }),
      new Promise<{ timeout: true }>((r) => {
        timeoutTimer = setTimeout(() => {
          r({ timeout: true });
        }, timeoutMs);
      }),
    ]);
    concurrentRenders = activeRenderCount;
  } finally {
    activeRenderCount--;
    clearTimeout(timeoutTimer);
  }
  if (
    result &&
    typeof result == 'object' &&
    'timeout' in (result as { timeout?: boolean })
  ) {
    let message = `Render timed-out after ${timeoutMs} ms`;
    let url = new URL(page.url());
    let [_a, _b, encodedId] = url.pathname.split('/');
    let id = encodedId ? decodeURIComponent(encodedId) : undefined;

    // Render-hang discriminators, captured here only on the timeout
    // path — the responsiveness probe and CPU sampling do real work, so
    // they must never touch the success path. Order matters: the
    // out-of-process / bounded signals run FIRST because they survive a
    // wedged JS thread (the probe races a short timer; CPU capture and
    // the network tracker read via CDP / a passive Map). The in-page
    // `page.evaluate` diagnostics run LAST and only when the thread is
    // responsive — on a CPU-spinning render (exactly what this is meant
    // to diagnose) an evaluate blocks until the protocol timeout and
    // would starve the RenderError we owe the caller.
    let mainThreadResponsive: boolean | null = null;
    let cpuMetrics: {
      scriptBusyFraction?: number;
      taskBusyFraction?: number;
      jsHeapUsedMB?: number;
    } = {};
    if (!page.isClosed()) {
      try {
        mainThreadResponsive = await probeMainThreadResponsive(page);
      } catch {
        mainThreadResponsive = null;
      }
      cpuMetrics = await captureCpuMetrics(page);
    }
    // Out-of-process V8 CPU sample of the still-spinning renderer. At the
    // timeout cap a wedged render is still in its hot loop, and the CDP
    // sampling profiler keeps collecting stack samples even when the JS
    // thread is too pegged for `Performance.getMetrics` or
    // `page.evaluate` to answer — so this names the hot function the
    // other timeout-path signals can only point at. Runs for ALL realms
    // (the cost lands only on a render that already failed) and never on
    // the success path. Best-effort: resolves to null on any CDP error
    // and the stop is time-boxed so a wedged renderer can't stall here.
    let cpuProfileTopFrames: string | null = null;
    if (!page.isClosed()) {
      let summary = await profileWindow(page, {
        run: () =>
          new Promise<void>((resolve) =>
            setTimeout(resolve, TIMEOUT_PATH_CPU_SAMPLE_MS),
          ),
      });
      cpuProfileTopFrames = formatTopFrames(summary);
    }
    // Out-of-band CDP view of fetches still outstanding — survives a
    // wedged JS thread, so it's available even when the in-page hooks
    // below are skipped. The longest-lived entry is what a waiting
    // render is hung on.
    let pendingNetworkRequests = getPendingNetworkRequests(page);

    // In-page diagnostics last. Together with the signals above they
    // tell apart a CPU-spinning render (unresponsive thread,
    // scriptBusyFraction ≈ 1) from a render waiting on a resource
    // (responsive thread, low script fraction → look at
    // pendingNetworkRequests for the hung fetch). Gate on a responsive
    // thread: a wedged one can't service `page.evaluate`, so these would
    // block until the protocol timeout — skip them and lean on the
    // out-of-process signals above.
    let dom: string | null = null;
    let docsInFlight: number | null = null;
    let richDiagnostics: {
      cardDocsInFlight?: string[];
      fileMetaDocsInFlight?: string[];
      cardDocLoadsInFlight?: Array<{ url: string; ageMs: number }>;
      fileMetaDocLoadsInFlight?: Array<{ url: string; ageMs: number }>;
      recentCardDocLoads?: Array<{ url: string; ms: number }>;
      recentFileMetaLoads?: Array<{ url: string; ms: number }>;
      renderStage?: string;
      stageAgeMs?: number;
      inFlightModuleImports?: string[];
      currentlyEvaluatingModule?: string | null;
      recentModuleEvaluations?: Array<{ url: string; ms: number }>;
      queryLoadsInFlight?: unknown[];
      recentQueryLoads?: unknown[];
    } | null = null;
    let timerSummary: string | null = null;
    if (mainThreadResponsive === true && !page.isClosed()) {
      try {
        dom = await page.evaluate(() => {
          let el = document.querySelector('[data-prerender]');
          if (el) {
            return el.outerHTML;
          }
          let err = document.querySelector('[data-prerender-error]');
          return err?.outerHTML ?? null;
        });
        // Prefer the richer per-URL diagnostic hook when the host
        // exposes it; fall back to the count-only `__docsInFlight` so the
        // old host build path still produces a sensible log.
        richDiagnostics = await page.evaluate(() => {
          try {
            let diag = (globalThis as any).__boxelRenderDiagnostics;
            if (typeof diag === 'function') {
              let result = diag();
              return result && typeof result === 'object' ? result : null;
            }
          } catch {
            return null;
          }
          return null;
        });
        docsInFlight = await page.evaluate(() => {
          try {
            return (globalThis as any).__docsInFlight();
          } catch (error) {
            return null;
          }
        });
        timerSummary = await page.evaluate(() => {
          try {
            let summary = (globalThis as any).__boxelRenderTimerSummary;
            if (typeof summary === 'function') {
              return summary();
            }
            if (typeof summary === 'string') {
              return summary;
            }
          } catch {
            return null;
          }
          return null;
        });
      } catch {
        dom = null;
        docsInFlight = null;
        richDiagnostics = null;
        timerSummary = null;
      }
    }

    let topPending = pendingNetworkRequests?.[0];
    log.warn(
      `render of ${id} timed out after ${timeoutMs}ms` +
        ` stage=${richDiagnostics?.renderStage ?? '<unknown>'}` +
        ` stageAgeMs=${richDiagnostics?.stageAgeMs ?? '<unknown>'}` +
        ` cardDocsInFlight=${richDiagnostics?.cardDocsInFlight?.length ?? docsInFlight ?? 0}` +
        ` fileMetaDocsInFlight=${richDiagnostics?.fileMetaDocsInFlight?.length ?? 0}` +
        ` inFlightModuleImports=${richDiagnostics?.inFlightModuleImports?.length ?? 0}` +
        ` evaluating=${richDiagnostics?.currentlyEvaluatingModule ?? 'none'}` +
        ` mainThreadResponsive=${mainThreadResponsive ?? '<unknown>'}` +
        ` scriptBusy=${
          typeof cpuMetrics.scriptBusyFraction === 'number'
            ? cpuMetrics.scriptBusyFraction.toFixed(2)
            : '<unknown>'
        }` +
        ` pendingFetches=${pendingNetworkRequests?.length ?? '<unknown>'}` +
        (topPending ? `(top: ${topPending.url} ${topPending.ageMs}ms)` : '') +
        ` concurrentRenders=${concurrentRenders}` +
        (cpuProfileTopFrames ? ` cpuTopFrames: ${cpuProfileTopFrames}` : '') +
        ` DOM:\n${dom?.trim()}`,
    );
    // Diagnostics ride on the outer `RenderError.diagnostics` as a
    // transient transport; the Prerenderer lifts them to
    // `response.meta.diagnostics` before returning, where the indexer
    // reads them and persists into `diagnostics`. The field is
    // dropped from the final response.
    let diagnostics: RenderTimeoutDiagnostics = {
      ...(richDiagnostics?.renderStage
        ? { renderStage: richDiagnostics.renderStage }
        : {}),
      ...(typeof richDiagnostics?.stageAgeMs === 'number'
        ? { stageAgeMs: richDiagnostics.stageAgeMs }
        : {}),
      ...(Array.isArray(richDiagnostics?.cardDocsInFlight)
        ? { cardDocsInFlight: richDiagnostics!.cardDocsInFlight }
        : {}),
      ...(Array.isArray(richDiagnostics?.fileMetaDocsInFlight)
        ? { fileMetaDocsInFlight: richDiagnostics!.fileMetaDocsInFlight }
        : {}),
      ...(Array.isArray(richDiagnostics?.inFlightModuleImports)
        ? { inFlightModuleImports: richDiagnostics!.inFlightModuleImports }
        : {}),
      ...(richDiagnostics?.currentlyEvaluatingModule !== undefined
        ? {
            currentlyEvaluatingModule:
              richDiagnostics.currentlyEvaluatingModule,
          }
        : {}),
      ...(Array.isArray(richDiagnostics?.recentModuleEvaluations)
        ? {
            recentModuleEvaluations: richDiagnostics!.recentModuleEvaluations,
          }
        : {}),
      ...(Array.isArray(richDiagnostics?.queryLoadsInFlight)
        ? {
            queryLoadsInFlight: richDiagnostics!.queryLoadsInFlight as Array<
              Record<string, unknown>
            >,
          }
        : {}),
      ...(Array.isArray(richDiagnostics?.recentQueryLoads)
        ? {
            recentQueryLoads: richDiagnostics!.recentQueryLoads as Array<
              Record<string, unknown>
            >,
          }
        : {}),
      ...(Array.isArray(richDiagnostics?.cardDocLoadsInFlight)
        ? { cardDocLoadsInFlight: richDiagnostics!.cardDocLoadsInFlight }
        : {}),
      ...(Array.isArray(richDiagnostics?.fileMetaDocLoadsInFlight)
        ? {
            fileMetaDocLoadsInFlight: richDiagnostics!.fileMetaDocLoadsInFlight,
          }
        : {}),
      ...(Array.isArray(richDiagnostics?.recentCardDocLoads)
        ? { recentCardDocLoads: richDiagnostics!.recentCardDocLoads }
        : {}),
      ...(Array.isArray(richDiagnostics?.recentFileMetaLoads)
        ? { recentFileMetaLoads: richDiagnostics!.recentFileMetaLoads }
        : {}),
      ...(typeof docsInFlight === 'number' ? { docsInFlight } : {}),
      ...(dom ? { capturedDom: dom } : {}),
      ...(typeof timerSummary === 'string' && timerSummary.trim()
        ? { blockedTimerSummary: timerSummary.trim() }
        : {}),
      ...(typeof mainThreadResponsive === 'boolean'
        ? { mainThreadResponsive }
        : {}),
      ...(typeof cpuMetrics.scriptBusyFraction === 'number'
        ? { scriptBusyFraction: cpuMetrics.scriptBusyFraction }
        : {}),
      ...(typeof cpuMetrics.taskBusyFraction === 'number'
        ? { taskBusyFraction: cpuMetrics.taskBusyFraction }
        : {}),
      ...(typeof cpuMetrics.jsHeapUsedMB === 'number'
        ? { jsHeapUsedMB: cpuMetrics.jsHeapUsedMB }
        : {}),
      ...(pendingNetworkRequests ? { pendingNetworkRequests } : {}),
      concurrentRenders,
    };
    let timeoutError: RenderError = {
      type: 'instance-error',
      error: {
        id,
        status: 504,
        title: 'Render timeout',
        message,
        additionalErrors: null,
      },
      evict: true,
      diagnostics,
    };
    if (typeof timerSummary === 'string' && timerSummary.trim()) {
      timeoutError.error.stack = timerSummary.trim();
    }
    (timeoutError as any).capturedDom = dom ?? null;
    (timeoutError as any).docsInFlight = docsInFlight ?? null;
    return timeoutError;
  } else {
    return result as T;
  }
}

export function isRenderError(value: any): value is RenderError {
  return typeof value === 'object' && value !== null && 'error' in value;
}
