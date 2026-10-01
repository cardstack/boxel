import assert from 'node:assert/strict';

import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await page.goto(
    process.env.ROOM_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
    {
      waitUntil: 'domcontentloaded',
    },
  );
  await page.getByRole('button', { name: '50-second highlights ↗' }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('.wr-shell').dataset.quickActions) >= 2,
    {},
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const snapshot = await page
    .locator('[data-widget-id="lightbox"]')
    .getAttribute('style');
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await page.locator('[data-widget-id="lightbox"]').getAttribute('style'),
    snapshot,
  );
  await page.getByRole('button', { name: 'Explore room', exact: true }).click();
  assert.equal(await page.locator('[data-room-cursor]').count(), 0);
  await page
    .getByRole('button', { name: 'Full audio tour', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Guided tour narration', exact: true })
    .waitFor();
  console.log(
    'Reduced motion: actions, paused camera, cursor cleanup and full-tour access passed',
  );
} finally {
  await browser.close();
}
