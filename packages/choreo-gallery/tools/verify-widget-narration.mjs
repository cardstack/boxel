import assert from 'node:assert/strict';

import { webkit } from 'playwright';
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
    window.__clips = [];
    window.__attempts = [];
    window.__audios = [];
    window.__injected = false;
    window.Audio = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audios.push(this);
        this.addEventListener('playing', () => window.__clips.push(this.src));
      }
      play() {
        this.playbackRate = 4;
        window.__attempts.push(this.src);
        if (this.src.endsWith('/enter.mp3') && !window.__injected) {
          window.__injected = true;
          return Promise.reject(
            new DOMException(
              'Simulated source-switch interruption',
              'AbortError',
            ),
          );
        }
        return super.play();
      }
    };
  });
  await page.goto(
    process.env.NARRATION_URL ||
      'http://localhost:4590/_widgets?film=1#/_widgets',
  );
  await page
    .getByRole('button', { name: 'Full audio tour', exact: true })
    .click();
  await page
    .waitForFunction(
      () => window.__clips.some((s) => s.endsWith('/presence.mp3')),
      {},
      { timeout: 60000 },
    )
    .catch(async (e) => {
      console.log(
        'DIAGNOSTIC',
        await page.evaluate(() => ({
          clips: window.__clips,
          attempts: window.__attempts,
          audio: window.__audios.map((a) => ({
            src: a.src,
            paused: a.paused,
            time: a.currentTime,
            error: a.error?.message,
          })),
          text: document.body.innerText.slice(-1000),
        })),
        errors,
      );
      throw e;
    });
  assert.ok(await page.evaluate(() => window.__injected));
  await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
  assert.ok(await page.evaluate(() => window.__audios.every((a) => a.paused)));
  const count = await page.evaluate(() => window.__attempts.length);
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
    }
  });
  assert.equal(
    await page.evaluate(() => window.__attempts.length),
    count,
    'Explicit pause must not restart playback',
  );
  await page.getByRole('button', { name: 'Resume stop', exact: true }).click();
  await page.waitForFunction(
    () => window.__clips.some((s) => s.endsWith('/keyframes.mp3')),
    {},
    { timeout: 40000 },
  );
  // An unexpected pause should recover, while user pause above stays paused.
  await page.evaluate(() => window.__audios[0].pause());
  await page.waitForFunction(() => !window.__audios[0].paused);
  await page.waitForFunction(
    () => window.__clips.some((s) => s.endsWith('/pointer.mp3')),
    {},
    { timeout: 40000 },
  );
  console.log(
    await page.evaluate(() => ({
      clips: window.__clips,
      attempts: window.__attempts,
      interruptionRecovered: window.__injected,
    })),
    errors,
  );
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: 'Leave tour', exact: true }).click();
  assert.ok(await page.evaluate(() => window.__audios.every((a) => a.paused)));
  console.log(
    'Separate narration clips advance; AbortError recovers; pause/resume/leave passed.',
  );
} finally {
  await browser.close();
}
