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
import { clearLocalStorage, login, registerRealmUsers } from '../helpers';

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

  test('it can create a new realm for a logged in user upon request', async ({
    page,
  }) => {
    await clearLocalStorage(page, appURL);
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator('[data-test-workspace-chooser-toggle]').click();
    await page.locator('[data-test-add-workspace]').click();
    await page.locator('[data-test-display-name-field]').fill('New Workspace');
    await page.locator('[data-test-endpoint-field]').fill('new-workspace');
    await page.locator('[data-test-create-workspace-submit]').click();
    await expect(
      page.locator('[data-test-workspace="New Workspace"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-test-create-workspace-modal]'),
    ).toHaveCount(0);
    await page.locator('[data-test-workspace="New Workspace"]').click();
    let newRealmURL = new URL('user1/new-workspace/', new URL(appURL).origin)
      .href;
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toBeVisible();
  });
});
