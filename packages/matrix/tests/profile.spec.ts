import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import {
  credentialFields,
  login,
  validateEmail,
  assertLoggedOut,
  assertLoggedIn,
  createSubscribedUser,
  createUser,
  updateSynapseUser,
} from '../helpers/index.ts';
import {
  keyWriteTicketStatus,
  signInSecureSession,
} from '../helpers/secure-origin-pages.ts';
import { appURL } from '../support/isolated-realm-server.ts';

test.describe('Profile', () => {
  // CI HACK (do not merge): on even repeats, hold Synapse's answer to the
  // logout request for 3 s, so the sign-in form is filled before it returns.
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.repeatEachIndex % 2 === 0) {
      await page.route('**/_matrix/client/v3/logout', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
      });
    }
  });

  let user: {
    username: string;
    password: string;
    credentials: any;
  };
  let userEmail: string;

  let unseenEmail: string;
  test.beforeEach(async ({ page }) => {
    user = await createSubscribedUser('profile');
    userEmail = `${user.username}@localhost`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [userEmail],
    });

    unseenEmail = `unseen-${user.username}@localhost`;
    await gotoProfileSettings(page);
  });

  async function gotoProfileSettings(page: Page) {
    await login(page, user.username, user.password, { url: appURL });
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-settings-button]').click();
  }

  // What happened between signing out and signing back in, put in the error
  // when the sign-in form can't be filled. The first attempt of a failing test
  // records no trace, so the error is the only place this survives.
  interface SignOutRecord {
    note(event: string): void;
    describe(): string;
  }

  async function logoutFromProfileSettings(page: Page): Promise<SignOutRecord> {
    let start = Date.now();
    let events: string[] = [];
    let record: SignOutRecord = {
      note: (event) => events.push(`+${Date.now() - start}ms ${event}`),
      describe: () => events.join('\n'),
    };
    // The login form asks Synapse for its login flows when it is constructed,
    // so each of these requests is the form being built.
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().endsWith('/_matrix/client/v3/login')
      ) {
        record.note('login form built');
      }
    });
    page.on('response', (response) => {
      if (response.url().endsWith('/_matrix/client/v3/logout')) {
        record.note(`matrix logout answered ${response.status()}`);
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        record.note(`navigated to ${frame.url()}`);
      }
    });
    await page.locator('[data-test-profile-icon-button]').click();
    record.note('sign out clicked');
    // Logout shows the login form at once, but goes to the workspace chooser
    // only once Matrix answers its logout request, and that navigation builds
    // the form again. Wait for it, so the form the caller fills is the last.
    let loggedOut = page.waitForResponse((response) =>
      response.url().endsWith('/_matrix/client/v3/logout'),
    );
    await page.locator('[data-test-signout-button]').click();
    await loggedOut;
    await page.waitForURL((url) =>
      (url.searchParams.get('operatorModeState') ?? '').includes(
        '"workspaceChooserOpened":true',
      ),
    );
    record.note('logout navigation done');
    return record;
  }

  async function signInFromLoggedOutState(
    page: Page,
    signOut: SignOutRecord,
    username: string,
    password: string,
  ) {
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    signOut.note('filling the sign-in form');
    try {
      await expect(async () => {
        await credentialFields(page)
          .locator('[data-test-username-field]')
          .fill(username);
        await credentialFields(page)
          .locator('[data-test-password-field]')
          .fill(password);
        await expect(
          credentialFields(page).locator('[data-test-username-field]'),
        ).toHaveValue(username);
        await expect(
          credentialFields(page).locator('[data-test-password-field]'),
        ).toHaveValue(password);
        await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
      }).toPass({ timeout: 15_000 });
    } catch (e) {
      throw new Error(
        `${(e as Error).message}\n\nSince sign-out:\n${signOut.describe()}`,
      );
    }
    await page.locator('[data-test-login-btn]').click();
  }

  test('it can change display name in settings', async ({ page }) => {
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
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
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
    await page.locator('[data-test-new-email-field]').fill(unseenEmail);
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill(user.password);
    await page.locator('[data-test-confirm-password-button]').click();

    // pending email state
    await expect(page.locator('[data-test-password-modal]')).toBeHidden();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await expect(page.locator('[data-test-email-validation-msg]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-test-new-email]')).toContainText(
      unseenEmail,
    );
    await expect(
      page.locator('[data-test-new-email-not-verified]'),
    ).toHaveCount(1);

    // email client
    await validateEmail(page, unseenEmail, {
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
      unseenEmail,
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
  });

  test('it can handle incorrect password when changing email', async ({
    page,
  }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();

    await page.locator('[data-test-new-email-field]').fill(unseenEmail);
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill('bad pass');
    await page.locator('[data-test-confirm-password-button]').click();
    await expect(
      credentialFields(page, 'confirm-password').locator(
        '[data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid password');
    await expect(
      page.locator('[data-test-confirm-password-button]'),
      'confirming waits for a different password',
    ).toBeDisabled();
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill(user.password);
    await expect(
      credentialFields(page, 'confirm-password').locator(
        '[data-test-boxel-input-error-message]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-test-confirm-password-button]'),
    ).toBeEnabled();
  });

  test('it can handle setting email to an already existing email when changing email', async ({
    page,
  }) => {
    let existingUser = await createUser('profile-existing-user');
    let existingUserEmail = `${existingUser.username}@localhost`;
    await updateSynapseUser(existingUser.credentials.userId, {
      emailAddresses: [existingUserEmail],
    });
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();

    await page.locator('[data-test-new-email-field]').fill(existingUserEmail);
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill(user.password);
    await page.locator('[data-test-confirm-password-button]').click();

    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toHaveText('Email address is already in use');
    await page.locator('[data-test-new-email-field]').fill(existingUserEmail);
    await expect(
      page.locator('[data-test-boxel-input-error-message]'),
    ).toHaveCount(0);
  });

  test('it can resend email verification message', async ({ page }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill(unseenEmail);
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill(user.password);
    await page.locator('[data-test-confirm-password-button]').click();

    // email client
    await validateEmail(page, unseenEmail, {
      sendAttempts: 2,
      onAppTrigger: async (page) => {
        await expect(page.locator('[data-test-resend-validation]')).toHaveCount(
          1,
        );
      },
    });
  });

  test('it can cancel email verification', async ({ page }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill(unseenEmail);
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await credentialFields(page, 'confirm-password')
      .locator('[data-test-password-field]')
      .fill(user.password);
    await page.locator('[data-test-confirm-password-button]').click();

    // pending email state
    await page.locator('[data-test-cancel-email-change]').click();
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
  });

  test('it can cancel password confirmation when changing email', async ({
    page,
  }) => {
    let existingUser = await createUser('profile-existing-user');
    let existingUserEmail = `${existingUser.username}@localhost`;
    await updateSynapseUser(existingUser.credentials.userId, {
      emailAddresses: [existingUserEmail],
    });
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();
    await page.locator('[data-test-new-email-field]').fill(existingUserEmail);
    await page.locator('[data-test-profile-settings-save-button]').click();

    // password modal
    await expect(page.locator('[data-test-password-modal]')).toHaveCount(1);
    await page.locator('[data-test-password-confirm-cancel-button]').click();

    await expect(page.locator('[data-test-password-modal]')).toHaveCount(0);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await expect(page.locator('[data-test-new-email]')).toHaveCount(0);
    await expect(page.locator('[data-test-email-validation-msg]')).toHaveCount(
      0,
    );
  });

  test('it can cancel changing an email', async ({ page }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await page.locator('[data-test-change-email-button]').click();
    await page
      .locator('[data-test-new-email-field]')
      .fill('new-email-prefix' + userEmail);

    await page.locator('[data-test-confirm-cancel-button]').click();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
  });

  test('it can change password in settings', async ({ page }) => {
    // A secure session signed in with the old password, as whoever it leaked
    // to would have.
    let secureSession = await signInSecureSession(
      page,
      user.username,
      user.password,
    );
    expect(await keyWriteTicketStatus(page, secureSession)).toBe(201);
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');
    await credentialFields(page)
      .locator('[data-test-current-password-field]')
      .fill(user.password);
    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass123!');
    await credentialFields(page)
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    expect(
      await keyWriteTicketStatus(page, secureSession),
      'the change ended the secure session signed in with the old password',
    ).toBe(403);
    await page.locator('[data-test-confirm-cancel-button]').click();

    let signOut = await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await signInFromLoggedOutState(page, signOut, user.username, 'newpass123!');
    await assertLoggedIn(page, {
      userId: user.credentials.userId,
      displayName: user.username,
      email: userEmail,
    });
  });

  test('It shows an error when new password does not meet the requirement', async ({
    page,
  }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');
    await credentialFields(page)
      .locator('[data-test-current-password-field]')
      .fill(user.password);
    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass');
    await credentialFields(page)
      .locator('[data-test-confirm-password-field]')
      .fill('newpass');
    await expect(
      credentialFields(page).locator(
        '[data-test-new-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'new password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      credentialFields(page).locator(
        '[data-test-new-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Password must be at least 8 characters long');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass123!');
    await credentialFields(page)
      .locator('[data-test-confirm-password-field]')
      .fill('newpass1');
    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass123!'); //This line is only for change focus from input
    await expect(
      credentialFields(page).locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'confirm password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      credentialFields(page).locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Passwords do not match');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass123!');
    await credentialFields(page)
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-confirm-cancel-button]').click();

    let signOut = await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await signInFromLoggedOutState(page, signOut, user.username, 'newpass123!');
    await assertLoggedIn(page, {
      userId: user.credentials.userId,
      displayName: user.username,
      email: userEmail,
    });
  });

  test('It shows an error when current password is invalid', async ({
    page,
  }) => {
    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );

    await page.locator('[data-test-change-password-button]').click();
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings > Password');

    await credentialFields(page)
      .locator('[data-test-current-password-field]')
      .fill('invalidpass');
    await credentialFields(page)
      .locator('[data-test-new-password-field]')
      .fill('newpass123!');
    await credentialFields(page)
      .locator('[data-test-confirm-password-field]')
      .fill('newpass123!');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();
    await expect(
      credentialFields(page).locator(
        '[data-test-current-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'current password field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      credentialFields(page).locator(
        '[data-test-current-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid password');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();

    await credentialFields(page)
      .locator('[data-test-current-password-field]')
      .fill(user.password);
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();

    await expect(page.locator('[data-test-current-email]')).toContainText(
      userEmail,
    );
    await expect(
      page.locator('[data-test-settings-modal] [data-test-boxel-header-title]'),
    ).toContainText('Settings');
    await page.locator('[data-test-confirm-cancel-button]').click();

    let signOut = await logoutFromProfileSettings(page);
    await assertLoggedOut(page);

    await signInFromLoggedOutState(page, signOut, user.username, 'newpass123!');
    await assertLoggedIn(page, {
      userId: user.credentials.userId,
      displayName: user.username,
      email: userEmail,
    });
  });
});
