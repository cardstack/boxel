import { expect, test } from '@playwright/test';
import {
  updateUser,
  registerUser,
  createRegistrationToken,
} from '../docker/synapse';
import {
  clearLocalStorage,
  assertLoggedIn,
  gotoRegistration,
  gotoForgotPassword,
  validateEmailForResetPassword,
  login,
  setupUserSubscribed,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

const REGISTRATION_TOKEN = 'abc123';
const name = 'user1';
const email = 'user1@example.com';
const username = 'user1';
const password = 'mypassword1!';

test.describe('Forgot password', () => {
  let testEnv: TestEnvironment;
  test.beforeEach(async ({ page }) => {
    // These tests specifically are pretty slow as there's lots of reloading
    // Add 30s to the overall test timeout
    test.setTimeout(120_000);
    testEnv = await startUniqueTestEnvironment({ withSmtp: true });

    let admin = await registerUser(
      testEnv.synapse!,
      'admin',
      'adminpass',
      true,
      undefined,
      testEnv.config.testHost,
    );
    await createRegistrationToken(
      testEnv.synapse!,
      admin.accessToken,
      REGISTRATION_TOKEN,
      1000,
    );
    await clearLocalStorage(page, testEnv.config.testHost);
    await gotoRegistration(page, testEnv.config.testHost);
    await registerUser(
      testEnv.synapse!,
      username,
      password,
      false,
      undefined,
      testEnv.config.testHost,
    );
    await updateUser(testEnv.synapse!, admin.accessToken, '@user1:localhost', {
      emailAddresses: [email],
      displayname: name,
    });
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  test('It can reset password', async ({ page }) => {
    await gotoForgotPassword(page, testEnv.config.testHost);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    let resetPasswordPage = await validateEmailForResetPassword(
      testEnv,
      page,
      'user1@example.com',
      {
        onEmailPage: async (page) => {
          await expect(page).toHaveScreenshot('verification-email.png', {
            mask: [page.locator('.messagelist')],
            maxDiffPixelRatio: 0.02,
          });
        },
        onValidationPage: async (page) => {
          await expect(page.locator('body')).toContainText(
            'You have requested to reset your Boxel account password',
          );
          await expect(page).toHaveScreenshot('verification-page.png', {
            maxDiffPixelRatio: 0.01,
          });
        },
      },
    );

    await expect(
      resetPasswordPage.locator('[data-test-reset-password-btn]'),
    ).toBeDisabled();
    await resetPasswordPage
      .locator('[data-test-password-field]')
      .fill('mypassword2!');
    await resetPasswordPage
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword2!');
    await expect(
      resetPasswordPage.locator('[data-test-reset-password-btn]'),
    ).toBeEnabled();
    await resetPasswordPage.locator('[data-test-reset-password-btn]').click();

    await expect(
      resetPasswordPage.locator('[data-test-reset-password-success]'),
    ).toContainText('Your password is now reset');
    await resetPasswordPage.locator('[data-test-back-to-login-btn]').click();

    await login(resetPasswordPage, 'user1', 'mypassword2!', {
      url: testEnv.config.testHost,
    });

    await assertLoggedIn(resetPasswordPage);
  });

  test('It shows an error when email does not belong to any account', async ({
    page,
  }) => {
    await gotoForgotPassword(page, testEnv.config.testHost);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user2@example.com');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(
      page.locator(
        '[data-test-email-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'email field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-email-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('No account with the given email address exists');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();

    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );
  });

  test('It shows an error when password does not meet the requirement', async ({
    page,
  }) => {
    await gotoForgotPassword(page, testEnv.config.testHost);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    let resetPasswordPage = await validateEmailForResetPassword(
      testEnv,
      page,
      'user1@example.com',
    );

    await expect(
      resetPasswordPage.locator('[data-test-reset-password-btn]'),
    ).toBeDisabled();
    await resetPasswordPage.locator('[data-test-password-field]').fill('short');
    await resetPasswordPage
      .locator('[data-test-confirm-password-field]')
      .fill('short');
    await expect(
      resetPasswordPage.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      resetPasswordPage.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Password must be at least 8 characters long');

    await resetPasswordPage
      .locator('[data-test-password-field]')
      .fill('mypassword!1');
    await resetPasswordPage
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!');
    await resetPasswordPage.locator('[data-test-reset-password-btn]').click();
    await expect(
      resetPasswordPage.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'confirm password displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      resetPasswordPage.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Passwords do not match');
    await resetPasswordPage
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!1');

    await expect(
      resetPasswordPage.locator('[data-test-reset-password-btn]'),
    ).toBeEnabled();
    await resetPasswordPage.locator('[data-test-reset-password-btn]').click();
  });

  test('it can resend email validation message', async ({ page }) => {
    await gotoForgotPassword(page, testEnv.config.testHost);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    await validateEmailForResetPassword(testEnv, page, 'user1@example.com', {
      sendAttempts: 2,
    });
  });
});
