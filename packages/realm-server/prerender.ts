import puppeteer from 'puppeteer';

export async function prerenderCard(
  url: string,
  format: string,
): Promise<{ html: string }> {
  const browser = await puppeteer.launch({
    headless: process.env.BOXEL_SHOW_PRERENDER !== 'true',
  });
  const page = await browser.newPage();
  await page.goto(
    `http://localhost:4200/render/${format}/${encodeURIComponent(url)}`,
  );
  await page.waitForSelector('[data-render-output="ready"]');
  await browser.close();
  return { html: '<div></div>' };
}
