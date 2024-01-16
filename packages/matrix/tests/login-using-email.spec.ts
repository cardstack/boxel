import { expect, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  updateUser,
  type SynapseInstance,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  openRoot,
  toggleOperatorMode,
  clearLocalStorage,
  gotoRegistration,
  assertLoggedIn,
  openAiAssistant,
  registerRealmUsers,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('Login using email', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();

    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await registerRealmUsers(synapse);
    await clearLocalStorage(page);
    await gotoRegistration(page);
    await registerUser(synapse, 'user1', 'mypassword1!');
    await updateUser(admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@example.com'],
      displayname: 'Test User',
    });
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('Login using email', async ({ page }) => {
    await openRoot(page);
    await toggleOperatorMode(page);
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await openAiAssistant(page);

    await assertLoggedIn(page, {
      email: 'user1@example.com',
      displayName: 'Test User',
    });
  });
});
