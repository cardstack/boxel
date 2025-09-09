import {
  type PrerenderMeta,
  type DBAdapter,
  fetchUserPermissions,
} from '@cardstack/runtime-common';
import puppeteer, { type Page } from 'puppeteer';
import { createJWT } from './jwt';

export interface RenderResponse extends PrerenderMeta {
  isolatedHTML: string;
  atomHTML: string;
  embeddedHTML: Record<string, string>;
  fittedHTML: Record<string, string>;
  iconHTML: string;
}

export async function prerenderCard({
  url,
  realm,
  userId,
  secretSeed,
  dbAdapter,
}: {
  url: string;
  realm: string;
  userId: string;
  secretSeed: string;
  dbAdapter: DBAdapter;
}): Promise<RenderResponse> {
  let permissions = (await fetchUserPermissions(dbAdapter, new URL(realm)))[
    userId
  ];
  if (!permissions) {
    throw new Error('TODO what do we do here?');
  }
  let token = createJWT(
    {
      user: userId,
      realm,
      permissions,
      sessionRoom: '',
    },
    '1d',
    secretSeed,
  );
  let auth = JSON.stringify({ [realm]: token });
  const browser = await puppeteer.launch({
    headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
    args: process.env.CI ? ['--no-sandbox'] : [],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    page.evaluateOnNewDocument((auth) => {
      localStorage.setItem('boxel-session', auth);
    }, auth);

    // TODO this seems backwards, we need to render HTML first in order to pull
    // on the linked fields to trigger them to load. after that then we can
    // render meta
    await page.goto(
      `http://localhost:4200/render/${encodeURIComponent(url)}/meta`,
    );
    let result = await captureResult(page, 'textContent');
    if (result.status === 'error') {
      throw new Error('todo: make error doc');
    }

    const meta: PrerenderMeta = JSON.parse(result.value);

    const isolatedHTML = await renderHTML(page, 'isolated', 0);
    const atomHTML = await renderHTML(page, 'atom', 0);
    const embeddedHTML = await renderAncestors(page, 'embedded', meta.types);
    const fittedHTML = await renderAncestors(page, 'fitted', meta.types);
    const iconHTML = await renderIcon(page);

    return {
      ...meta,
      iconHTML,
      isolatedHTML,
      atomHTML,
      embeddedHTML,
      fittedHTML,
    };
  } finally {
    await context.close();
    await browser.close();
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

async function renderAncestors(page: Page, format: string, types: string[]) {
  let html: Record<string, string> = {};
  for (let ancestorLevel = 0; ancestorLevel < types.length; ancestorLevel++) {
    html[types[ancestorLevel]] = await renderHTML(page, format, ancestorLevel);
  }
  return html;
}

// TODO
async function renderMeta() {}

async function renderHTML(
  page: Page,
  format: string,
  ancestorLevel: number,
): Promise<string> {
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  let result = await captureResult(page, 'innerHTML');
  if (result.status === 'error') {
    throw new Error('todo: error doc');
  }
  return result.value;
}

async function renderIcon(page: Page): Promise<string> {
  await transitionTo(page, 'render.icon');
  let result = await captureResult(page, 'outerHTML');
  if (result.status === 'error') {
    throw new Error('todo: error doc');
  }

  return result.value;
}

async function captureResult(
  page: Page,
  capture: 'textContent' | 'innerHTML' | 'outerHTML',
): Promise<{ status: 'ready' | 'error'; value: string }> {
  await page.waitForSelector(
    '[data-prerender-status="ready"], [data-prerender-status="error"]',
  );
  return await page.evaluate(
    (capture: 'textContent' | 'innerHTML' | 'outerHTML') => {
      let element = document.querySelector('[data-prerender]') as HTMLElement;
      let status = element.dataset.prerenderStatus as 'ready' | 'error';
      if (status === 'error') {
        return { status, value: element.innerHTML! };
      } else {
        return { status, value: element.children[0][capture]! };
      }
    },
    capture,
  );
}
