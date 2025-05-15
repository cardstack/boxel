import type { PrerenderMeta } from '@cardstack/runtime-common';
import puppeteer, { type Page } from 'puppeteer';

export interface RenderResponse extends PrerenderMeta {
  isolatedHTML: string;
  atomHTML: string;
  embeddedHTML: Record<string, string>;
  fittedHTML: Record<string, string>;
  iconHTML: string;
}

export async function prerenderCard(url: string): Promise<RenderResponse> {
  const browser = await puppeteer.launch({
    headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  if (process.env.BOXEL_SESSION) {
    // Run this in browser to copy your own session into here:
    // console.log(`export BOXEL_SESSION="${btoa(localStorage.getItem("boxel-session"))}"`)
    const auth = atob(process.env.BOXEL_SESSION!);
    page.evaluateOnNewDocument((auth) => {
      localStorage.setItem('boxel-session', auth);
    }, auth);
  }

  await page.goto(
    `http://localhost:4200/render/${encodeURIComponent(url)}/meta`,
  );
  await page.waitForSelector('[data-render-output="ready"]');
  const meta: PrerenderMeta = await page.evaluate(() => {
    return JSON.parse(
      document.querySelector('[data-render-output="ready"]')!.textContent!,
    );
  });

  const isolatedHTML = await renderHTML(page, 'isolated', 0);
  const atomHTML = await renderHTML(page, 'atom', 0);
  const embeddedHTML = await renderAncestors(page, 'embedded', meta.types);
  const fittedHTML = await renderAncestors(page, 'embedded', meta.types);
  const iconHTML = await renderIcon(page);

  await context.close();
  await browser.close();
  return {
    ...meta,
    iconHTML,
    isolatedHTML,
    atomHTML,
    embeddedHTML,
    fittedHTML,
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

async function renderAncestors(page: Page, format: string, types: string[]) {
  let html: Record<string, string> = {};
  for (let ancestorLevel = 0; ancestorLevel < types.length; ancestorLevel++) {
    html[types[ancestorLevel]] = await renderHTML(page, format, ancestorLevel);
  }
  return html;
}

async function renderHTML(
  page: Page,
  format: string,
  ancestorLevel: number,
): Promise<string> {
  await transitionTo(page, 'render.html', format, String(ancestorLevel));
  await page.waitForSelector('[data-render-output="ready"]');
  return await page.evaluate(() => {
    return document.querySelector('[data-render-output="ready"]')!.innerHTML;
  });
}

async function renderIcon(page: Page): Promise<string> {
  await transitionTo(page, 'render.icon');
  await page.waitForSelector('[data-render-output="ready"]');
  return await page.evaluate(() => {
    return document.querySelector('[data-render-output="ready"]')!.outerHTML;
  });
}
