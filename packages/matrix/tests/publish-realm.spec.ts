import { test, expect, type Page } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  type IsolatedRealmServer,
  appURL,
} from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  login,
  registerRealmUsers,
  setupUserSubscribed,
} from '../helpers';

test.describe('Publish realm', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;

  async function openPublishRealmModal(page: Page) {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    await setupUserSubscribed('@user1:localhost', realmServer);

    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await createRealm(page, 'new-workspace', '1New Workspace');
    await page.locator('[data-test-workspace="1New Workspace"]').click();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();
  }

  async function publishDefaultRealm(page: Page) {
    await openPublishRealmModal(page);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    await page.waitForSelector('[data-test-unpublish-button]');
    await expect(
      page.locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      ),
    ).toBeVisible();
  }

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('it can publish a realm to a subdirectory', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      )
      .click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/',
    );
    await newTab.close();
    await page.bringToFront();
  });

  test('it validates and claims a custom subdomain', async ({ page }) => {
    await openPublishRealmModal(page);

    await page.locator('[data-test-custom-subdomain-setup-button]').click();

    let customSubdomainInput = page.locator(
      '[data-test-custom-subdomain-input]',
    );
    let claimButton = page.locator('[data-test-claim-custom-subdomain-button]');
    let customSubdomainField = customSubdomainInput.locator('input');

    await customSubdomainField.fill('xn--punycodetest');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveText('Punycode domains are not allowed for security reasons');

    await customSubdomainField.fill('acceptable-subdomain');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveCount(0);

    await expect(
      page.locator('[data-test-custom-subdomain-input]'),
    ).toHaveCount(0);
  });

  test('open site popover opens with shift-click', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page.locator('[data-test-close-modal]').click();
    await page.locator('[data-test-open-site-button]').click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/index',
    );
    await newTab.close();
    await page.bringToFront();

    await expect(page.locator('[data-test-open-site-popover]')).toHaveCount(0);

    let popupPromise = page
      .waitForEvent('popup', { timeout: 1_000 })
      .catch(() => null);

    await page.locator('[data-test-open-site-button]').click({
      modifiers: ['Shift'],
    });

    let popup = await popupPromise;
    expect(popup).toBeNull();

    await expect(page.locator('[data-test-open-site-popover]')).toBeVisible();

    newTabPromise = page.waitForEvent('popup');

    await page
      .locator('[data-test-open-site-popover] [data-test-open-site-button]')
      .click();

    newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/index',
    );
    await newTab.close();
    await page.bringToFront();
  });
});
