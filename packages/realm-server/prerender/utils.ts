import {
  delay,
  type CardErrorJSONAPI,
  type PrerenderMeta,
} from '@cardstack/runtime-common';
import { type Page } from 'puppeteer';

export const renderTimeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 15_000);

export type RenderStatus = 'ready' | 'error' | 'unusable';

export interface RenderCapture {
  status: RenderStatus;
  value: string;
  alive?: 'true' | 'false';
}

export interface RenderError {
  error: string;
  id?: string;
  status: number;
  title?: string;
  message: string;
  realm?: string;
  meta: {
    lastKnownGoodHtml: string | null;
    cardTitle: string | null;
    scopedCssUrls: string[];
    stack: string | null;
  };
  evict?: boolean;
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
): Promise<string | RenderError> {
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  let result = await captureResult(page, 'innerHTML');
  if (result.status === 'error' || result.status === 'unusable') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    const err: RenderError = {
      ...(error as unknown as RenderError),
      error: error.message,
      evict: result.status === 'unusable',
    };
    return err;
  }
  return result.value;
}

export async function renderIcon(page: Page): Promise<string | RenderError> {
  await transitionTo(page, 'render.icon');
  let result = await captureResult(page, 'outerHTML');
  if (result.status === 'error' || result.status === 'unusable') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    const err: RenderError = {
      ...(error as unknown as RenderError),
      error: error.message,
      evict: result.status === 'unusable',
    };
    return err;
  }
  return result.value;
}

export async function renderMeta(
  page: Page,
): Promise<PrerenderMeta | RenderError> {
  await transitionTo(page, 'render.meta');
  let result = await captureResult(page, 'textContent');
  if (result.status === 'error' || result.status === 'unusable') {
    let error = JSON.parse(result.value) as CardErrorJSONAPI;
    const err: RenderError = {
      ...(error as unknown as RenderError),
      error: error.message,
      evict: result.status === 'unusable',
    };
    return err;
  }
  return JSON.parse(result.value) as PrerenderMeta;
}

export async function renderAncestors(
  page: Page,
  format: 'embedded' | 'fitted',
  types: string[],
): Promise<Record<string, string> | RenderError> {
  let out: Record<string, string> = {};
  for (let i = 0; i < types.length; i++) {
    let res = await renderHTML(page, format, i);
    if (isRenderError(res)) return res;
    out[types[i]] = res as string;
  }
  return out;
}

export async function captureResult(
  page: Page,
  capture: 'textContent' | 'innerHTML' | 'outerHTML',
  opts?: { simulateTimeoutMs?: number },
): Promise<RenderCapture> {
  await page.waitForSelector(
    '[data-prerender-status="ready"], [data-prerender-status="error"], [data-prerender-status="unusable"]',
  );
  // Read initial status
  let status: RenderStatus = await page.evaluate(() => {
    let el = document.querySelector('[data-prerender]') as HTMLElement;
    return el.dataset.prerenderStatus as any as RenderStatus;
  });
  // If we see 'error', wait briefly to see if the route marks it 'unusable'.
  // Note that it takes the render route a minimum of 300ms to determine if
  // Ember is still healthy.
  if (status === 'error') {
    try {
      await page.waitForSelector('[data-prerender-status="unusable"]', {
        timeout: 500,
      });
      status = 'unusable';
    } catch {
      // keep 'error'
    }
  }
  let result = await page.evaluate(
    (
      capture: 'textContent' | 'innerHTML' | 'outerHTML',
      finalStatus: RenderStatus,
    ) => {
      let element = document.querySelector('[data-prerender]') as HTMLElement;
      let alive =
        (element.dataset.emberAlive as 'true' | 'false' | undefined) ??
        undefined;
      if (finalStatus === 'error' || finalStatus === 'unusable') {
        // Extract only the JSON payload (between the first '{' and the last '}')
        let html = element.innerHTML ?? '';
        let start = html.indexOf('{');
        let end = html.lastIndexOf('}');
        let json =
          start !== -1 && end !== -1 && end > start
            ? html.slice(start, end + 1)
            : html;
        return { status: finalStatus, value: json, alive } as RenderCapture;
      } else {
        const firstChild = element.children[0] as HTMLElement & {
          textContent: string;
          innerHTML: string;
          outerHTML: string;
        };
        return {
          status: finalStatus,
          value: (firstChild as any)[capture]!,
          alive,
        } as RenderCapture;
      }
    },
    capture,
    status,
  );
  if (opts?.simulateTimeoutMs) {
    await delay(opts?.simulateTimeoutMs);
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
      evict: true,
    } as RenderError;
  } else {
    return result as T;
  }
}

export function isRenderError(value: any): value is RenderError {
  return typeof value === 'object' && value !== null && 'error' in value;
}
