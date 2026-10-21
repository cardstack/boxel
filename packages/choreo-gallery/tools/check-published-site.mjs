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
 * - every guide's page renders in the gallery's frame, in each theme, with
 *   the guides' sections, its pager, a live demo for each card it embeds, no
 *   file chrome, and no "Read the guide →" leading back to itself.
 *
 * On every page, any console error, uncaught exception, failed request, or
 * response of 400 or more from the site fails the check, except the known
 * platform issues `knownIssue` names, which it reports without failing.
 *
 * Chrome rather than Playwright's bundled Chromium, because the films' media
 * needs Chrome's codecs (BROWSER_CHANNEL picks another channel). Muted, with
 * software WebGL, since the films and the room are WebGL and headless has no
 * GPU. Exits 1 when any check fails.
 */
/* global document, window */
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
// A guide's page is the card beside its Markdown: `docs/guides/core-start` for
// `docs/guides/core-start.md`. The index, `README`, has one too.
const guides = only
  ? []
  : paths
      .filter((p) => /^docs\/guides\/[^/]+\.json$/.test(p))
      .map((p) => p.slice('docs/guides/'.length, -'.json'.length))
      .filter((slug) => paths.includes(`docs/guides/${slug}.md`))
      .sort();
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
function report(name, problems, known) {
  results.push({ name, ok: problems.length === 0, problems, known });
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}`);
  for (let problem of problems) {
    console.log(`       ${problem}`);
  }
  for (let issue of known) {
    console.log(`       known: ${issue}`);
  }
}

// Problems the platform causes on any published site, which the sweep reports
// without failing a check. Remove one once the platform no longer causes it.
function knownIssue(response) {
  if (
    response.status() === 404 &&
    response.url() === new URL('_federated-search', site).href
  ) {
    let realms = [];
    try {
      realms = JSON.parse(response.request().postData() ?? '{}').realms ?? [];
    } catch {
      // Not the host's head query.
    }
    // The head query names one realm: the card's folder under the site.
    if (
      realms.length === 1 &&
      realms[0].startsWith(site) &&
      realms[0] !== site
    ) {
      return `the host queries a page's head HTML under the card's folder as its realm (${realms.join(', ')}), which the realm server doesn't know`;
    }
  }
  return undefined;
}

// The browser asks for /favicon.ico when the page's head names no icon, which
// is the case once the host replaces the head with a card's own head HTML and
// the card's theme names no icon.
function knownConsoleIssue(url) {
  return url === new URL('favicon.ico', site).href
    ? "the page's head names no icon once the host replaces it with the card's head, so the browser asks for /favicon.ico"
    : undefined;
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
  let known = [];
  let knownURLs = new Set();
  let consoleErrors = [];
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      consoleErrors.push({ text: m.text(), url: m.location()?.url });
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
    if (r.status() < 400 || !r.url().startsWith(site)) {
      return;
    }
    let issue = knownIssue(r);
    if (issue) {
      known.push(issue);
      knownURLs.add(r.url());
    } else {
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
  // A failed request also logs a console error naming its URL; a known one's
  // is reported with its response.
  for (let { text, url } of consoleErrors) {
    let issue = knownConsoleIssue(url);
    if (issue) {
      known.push(issue);
    } else if (!knownURLs.has(url)) {
      problems.push(`console error: ${text}${url ? ` (${url})` : ''}`);
    }
  }
  report(name, problems, [...new Set(known)]);
}

// The server sends a page's prerendered HTML between two markers, and the host
// removes it as it starts, then renders the page itself. Wait for that, so a
// check reads and clicks the live page rather than the inert prerendered one.
async function goLive(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      let start = document.getElementById('boxel-isolated-start');
      return !start || start.nextElementSibling?.id === 'boxel-isolated-end';
    },
    null,
    { timeout: TIMEOUT },
  );
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

// A guide's page: its heading, the guides' sections beside it with the guide
// marked as the one being read, the pager, its embedded demos, and none of the
// host's file chrome.
async function expectGuide(page, slug, embeds, problems) {
  await goLive(page, new URL(`docs/guides/${slug}`, site).href);
  let article = page.locator('[data-guide-article]');
  let rendered = await article
    .locator('h1')
    .first()
    .waitFor({ timeout: TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (!rendered) {
    // Host mode shows "Loading card…" until the page's card loads.
    let loading = await page.getByText('Loading card…').isVisible();
    problems.push(
      loading
        ? `the host never loaded the guide: it still shows "Loading card…" after ${TIMEOUT / 1000} s`
        : `the guide shows no heading after ${TIMEOUT / 1000} s`,
    );
    return;
  }
  let sections = await page.locator('[data-guide-section]').count();
  if (sections === 0) {
    problems.push("the guides' sections are missing");
  }
  let current = await page
    .locator('[data-guide-nav] [aria-current="page"]')
    .count();
  if (current !== 1) {
    problems.push(`${current} navigation links mark the guide as current`);
  }
  if (slug !== 'README' && !(await article.getByText('All guides').count())) {
    problems.push('the pager is missing');
  }
  if (
    await page
      .locator('[data-test-file-isolated], [data-test-file-download]')
      .count()
  ) {
    problems.push('the page shows the file view');
  }
  if (await article.locator(`a[data-demo-guide="${slug}"]`).count()) {
    problems.push('an embedded demo links back to this guide');
  }
  if (embeds > 0) {
    let live = article.locator('[data-choreo-site]');
    await live
      .nth(embeds - 1)
      .waitFor({ timeout: TIMEOUT })
      .catch(() => {});
    let count = await live.count();
    if (count < embeds) {
      problems.push(`${count} live demos for ${embeds} embedded cards`);
    }
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
      await goLive(page, site);
      let tiles = await expectGrid(page);
      if (tiles !== allDemoCount) {
        problems.push(`${tiles} tiles for ${allDemoCount} demos`);
      }
      await expectTheme(page, theme, problems);
    });
    await onPage(context, `guides index (${theme})`, async (page, problems) => {
      await expectGuide(page, 'README', 0, problems);
      await expectTheme(page, theme, problems);
    });
  }

  for (let slug of demos) {
    await onPage(context, `demo ${slug} (${theme})`, async (page, problems) => {
      await goLive(page, new URL(`demos/${slug}`, site).href);
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

// The host opens a demo over the grid and records it in the page's URL, so Back
// closes the demo and leaves the grid it was opened from.
await onPage(context, 'tiles open demos, Back returns', async (page) => {
  await goLive(page, site);
  await expectGrid(page);
  let gridURL = page.url();
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
    await page
      .waitForURL((url) => url.href !== gridURL, { timeout: TIMEOUT })
      .catch(() => {
        throw new Error(`opening ${slug} didn't change the page's URL`);
      });
    await page.goBack();
    await page
      .locator('article.demo-head')
      .waitFor({ state: 'detached', timeout: TIMEOUT })
      .catch(() => {
        throw new Error(`Back from ${slug} didn't close the demo`);
      });
    if (page.url() !== gridURL) {
      throw new Error(`Back from ${slug} went to ${page.url()}, not the grid`);
    }
  }
});

if (!only) {
  await onPage(context, 'widget room', async (page, problems) => {
    await goLive(page, site);
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

for (let slug of guides) {
  let embeds =
    (await source(`docs/guides/${slug}.md`)).match(/::card\[/g)?.length ?? 0;
  await onPage(context, `guide ${slug}`, async (page, problems) => {
    await expectGuide(page, slug, embeds, problems);
  });
}

await context.close();
await browser.close();

let failed = results.filter((r) => !r.ok);
let withKnown = results.filter((r) => r.known.length).length;
console.log(
  `\n${results.length - failed.length} of ${results.length} checks passed on ${site}` +
    (withKnown ? `; ${withKnown} met a known platform issue` : ''),
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
