import { expect, test } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  assertLoggedIn,
  gotoForgotPassword,
  validateEmailForResetPassword,
  login,
  createSubscribedUser,
  updateSynapseUser,
} from '../helpers';

test.describe('Forgot password', () => {
  let user: { username: string; password: string; credentials: any };
  let userEmail: string;
  test.beforeEach(async ({ page }) => {
    // These tests specifically are pretty slow as there's lots of reloading
    // Add 30s to the overall test timeout
    test.setTimeout(120_000);

    await clearLocalStorage(page, appURL);
    user = await createSubscribedUser('forgot-password');
    userEmail = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [userEmail],
      displayname: user.username,
    });
  });

  test('It can reset password', async ({ page }) => {
    let newPassword = 'mynewpassword!1';
    await gotoForgotPassword(page, appURL);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(userEmail);
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    let resetPasswordPage = await validateEmailForResetPassword(
      page,
      userEmail,
      {
        onEmailPage: async (page) => {
          await expect(page).toHaveScreenshot('verification-email.png', {
            mask: [page.locator('.messagelist')],
            maxDiffPixelRatio: 0.025,
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
      .fill(newPassword);
    await resetPasswordPage
      .locator('[data-test-confirm-password-field]')
      .fill(newPassword);
    await expect(
      resetPasswordPage.locator('[data-test-reset-password-btn]'),
    ).toBeEnabled();
    await resetPasswordPage.locator('[data-test-reset-password-btn]').click();

    await expect(
      resetPasswordPage.locator('[data-test-reset-password-success]'),
    ).toContainText('Your password is now reset');
    await resetPasswordPage.locator('[data-test-back-to-login-btn]').click();

    await login(resetPasswordPage, user.username, newPassword, {
      url: appURL,
    });

    await assertLoggedIn(resetPasswordPage, {
      email: userEmail,
      userId: user.credentials.userId,
      displayName: user.username,
    });
  });

  test('It shows an error when email does not belong to any account', async ({
    page,
  }) => {
    await gotoForgotPassword(page);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page
      .locator('[data-test-email-field]')
      .fill('totallunknownuser@example.com');
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

    await page.locator('[data-test-email-field]').fill(userEmail);
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
    await gotoForgotPassword(page);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(userEmail);
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    let resetPasswordPage = await validateEmailForResetPassword(
      page,
      userEmail,
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
    await gotoForgotPassword(page);

    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(userEmail);
    await expect(
      page.locator('[data-test-reset-your-password-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(
      1,
    );

    await validateEmailForResetPassword(page, userEmail, {
      sendAttempts: 2,
    });
  });
});
