import { expect, type Page, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
  updateUser,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  login,
  validateEmail,
  assertLoggedOut,
  assertLoggedIn,
  registerRealmUsers,
} from '../helpers';

test.describe('Profile', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();

    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user0', 'pass');
    await updateUser(admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@localhost'],
    });
    await updateUser(admin.accessToken, '@user0:localhost', {
      emailAddresses: ['user0@localhost'],
    });
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  async function gotoProfileSettings(page: Page) {
    await login(page, 'user1', 'pass');
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-settings-button]').click();
  }

  async function logoutFromProfileSettings(page: Page) {
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-signout-button]').click();
  }

  test('it can change display name in settings', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(
      page.locator('[data-test-profile-display-name]'),
    ).toContainText('');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await page.locator('[data-test-display-name-field]').fill('John');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();
    await expect(
      page.locator('[data-test-profile-display-name]'),
    ).toContainText('John'); // This is read from the profile in matrix service that gets fetched from the matrix server on save
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
  });

  test('it can change email in settings', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-change-email-button]').click();

    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Email');
    await expect(page.locator('[data-test-email-validation-msg]')).toHaveCount(
      1,
    );
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('pass');
    await page.locator('[data-test-confirm-password-button]').click();

    // pending email state
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(0);
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await expect(page.locator('[data-test-email-validation-msg]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-test-new-email]')).toContainText(
      'user2@localhost',
    );
    await expect(
      page.locator('[data-test-new-email-not-verified]'),
    ).toHaveCount(1);

    // email client
    await validateEmail(page, 'user2@localhost', {
      onAppTrigger: async (page) => {
        await expect(page.locator('[data-test-resend-validation]')).toHaveCount(
          1,
        );
      },
      onEmailPage: async (page) => {
        await expect(page).toHaveScreenshot(
          'email-change-verification-email.png',
          {
            mask: [page.locator('.messagelist')],
            maxDiffPixelRatio: 0.01,
          },
        );
      },
      onValidationPage: async (page) => {
        await expect(page.locator('body')).toContainText(
          'Your email has now been validated',
        );
        await expect(page).toHaveScreenshot(
          'email-change-verification-page.png',
          {
            maxDiffPixelRatio: 0.01,
          },
        );
      },
    });

    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user2@localhost',
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
  });

  test('it can handle incorrect password when changing email', async ({
    page,
  }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();

    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('bad pass');
    await page.locator('[data-test-confirm-password-button]').click();
    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toContainText('Invalid password');
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('pass');
    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toHaveCount(0);
  });

  test('it can handle setting email to an already existing email when changing email', async ({
    page,
  }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();

    await page.locator('[data-test-new-email-field]').fill('user0@localhost');
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('pass');
    await page.locator('[data-test-confirm-password-button]').click();

    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toHaveText('Email address is already in use');
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toHaveCount(0);
  });

  test('it can resend email verification message', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('pass');
    await page.locator('[data-test-confirm-password-button]').click();

    // email client
    await validateEmail(page, 'user2@localhost', {
      sendAttempts: 2,
      onAppTrigger: async (page) => {
        await expect(page.locator('[data-test-resend-validation]')).toHaveCount(
          1,
        );
      },
    });
  });

  test('it can cancel email verification', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page
      .locator('[data-test-password-modal] [data-test-password-field]')
      .fill('pass');
    await page.locator('[data-test-confirm-password-button]').click();

    // pending email state
    await page.locator('[data-test-cancel-email-change]').click();
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
  });

  test('it can cancel password confirmation when changing email', async ({
    page,
  }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page.locator('[data-test-password-confirm-cancel-button]').click();

    await expect(page.locator('[data-test-password-modal]')).toHaveCount(0);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
    await expect(page.locator('[data-test-email-validation-msg]')).toHaveCount(
      0,
    );
  });

  test('it can cancel changing an email', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill('user2@localhost');

    await page.locator('[data-test-confirm-cancel-button]').click();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
  });

  test('it can change password in settings', async ({ page }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');
    await page.locator('[data-test-current-password-field]').fill('pass');
    await page.locator('[data-test-new-password-field]').fill('newpass123!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-confirm-cancel-button]').click();

    await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('newpass123!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page);
  });

  test('It shows an error when new password does not meet the requirement', async ({
    page,
  }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');
    await page.locator('[data-test-current-password-field]').fill('pass');
    await page.locator('[data-test-new-password-field]').fill('newpass');
    await page.locator('[data-test-confirm-password-field]').fill('newpass');
    await expect(
      page.locator(
        '[data-test-new-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'new password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-new-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Password must be at least 8 characters long');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await page.locator('[data-test-new-password-field]').fill('newpass123!');
    await page.locator('[data-test-confirm-password-field]').fill('newpass1');
    await page.locator('[data-test-new-password-field]').fill('newpass123!'); //This line is only for change focus from input
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'confirm password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Passwords do not match');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await page.locator('[data-test-new-password-field]').fill('newpass123!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-confirm-cancel-button]').click();

    await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('newpass123!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page);
  });

  test('It shows an error when current password is invalid', async ({
    page,
  }) => {
    await gotoProfileSettings(page);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');

    await page
      .locator('[data-test-current-password-field]')
      .fill('invalidpass');
    await page.locator('[data-test-new-password-field]').fill('newpass123!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();
    await expect(
      page.locator(
        '[data-test-current-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'current password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-current-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid password');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await page.locator('[data-test-current-password-field]').fill('pass');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      'user1@localhost',
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-confirm-cancel-button]').click();

    await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('newpass123!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page);
  });
});
