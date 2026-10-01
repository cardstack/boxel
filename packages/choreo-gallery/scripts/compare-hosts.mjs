/* global document, getComputedStyle */
import { chromium } from 'playwright';
const base = process.argv[2];
if (!base) {
  throw new Error(
    'Usage: node scripts/compare-hosts.mjs <base-url> [routes...]',
  );
}
const routes = process.argv.slice(3);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? 'chromium',
  args: ['--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [];
const media = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (/\.(mp3|glb|wasm|cube)(\?|$)/.test(r.url())) {
    media.push({ url: r.url(), status: r.status() });
  }
});
const results = [];
try {
  for (const route of routes.length
    ? routes
    : ['', 'playhead', 'mockup', 'long-take', 'sagrada', 'towers', 'sylva']) {
    const start = Date.now();
    const errorStart = errors.length;
    const mediaStart = media.length;
    try {
      await page.goto(new URL(route, base).href, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      if (!route) {
        await page.locator('.card').first().waitFor();
        const count = await page.locator('.card').count();
        const theme = page.getByRole('button', {
          name: 'Switch to light mode',
        });
        // Boxel first shows inert prerendered HTML. Confirm the interaction
        // took effect rather than mistaking that snapshot for a live app.
        for (let attempt = 0; attempt < 12; attempt++) {
          if (
            await page.evaluate(
              () =>
                (
                  document.querySelector('.choreo-site') ??
                  document.documentElement
                ).getAttribute('data-theme') === 'light',
            )
          ) {
            break;
          }
          if (await theme.count()) {
            await theme.click();
          }
          try {
            await page.waitForFunction(
              () =>
                (
                  document.querySelector('.choreo-site') ??
                  document.documentElement
                ).getAttribute('data-theme') === 'light',
              {},
              { timeout: 5000 },
            );
            break;
          } catch (error) {
            if (attempt === 11) {
              throw error;
            }
          }
        }
        const light = await page.evaluate(() =>
          (
            document.querySelector('.choreo-site') ?? document.documentElement
          ).getAttribute('data-theme'),
        );
        const dark = page.getByRole('button', { name: 'Switch to dark mode' });
        if (await dark.count()) {
          await dark.click();
        }
        results.push({ route, count, light });
      } else {
        await page
          .locator(`.demo-head[data-demo="${route}"]`)
          .waitFor({ timeout: 90000 });
        const sample = await page.locator('.sample code').first().innerText();
        const item = { route, sampleLength: sample.length };
        if (['mockup', 'long-take'].includes(route)) {
          const p = route === 'mockup' ? 'mg' : 'lt';
          await page.locator(`.${p}-seg button`).nth(1).click();
          await page.locator(`.${p}-stage canvas`).waitFor({ timeout: 45000 });
          item.canvas = await page
            .locator(`.${p}-stage canvas`)
            .evaluate((el) => ({
              width: el.width,
              height: el.height,
              visible: el.getBoundingClientRect().width > 0,
            }));
          item.loading = await page.locator(`.${p}-loading`).allTextContents();
        }
        if (['sagrada', 'towers'].includes(route)) {
          const theater = page.getByRole('button', { name: /theater/i });
          if (await theater.count()) {
            await theater.first().click();
            item.theater = await page
              .locator('.demo-body')
              .getAttribute('class');
          }
          const frame = page.frameLocator('.stage-wrap iframe').first();
          await frame
            .locator('.cf-frame')
            .waitFor({ state: 'attached', timeout: 60000 });
          await frame
            .frameLocator('.cf-frame')
            .locator('canvas')
            .first()
            .waitFor({ state: 'attached', timeout: 60000 });
          await frame
            .getByRole('button', { name: /Begin muted/i })
            .click({ timeout: 60000 });
          await frame
            .getByRole('button', { name: /Begin muted/i })
            .waitFor({ state: 'detached', timeout: 30000 });
          item.gateGone =
            (await frame
              .getByRole('button', { name: /Begin muted/i })
              .count()) === 0;
          await frame.locator('.cf-stage').hover();
          await frame
            .getByRole('button', { name: 'pause', exact: true })
            .click();
          item.paused =
            (await frame
              .getByRole('button', { name: 'play', exact: true })
              .count()) === 1;
          const captions = frame.getByRole('button', {
            name: 'captions',
            exact: true,
          });
          const beforeCaption = await captions.getAttribute('class');
          await captions.click();
          item.captionsChanged =
            (await captions.getAttribute('class')) !== beforeCaption;
          item.volume = await frame
            .getByRole('slider', { name: 'volume', exact: true })
            .evaluate((el) => {
              el.value = '0.4';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return el.value;
            });
          item.playerType = await frame
            .locator('.cf-chap, .cf-word')
            .evaluateAll((els) =>
              els.map((el) => ({
                control: el.className,
                fontSize: getComputedStyle(el).fontSize,
                color: getComputedStyle(el).color,
              })),
            );
          if (process.env.SCREENSHOT_DIR) {
            await page.screenshot({
              path: `${process.env.SCREENSHOT_DIR}/${route}.png`,
            });
          }
          const beforeChapter = await frame.locator('.cf-chap').innerText();
          await frame
            .getByRole('button', { name: 'next chapter', exact: true })
            .click();
          await frame
            .locator('.cf-chap')
            .filter({ hasNotText: beforeChapter })
            .waitFor();
          item.chapterChanged =
            (await frame.locator('.cf-chap').innerText()) !== beforeChapter;
          await frame.locator('.cf-stage').hover();
          await frame.locator('.cf-word').click();
          await frame.getByRole('button', { name: /Begin muted/i }).waitFor();
          item.titleScreen = true;
          item.frames = page.frames().map((f) => f.url().slice(0, 150));
        }
        if (route === 'sylva') {
          const sylva = page.frameLocator('.stage-wrap iframe').first();
          await sylva.locator('canvas').first().waitFor({ timeout: 60000 });
          item.canvas = await sylva
            .locator('canvas')
            .first()
            .evaluate((el) => ({ width: el.width, height: el.height }));
          item.frames = page.frames().length;
        }
        results.push(item);
      }
    } catch (error) {
      results.push({ route, error: error.message });
    }
    results.at(-1).durationMs = Date.now() - start;
    results.at(-1).errors = errors.slice(errorStart);
    results.at(-1).media = media.slice(mediaStart);
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser.close();
}
if (
  results.some(
    (r) =>
      r.error ||
      r.errors.length ||
      r.media.some((m) => m.status >= 400) ||
      r.paused === false ||
      r.captionsChanged === false ||
      r.chapterChanged === false ||
      r.titleScreen === false,
  )
) {
  process.exitCode = 1;
}
