/* global document */
import assert from 'node:assert/strict';

import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4600';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole('button', { name: 'Reverse order', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove Build a prototype', exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[data-task-id="prototype"]'),
  );
  assert.deepEqual(
    await page
      .locator('[data-task-id]')
      .evaluateAll((els) => els.map((e) => e.dataset.taskId)),
    ['review', 'outline'],
  );
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  assert.equal(await page.locator('[data-task-id]').count(), 3);
  await page.goto(`${base}/spatial`);
  await page
    .getByRole('button', { name: 'Toggle perspective', exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.tutorial-plane')
      .style.transform.includes('rotateY(-32deg)'),
  );
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Count: 1', exact: true }).count(),
    1,
  );
  await page.goto(`${base}/film`);
  await page.evaluate(() => document.fonts.ready);
  const frame = page.locator('[data-tutorial-film]');
  const capture = async (time) => {
    await frame.evaluate((el, t) => el.tutorialCapture.renderAt(t), time);
    const bounds = await frame.boundingBox();
    const dot = await page.locator('.tutorial-film-dot').boundingBox();
    assert(
      dot.x >= bounds.x && dot.y >= bounds.y + bounds.height * 0.35,
      'The actor stays below the title',
    );
    assert(
      dot.x + dot.width <= bounds.x + bounds.width &&
        dot.y + dot.height <= bounds.y + bounds.height,
      'The actor stays inside the frame',
    );
    return frame.screenshot();
  };
  const two = await capture(2);
  await capture(5);
  const back = await capture(2);
  assert(two.equals(back), 'Backward seek must reproduce the same pixels');
  await page.reload();
  const fresh = await capture(2);
  assert(two.equals(fresh), 'Fresh seek must reproduce the same pixels');
  await capture(6);
  await capture(0);
  await page.getByRole('button', { name: 'Play scene', exact: true }).click();
  await page.getByRole('button', { name: 'Pause scene', exact: true }).click();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Task identity and interruption, live spatial input, and forward/backward/fresh film frames pass.',
  );
} finally {
  await browser.close();
}
