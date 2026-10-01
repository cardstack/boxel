import assert from 'node:assert/strict';

import { chromium, webkit } from 'playwright';
for (const kind of ['chromium', 'webkit']) {
  const browser = await (kind === 'chromium' ? chromium : webkit).launch({
    headless: true,
    executablePath:
      kind === 'chromium' ? process.env.CHROME_PATH : process.env.WEBKIT_PATH,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      process.env.LIVE_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.wr-tile-preview').length === 45 &&
        [...document.querySelectorAll('.wr-tile-preview')].every(
          (e) => e.complete && e.naturalWidth,
        ),
    );
    // Hold live image decoding at a deterministic gate, leaving static posters intact.
    await page.evaluate(() => {
      const target = document.querySelector(
        '[data-widget-id="lightbox"] .wr-live-canvas',
      );
      const observer = new MutationObserver(() => {
        if (target.childElementCount) {
          observer.disconnect();
          const image = new Image();
          image.src = document.querySelector('.wr-tile-preview').src;
          target.append(image);
        }
      });
      observer.observe(target, { childList: true });
      const decode = HTMLImageElement.prototype.decode;
      window.__releaseImages = null;
      const gate = new Promise((r) => (window.__releaseImages = r));
      HTMLImageElement.prototype.decode = function () {
        return this.closest('.wr-live-canvas')
          ? gate.then(() => decode.call(this))
          : decode.call(this);
      };
      window.__blank = [];
      const sample = () => {
        for (const el of document.querySelectorAll('[data-widget-id]')) {
          const canvas = el.querySelector('.wr-live-canvas'),
            poster = el.querySelector('.wr-tile-preview');
          if (
            getComputedStyle(el).visibility === 'visible' &&
            Number(getComputedStyle(poster).opacity) < 0.95 &&
            (getComputedStyle(canvas).contentVisibility === 'hidden' ||
              !canvas.childElementCount)
          ) {
            window.__blank.push(el.dataset.widgetId);
          }
        }
        requestAnimationFrame(sample);
      };
      sample();
    });
    await page
      .locator('[data-widget-id="lightbox"] .wr-live-hit')
      .evaluate((e) => e.click());
    await page.waitForFunction(() =>
      document.querySelector('[data-widget-id="lightbox"] .wr-live-canvas img'),
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[data-widget-id="lightbox"]'))
          .transform === 'none',
    );
    const held = await page
      .locator('[data-widget-id="lightbox"]')
      .evaluate((e) => ({
        ready: e.dataset.widgetReady,
        opacity: Number(
          getComputedStyle(e.querySelector('.wr-tile-preview')).opacity,
        ),
        inert: e.querySelector('.wr-live-content').inert,
      }));
    assert.equal(held.ready, 'false');
    assert.ok(held.opacity > 0.99);
    assert.ok(held.inert);
    await page.screenshot({ path: `/tmp/widget-handoff-held-${kind}.png` });
    await page.evaluate(() => window.__releaseImages());
    await page.waitForFunction(
      () =>
        document.querySelector('[data-widget-id="lightbox"]').dataset
          .widgetReady === 'true' &&
        Number(
          getComputedStyle(
            document.querySelector(
              '[data-widget-id="lightbox"] .wr-tile-preview',
            ),
          ).opacity,
        ) === 0,
    );
    await page.screenshot({ path: `/tmp/widget-handoff-live-${kind}.png` });
    await page.locator('.wr-brand').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-widget-id="lightbox"] .wr-live-canvas')
          .dataset.render === 'parked',
    );
    await page
      .locator('[data-widget-id="tabs"] .wr-live-hit')
      .evaluate((e) => e.click());
    await page
      .locator('[data-widget-id="lightbox"] .wr-live-hit')
      .evaluate((e) => e.click());
    await page.locator('.wr-brand').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.wr-live-canvas')].every(
        (e) => e.dataset.render === 'parked',
      ),
    );
    assert.deepEqual(await page.evaluate(() => window.__blank), []);
    assert.deepEqual(errors, []);
    console.log(
      kind,
      'cold image gate, covered handoff, rapid reversal passed',
    );
  } finally {
    await browser.close();
  }
}
