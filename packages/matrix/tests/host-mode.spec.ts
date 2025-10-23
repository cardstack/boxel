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
import { registerRealmUsers } from '../helpers';

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

  test.skip('card in a published realm renders in host mode with a connect button', async ({
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

  test.skip('clicking connect button logs in on main site and redirects back to host mode', async ({
    page,
  }) => {
    await page.goto('http://published.localhost:4205/mango.json');

    await expect(page.locator('iframe')).toBeVisible();

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

  test.skip('visiting connect route with known origin includes a matching frame-ancestors CSP', async ({
    page,
  }) => {
    let response = await page.goto(
      'http://localhost:4205/connect/http%3A%2F%2Fpublished.localhost%3A4205%2F',
    );

    expect(response?.headers()['content-security-policy']).toBe(
      'frame-ancestors http://published.localhost:4205/',
    );
  });

  test.skip('visiting connect route with origin not in published_realms returns 404', async ({
    page,
  }) => {
    let response = await page.goto(
      'http://localhost:4205/connect/http%3A%2F%2Fexample.com',
    );

    expect(response?.status()).toBe(404);
    expect(await page.textContent('body')).toContain(
      'No published realm found for origin http://example.com',
    );
  });
});
