import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import {
  assertLoggedIn,
  login,
  registerRealmUsers,
  waitUntil,
} from '../helpers';

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

  // Doesn’t work reliably in CI
  test.skip('connect button shows session when logged in', async ({ page }) => {
    let serverIndexUrl = new URL(appURL).origin;
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await assertLoggedIn(page);

    await page.goto('http://published.localhost:4205/mango.json');

    await waitUntil(() => page.locator('iframe').isVisible());

    let connectIframe = page.frameLocator('iframe');

    if (await connectIframe.locator('[data-test-connect]').isVisible()) {
      await connectIframe.locator('[data-test-connect]').click();
    }

    await expect(connectIframe.locator('[data-test-session]')).toHaveText(
      '@user1:localhost',
    );
  });
});
