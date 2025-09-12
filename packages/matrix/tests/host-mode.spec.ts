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
} from '../helpers/isolated-realm-server';
import { registerRealmUsers, waitUntil } from '../helpers';

test.describe('Host mode', () => {
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
    realmServer = await startRealmServer(true);
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('card in a published realm renders in host mode with a connect button', async ({
    page,
  }) => {
    await page.goto('http://published.localhost:4205/mango.json');

    await expect(
      page.locator('[data-test-card="http://published.localhost:4205/mango"]'),
    ).toBeVisible();
    await expect(page.locator('h1:first-of-type')).toHaveText('Mango');

    let connectIframe = page.frameLocator('iframe');
    await expect(connectIframe.locator('[data-test-connect]')).toBeVisible();
  });

  test('clicking connect button logs in on main site and redirects back to host mode', async ({
    page,
  }) => {
    await page.goto('http://published.localhost:4205/mango.json');

    await waitUntil(() => page.locator('iframe').isVisible());

    let connectIframe = page.frameLocator('iframe');
    await connectIframe.locator('[data-test-connect]').click();

    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('pass');
    await page.locator('[data-test-login-btn]').click();

    await expect(page).toHaveURL('http://published.localhost:4205/mango.json');

    await expect(
      connectIframe.locator(
        '[data-test-profile-icon-userid="@user1:localhost"]',
      ),
    ).toBeVisible();
  });
});
