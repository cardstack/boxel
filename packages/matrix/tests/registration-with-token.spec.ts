import { expect } from '@playwright/test';
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
  assertLoggedOut,
  logout,
  test,
  setupMatrixOverride,
  openAiAssistant,
  registerRealmUsers,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('User Registration w/ Token', () => {
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
    await registerRealmUsers(synapse);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('it can register a user with a registration token', async ({ page }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
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

    await openAiAssistant(page);
    await assertLoggedIn(page, {
      email: 'user1@example.com',
      displayName: 'Test User',
    });

    // assert that the registration mode state is cleared properly
    await logout(page);
    await assertLoggedOut(page);
  });

  test('it shows an error when the username is already taken', async ({
    page,
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

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user2@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');

    await expect(
      page.locator(
        '[data-test-username-field][data-test-boxel-input-group-validation-state="invalid"]',
      ),
      'username field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
    ).toContainText('User Name is already taken');

    await page.locator('[data-test-username-field]').fill('user2');
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user2@example.com');

    await openAiAssistant(page);
    await assertLoggedIn(page, {
      userId: '@user2:localhost',
      displayName: 'Test User',
    });
  });

  test(`it show an error when a invalid registration token is used`, async ({
    page,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await clearLocalStorage(page);

    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await page.locator('[data-test-token-field]').fill('invalid token');
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'token field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid registration token');

    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await validateEmail(page, 'user1@example.com');

    await openAiAssistant(page);
    await assertLoggedIn(page, {
      userId: '@user1:localhost',
      displayName: 'Test User',
    });
  });

  test(`it shows an error when passwords do not match`, async ({ page }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!!');
    await page.locator('[data-test-register-btn]').click();
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText('Passwords do not match');

    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test(`it shows an error when password doesn't follow requirement`, async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText(
      'Password must be at least 8 characters long and include a number and a symbol',
    );

    await page.locator('[data-test-password-field]').fill('mypassword!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText(
      'Password must be at least 8 characters long and include a number and a symbol',
    );

    await page.locator('[data-test-password-field]').fill('mypassword!1');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!1');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);

    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test(`it shows an error when password doesn't meet the requirement`, async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText(
      'Password must be at least 8 characters long and include a number and a symbol',
    );

    await page.locator('[data-test-password-field]').fill('mypassword!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText(
      'Password must be at least 8 characters long and include a number and a symbol',
    );

    await page.locator('[data-test-password-field]').fill('mypassword!1');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!1');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);

    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test(`it can resend email validation message`, async ({ page }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await clearLocalStorage(page);
    await createRegistrationToken(
      synapse,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com', { sendAttempts: 2 });
  });
});
