import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { waitForDisplay, waitForTessarInteractive } from './browser-oracle.mjs';

test('Tessar browser readiness rejects correct server HTML until the subscribed client replaces it', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body>
      <script id="boxel-isolated-start" type="x/boundary"></script>
      <article><span data-tessar-stat="scoreTotal">0</span></article>
      <script id="boxel-isolated-end" type="x/boundary"></script>
    </body></html>`);
    const realmURL = 'http://localhost/tessar/';
    // This was the old false positive: the independent value oracle passes
    // even though there is no client available to receive a subsequent write.
    await waitForDisplay(page, { scoreTotal: 0, rows: [] });
    await assert.rejects(waitForTessarInteractive(page, realmURL, 100));
    await page.evaluate((realmURL) => {
      window._CARDSTACK_REALM_SUBSCRIBE = {
        isTessarConnected: true,
        listenerCallbacks: new Map([[realmURL, [() => {}]]]),
      };
    }, realmURL);
    await assert.rejects(waitForTessarInteractive(page, realmURL, 100));
    await page.evaluate(() => {
      document.querySelector('article').remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<article><span data-tessar-stat="scoreTotal">0</span></article>',
      );
    });
    await waitForTessarInteractive(page, realmURL);
    await waitForDisplay(page, { scoreTotal: 0, rows: [] });
  } finally {
    await browser.close();
  }
});
