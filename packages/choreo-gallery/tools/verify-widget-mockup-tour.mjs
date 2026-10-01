import assert from 'node:assert/strict';
import fs from 'node:fs';

import { webkit } from 'playwright';
const ids = [
  ...fs
    .readFileSync('packages/choreo-test-app/app/lib/widget-tour.ts', 'utf8')
    .matchAll(/id: '([^']+)'/g),
].map((m) => m[1]);
const b = await webkit.launch({
  headless: true,
  executablePath: process.env.WEBKIT_PATH,
});
try {
  for (const quick of [false, true]) {
    const p = await b.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const errors = [];
    let failedModel = false;
    if (process.env.MOCKUP_WAIT_ACTIVE) {
      await p.route('**/iphone-15-pro.glb*', async (route) => {
        await p.waitForFunction(
          () =>
            document
              .querySelector('[data-widget-id="mockup"]')
              ?.getAttribute('data-widget-active') === 'true',
        );
        await route.continue();
      });
    }
    if (process.env.MOCKUP_FAIL_MODEL) {
      await p.route('**/iphone-15-pro.glb*', async (route) => {
        if (!failedModel) {
          failedModel = true;
          return route.fulfill({
            status: 503,
            contentType: 'text/plain',
            body: 'Temporary gateway failure',
          });
        }
        return route.continue();
      });
    }
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(() => {
      const A = window.Audio;
      window.__audios = [];
      window.Audio = class extends A {
        constructor(...a) {
          super(...a);
          window.__audios.push(this);
        }
      };
    });
    await p.goto(
      process.env.MOCKUP_URL ||
        'http://localhost:4590/_widgets?film=1#/_widgets',
    );
    await p
      .getByRole('button', {
        name: quick ? '50-second highlights ↗' : 'Full audio tour',
        exact: true,
      })
      .click();
    if (quick) {
      await p.waitForFunction(() => window.__audios[0]?.readyState >= 1);
      await p.evaluate(() => (window.__audios[0].currentTime = 28.5));
    } else {
      for (let i = 0; i < ids.indexOf('mockup'); i++) {
        await p
          .getByRole('button', { name: 'Next stop →', exact: true })
          .click();
      }
    }
    await p.waitForFunction(
      () =>
        document.querySelector('[data-live-demo="mockup"] .mg-page')?.dataset
          .mode === '3d',
      {},
      { timeout: 45000 },
    );
    await p.waitForFunction(
      () => {
        const tile = document.querySelector('[data-widget-id="mockup"]');
        const stage = tile?.querySelector('.mg-stage');
        const canvas = stage?.querySelector('canvas');
        return (
          tile?.getAttribute('data-widget-ready') === 'true' &&
          stage?.getAttribute('data-ready') === 'yes' &&
          canvas?.width > 300 &&
          Number(getComputedStyle(canvas).opacity) === 1
        );
      },
      {},
      { timeout: 15000 },
    );
    if (!quick) {
      await p.waitForFunction(() =>
        document.querySelector('.wr-shell')?.classList.contains('is-live'),
      );
    }
    await p.waitForFunction(
      () =>
        Number(
          getComputedStyle(
            document.querySelector(
              '[data-widget-id="mockup"] .wr-tile-preview',
            ),
          ).opacity,
        ) < 0.05,
    );
    await p.screenshot({
      path: `/tmp/mockup-visible-${quick ? 'highlights' : 'full'}.png`,
    });
    console.log(
      quick ? 'Highlights' : 'Full tour',
      'Mockup entered 3D',
      errors,
    );
    assert.deepEqual(errors, []);
    await p.close();
  }
} finally {
  await b.close();
}
