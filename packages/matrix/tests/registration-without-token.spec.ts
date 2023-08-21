import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { gotoRegistration, assertLoggedIn } from '../helpers';

test.describe('User Registration w/o Token', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async () => {
    synapse = await synapseStart({
      template: 'test-without-registration-token',
    });
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can register a user without a registration token', async ({
    page,
  }) => {
    await gotoRegistration(page);
    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await assertLoggedIn(page);
  });
});
