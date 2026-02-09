import {
  cleanCapturedHTML,
  delay,
  logger,
  type PrerenderMeta,
  type RenderError,
} from '@cardstack/runtime-common';

import type { Page } from 'puppeteer';

const log = logger('prerenderer');
const DEFAULT_CARD_RENDER_TIMEOUT_MS = 30_000;

export const cardRenderTimeout = Number(
  process.env.RENDER_TIMEOUT_MS ?? DEFAULT_CARD_RENDER_TIMEOUT_MS,
);
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

export async function transitionTo(
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

export async function renderHTML(
  page: Page,
  format: string,
  ancestorLevel: number,
  opts?: CaptureOptions,
): Promise<string | RenderError> {
  await transitionTo(page, 'render.html', format, String(ancestorLevel));

  let markerInfo = await page.evaluate(() => {
    let el = document.querySelector('[data-prerender]') as HTMLElement | null;
    if (!el) return { hasContainer: false };
    let comments = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 8)
      .map((n) => (n as Comment).nodeValue);
    return {
      hasContainer: true,
      hasMarkerInContainer: el.innerHTML.includes('%+b:'),
      commentSamples: comments.slice(0, 5),
    };
  });
  log.info('container markers', markerInfo);

  let around = await page.evaluate(() => {
    let el = document.querySelector('[data-prerender]');
    if (!el || !el.parentElement) return { hasParent: false };
    let parent = el.parentElement;
    let prev = el.previousSibling;
    let next = el.nextSibling;
    return {
      hasParent: true,
      parentHasMarkers: parent.innerHTML.includes('%+b:'),
      prevComment: prev?.nodeType === 8 ? prev.nodeValue : null,
      nextComment: next?.nodeType === 8 ? next.nodeValue : null,
    };
  });
  log.info('marker siblings', around);

  let result = await captureResult(
    page,
    ['isolated', 'atom', 'head'].includes(format) ? 'innerHTML' : 'outerHTML',
    opts,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.html');
  }
  return cleanCapturedHTML(result.value);
}

export async function renderIcon(
  page: Page,
  opts?: CaptureOptions,
): Promise<string | RenderError> {
  await transitionTo(page, 'render.icon');
  let result = await captureResult(page, 'outerHTML', opts);
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.icon');
  }
  return cleanCapturedHTML(result.value);
}

export async function renderMeta(
  page: Page,
  opts?: CaptureOptions,
): Promise<PrerenderMeta | RenderError> {
  await transitionTo(page, 'render.meta');
  let result = await captureResult(page, 'textContent', opts);
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
    id = match?.[1] ?? null;
  } catch {
    id = null;
  }
  return {
    type: 'instance-error',
    error: {
      id,
      status: 500,
      title: options?.title ?? 'Invalid render response',
      message,
      additionalErrors: null,
    },
    ...(options?.evict ? { evict: true } : {}),
  };
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
        // Serialize mode emits rehydrate markers as siblings of the container.
        let useParentCapture =
          capture !== 'textContent' &&
          (globalThis as any).__boxelRenderMode === 'serialize';
        const firstChild = resolvedElement.children[0] as
          | (HTMLElement & {
              textContent: string;
              innerHTML: string;
              outerHTML: string;
            })
          | undefined;
        if (!firstChild) {
          return {
            status: 'error',
            value: JSON.stringify({
              type: 'instance-error',
              error: {
                id: resolvedElement.dataset.prerenderId ?? null,
                status: 500,
                title: 'Invalid render response',
                message:
                  '[data-prerender] has no child element to capture (render produced no root element)',
                additionalErrors: null,
              },
            }),
            alive,
            id: resolvedElement.dataset.prerenderId ?? undefined,
            nonce: resolvedElement.dataset.prerenderNonce ?? undefined,
          } as RenderCapture;
        }
        if (useParentCapture) {
          let parent = resolvedElement.parentElement;

          // Collect elements and Glimmer serialisation comments
          let pieces: string[] = [];
          if (parent) {
            let nodes = Array.from(parent.childNodes);
            for (let node of nodes) {
              if (node === resolvedElement) {
                // Use the same capture mode as the non-serialize path:
                // innerHTML → firstChild.innerHTML (strips wrapper div)
                // outerHTML → firstChild.outerHTML (keeps wrapper div)
                pieces.push((firstChild as any)[capture]);
                continue;
              }
              if (node.nodeType === 8) {
                let value = (node as Comment).nodeValue ?? '';
                if (value.includes('%+') || value.includes('%-')) {
                  pieces.push(`<!--${value}-->`);
                }
              }
            }
          }
          return {
            status: finalStatus,
            value:
              pieces.length > 0
                ? pieces.join('')
                : (firstChild as any)[capture],
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

export async function withTimeout<T>(
  page: Page,
  fn: () => Promise<T>,
  timeoutMs = cardRenderTimeout,
): Promise<T | RenderError> {
  let result = await Promise.race([
    fn(),
    new Promise<{ timeout: true }>((r) =>
      setTimeout(() => {
        r({ timeout: true });
      }, timeoutMs),
    ),
  ]);
  if (
    result &&
    typeof result == 'object' &&
    'timeout' in (result as { timeout?: boolean })
  ) {
    let message = `Render timed-out after ${timeoutMs} ms`;
    let url = new URL(page.url());
    let [_a, _b, encodedId] = url.pathname.split('/');
    let id = encodedId ? decodeURIComponent(encodedId) : undefined;

    // Capture diagnostics only if the page is still alive; timeouts can close the target.
    let dom: string | null = null;
    let docsInFlight: number | null = null;
    let timerSummary: string | null = null;
    if (!page.isClosed()) {
      try {
        dom = await page.evaluate(() => {
          let el = document.querySelector('[data-prerender]');
          if (el) {
            return el.outerHTML;
          }
          let err = document.querySelector('[data-prerender-error]');
          return err?.outerHTML ?? null;
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
        timerSummary = null;
      }
    }
    log.warn(
      `render of ${id} timed out with DOM:\n${dom?.trim()}\nDocs in flight: ${docsInFlight}`,
    );
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
