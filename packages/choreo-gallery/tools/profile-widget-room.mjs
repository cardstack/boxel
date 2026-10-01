import fs from 'node:fs/promises';

import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    process.env.ROOM_URL || 'http://localhost:4590/_widgets?film=1#/_widgets',
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-widget-id]').length === 45,
  );
  // Sample a fixed interval including initial mount work, then the same six camera moves.
  const result = await page.evaluate(async () => {
    const measure = async (ms) => {
      const ds = [];
      let start = performance.now(),
        last = start;
      while (performance.now() - start < ms) {
        await new Promise(requestAnimationFrame);
        const n = performance.now();
        ds.push(n - last);
        last = n;
      }
      ds.sort((a, b) => a - b);
      return {
        frames: ds.length,
        p50: ds[Math.floor(ds.length * 0.5)],
        p95: ds[Math.floor(ds.length * 0.95)],
        max: Math.max(...ds),
        over50: ds.filter((n) => n > 50).length,
      };
    };
    const initial = await measure(4000);
    const structure = () => ({
      nodes: document.querySelectorAll('*').length,
      mounted: [...document.querySelectorAll('.wr-live-canvas')].filter(
        (e) => e.childElementCount,
      ).length,
      visible: [...document.querySelectorAll('[data-widget-id]')].filter(
        (e) => getComputedStyle(e).visibility === 'visible',
      ).length,
      rendered: [...document.querySelectorAll('.wr-live-canvas')].filter(
        (e) =>
          e.childElementCount &&
          getComputedStyle(e).contentVisibility !== 'hidden',
      ).length,
      animations: document.getAnimations().length,
    });
    const overview = structure();
    const moves = [];
    for (const index of [5, 0, 4, 1, 3, 2]) {
      document.querySelectorAll('.wr-bays button')[index].click();
      moves.push({ index, ...(await measure(1700)) });
    }
    return { initial, overview, moves, after: structure() };
  });
  const metrics = await cdp.send('Performance.getMetrics');
  result.metrics = Object.fromEntries(
    metrics.metrics
      .filter((m) =>
        [
          'LayoutCount',
          'RecalcStyleCount',
          'LayoutDuration',
          'RecalcStyleDuration',
          'ScriptDuration',
          'TaskDuration',
          'JSHeapUsedSize',
        ].includes(m.name),
      )
      .map((m) => [m.name, m.value]),
  );
  result.errors = errors;
  console.log(JSON.stringify(result, null, 2));
  if (process.env.ROOM_REPORT) {
    await fs.writeFile(
      process.env.ROOM_REPORT,
      JSON.stringify(result, null, 2),
    );
  }
} finally {
  await browser.close();
}
