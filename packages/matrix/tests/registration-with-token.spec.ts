import { expect } from '@playwright/test';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  assertLoggedOut,
  logout,
  test,
  mailHost,
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
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await validateEmail(page, 'user1@example.com', {
      onEmailPage: async (page) => {
        await expect(page).toHaveScreenshot('verification-email.png', {
          mask: [page.locator('.messagelist')],
          maxDiffPixelRatio: 0.01,
        });
      },
      onValidationPage: async (page) => {
        await expect(page.locator('body')).toContainText(
          'Your email has now been validated',
        );
        await expect(page).toHaveScreenshot('verification-page.png', {
          maxDiffPixelRatio: 0.01,
        });
      },
    });

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field] input').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field] input').fill('mypassword');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-confirm-password-field] input')
      .fill('mypassword');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field] input').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await assertLoggedIn(page, { email: 'user1@example.com' });

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
    await clearLocalStorage(page);

    await gotoRegistration(page);
    await validateEmail(page, 'user1@example.com');
    await page.locator('[data-test-username-field] input').fill('user1');
    await page.locator('[data-test-password-field] input').fill('mypassword');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword');
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

    await page.locator('[data-test-username-field] input').fill('user2');
    await expect(
      page.locator(
        '[data-test-username-field] [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field] input').fill('abc123');
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
    await clearLocalStorage(page);

    await gotoRegistration(page);
    await validateEmail(page, 'user1@example.com');
    await page.locator('[data-test-username-field] input').fill('user1');
    await page.locator('[data-test-password-field] input').fill('mypassword');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword');
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await page.locator('[data-test-token-field] input').fill('invalid token');
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

    await page.locator('[data-test-token-field] input').fill('abc123');
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

  test(`it shows an error when passwords do not match`, async ({ page }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);
    await validateEmail(page, 'user1@example.com');

    await page.locator('[data-test-username-field] input').fill('user1');
    await page.locator('[data-test-password-field] input').fill('mypassword');
    await page
      .locator('[data-test-confirm-password-field] input')
      .fill('does not match');
    await page.locator('[data-test-register-btn]').click();
    await expect(
      page.locator(
        '[data-test-password-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] [data-test-boxel-input-error-message]',
      ),
    ).toHaveText('Passwords do not match');
    await expect(
      page.locator(
        '[data-test-confirm-password-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);

    await page
      .locator('[data-test-confirm-password-field] input')
      .fill('mypassword');
    await expect(
      page.locator(
        '[data-test-password-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-password-field] [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] [data-test-boxel-input-validation-state="invalid"]',
      ),
      'confirm password field does not have error state',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test(`it can register a user when email validation is performed after providing registration token`, async ({
    page,
    synapse,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await validateEmail(page, 'user1@example.com', {
      isLoggedInWhenValidated: true,
      onEmailPage: async (page) => {
        await gotoRegistration(page);
        await expect(
          page.locator('[data-test-email-validation]'),
        ).toContainText(
          'The email address user1@example.com has not been validated',
        );
        await expect(
          page.locator('[data-test-token-field]'),
          'token field is not displayed',
        ).toHaveCount(0);
        await page.locator('[data-test-username-field] input').fill('user1');
        await page
          .locator('[data-test-password-field] input')
          .fill('mypassword');
        await page
          .locator('[data-test-confirm-password-field] input')
          .fill('mypassword');
        await page.locator('[data-test-register-btn]').click();

        await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
        await expect(
          page.locator('[data-test-username-field]'),
          'username field is not displayed',
        ).toHaveCount(0);
        await page.locator('[data-test-token-field] input').fill('abc123');
        await page.locator('[data-test-next-btn]').click();

        await expect(
          page.locator('[data-test-email-validation]'),
        ).toContainText(
          'The email address user1@example.com has not been validated',
        );
        await expect(
          page.locator('[data-test-username-field]'),
          'username field is not displayed',
        ).toHaveCount(0);
        await expect(
          page.locator('[data-test-token-field]'),
          'token field is not displayed',
        ).toHaveCount(0);

        await page.goto(mailHost);
        await expect(
          page
            .locator('.messagelist .unread')
            .filter({ hasText: 'user1@example.com' }),
        ).toHaveCount(1);
        await page
          .locator('.messagelist .unread')
          .filter({ hasText: 'user1@example.com' })
          .first()
          .click();
        await expect(
          page.frameLocator('.messageview iframe').locator('body'),
        ).toContainText('Verify Your Email Address');
        await expect(
          page.locator('.messageview .messageviewheader'),
        ).toContainText(`To:user1@example.com`);
      },
    });
    await assertLoggedIn(page, { email: 'user1@example.com' });
  });

  test(`it can resend email validation message`, async ({ page }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);
    await validateEmail(page, 'user1@example.com', { sendAttempts: 2 });
  });
});
