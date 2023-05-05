import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { testServer } from '../helpers';

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
    await page.goto(`/chat`);
    await page.getByRole('link', { name: 'Register new user' }).click();
    await expect(page.url()).toBe(`${testServer}/chat/register`);
    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed'
    ).toHaveCount(0);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await page.waitForURL(`${testServer}/chat`);

    await expect(
      page.locator('[data-test-field-value="userId"]')
    ).toContainText('@user1:localhost');
    await expect(
      page.locator('[data-test-field-value="displayName"]')
    ).toContainText('user1');
  });
});
