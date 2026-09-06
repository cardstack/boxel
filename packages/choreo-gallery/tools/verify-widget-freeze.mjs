import assert from 'node:assert/strict';

import { chromium, webkit } from 'playwright';
const mobile = process.env.FREEZE_BROWSER === 'webkit';
const browser = await (mobile ? webkit : chromium).launch({
  headless: true,
  executablePath: mobile ? process.env.WEBKIT_PATH : process.env.CHROME_PATH,
});
try {
  let page = await browser.newPage({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1920, height: 1080 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.__audios = [];
    window.Audio = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audios.push(this);
      }
    };
  });
  await page.goto(
    process.env.FREEZE_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
  );
  if (process.env.FREEZE_HOST_CARD) {
    await page.locator('[data-choreo-gallery]').waitFor({ timeout: 90000 });
    page = await (
      await page.locator('[data-choreo-gallery]').elementHandle()
    ).contentFrame();
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-widget-id]').length === 45,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.wr-live-content')].every((el) =>
        el
          .getAnimations({ subtree: true })
          .every((a) => a.playState !== 'running'),
      ),
    {},
    { timeout: 10000 },
  );
  const initial = await page.evaluate(() => ({
    active: document.querySelectorAll('[data-widget-active="true"]').length,
    inert: [...document.querySelectorAll('.wr-live-content')].every(
      (e) => e.inert,
    ),
    running: [...document.querySelectorAll('.wr-live-content')]
      .flatMap((e) => e.getAnimations({ subtree: true }))
      .filter((a) => a.playState === 'running').length,
  }));
  console.log({ initial });
  assert.equal(initial.active, 0);
  assert.ok(initial.inert);
  assert.equal(initial.running, 0);
  await page.evaluate(() => {
    window.__activity = [];
    window.__violations = [];
    window.__lastAction = 0;
    function sample() {
      const root = document.querySelector('.wr-shell');
      const active = [
        ...document.querySelectorAll('[data-widget-active="true"]'),
      ].map((e) => e.dataset.widgetId);
      if (active.length > 1) {
        window.__violations.push(active);
      }
      const count = Number(root.dataset.quickActions);
      if (
        Number.isFinite(count) &&
        count > 0 &&
        count !== window.__lastAction
      ) {
        window.__activity.push({
          t: window.__audios.find((a) => a.src.includes('quick-george'))
            ?.currentTime,
          action: root.dataset.quickLastDemo,
          active,
        });
        window.__lastAction = count;
      }
      window.__freezeRaf = requestAnimationFrame(sample);
    }
    sample();
  });
  if (process.env.WARM_MOCKUP) {
    await page
      .locator('[data-widget-id="mockup"] .wr-live-hit')
      .evaluate((el) => el.click());
    await page.waitForFunction(() =>
      document.querySelector('.wr-shell')?.classList.contains('is-live'),
    );
    await page
      .locator('[data-live-demo="mockup"] .mg-seg button')
      .last()
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-live-demo="mockup"] .mg-stage')
          ?.getAttribute('data-ready') === 'yes',
    );
    await page.locator('.wr-brand').click();
  }
  await page.getByRole('button', { name: '50-second highlights ↗' }).click();
  await page
    .getByRole('button', { name: 'Replay highlights', exact: true })
    .waitFor({ timeout: 80000 })
    .catch(async (e) => {
      console.log(
        'TOUR_DIAGNOSTIC',
        errors,
        await page.evaluate(() => ({
          body: document.body.innerText.slice(-1600),
          audio: window.__audios.map((a) => ({
            src: a.src,
            time: a.currentTime,
            paused: a.paused,
            error: a.error?.message,
          })),
          root: document.querySelector('.wr-shell')?.dataset,
        })),
      );
      throw e;
    });
  const result = await page.evaluate(() => ({
    activity: window.__activity,
    violations: window.__violations,
    actions: document.querySelector('.wr-shell').dataset.quickActions,
    missed: document.querySelector('.wr-shell').dataset.quickMissed,
  }));
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  assert.equal(result.actions, '23');
  assert.equal(result.missed, '');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(errors, []);
  assert.ok(
    result.activity.every((x) => x.active.includes(x.action)),
    'Each clicked demo must be active',
  );
  // A finite effect created during an off-focus render must hold its frame,
  // then continue on the same DOM node when focus comes back.
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.textContent = 'freeze probe';
    document
      .querySelector('[data-live-demo="lightbox"] .wr-live-canvas')
      .append(el);
    window.__probe = el;
    window.__probeAnimation = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 10000,
    });
  });
  await page.waitForFunction(
    () =>
      window.__probeAnimation.playState === 'paused' &&
      !window.__probeAnimation.pending,
  );
  const held = await page.evaluate(async () => {
    const t = window.__probeAnimation.currentTime;
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame);
    }
    return { before: t, after: window.__probeAnimation.currentTime };
  });
  assert.equal(held.before, held.after);
  await page
    .locator('[data-widget-id="lightbox"] .wr-live-hit')
    .evaluate((el) => el.click());
  await page.waitForFunction(
    () =>
      window.__probeAnimation.playState === 'running' &&
      window.__probeAnimation.currentTime > 100,
  );
  assert.ok(await page.evaluate(() => window.__probe.isConnected));
  console.log('Freeze/resume retains the same DOM and animation state.');
} finally {
  await browser.close();
}
