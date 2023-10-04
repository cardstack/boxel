import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  setupMatrixOverride,
} from '../helpers';

test.describe('User Registration w/o Token', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart({
      template: 'test-without-registration-token',
    });
    await setupMatrixOverride(page, synapse);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can register a user without a registration token', async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);
    await validateEmail(page, 'user1@example.com');
    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await assertLoggedIn(page);
  });
});
