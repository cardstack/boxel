import { Format, formats, PrerenderMeta } from '@cardstack/runtime-common';
import puppeteer, { Page } from 'puppeteer';

export interface RenderResponse extends PrerenderMeta {
  iconHTML: string;
  html: Record<Format, string>;
}

export async function prerenderCard(url: string): Promise<RenderResponse> {
  const browser = await puppeteer.launch({
    headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  // TODO value created by hand from an existing browser session via:
  // console.log(`export TODO_SESSION="${btoa(localStorage.getItem("boxel-session"))}"`)
  const auth: string = atob(process.env.TODO_SESSION!);

  page.evaluateOnNewDocument((auth) => {
    localStorage.setItem('boxel-session', auth);
  }, auth);

  const html: Map<Format, string> = new Map();

  await page.goto(
    `http://localhost:4200/render/${encodeURIComponent(url)}/meta`,
  );
  await page.waitForSelector('[data-render-output="ready"]');
  const meta: PrerenderMeta = await page.evaluate(() => {
    return JSON.parse(
      document.querySelector('[data-render-output="ready"]')!.textContent!,
    );
  });

  for (let format of formats) {
    await transitionTo(page, 'render.html', format, '0');
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

  await context.close();
  await browser.close();
  return {
    ...meta,
    iconHTML,
    html: Object.fromEntries(html) as Record<Format, string>,
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
