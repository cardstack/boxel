import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--mute-audio'],
});
try {
  for (const path of [
    '../../choreo-test-app/app/styles/app.css',
    '../styles/app.scoped.css',
  ]) {
    const css = readFileSync(new URL(path, import.meta.url), 'utf8');
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style>
      <style>body{margin:0}.stage-row{width:100vw}.stage-wrap{width:100%}</style>
      <main class="choreo-site"><div class="demo-body is-theater">
      <div class="stage-row"><div class="stage-wrap"><div class="tw-face"></div>
      </div></div></div></main>`);
    for (const face of ['tw-face', 'sg-face', 'sy-page']) {
      await page.locator('.stage-wrap > div').evaluate((el, name) => {
        el.className = name;
      }, face);
      for (const [width, height] of [
        [390, 844],
        [430, 932],
        [844, 390],
        [1440, 1000],
      ]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.locator('.stage-wrap').boundingBox();
        assert.equal(
          bounds.height,
          Math.min(width, height),
          `${path}: ${face} ${width}×${height}`,
        );
        assert.ok(
          bounds.height <= bounds.width,
          'theater must never be taller than square',
        );
      }
    }
    console.log(`PASS theater sizing: ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
