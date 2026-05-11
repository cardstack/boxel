// Dev-only probe: assert the host's `/_standby` route is browser-loadable
// before the prerender service starts.
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
// We don't extend the page pool's retry budget to cover this: it's a dev
// concern and stretching production's failure-detection window would mask
// real prerender problems in the hosted environment. Instead we run the
// same puppeteer navigation the prerender would perform, in a one-shot
// process whose job is just to wait for vite. Each attempt has the same
// 30s budget as the prerender; failures retry with exponential backoff
// (500ms doubling to a 5s cap). The 10-minute overall ceiling guards
// against a genuinely broken vite — in normal dev that ceiling is never
// reached.

import puppeteer from 'puppeteer';

const PER_ATTEMPT_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 5_000;
const TOTAL_TIMEOUT_MS = 600_000;

const log = (msg: string) => console.log(`[wait-for-host-standby] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const elapsedSec = (start: number) => Math.round((Date.now() - start) / 1000);

async function main() {
  let hostUrl =
    process.argv[2] || process.env.HOST_URL || 'http://localhost:4200';
  let standbyUrl = `${hostUrl}/_standby`;

  let launchArgs: string[] = [];
  if (
    process.env.CI === 'true' ||
    process.env.PUPPETEER_DISABLE_SANDBOX === 'true'
  ) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  log(`probing ${standbyUrl} (max ${TOTAL_TIMEOUT_MS / 1000}s)...`);
  let start = Date.now();

  let browser = await puppeteer.launch({
    headless: true,
    ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });

  let attempt = 0;
  let backoffMs = 500;
  let success = false;
  try {
    while (Date.now() - start < TOTAL_TIMEOUT_MS) {
      attempt++;
      let page = await browser.newPage();
      try {
        await page.goto(standbyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: PER_ATTEMPT_TIMEOUT_MS,
        });
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
