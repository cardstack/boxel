// Dev-only probe: assert the host's `/_standby` route is browser-loadable
// AND that Ember has booted far enough to render the route's
// `#standby-ready` marker — the same two-phase check the real prerender's
// `#loadStandbyPage` in page-pool.ts performs.
//
// Without this gate, the prerender launches while vite is still
// cold-bundling the host's ~1000-package dep graph. Puppeteer's first
// `/_standby` navigation inside the prerender then blocks on the in-flight
// bundle, hits the 30s per-attempt navigation timeout, and the page pool's
// retry budget is exhausted long before the optimizer finishes — leaving
// the prerender unable to render any card. Every indexing job that
// follows fails with "No standby page available," and recovery needs an
// operator to manually restart the service. The hosted environment serves
// a pre-built bundle with no optimizer phase, so this probe is dev-only.
//
// `domcontentloaded` alone is NOT a sufficient signal. Vite serves the
// `/_standby` HTML shell as soon as its HTTP server is up — long before
// the optimizer has bundled the Ember runtime + app graph the page tries
// to import. Puppeteer treats that bare shell as a successful navigation,
// so a probe that stops there returns "ready" while Ember is still
// crashing on unresolved imports. We instead wait for `#standby-ready`,
// which is rendered by the `/_standby` route's template and therefore
// only present once Ember has booted and the router has resolved.
//
// We don't extend the page pool's retry budget to cover this: it's a dev
// concern and stretching production's failure-detection window would mask
// real prerender problems in the hosted environment. Instead we run the
// same puppeteer navigation the prerender would perform, in a one-shot
// process whose job is just to wait for vite. Each attempt has the same
// 30s budget as the prerender; failures retry with exponential backoff
// (500ms doubling to a 5s cap). The 10-minute overall ceiling guards
// against a genuinely broken vite — in normal dev that ceiling is never
// reached.

// First, so this probe's own progress logs flush in real time instead of
// at process exit (Node block-buffers writes to a pipe; in CI this script
// runs piped through run-p + tee, so retry-attempt output otherwise hides
// behind buffering until teardown).
import '../lib/unbuffer-stdio';
import puppeteer, { type Browser } from 'puppeteer';

const PER_ATTEMPT_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 5_000;
const TOTAL_TIMEOUT_MS = 600_000;
// Chrome startup on a loaded CI runner occasionally takes >30s to print
// its DevTools WS endpoint to stdout. Puppeteer's default launch timeout
// is 30s, so a single slow start aborts the whole script before the
// goto/waitForFunction retry loop ever runs. Give the launch its own
// generous budget and retry it independently — the page-pool's own
// BrowserManager also relies on launch succeeding on the first try, but
// here we're a one-shot startup probe and the cost of a retry is small.
const LAUNCH_TIMEOUT_MS = 90_000;
const LAUNCH_MAX_ATTEMPTS = 3;
const LAUNCH_RETRY_BACKOFF_MS = 2_000;

import { isHttpsLoopback } from '../lib/is-https-loopback';

const log = (msg: string) => console.log(`[wait-for-host-standby] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const elapsedSec = (start: number) => Math.round((Date.now() - start) / 1000);

async function launchBrowserWithRetry({
  launchArgs,
  totalDeadline,
}: {
  launchArgs: string[];
  totalDeadline: number;
}): Promise<Browser> {
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  let lastError: unknown;
  for (let attempt = 1; attempt <= LAUNCH_MAX_ATTEMPTS; attempt++) {
    let remaining = totalDeadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    let timeout = Math.min(LAUNCH_TIMEOUT_MS, remaining);
    // On the final attempt, pipe Chrome's own stdout/stderr through node so
    // that if launch is still failing we capture *why* (sandbox denial,
    // missing shared library, GPU init crash, etc.) instead of a bare
    // "Timed out … while waiting for the WS endpoint URL." The earlier
    // attempts stay quiet on healthy runs.
    let dumpio =
      attempt === LAUNCH_MAX_ATTEMPTS ||
      process.env.WAIT_FOR_HOST_STANDBY_VERBOSE === '1';
    log(
      `puppeteer.launch attempt ${attempt}/${LAUNCH_MAX_ATTEMPTS} ` +
        `(timeout=${timeout}ms, executable=${executablePath ?? 'puppeteer-bundled'}, ` +
        `args=${JSON.stringify(launchArgs)}, dumpio=${dumpio})`,
    );
    let t0 = Date.now();
    try {
      let browser = await puppeteer.launch({
        headless: true,
        timeout,
        dumpio,
        ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
        ...(executablePath ? { executablePath } : {}),
      });
      log(
        `puppeteer.launch attempt ${attempt} succeeded after ${Date.now() - t0}ms`,
      );
      return browser;
    } catch (e) {
      lastError = e;
      let message = e instanceof Error ? e.message : String(e);
      log(
        `puppeteer.launch attempt ${attempt} failed after ${Date.now() - t0}ms: ${message}`,
      );
      if (attempt === LAUNCH_MAX_ATTEMPTS) {
        break;
      }
      let remainingAfterFailure = totalDeadline - Date.now();
      if (remainingAfterFailure <= LAUNCH_RETRY_BACKOFF_MS) {
        break;
      }
      await sleep(LAUNCH_RETRY_BACKOFF_MS);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`puppeteer.launch failed: ${String(lastError)}`);
}

async function main() {
  // Vite serves HTTPS on localhost:4200 in local dev (the realm-server
  // requires the mkcert leaf and vite reads the same cert). Default
  // accordingly so a stale shell that hasn't re-exported HOST_URL
  // still probes the right scheme.
  let hostUrl =
    process.argv[2] || process.env.HOST_URL || 'https://localhost:4200';
  let standbyUrl = `${hostUrl}/_standby`;

  let launchArgs: string[] = [];
  if (
    process.env.CI === 'true' ||
    process.env.PUPPETEER_DISABLE_SANDBOX === 'true'
  ) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  // Match the prerender server's BrowserManager: relax cert checks for
  // the local mkcert leaf. Chrome 144+ silently demotes
  // `--ignore-certificate-errors` to a dev-only flag — pair it with
  // `--allow-insecure-localhost` so the dev cert is actually accepted
  // (otherwise the TLS handshake closes with ERR_CONNECTION_CLOSED and
  // every retry times out with no obvious explanation in the log).
  //
  // Gated on https + a loopback hostname so the relaxation only fires
  // in local dev / CI (where the cert is the mkcert leaf). Production
  // hits a real hostname with a real CA-signed cert, where we want
  // strict validation.
  if (isHttpsLoopback(hostUrl)) {
    launchArgs.push(
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
    );
  }

  log(`probing ${standbyUrl} (max ${TOTAL_TIMEOUT_MS / 1000}s)...`);
  let start = Date.now();

  let browser = await launchBrowserWithRetry({
    launchArgs,
    totalDeadline: start + TOTAL_TIMEOUT_MS,
  });

  let attempt = 0;
  let backoffMs = 500;
  let success = false;
  // Cap each phase's timeout to whatever total budget is still left so the
  // advertised 10-minute ceiling is actually honored — a fresh attempt
  // started near the deadline would otherwise run for up to
  // 2×PER_ATTEMPT_TIMEOUT_MS (goto + waitForFunction) past it.
  let phaseBudgetMs = () =>
    Math.max(
      1,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, TOTAL_TIMEOUT_MS - (Date.now() - start)),
    );
  // Verbose mode forwards every chrome console message + every failed
  // network request from the standby probe page to our own stdout, so
  // when the probe hangs we can see what URL the page is choking on
  // (TLS-handshake failures, h2 stream resets, cross-origin denials,
  // etc.). Off by default — healthy runs don't need the noise. Flip
  // `WAIT_FOR_HOST_STANDBY_VERBOSE=1` when investigating a probe hang.
  let verbose = process.env.WAIT_FOR_HOST_STANDBY_VERBOSE === '1';
  try {
    while (Date.now() - start < TOTAL_TIMEOUT_MS) {
      attempt++;
      let page = await browser.newPage();
      if (verbose) {
        page.on('console', (msg) =>
          log(`[chrome console.${msg.type()}] ${msg.text()}`),
        );
        page.on('pageerror', (err: unknown) =>
          log(
            `[chrome pageerror] ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
        page.on('requestfailed', (req) =>
          log(
            `[chrome requestfailed] ${req.method()} ${req.url()} — ${
              req.failure()?.errorText ?? 'unknown'
            }`,
          ),
        );
        page.on('response', (resp) => {
          if (resp.status() >= 400) {
            log(`[chrome response ${resp.status()}] ${resp.url()}`);
          }
        });
        page.on('framedetached', (frame) =>
          log(`[chrome framedetached] url=${frame.url()}`),
        );
      }
      try {
        // Mirror page-pool.ts's #loadStandbyPage: each phase gets its own
        // PER_ATTEMPT_TIMEOUT_MS budget. The goto budget only covers
        // serving the HTML shell; waiting for Ember to boot and render
        // `#standby-ready` is a separate clock because on a cold vite
        // cache the script tag's module fetch can spin while the
        // optimizer is still bundling its dep graph.
        if (verbose) log(`attempt ${attempt}: page.goto(${standbyUrl})`);
        let response = await page.goto(standbyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: phaseBudgetMs(),
        });
        let status = response?.status();
        if (verbose) log(`attempt ${attempt}: goto resolved status=${status}`);
        if (status != null && status >= 400) {
          throw new Error(`HTTP ${status}`);
        }
        if (verbose) log(`attempt ${attempt}: waiting for #standby-ready`);
        await page.waitForFunction(
          () => !!document.querySelector('#standby-ready'),
          { timeout: phaseBudgetMs() },
        );
        log(`browser-ready after ${elapsedSec(start)}s (attempt ${attempt})`);
        success = true;
        break;
      } catch (e) {
        let message = e instanceof Error ? e.message : String(e);
        log(
          `attempt ${attempt} failed after ${elapsedSec(start)}s: ${message}; retrying in ${backoffMs}ms`,
        );
      } finally {
        await page.close().catch(() => {});
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (!success) {
    log(`ERROR: /_standby not browser-ready after ${elapsedSec(start)}s`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[wait-for-host-standby] unexpected failure:', err);
  process.exit(1);
});
