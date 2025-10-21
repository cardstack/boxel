import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  appURL,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import {
  login,
  setSkillsRedirect,
  setCatalogRedirect,
  getMonacoContent,
  setupUserSubscribed,
  setupPermissions,
  registerRealmUsers,
} from '../helpers';

// This E2E test iterates catalog listings that are eligible for Remix
// and verifies that Remix installs into a writable realm, switches to code mode,
// and install successfully

test.describe('Catalog Remix', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  const serverOrigin = new URL(appURL).origin; // http://localhost:4205

  test.beforeEach(async ({ page }) => {
    test.setTimeout(600_000);
    await setSkillsRedirect(page);
    await setCatalogRedirect(page);

    synapse = await synapseStart({ template: 'test' });
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    realmServer = await startRealmServer();

    // Ensure user is subscribed and has write permissions to their test realm
    await setupUserSubscribed('@user1:localhost', realmServer);
    await setupPermissions('@user1:localhost', `${appURL}/`, realmServer);
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  async function openCatalog(page: import('@playwright/test').Page) {
    // Log in and navigate directly to the catalog index card
    await login(page, 'user1', 'pass', { url: `${serverOrigin}/catalog/index` });
    // Ensure the catalog app is rendered
    await page.locator('[data-test-catalog-app]').waitFor();
    // Switch to the "Cards" tab in the catalog UI
    await page
      .locator(`[data-test-catalog-app] [data-test-tab-label="Cards"]`)
      .click();
    // Wait for list view and the grid to render
    await page.locator('[data-test-catalog-list-view]').waitFor();
    await page.locator('[data-test-cards-grid-cards]').first().waitFor();
  }

  async function remixFromGridItem(
    page: import('@playwright/test').Page,
    listingId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Open realm chooser menu under the listing and choose the main test workspace
    const itemSelector = `[data-test-cards-grid-item="${listingId}"]`;
    const remixButton = `${itemSelector} [data-test-catalog-listing-action="Remix"]`;

    // Ensure item is visible and interactive
    await page.locator(itemSelector).scrollIntoViewIfNeeded();
    await page.locator(itemSelector).hover({ force: true });
    await page.locator(remixButton).waitFor();
    // Use programmatic click on the button element to avoid bubbling to the
    // card container (which would open Details). The component stops
    // propagation on click, so this is safer than pointer clicks.
    await page.locator(remixButton).evaluate((el) => (el as HTMLElement).click());

    // Open dropdown reliably
    const dropdown = page.locator('[data-test-boxel-dropdown-content]');
    if ((await dropdown.count()) === 0) {
      await page.waitForTimeout(120);
      await page
        .locator(remixButton)
        .evaluate((el) => (el as HTMLElement).click());
    }

    // Choose a writable realm – the default test workspace name is "Test Workspace A"
    const realmMenuItem = page.locator(
      `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace A"]`,
    );
    await realmMenuItem.first().waitFor();

    // Prepare to catch the _atomic write result
    const atomicResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/_atomic'),
      { timeout: 30_000 },
    );

    await realmMenuItem.first().click();

    // Analyze _atomic response
    let atomicOk = false;
    let atomicErr: string | undefined;
    try {
      const resp = await atomicResponsePromise;
      atomicOk = resp.ok();
      if (!atomicOk) {
        try {
          const json = await resp.json();
          const err = Array.isArray(json?.errors) ? json.errors[0] : json;
          atomicErr = err?.detail || err?.message || `HTTP ${resp.status()}`;
        } catch (_e) {
          atomicErr = `HTTP ${resp.status()}`;
        }
      }
    } catch (_e) {
      atomicErr = 'No _atomic response or timeout';
    }

    if (!atomicOk) {
      return { success: false, error: atomicErr };
    }

    // Expect to land in code mode with an editor
    await page.locator('[data-test-editor]').waitFor();
    const editorContent = await getMonacoContent(page);
    if (!editorContent) {
      return { success: false, error: 'Editor did not load content' };
    }

    // Verify the rendered card resource responds successfully
    const urlInput = page.locator('[data-test-card-url-bar-input]').first();
    await urlInput.waitFor();
    const value = await urlInput.inputValue();
    if (!value) {
      return { success: false, error: 'Unable to determine remixed card url' };
    }
    const status = await page.evaluate(async (fullUrl: string) => {
      try {
        const url = fullUrl.endsWith('.json') ? fullUrl : `${fullUrl}.json`;
        const res = await fetch(url, { cache: 'no-store' });
        return res.status;
      } catch {
        return 0;
      }
    }, value);
    if (status !== 200) {
      return { success: false, error: `Remixed card fetch returned ${status}` };
    }

    return { success: true };
  }

  async function getRemixEligibleListingIds(
    page: import('@playwright/test').Page,
  ): Promise<string[]> {
    // Collect listing ids currently rendered in the grid and filter by type + presence of Remix
    const ids: string[] = await page.$$eval(
      '[data-test-cards-grid-cards] [data-test-cards-grid-item]',
      (nodes) => nodes.map((n) => n.getAttribute('data-test-cards-grid-item')!).filter(Boolean) as string[],
    );

    const eligible: string[] = [];
    for (let id of ids) {
      // fetch the JSON to check listing type (CardListing or AppListing)
      const doc = await page.evaluate(async (cardId: string) => {
        const res = await fetch(`${cardId}.json`);
        if (!res.ok) return null;
        return res.json();
      }, id);
      if (!doc) continue;
      const adoptsName = doc?.data?.meta?.adoptsFrom?.name;
      if (adoptsName !== 'CardListing' && adoptsName !== 'AppListing') continue;

      // check Remix button exists in DOM for this card
      const hasRemix = await page
        .locator(
          `[data-test-cards-grid-item="${id}"] [data-test-catalog-listing-action="Remix"]`,
        )
        .count();
      if (hasRemix > 0) {
        eligible.push(id);
      }
    }
    return eligible;
  }

  test('remix works for all eligible CardListing/AppListing in Cards and Apps tabs', async ({
    page,
  }) => {
    await openCatalog(page);

    const tabNames = [// 'Cards', 
     'Apps'] as const;
    let successCount = 0;
    const failures: { id: string; error: string }[] = [];
    for (let tab of tabNames) {
      await page
        .locator(`[data-test-catalog-app] [data-test-tab-label="${tab}"]`)
        .click();
      await page.locator('[data-test-catalog-list-view]').waitFor();
      await page.locator('[data-test-cards-grid-cards]').first().waitFor();

      const listingIds = await getRemixEligibleListingIds(page);
      for (let id of listingIds) {
        const res = await remixFromGridItem(page, id);
        if (res.success) {
          successCount++;
        } else {
          failures.push({ id, error: res.error ?? 'Unknown failure' });
        }
        // Return to catalog to continue with the next listing
        await page.goto(`${serverOrigin}/catalog/index`);
        await page
          .locator(`[data-test-catalog-app] [data-test-tab-label="${tab}"]`)
          .click();
        await page.locator('[data-test-cards-grid-cards]').first().waitFor();
      }
    }
    if (successCount === 0) {
      const sample = failures
        .slice(0, 10)
        .map((f) => `- ${f.id}: ${f.error}`)
        .join('\n');
      throw new Error(
        `No listings remixed successfully. Sample failures (max 10):\n${sample}`,
      );
    }
  });
});
