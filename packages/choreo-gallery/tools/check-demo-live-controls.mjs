/* global document, DOMMatrixReadOnly, getComputedStyle */
import assert from 'node:assert/strict';

import { chromium } from 'playwright';

// Run against the live app, or pass a built site's base URL (including #/ for hash routing).
const base = new URL(process.env.DEMO_BASE_URL ?? 'http://localhost:4592');
if (base.hash) {
  base.hash = '/playground/keyframes';
} else {
  base.pathname = `${base.pathname.replace(/\/$/, '')}/playground/keyframes`;
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  const duration = page.getByRole('slider', { name: 'Duration', exact: true });
  await duration.waitFor();
  await page.locator('.morph').evaluate((element) => {
    element.dataset.liveIdentity = 'kept';
  });
  await duration.press('ArrowRight');
  const seconds = Number(await duration.getAttribute('aria-valuenow'));
  await page.waitForFunction(
    (value) =>
      document
        .querySelector('.morph-glow')
        ?.getAnimations()
        .some(
          (animation) =>
            Math.abs(
              Number(animation.effect?.getTiming().duration) - value * 1000,
            ) < 1,
        ),
    seconds,
  );
  const scale = page.getByRole('slider', {
    name: 'Peak Scale (×)',
    exact: true,
  });
  await scale.press('End');
  await page.waitForFunction(() => {
    const element = document.querySelector('.morph');
    if (!element) {
      return false;
    }
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b) > 1.8;
  });
  assert.equal(
    await page.locator('.morph').getAttribute('data-live-identity'),
    'kept',
  );
  const rows = await page
    .locator('.workbench-dials .dialkit-slider')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const label = element
          .querySelector('.dialkit-slider-label')
          .getBoundingClientRect();
        const value = element
          .querySelector('.dialkit-slider-value')
          .getBoundingClientRect();
        return {
          height: element.getBoundingClientRect().height,
          overlap: label.right > value.left,
        };
      }),
    );
  assert.ok(
    rows.length && rows.every((row) => row.height <= 38 && !row.overlap),
    'Compact native rows keep labels clear of their values',
  );
  assert.deepEqual(errors, []);
  console.log(
    `Live duration ${seconds}s and peakScale 2 reached existing motion nodes; ${rows.length} compact rows passed.`,
  );
} finally {
  await browser.close();
}
