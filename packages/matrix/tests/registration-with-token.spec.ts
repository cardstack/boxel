import { test, expect } from '@playwright/test';
import { testServer } from '../helpers';
import {
  synapseStart,
  synapseStop,
  registerUser,
  createRegistrationToken,
  type SynapseInstance,
  type Credentials,
} from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('User Registration w/ Token', () => {
  let synapse: SynapseInstance;
  let admin: Credentials;

  test.beforeEach(async () => {
    synapse = await synapseStart();
    admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can register a user with a registration token', async ({ page }) => {
    await page.goto(`/chat`);
    await page.getByRole('link', { name: 'Register new user' }).click();
    await expect(page.url()).toBe(`${testServer}/chat/register`);
    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed'
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed'
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await page.waitForURL(`${testServer}/chat`);

    await expect(
      page.locator('[data-test-field-value="userId"]')
    ).toContainText('@user1:localhost');
    await expect(
      page.locator('[data-test-field-value="displayName"]')
    ).toContainText('user1');
  });

  test('it shows an error when the username is already taken', async ({
    page,
  }) => {
    await registerUser(synapse, 'user1', 'pass');

    await page.goto(`/chat/register`);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-validation-state="initial"]'
      ),
      'username field displays initial validation state'
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]'
      ),
      'no error message is displayed'
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-validation-state="invalid"]'
      ),
      'username field displays invalid validation state'
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]'
      )
    ).toContainText('User ID already taken');

    await page.locator('[data-test-username-field]').fill('user2');
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]'
      ),
      'no error message is displayed'
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await page.waitForURL(`${testServer}/chat`);

    await expect(
      page.locator('[data-test-field-value="userId"]')
    ).toContainText('@user2:localhost');
  });

  test(`it show an error when a invalid registration token is used`, async ({
    page,
  }) => {
    await page.goto(`/chat/register`);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('invalid token');
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="initial"]'
      ),
      'token field displays initial validation state'
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]'
      ),
      'no error message is displayed'
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="invalid"]'
      ),
      'token field displays invalid validation state'
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]'
      )
    ).toContainText('Invalid registration token');

    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="initial"]'
      ),
      'token field displays initial validation state'
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]'
      ),
      'no error message is displayed'
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();

    await page.waitForURL(`${testServer}/chat`);

    await expect(
      page.locator('[data-test-field-value="userId"]')
    ).toContainText('@user1:localhost');
  });
});
