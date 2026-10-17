/**
 * Sweeps the published gallery in headless Chrome and reports what's broken.
 *
 *   node packages/choreo-gallery/tools/check-published-site.mjs
 *   node packages/choreo-gallery/tools/check-published-site.mjs https://choreo.boxel.site/ --themes dark --only towers,crossing
 *   node packages/choreo-gallery/tools/check-published-site.mjs --json sweep.json
 *
 * It reads the published realm's file list (`_mtimes`), so it checks whatever
 * the published copy holds:
 *
 * - the grid shows a tile for every demo, in each theme;
 * - every demo's URL loads that demo's page directly, in each theme, and a
 *   demo with a lab opens it;
 * - each film's frame posts its first frame, with no "Unable to load" status;
 * - clicking each tile opens its demo, and Back returns to the grid;
 * - the 3D Gallery link opens the widget room, and the room renders with no
 *   engine issue;
 * - every guide renders, with a live demo for each card it embeds.
 *
 * On every page, any console error, uncaught exception, failed request, or
 * response of 400 or more from the site fails the check.
 *
 * Chrome rather than Playwright's bundled Chromium, because the films' media
 * needs Chrome's codecs (BROWSER_CHANNEL picks another channel). Muted, with
 * software WebGL, since the films and the room are WebGL and headless has no
 * GPU. Exits 1 when any check fails.
 */
/* global window */
/* eslint-disable n/no-process-exit */
import { writeFileSync } from 'node:fs';

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name) => {
  let i = args.indexOf(name);
  if (i === -1) {
    return undefined;
  }
  let [value] = args.splice(i, 2).slice(1);
  return value;
};
const themes = (option('--themes') ?? 'dark,light').split(',');
const only = option('--only')?.split(',');
const jsonPath = option('--json');
const site = new URL(args[0] ?? 'https://choreo.boxel.site/').href;

const FILMS = new Set(['towers', 'sagrada', 'sylva']);
const TIMEOUT = 45_000;
// Errors and requests that arrive just after a page reports ready still count.
const SETTLE = 3_000;

async function realmPaths() {
  let response = await fetch(new URL('_mtimes', site), {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) {
    throw new Error(`${site}_mtimes answered ${response.status}`);
  }
  let { data } = await response.json();
  return Object.keys(data.attributes.mtimes).map((url) =>
    url.slice(site.length),
  );
}

async function source(path) {
  let response = await fetch(new URL(path, site), {
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok) {
    throw new Error(`${path} source answered ${response.status}`);
  }
  return response.text();
}

const paths = await realmPaths();
const demos = paths
  .filter((p) => /^demos\/[^/]+\.json$/.test(p))
  .map((p) => p.slice('demos/'.length, -'.json'.length))
  .filter((slug) => !only || only.includes(slug))
  .sort();
const guides = only
  ? []
  : paths.filter((p) => /^docs\/guides\/[^/]+\.md$/.test(p)).sort();
const allDemoCount = paths.filter((p) => /^demos\/[^/]+\.json$/.test(p)).length;

const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? 'chrome',
  args: [
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
  ],
});

const results = [];
function report(name, problems) {
  results.push({ name, ok: problems.length === 0, problems });
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}`);
  for (let problem of problems) {
    console.log(`       ${problem}`);
  }
}

// One context per theme. The theme is the gallery's own preference, stored in
// the page's localStorage before any of its scripts run. Each film's frame
// posts its first frame to the page, which records it.
async function themedContext(theme) {
  let context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((value) => {
    try {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the page
      window.localStorage.setItem('choreo-theme', value);
    } catch {
      // A frame without storage (the films' srcdoc documents) has no theme.
    }
    if (window.top === window) {
      window.__filmFirstFrames = 0;
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'choreo-film:first-frame') {
          window.__filmFirstFrames += 1;
        }
      });
    }
  }, theme);
  return context;
}

// Runs `check` on a fresh page and collects what went wrong around it.
async function onPage(context, name, check) {
  let page = await context.newPage();
  let problems = [];
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      problems.push(`console error: ${m.text()}`);
    }
  });
  page.on('requestfailed', (r) => {
    let reason = r.failure()?.errorText ?? '';
    // Leaving a page aborts its pending requests.
    if (reason !== 'net::ERR_ABORTED') {
      problems.push(`request failed: ${r.url()} ${reason}`);
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(site)) {
      problems.push(`HTTP ${r.status()}: ${r.url()}`);
    }
  });
  try {
    await check(page, problems);
    await page.waitForTimeout(SETTLE);
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
  report(name, problems);
}

async function expectTheme(page, theme, problems) {
  let applied = await page
    .locator('.choreo-site[data-choreo-site]')
    .first()
    .getAttribute('data-theme');
  if (applied !== theme) {
    problems.push(`theme is ${applied}, expected ${theme}`);
  }
}

async function expectGrid(page) {
  await page
    .locator('[data-gallery-tile]')
    .nth(allDemoCount - 1)
    .waitFor({ timeout: TIMEOUT });
  return page.locator('[data-gallery-tile]').count();
}

for (let theme of themes) {
  let context = await themedContext(theme);

  if (!only) {
    await onPage(context, `grid (${theme})`, async (page, problems) => {
      await page.goto(site);
      let tiles = await expectGrid(page);
      if (tiles !== allDemoCount) {
        problems.push(`${tiles} tiles for ${allDemoCount} demos`);
      }
      await expectTheme(page, theme, problems);
    });
  }

  for (let slug of demos) {
    await onPage(context, `demo ${slug} (${theme})`, async (page, problems) => {
      await page.goto(new URL(`demos/${slug}`, site).href);
      await page
        .locator(`article.demo-head[data-demo="${slug}"]`)
        .waitFor({ timeout: TIMEOUT });
      await expectTheme(page, theme, problems);
      if (FILMS.has(slug)) {
        await page.waitForFunction(() => window.__filmFirstFrames > 0, null, {
          timeout: TIMEOUT,
        });
        if (await page.locator('p.film-status[role=alert]').count()) {
          problems.push(
            await page.locator('p.film-status[role=alert]').innerText(),
          );
        }
      } else {
        await page.locator('button.lab-toggle').click();
        await page
          .locator(`section.lab[data-demo-lab="${slug}"] .dialkit-root`)
          .waitFor({ timeout: TIMEOUT });
      }
    });
  }
  await context.close();
}

// Navigation and the remaining pages don't depend on the theme, so they run
// once, in the first.
let context = await themedContext(themes[0]);

await onPage(context, 'tiles open demos, Back returns', async (page) => {
  await page.goto(site);
  await expectGrid(page);
  for (let slug of demos) {
    await page
      .locator(`[data-gallery-tile="${slug}"] a.tile-title`)
      .click({ timeout: TIMEOUT });
    await page
      .locator(`article.demo-head[data-demo="${slug}"]`)
      .waitFor({ timeout: TIMEOUT })
      .catch(() => {
        throw new Error(`the ${slug} tile didn't open its demo`);
      });
    await page.goBack();
    await expectGrid(page).catch(() => {
      throw new Error(`Back from ${slug} didn't return to the grid`);
    });
  }
});

if (!only) {
  await onPage(context, 'widget room', async (page, problems) => {
    await page.goto(site);
    await expectGrid(page);
    await page.locator('a[data-gallery-room]').click();
    await page.locator('section.wr-shell').waitFor({ timeout: TIMEOUT });
    await page
      .locator('[data-test-widget-embed]')
      .first()
      .waitFor({ timeout: TIMEOUT });
    if (await page.locator('.wr-engine-issue[role=alert]').count()) {
      problems.push(
        await page.locator('.wr-engine-issue[role=alert]').innerText(),
      );
    }
  });
}

for (let guide of guides) {
  let embeds = (await source(guide)).match(/::card\[/g)?.length ?? 0;
  await onPage(context, `guide ${guide}`, async (page, problems) => {
    await page.goto(new URL(guide, site).href);
    await page.locator('h1').first().waitFor({ timeout: TIMEOUT });
    if (embeds > 0) {
      let live = page.locator('[data-choreo-site]');
      await live
        .nth(embeds - 1)
        .waitFor({ timeout: TIMEOUT })
        .catch(() => {});
      let count = await live.count();
      if (count < embeds) {
        problems.push(`${count} live demos for ${embeds} embedded cards`);
      }
    }
  });
}

await context.close();
await browser.close();

let failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length} of ${results.length} checks passed on ${site}`,
);
if (jsonPath) {
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { site, checkedAt: new Date().toISOString(), results },
      null,
      2,
    ),
  );
}
process.exit(failed.length ? 1 : 0);
