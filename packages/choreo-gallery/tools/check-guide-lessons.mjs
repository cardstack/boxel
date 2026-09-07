/* global window, StorageEvent */
/* eslint-disable n/no-unsupported-features/node-builtins -- localStorage is the browser API inside page.evaluate. */
/* eslint-disable n/no-missing-import -- /app imports execute in the Vite-served browser. */
import assert from 'node:assert/strict';

import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
try {
  for (const [slug, id] of [
    ['interactive-slides', 'slides'],
    ['core-reorder-grid', 'grid'],
    ['core-shared-layout', 'tabs'],
    ['core-reveal', 'reveal'],
    ['core-header', 'header'],
    ['interactive-drift', 'drift'],
    ['interactive-hang', 'hang'],
    ['core-presence', 'presence'],
  ]) {
    await p.goto('http://localhost:4592/docs/' + slug, {
      waitUntil: 'domcontentloaded',
    });
    await p.locator('[data-demo-lesson="' + id + '"]').waitFor();
    assert.equal(await p.locator('.guide-demo iframe').count(), 1);
    await p
      .frameLocator('.guide-demo iframe')
      .locator('.demo-workbench')
      .waitFor();
    await p
      .frameLocator('.guide-demo iframe')
      .locator('.dialkit-slider')
      .first()
      .waitFor();
    assert.ok(await p.locator('[data-demo-lesson] details').count());
    console.log(slug, 'lesson + live embed + code OK');
  }
  await p.evaluate(async () => {
    (await import('/app/lib/theme.ts')).setThemeMode('light');
  });
  await p.goto('http://localhost:4592/_widgets', {
    waitUntil: 'domcontentloaded',
  });
  await p.locator('.wr-shell').waitFor();
  assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
  await p.evaluate(async () => {
    const t = await import('/app/lib/theme.ts');
    t.setThemeMode('light');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'choreo-theme', newValue: 'light' }),
    );
  });
  assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(
    await p.evaluate(() => window.localStorage.getItem('choreo-theme')),
    'light',
  );
  await p.goto('http://localhost:4592/_widget/keyframes', {
    waitUntil: 'domcontentloaded',
  });
  await p.locator('[data-test-widget-embed]').waitFor();
  assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
  await p.goto('http://localhost:4592/docs/core-presence', {
    waitUntil: 'domcontentloaded',
  });
  await p.locator('[data-demo-lesson]').waitFor();
  assert.equal(await p.locator('html').getAttribute('data-theme'), 'light');

  console.log(
    'Gallery + live tile stay dark; saved light preference survives.',
  );
  assert.deepEqual(errors, []);
} finally {
  await b.close();
}
