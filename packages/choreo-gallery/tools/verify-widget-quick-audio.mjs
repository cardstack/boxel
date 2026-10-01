import assert from 'node:assert/strict';

import { webkit } from 'playwright';

const browser = await webkit.launch({
  headless: true,
  executablePath: process.env.WEBKIT_PATH,
});
try {
  const page = await browser.newPage();
  let failed = false;
  await page.route('**/quick-george.mp3*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('acceptHeader'), 'audio/mpeg');
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: 'Unavailable',
      });
    } else {
      await route.continue();
    }
  });
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__tourAudio = this;
      return play.call(this);
    };
  });
  await page.goto(
    process.env.ROOM_URL ||
      'http://localhost:4591/iframe/tour-20260906/widget-room.html?film=1#/_widgets',
  );
  await page.getByRole('button', { name: '50-second highlights' }).click();
  await page.waitForFunction(() => window.__tourAudio?.currentTime > 2);
  assert.ok(failed, 'The initial source failed');
  assert.match(
    await page.evaluate(() => window.__tourAudio.src),
    /audioRetry=/,
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.evaluate(() => window.__tourAudio.currentTime);
  await page.evaluate(async () => {
    for (let n = 0; n < 20; n++) {
      await new Promise(requestAnimationFrame);
    }
  });
  assert.ok(await page.evaluate(() => window.__tourAudio.paused));
  assert.equal(
    await page.evaluate(() => window.__tourAudio.currentTime),
    paused,
  );
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(
    (time) =>
      !window.__tourAudio.paused && window.__tourAudio.currentTime > time + 1,
    paused,
  );
  await page.evaluate(() => {
    window.__tourAudio.currentTime = window.__tourAudio.duration - 1;
  });
  await page
    .getByRole('button', { name: 'Replay highlights', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Replay highlights', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !window.__tourAudio.paused &&
      window.__tourAudio.currentTime > 0 &&
      window.__tourAudio.currentTime < 4,
  );
  console.log(
    'WebKit: failed initial source recovers; pause, position-preserving resume, completion and replay pass.',
  );
} finally {
  await browser.close();
}
