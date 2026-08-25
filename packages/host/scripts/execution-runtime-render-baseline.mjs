/**
 * Record cold and warm render timings for representative cards.
 *
 * This is the measurement instrument behind
 * `docs/boxel-execution-runtime-render-baseline.md`. It exists as a script
 * rather than as prose describing a procedure because a baseline that cannot
 * be re-run is not a baseline — every later performance claim has to be able
 * to reproduce the number it is arguing against.
 *
 * What it separates, and why:
 *
 * - **Document delivery** — navigation start to `DOMContentLoaded`, read from
 *   the page's own navigation entry. The one part the Host does not own.
 * - **Application/auth readiness** — the Host booting and authentication
 *   resolving. Common to every card and independent of any execution work.
 * - **Execution readiness** — application readiness to substantive card
 *   output. This is the part the execution runtime owns.
 * - **Cold versus warm** — cold uses a fresh browser context per sample, so
 *   no HTTP cache, storage, or compiled-module state survives. Warm repeats
 *   the navigation in the same context, which is what a user moving between
 *   cards actually experiences.
 *
 * Readiness is defined by the selectors the browser smoke runner exports, so
 * the two tools measure the same two moments rather than two similar ones.
 *
 * Absolute numbers from a local development Host are diagnostic, not
 * service-level objectives: the dev server ships a large unbundled module
 * graph that no deployed build serves. What survives comparison is the shape —
 * the split between application and execution cost, the cold-to-warm ratio,
 * and how one card compares with another in the same run.
 *
 * Usage:
 *
 *   node scripts/execution-runtime-render-baseline.mjs \
 *     --host https://localhost:4200 \
 *     --card 'skill=/base/Skill/boxel-development' \
 *     --samples 3 --warm 3 --out baseline.json
 *
 * `--chromium <path>` selects the browser binary when the environment's
 * Chromium build is not the one Playwright would download. `--login
 * <user>:<password>` signs in once before measuring, for a Host that requires
 * a session.
 */
import { writeFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

import {
  APPLICATION_READY_SELECTOR,
  CARD_LOADING_SELECTOR,
  CARD_SURFACE_SELECTOR,
  FATAL_CARD_TEXT,
  SIGN_IN_TEXT,
} from './execution-runtime-browser-smoke.mjs';

const DEFAULTS = {
  host: 'https://localhost:4200',
  samples: 3,
  timeoutMs: 120_000,
  warm: 3,
};

export function parseArguments(argv) {
  let options = { ...DEFAULTS, cards: [] };
  for (let index = 0; index < argv.length; index++) {
    let flag = argv[index];
    let value = argv[index + 1];
    if (flag === '--card') {
      let separator = value.indexOf('=');
      if (separator === -1) {
        throw new Error(`--card expects <id>=<path>, received: ${value}`);
      }
      options.cards.push({
        id: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
      index++;
    } else if (flag === '--login') {
      let separator = value.indexOf(':');
      if (separator === -1) {
        throw new Error(
          `--login expects <user>:<password>, received: ${value}`,
        );
      }
      options.login = {
        password: value.slice(separator + 1),
        username: value.slice(0, separator),
      };
      index++;
    } else if (['--chromium', '--host', '--out'].includes(flag)) {
      options[flag.slice(2)] = value;
      index++;
    } else if (['--samples', '--warm', '--timeout-ms'].includes(flag)) {
      let key = flag === '--timeout-ms' ? 'timeoutMs' : flag.slice(2);
      options[key] = Number(value);
      index++;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.cards.length) {
    throw new Error('At least one --card <id>=<path> is required');
  }
  return options;
}

export function median(values) {
  if (!values.length) return undefined;
  let sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function waitFor(page, predicate, timeoutMs) {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let state = await page.evaluate(predicate, {
      applicationReadySelector: APPLICATION_READY_SELECTOR,
      cardLoadingSelector: CARD_LOADING_SELECTOR,
      cardSurfaceSelector: CARD_SURFACE_SELECTOR,
      fatalText: FATAL_CARD_TEXT,
      signInText: SIGN_IN_TEXT,
    });
    if (state.done) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { done: false, timedOut: true };
}

const applicationReady = ({ applicationReadySelector, signInText }) => {
  let signIn = (document.body?.innerText ?? '').includes(signInText);
  return {
    done: Boolean(document.querySelector(applicationReadySelector)) || signIn,
    signIn,
  };
};

// An error card occupies the same surface as a rendered card, so "a surface
// appeared" is not on its own evidence that anything rendered. A sample that
// lands on an error is timed but excluded from the medians.
const executionReady = ({
  cardLoadingSelector,
  cardSurfaceSelector,
  fatalText,
}) => {
  let text = document.body?.innerText ?? '';
  let fatal = fatalText.some((value) => text.includes(value));
  return {
    done:
      fatal ||
      (Boolean(document.querySelector(cardSurfaceSelector)) &&
        !document.querySelector(cardLoadingSelector)),
    fatal,
  };
};

/**
 * Time one navigation.
 *
 * `performance.now()` is read in this process rather than in the page, so the
 * clock is continuous across a navigation that replaces the document.
 */
export async function sampleRender(page, url, timeoutMs) {
  let startedAt = performance.now();
  await page.goto(url, { timeout: timeoutMs, waitUntil: 'commit' });
  let application = await waitFor(page, applicationReady, timeoutMs);
  let applicationMs = Math.round(performance.now() - startedAt);
  let executionStartedAt = performance.now();
  let execution = application.signIn
    ? { done: false }
    : await waitFor(page, executionReady, timeoutMs);
  let executionMs = Math.round(performance.now() - executionStartedAt);

  // Document delivery is read from the page's own navigation entry rather
  // than timed here: it ends before this process can observe anything, and it
  // is the one part of the cost the Host does not own.
  let documentMs = await page
    .evaluate(() => {
      let [entry] = performance.getEntriesByType('navigation');
      return entry ? Math.round(entry.domContentLoadedEventEnd) : null;
    })
    .catch(() => null);

  return {
    applicationMs,
    documentMs,
    executionMs,
    fatal: Boolean(execution.fatal),
    ready: Boolean(execution.done) && !execution.fatal,
    signIn: Boolean(application.signIn),
    totalMs: applicationMs + executionMs,
  };
}

/**
 * Sign in once and keep the resulting session for every measurement context.
 *
 * Signing in inside a measured sample would put the login round trip in the
 * cold number. Replaying a captured session instead gives each sample an empty
 * HTTP cache — which is what makes it cold — while still arriving
 * authenticated, as a returning user does.
 */
async function captureSignedInState(browser, options) {
  let context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    let page = await context.newPage();
    await page.goto(options.host, { timeout: options.timeoutMs });
    await page
      .locator('[data-test-username-field]')
      .fill(options.login.username, { timeout: options.timeoutMs });
    await page
      .locator('[data-test-password-field]')
      .fill(options.login.password, { timeout: options.timeoutMs });
    await page
      .locator('[data-test-login-btn]')
      .click({ timeout: options.timeoutMs });
    await page
      .locator('[data-test-username-field]')
      .waitFor({ state: 'detached', timeout: options.timeoutMs });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function measureCard(browser, card, options) {
  let url = new URL(card.path, options.host).href;
  let cold = [];
  let warm = [];
  for (let sample = 0; sample < options.samples; sample++) {
    // A fresh context is what makes a cold sample cold: no HTTP cache, no
    // storage, no service worker carried over from the sample before it.
    let context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: options.storageState,
    });
    try {
      let page = await context.newPage();
      cold.push(await sampleRender(page, url, options.timeoutMs));
      for (let repeat = 0; repeat < options.warm; repeat++) {
        // Leaving and returning is what a warm navigation is; navigating to
        // the same URL again would be a no-op the Host could short-circuit.
        await page.goto('about:blank');
        warm.push(await sampleRender(page, url, options.timeoutMs));
      }
    } finally {
      await context.close();
    }
  }
  let usable = (samples) => samples.filter((sample) => sample.ready);
  let summarize = (samples) => ({
    applicationMedianMs: median(
      usable(samples).map((sample) => sample.applicationMs),
    ),
    documentMedianMs: median(
      usable(samples)
        .map((sample) => sample.documentMs)
        .filter((value) => typeof value === 'number'),
    ),
    executionMedianMs: median(
      usable(samples).map((sample) => sample.executionMs),
    ),
    errorSamples: samples.filter((sample) => sample.fatal).length,
    samples: samples.length,
    totalMedianMs: median(usable(samples).map((sample) => sample.totalMs)),
    unreadySamples: samples.length - usable(samples).length,
  });

  return {
    cold: summarize(cold),
    coldSamples: cold,
    id: card.id,
    url,
    warm: summarize(warm),
    warmSamples: warm,
  };
}

export function renderBaselineTable(report) {
  let cell = (value) =>
    typeof value === 'number' ? `${value.toLocaleString('en-US')} ms` : '—';
  let rows = report.cards.map((card) => [
    card.id,
    cell(card.cold.documentMedianMs),
    cell(card.cold.applicationMedianMs),
    cell(card.cold.executionMedianMs),
    cell(card.cold.totalMedianMs),
    cell(card.warm.documentMedianMs),
    cell(card.warm.applicationMedianMs),
    cell(card.warm.executionMedianMs),
    cell(card.warm.totalMedianMs),
  ]);
  let columns = [
    'Card',
    'Cold doc',
    'Cold app',
    'Cold exec',
    'Cold total',
    'Warm doc',
    'Warm app',
    'Warm exec',
    'Warm total',
  ];
  let widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );
  let line = (cells) =>
    `| ${cells.map((value, index) => value.padEnd(widths[index])).join(' | ')} |`;

  return [
    line(columns),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

export async function recordRenderBaseline(options) {
  // `--chromium` names the browser binary to measure with. Which build was
  // used belongs in the report: a baseline compared against a different
  // browser is not a comparison.
  let browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: options.chromium,
  });
  try {
    let storageState = options.login
      ? await captureSignedInState(browser, options)
      : undefined;
    let cards = [];
    for (let card of options.cards) {
      cards.push(
        await measureCard(browser, { ...card }, { ...options, storageState }),
      );
    }
    return {
      cards,
      environment: {
        chromium: browser.version(),
        chromiumExecutable: options.chromium ?? 'playwright default',
        host: options.host,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      method: {
        coldSamplesPerCard: options.samples,
        readiness: {
          application: APPLICATION_READY_SELECTOR,
          execution: `${CARD_SURFACE_SELECTOR} without ${CARD_LOADING_SELECTOR}`,
        },
        warmSamplesPerColdSample: options.warm,
      },
    };
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('execution-runtime-render-baseline.mjs')) {
  let options = parseArguments(process.argv.slice(2));
  let report = await recordRenderBaseline(options);
  if (options.out) {
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(renderBaselineTable(report));
  console.log(`\n${JSON.stringify(report.environment, null, 2)}`);
}
