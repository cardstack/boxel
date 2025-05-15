import {
  Format,
  formats,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import puppeteer, { Page } from 'puppeteer';

export interface RenderResponse {
  iconHTML: string;
  html: Record<Format, string>;
  json: LooseSingleCardDocument;
}

export async function prerenderCard(url: string): Promise<RenderResponse> {
  const browser = await puppeteer.launch({
    headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  // TODO value created by hand from an existing browser session via:
  // console.log(`export TODO_SESSION="${btoa(JSON.stringify(Object.fromEntries(['boxel-realm-server-session', 'auth', 'boxel-session'].map(k => [k,localStorage.getItem(k)]))))}"`)
  const auth: Record<string, string> = JSON.parse(
    atob(process.env.TODO_SESSION!),
  );

  page.evaluateOnNewDocument((auth) => {
    for (let [k, v] of Object.entries(auth)) {
      localStorage.setItem(k, v);
    }
  }, auth);

  const html: Map<Format, string> = new Map();

  await page.goto(`http://localhost:4200/render/${encodeURIComponent(url)}`);

  for (let format of formats) {
    await transitionTo(page, 'render.html', format);
    await page.waitForSelector('[data-render-output="ready"]');
    html.set(
      format,
      await page.evaluate(() => {
        return document.querySelector('[data-render-output="ready"]')!
          .innerHTML;
      }),
    );
  }

  await transitionTo(page, 'render.icon');
  await page.waitForSelector('[data-render-output="ready"]');
  const iconHTML = await page.evaluate(() => {
    return document.querySelector('[data-render-output="ready"]')!.outerHTML;
  });

  await transitionTo(page, 'render.json');
  await page.waitForSelector('[data-render-output="ready"]');
  const json: LooseSingleCardDocument = await page.evaluate(() => {
    return JSON.parse(
      document.querySelector('[data-render-output="ready"]')!.textContent!,
    );
  });

  await context.close();
  await browser.close();
  return {
    iconHTML,
    html: Object.fromEntries(html) as Record<Format, string>,
    json,
  };
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
