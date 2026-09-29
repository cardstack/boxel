import assert from 'node:assert/strict';
import fs from 'node:fs';

import { webkit } from 'playwright';
const ids = [
  ...fs
    .readFileSync('test-app/app/lib/widget-tour.ts', 'utf8')
    .matchAll(/id: '([^']+)'/g),
].map((m) => m[1]);
const browser = await webkit.launch({
  headless: true,
  executablePath: process.env.WEBKIT_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.__tourAudio = [];
    window.__tourEvents = [];
    window.Audio = class extends Original {
      constructor(...args) {
        super(...args);
        window.__tourAudio.push(this);
        for (const type of [
          'playing',
          'ended',
          'error',
          'stalled',
          'waiting',
          'pause',
        ]) {
          this.addEventListener(type, () =>
            window.__tourEvents.push({
              type,
              src: this.src,
              time: this.currentTime,
              duration: this.duration,
              paused: this.paused,
              at: performance.now(),
              error: this.error?.message,
            }),
          );
        }
      }
    };
  });
  const failedRequests = [];
  if (process.env.FAIL_CLIP) {
    await page.route(`**/${process.env.FAIL_CLIP}.mp3*`, async (route) => {
      failedRequests.push(route.request().url());
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'Temporary gateway failure',
      });
    });
  }
  const stalledRoutes = [];
  let recoveredStall = false;
  if (process.env.STALL_CLIP) {
    await page.route(`**/${process.env.STALL_CLIP}.mp3*`, async (route) => {
      if (route.request().url().includes('audioRetry=')) {
        recoveredStall = true;
        await Promise.allSettled(
          stalledRoutes.map((pending) => pending.abort()),
        );
        return route.continue();
      }
      stalledRoutes.push(route);
    });
  }
  await page.goto(
    process.env.ROOM_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
  );
  await page
    .getByRole('button', { name: 'Full audio tour', exact: true })
    .click();
  const start = Number(process.env.TOUR_START || 1);
  for (let i = 1; i < start; i++) {
    await page
      .getByRole('button', { name: 'Next stop →', exact: true })
      .click();
  }
  for (const id of ids.slice(
    start - 1,
    Number(process.env.TOUR_END || ids.length),
  )) {
    if (id === process.env.FAIL_CLIP) {
      continue;
    }
    await page
      .waitForFunction(
        (id) =>
          window.__tourEvents.some(
            (e) =>
              e.type === 'ended' &&
              e.src.split('?')[0].endsWith('/' + id + '.mp3'),
          ),
        id,
        { timeout: 35000 },
      )
      .catch(async (error) => {
        console.log(
          'STALLED',
          id,
          await page.evaluate(() => ({
            events: window.__tourEvents.slice(-12),
            audio: window.__tourAudio.map((a) => ({
              src: a.src,
              time: a.currentTime,
              duration: a.duration,
              paused: a.paused,
              ended: a.ended,
              ready: a.readyState,
              network: a.networkState,
              error: a.error?.message,
            })),
            guide: document.querySelector('.wr-guide-plane')?.textContent,
            active: document
              .querySelector('[data-widget-active="true"]')
              ?.getAttribute('data-widget-id'),
          })),
          errors,
        );
        throw error;
      });
    console.log('ENDED', ids.indexOf(id) + 1, id);
  }
  assert.deepEqual(errors, []);
  if (process.env.FAIL_CLIP) {
    assert.ok(
      failedRequests.some((url) => url.includes('audioRetry=2')),
      'Failed clip gets two fresh retries before continuing',
    );
  }
  if (process.env.STALL_CLIP) {
    assert.ok(recoveredStall, 'A stalled media request must be retried');
  }
  console.log('Requested full-tour stops completed in WebKit.');
} finally {
  await browser.close();
}
