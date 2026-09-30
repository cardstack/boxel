import assert from 'node:assert/strict';

import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  const page = await browser.newPage({
    viewport: process.env.MOBILE
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    process.env.ROOM_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-gallery-sign]').length === 6 &&
      [...document.querySelectorAll('.wr-tile-preview')].every(
        (i) => i.complete && i.naturalWidth,
      ),
  );
  assert.equal(
    await page.locator('.wr-canopy,.wr-reveal-fin,.wr-ceiling-slot').count(),
    0,
  );
  await page.screenshot({ path: '/tmp/room-architecture-overview.png' });
  for (let index = 0; index < 6; index++) {
    await page.locator('.wr-bays button').nth(index).click();
    await page.evaluate(async () => {
      let last = '',
        stable = 0;
      while (stable < 12) {
        await new Promise(requestAnimationFrame);
        const next = document.querySelector('.wr-world').style.transform;
        stable = next === last ? stable + 1 : 0;
        last = next;
      }
    });
    assert.equal(await page.locator('.wr-intro').count(), 0);
    const sign = page.locator(`[data-gallery-sign="${index}"]`);
    const bounds = await sign.boundingBox();
    assert.ok(
      bounds && bounds.y > 65 && bounds.y + bounds.height < 900,
      JSON.stringify({ index, bounds }),
    );
    if (process.env.MOBILE) {
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= 390,
        JSON.stringify(bounds),
      );
    }
    assert.ok(
      await sign
        .locator('strong')
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.screenshot({ path: `/tmp/room-architecture-bay-${index}.png` });
  }
  await page
    .getByRole('button', { name: 'All 45 demos ☰', exact: true })
    .click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.wr-results img')];
    return (
      images.length === 45 &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  });
  assert.deepEqual(errors, []);
  console.log(
    'All six mounted section signs fit their bays; no projecting fins or overhead planes; no page errors.',
  );
} finally {
  await browser.close();
}
