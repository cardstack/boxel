import { test, expect } from '@playwright/test';
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

  test('it can publish a realm', async ({ page }) => {
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
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    let newTabPromise = page.waitForEvent('popup');

    await page.locator('[data-test-open-site-button]').click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/',
    );
  });

  test('it validates and can claim a custom site name', async ({ page }) => {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    await setupUserSubscribed('@user1:localhost', realmServer);

    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await createRealm(page, 'custom-site-workspace', 'Custom Site Workspace');
    await page.locator('[data-test-workspace="Custom Site Workspace"]').click();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();

    await page.locator('[data-test-custom-site-name-setup-button]').click();
    await page.locator('[data-test-custom-site-name-input]').fill('Bad Name');
    await page.locator('[data-test-claim-site-name-button]').click();

    await expect(page.locator('[data-test-custom-site-name-error]')).toHaveText(
      'Subdomain can only contain lowercase letters, numbers, and hyphens',
    );
    await expect(page.locator('[data-test-publish-button]')).toBeDisabled();

    await page.locator('[data-test-custom-site-name-input]').fill('my-custom');
    await page.locator('[data-test-claim-site-name-button]').click();

    await expect(
      page.locator('[data-test-custom-site-name-availability]'),
    ).toHaveText('This name is available');
    await expect(
      page.locator('[data-test-custom-site-name-error]'),
    ).toHaveCount(0);

    await expect(
      page.locator('[data-test-custom-domain-checkbox]'),
    ).toBeChecked();
    await expect(page.locator('[data-test-publish-button]')).not.toBeDisabled();
  });
});
