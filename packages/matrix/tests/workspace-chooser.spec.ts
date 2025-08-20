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

test.describe('Workspace Chooser', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  const serverIndexUrl = new URL(appURL).origin;
  const realm1Name = 'realm1';
  const realm1URL = new URL(`user1/${realm1Name}/`, serverIndexUrl).href;

  async function setupRealms(page: Page) {
    await clearLocalStorage(page, serverIndexUrl);
    await setupUserSubscribed('@user1:localhost', realmServer);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });
    await createRealm(page, realm1Name);
    await page.goto(realm1URL);
  }

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('back button from a workspace returns to the workspace chooser', async ({
    page,
  }) => {
    await setupRealms(page);

    await page.goBack();

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);

    // realm1, skills, and catalog realm
    await expect(page.locator('[data-test-workspace]')).toHaveCount(3);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace="realm1"]`),
    ).toHaveCount(1);
  });
});
