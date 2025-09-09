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
  userId,
  secretSeed,
  dbAdapter,
}: {
  url: string;
  userId: string;
  secretSeed: string;
  dbAdapter: DBAdapter;
}): Promise<RenderResponse> {
  let permissionsForAllRealms = await fetchUserPermissions(dbAdapter, userId);
  if (!permissionsForAllRealms) {
    throw new Error(`Cannot determine permissions for user ${userId}`);
  }
  let sessions: { [realm: string]: string } = {};
  for (let [realm, permissions] of Object.entries(permissionsForAllRealms)) {
    sessions[realm] = createJWT(
      {
        user: userId,
        realm: realm,
        permissions,
        sessionRoom: '',
      },
      '1d',
      secretSeed,
    );
  }
  let auth = JSON.stringify(sessions);
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

    // We need to render the isolated HTML view first, as the template will pull
    // on the linked fields. Otherwise the linked fields will not be loaded.
    await page.goto(
      `http://localhost:4200/render/${encodeURIComponent(url)}/html/isolated/0`,
    );
    let result = await captureResult(page, 'innerHTML');
    if (result.status === 'error') {
      throw new Error('todo: error doc');
    }
    const isolatedHTML = result.value;
    const atomHTML = await renderHTML(page, 'atom', 0);
    const meta = await renderMeta(page);
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

async function renderMeta(page: Page): Promise<PrerenderMeta> {
  await transitionTo(page, 'render.meta');
  let result = await captureResult(page, 'textContent');
  if (result.status === 'error') {
    throw new Error('todo: make error doc');
  }
  const meta: PrerenderMeta = JSON.parse(result.value);
  return meta;
}

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
        // there is a strange <anonymous> tag that is being appended to the
        // innerHTML that this strips out
        return { status, value: element.innerHTML!.replace(/}[^}].*$/, '}') };
      } else {
        return { status, value: element.children[0][capture]! };
      }
    },
    capture,
  );
}
