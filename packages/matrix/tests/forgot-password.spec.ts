import { expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  clearLocalStorage,
  assertLoggedIn,
  test,
  setupMatrixOverride,
  gotoRegistration,
  gotoForgotPassword,
  validateEmailForResetPassword,
  login,
  register,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';
const name = 'user1';
const email = 'user1@example.com';
const username = 'user1';
const password = 'mypassword1!'

test.describe('Forgot password', () => {
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

    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await clearLocalStorage(page);
    await gotoRegistration(page);
    await register(page, name, email, username, password, REGISTRATION_TOKEN);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('It can forgot password', async ({ page }) => {
    await gotoForgotPassword(page);

    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-have-validated-btn]')).toHaveCount(1);
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(1);

    await validateEmailForResetPassword(page, 'user1@example.com', {
      onEmailPage: async (page) => {
        await expect(page).toHaveScreenshot('verification-email.png', {
          mask: [page.locator('.messagelist')],
          maxDiffPixelRatio: 0.01,
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
      onSuccessPage: async (page) => {
        await expect(page.locator('body')).toContainText(
          'Your email has now been validated',
        );
        await expect(page).toHaveScreenshot('success-page.png', {
          maxDiffPixelRatio: 0.01,
        });
      },
    });

    await page.locator('[data-test-have-validated-btn]').click();
    await expect(page.locator('[data-test-reset-password-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword2!');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword2!');
    await expect(page.locator('[data-test-reset-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-password-btn]').click();

    await expect(page.locator('[data-test-reset-password-success]')).toContainText('Your password is now reset');
    await page.locator('[data-test-back-to-login-btn]').click();

    await login(page, 'user1', 'mypassword2!');
    await assertLoggedIn(page);
  });

  test('It shows an error when email does not belonged to any account', async ({ page }) => {
    await gotoForgotPassword(page);

    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user2@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
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
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();

    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();
    await expect(page.locator('[data-test-have-validated-btn]')).toHaveCount(1);
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(1);
  });

  test('It shows an error when password does not meet the requirement', async ({ page }) => {
    await gotoForgotPassword(page);

    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-have-validated-btn]')).toHaveCount(1);
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(1);

    await validateEmailForResetPassword(page, 'user1@example.com');
    
    await page.locator('[data-test-have-validated-btn]').click();
    await expect(page.locator('[data-test-reset-password-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Password must be at least 8 characters long and include a number and a symbol');

    await page.locator('[data-test-password-field]').fill('mypassword!1');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword!');
    await page.locator('[data-test-reset-password-btn]').click();
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'confirm password displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Passwords do not match');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword!1');
    
    await expect(page.locator('[data-test-reset-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-password-btn]').click();
  });

  test('It shows an error when email has not been validated', async ({ page }) => {
    await gotoForgotPassword(page);

    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-have-validated-btn]')).toHaveCount(1);
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(1);

    await page.locator('[data-test-have-validated-btn]').click();
    await expect(page.locator('[data-test-reset-password-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword2!');
    await page.locator('[data-test-confirm-password-field]').fill('mypassword2!');
    await expect(page.locator('[data-test-reset-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-password-btn]').click();

    await expect(
      page.locator(
        '[data-test-reset-password-error]',
      ),
      'displays reset password error',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-reset-password-error]',
      ),
    ).toContainText('Please check your email to validate reset password');
  });

  test('it can resend email validation message', async ({ page }) => {
    await gotoForgotPassword(page);

    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-reset-your-password-btn]')).toBeEnabled();
    await page.locator('[data-test-reset-your-password-btn]').click();

    await expect(page.locator('[data-test-have-validated-btn]')).toHaveCount(1);
    await expect(page.locator('[data-test-resend-validation-btn]')).toHaveCount(1);

    await validateEmailForResetPassword(page, 'user1@example.com', { sendAttempts: 2 });
  });
});

