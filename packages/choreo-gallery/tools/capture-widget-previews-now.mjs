import fs from 'node:fs/promises';

import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
const root = 'test-app/public/widget-previews/rendered-20260906';
const manifest = [];
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({
      viewport: phone
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1200 },
      deviceScaleFactor: 2,
    });
    page.setDefaultTimeout(30000);
    await page.goto('http://localhost:4590/_widgets?film=1#/_widgets');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-widget-id]').length === 45,
    );
    const ids = await page
      .locator('[data-widget-id]')
      .evaluateAll((es) => es.map((e) => e.dataset.widgetId));
    const dir = root + (phone ? '/phone' : '');
    await fs.mkdir(dir, { recursive: true });
    for (const id of ids) {
      await page
        .locator(`[data-widget-id="${id}"] .wr-live-hit`)
        .evaluate((e) => e.click());
      await page.waitForFunction((id) => {
        const e = document.querySelector(`[data-widget-id="${id}"]`);
        return (
          e?.dataset.widgetReady === 'true' &&
          getComputedStyle(e).transform === 'none'
        );
      }, id);
      // Capture the real gallery canvas, including its actual room CSS and reserved expanded size.
      const canvas = page.locator(`[data-widget-id="${id}"] .wr-live-canvas`);
      await canvas.evaluate(async (e) => {
        await document.fonts.ready;
        await Promise.all(
          [...e.querySelectorAll('img')].map((i) => i.decode().catch(() => {})),
        );
        for (const a of e.getAnimations({ subtree: true })) {
          a.pause();
        }
        await new Promise(requestAnimationFrame);
      });
      await canvas.screenshot({
        path: `${dir}/${id}.jpg`,
        type: 'jpeg',
        quality: 90,
        animations: 'allow',
      });
      const size = await canvas.boundingBox();
      manifest.push({
        id,
        phone,
        width: size.width,
        height: size.height,
        scale: 2,
      });
      console.log(phone ? 'phone' : 'desktop', id);
      await page.locator('.wr-brand').click();
    }
    await page.close();
  }
  await fs.writeFile(
    root + '/manifest.json',
    JSON.stringify(manifest, null, 2),
  );
} finally {
  await browser.close();
}
