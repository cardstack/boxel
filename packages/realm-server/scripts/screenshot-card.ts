import { chromium, firefox, webkit } from 'playwright';
import { logger } from '@cardstack/runtime-common';

const log = logger('screenshot-card');

export type CardFormat = 'isolated' | 'embedded' | 'fitted' | 'atom';
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface ScreenshotCardOptions {
  cardUrl: string;
  hostAppUrl: string;
  format: CardFormat;
  browser?: BrowserType;
  realmToken?: string;
}

const BROWSERS = { chromium, firefox, webkit };

/**
 * Take a screenshot of a card rendered in the host app's `/render` route.
 * Returns raw PNG bytes.
 *
 * @throws If the card fails to load or render
 */
export async function screenshotCard(
  opts: ScreenshotCardOptions,
): Promise<Buffer> {
  const {
    cardUrl,
    hostAppUrl,
    format,
    browser: browserName = 'chromium',
    realmToken,
  } = opts;

  const nonce = Date.now();
  const renderOptions = encodeURIComponent(JSON.stringify({ clearCache: true }));
  const renderUrl = `${hostAppUrl}/render/${encodeURIComponent(cardUrl)}/${nonce}/${renderOptions}/html/${format}/0`;

  let browser;
  try {
    log.info(`[screenshot] launching ${browserName} for ${cardUrl} (format: ${format})`);
    browser = await BROWSERS[browserName].launch({ headless: true });

    const page = await browser.newPage();

    // Inject auth at network level if provided.
    // Playwright normalises header names to lowercase, so we spread the
    // original headers first (preserving Content-Type etc.) and then set
    // the lowercase 'authorization' key to avoid duplicates.
    if (realmToken) {
      const origin = new URL(cardUrl).origin;
      await page.route(`${origin}/**`, (route) => {
        const headers = {
          ...route.request().headers(), // preserves content-type and all others
          authorization: realmToken,    // lowercase to match Playwright's normalisation
        };
        route.continue({ headers });
      });
    }

    await page.goto(renderUrl, { waitUntil: 'domcontentloaded' });

    // Wait for any terminal state (ready, error, unusable) — not just "ready"
    await page.waitForSelector(
      '[data-prerender]:not([data-prerender-status="loading"])',
      { timeout: 90_000 },
    );

    const cardLocator = page.locator('[data-prerender]');
    const status = await cardLocator.getAttribute('data-prerender-status');
    if (status !== 'ready') {
      const errorText = await page
        .locator('[data-prerender-error]')
        .textContent()
        .catch(() => null);
      throw new Error(
        `Card render failed with status "${status}"${errorText ? `: ${errorText}` : ''}`,
      );
    }

    // Capture only the card element — no surrounding page whitespace
    const screenshot = await cardLocator.screenshot();
    log.info(`[screenshot] captured ${screenshot.length} bytes for ${cardUrl}`);
    return screenshot;
  } catch (error) {
    log.error(
      `[screenshot] failed for ${cardUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}
