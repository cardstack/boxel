import { test, expect } from '@playwright/test';
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
  setupMatrixOverride,
  openAiAssistant,
  registerRealmUsers,
} from '../helpers';

test.describe('User Registration w/o Token', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart({
      template: 'test-without-registration-token',
      // user registration tests require a static synapse port in order for the
      // link in the validation email to work
      hostPort: 8008,
    });
    await smtpStart();
    await setupMatrixOverride(page, synapse);
    await registerRealmUsers(synapse);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('it can register a user without a registration token', async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();
    await validateEmail(page, 'user1@example.com');

    await openAiAssistant(page);
    await assertLoggedIn(page);
  });
});
