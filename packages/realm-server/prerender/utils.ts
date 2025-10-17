import {
  delay,
  logger,
  type PrerenderMeta,
  type RenderError,
} from '@cardstack/runtime-common';

import { type Page } from 'puppeteer';

const log = logger('prerenderer');

export const renderTimeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 15_000);

export type RenderStatus = 'ready' | 'error' | 'unusable';

export interface RenderCapture {
  status: RenderStatus;
  value: string;
  alive?: 'true' | 'false';
  id?: string;
  nonce?: string;
}

export interface CaptureOptions {
  expectedId?: string;
  expectedNonce?: string;
  simulateTimeoutMs?: number;
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
  let result = await captureResult(
    page,
    ['isolated', 'atom'].includes(format) ? 'innerHTML' : 'outerHTML',
    opts,
  );
  if (result.status === 'error' || result.status === 'unusable') {
    return renderCaptureToError(page, result, 'render.html');
  }
  return result.value;
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
  return result.value;
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
    type: 'error',
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

// TODO i think comparing the id and nonce between the URL and DOM is overkill.
// at one point the AI was getting paranoid about the URL and DOM being out of
// sync. let's remove that logic its just bloat...
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
    {},
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
        const firstChild = resolvedElement.children[0] as HTMLElement & {
          textContent: string;
          innerHTML: string;
          outerHTML: string;
        };
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
  if (
    result &&
    typeof result == 'object' &&
    'timeout' in (result as { timeout?: boolean })
  ) {
    let message = `Render timed-out after ${timeoutMs} ms`;
    let url = new URL(page.url());
    let [_a, _b, encodedId] = url.pathname.split('/');
    let id = encodedId ? decodeURIComponent(encodedId) : undefined;

    let dom = await page.evaluate(() => {
      let el = document.querySelector('[data-prerender]');
      return el?.outerHTML;
    });
    log.warn(`render of ${id} timed out with DOM:\n${dom?.trim()}`);
    return {
      error: {
        id,
        status: 504,
        title: 'Render timeout',
        message,
      },
      evict: true,
    } as RenderError;
  } else {
    return result as T;
  }
}

export function isRenderError(value: any): value is RenderError {
  return typeof value === 'object' && value !== null && 'error' in value;
}
