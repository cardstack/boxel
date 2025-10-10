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

test.describe('Create Realm via Dashboard', () => {
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

  test('it can create a new realm', async ({ page }) => {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    await setupUserSubscribed('@user1:localhost', realmServer);

    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await createRealm(page, 'new-workspace', '1New Workspace');

    await expect(
      page.locator(`[data-test-workspace="1New Workspace"]`),
    ).toBeVisible();
    await expect(
      page.locator('[data-test-create-workspace-modal]'),
    ).toHaveCount(0);

    await page.locator('[data-test-workspace="1New Workspace"]').click();
    let newRealmURL = new URL('user1/new-workspace/', serverIndexUrl).href;
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-test-boxel-filter-list-button]`),
    ).toHaveCount(2);

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();
    await expect(page.locator('[data-test-host-submode]')).toBeVisible();

    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(
      page.locator(
        `[data-test-workspace="1New Workspace"] [data-test-realm-icon-url]`,
      ),
      'the "N" icon URL is shown',
    ).toHaveAttribute(
      'style',
      'background-image: url("https://boxel-images.boxel.ai/icons/Letter-n.png");',
    );
  });
});
