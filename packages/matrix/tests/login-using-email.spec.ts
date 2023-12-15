import { expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  assertLoggedOut,
  logout,
  test,
  setupMatrixOverride,
  openChat,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('Login using email', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart({
      template: 'test',
      // user registration tests require a static synapse port in order for the
      // link in the validation email to work
      hostPort: 8008,
    });
    await smtpStart();
    await setupMatrixOverride(page, synapse);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('Login using email', async ({ page }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-confirm-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com');
    
    await openChat(page);
    await assertLoggedIn(page, { email: 'user1@example.com', displayName: 'Test User' });
    await logout(page);
    await assertLoggedOut(page);
    
    //Login using email
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await openChat(page);

    await assertLoggedIn(page, { email: 'user1@example.com', displayName: 'Test User' });
  });
});
