import puppeteer from 'puppeteer';

export async function prerenderCard(
  url: string,
  format: string,
): Promise<{ html: string }> {
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
  await page.goto(
    `http://localhost:4200/render/${format}/${encodeURIComponent(url)}`,
  );
  await page.waitForSelector('[data-render-output="ready"]');
  const html = await page.evaluate(() => {
    return document.querySelector('[data-render-output="ready"]')!.innerHTML;
  });

  await context.close();
  return { html };
}
