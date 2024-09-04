import { expect } from '@playwright/test';
import {
  gotoRegistration,
  assertLoggedIn,
  assertLoggedOut,
  logout,
  test,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('User Registration w/ Token', () => {
  test('it can register a user with a registration token', async ({
    page,
    synapse,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await gotoRegistration(page);
    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword');
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

    await assertLoggedIn(page);

    // assert that the registration mode state is cleared properly
    await logout(page);
    await assertLoggedOut(page);
  });

  test('it shows an error when the username is already taken', async ({
    page,
    synapse,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await registerUser(synapse, 'user1', 'pass');

    await gotoRegistration(page);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-validation-state="initial"]',
      ),
      'username field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
      'username field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]',
      ),
    ).toContainText('User ID already taken');

    await page.locator('[data-test-username-field]').fill('user2');
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await assertLoggedIn(page, {
      userId: '@user2:localhost',
      displayName: 'user2',
    });
  });

  test(`it show an error when a invalid registration token is used`, async ({
    page,
    synapse,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await gotoRegistration(page);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await page.locator('[data-test-token-field]').fill('invalid token');
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
      'token field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid registration token');

    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();

    await assertLoggedIn(page);
  });
});
