import { expect, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  updateUser,
  type SynapseInstance,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  openRoot,
  clearLocalStorage,
  gotoRegistration,
  assertLoggedIn,
  registerRealmUsers,
  setupUserSubscribed,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('Login using email', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();

    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    await clearLocalStorage(page, appURL);
    await gotoRegistration(page, appURL);
    await registerUser(synapse, 'user1', 'mypassword1!');
    await updateUser(admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@example.com'],
      displayname: 'Test User',
    });
    await setupUserSubscribed('@user1:localhost', realmServer);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
    await realmServer.stop();
  });

  test('Login using email', async ({ page }) => {
    await openRoot(page, appURL);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page, {
      email: 'user1@example.com',
      displayName: 'Test User',
    });
  });
});
