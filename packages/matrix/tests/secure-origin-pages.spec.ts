import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  REGISTRATION_TOKEN,
  createSubscribedUser,
  getSharedSQLExecutor,
  updateSynapseUser,
} from '../helpers/index.ts';
import {
  fillRegistration,
  followEmailLink,
  keyWriteTicketStatus,
  openSecurePage,
  signInSecureSession,
  signedInUser,
  uniqueName,
} from '../helpers/secure-origin-pages.ts';

// The secure origin's sign-in, account creation and password reset pages:
// the app's own screens, drawn from the same components, on an origin card
// code can't reach. These drive them in a real browser against real Synapse,
// with its email going to smtp4dev. That Synapse asks for an invite code;
// creating an account where it asks for none is
// with-synapse/test-without-registration-token/secure-origin-open-registration.spec.ts.

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

test.describe('The secure origin’s pages', () => {
  test('the sign-in page reads and works from the keyboard as the app’s does', async ({
    page,
  }) => {
    let user = await createSubscribedUser('secure-keyboard');
    let secure = await openSecurePage(page, 'sign-in');
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-sign-in-title]')).toHaveText(
      'Sign in to your Boxel Account',
    );
    await expect(
      secure.locator('[data-test-secure-sign-in-subtitle]'),
    ).toHaveText(
      "Use Google to get started in one tap - we'll create your Boxel account if you don't have one yet.",
    );
    await expect(secure.locator('[data-test-secure-google]')).toHaveText(
      'Continue with Google',
    );
    await expect(secure.locator('[data-test-secure-divider-label]')).toHaveText(
      'or use your email',
    );
    let username = secure.getByLabel('Email Address or Username');
    let password = secure.getByLabel('Password');
    await expect(username).toHaveAttribute('placeholder', 'Your email address');
    await expect(password).toHaveAttribute('placeholder', 'Your password');
    await expect(username).toHaveAttribute('autocomplete', 'username');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(
      secure.locator('[data-test-secure-forgot-password]'),
    ).toHaveText('Forgot password?');
    await expect(
      secure.locator('[data-test-secure-register-prompt]'),
    ).toHaveText("Don't have an account?");
    await expect(secure.locator('[data-test-secure-register]')).toHaveText(
      'Create a new Boxel account',
    );

    // Focus starts in the first field; Sign In waits for both.
    await expect(username).toBeFocused();
    let submit = secure.locator('[data-test-secure-password-submit]');
    await expect(submit).toBeDisabled();
    await secure.keyboard.type(user.username);
    await expect(submit).toBeDisabled();
    await secure.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await secure.keyboard.type('not-the-password');
    await expect(submit).toBeEnabled();
    await secure.keyboard.press('Tab');
    await expect(
      secure.locator('[data-test-secure-forgot-password]'),
    ).toBeFocused();
    await secure.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await secure.keyboard.press('Tab');
    await expect(secure.locator('[data-test-secure-register]')).toBeFocused();
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await expect(secure.locator('[data-test-secure-google]')).toBeFocused();

    // Enter submits; a refused password reads as the app's does, and typing
    // clears it.
    await password.focus();
    await secure.keyboard.press('Enter');
    let error = secure.locator('[data-test-secure-error]');
    await expect(error).toHaveText(
      'Sign-in failed. Please check your credentials and try again.',
    );
    await password.fill(user.password);
    await expect(error).toBeHidden();
    await secure.keyboard.press('Enter');
    expect(await signedInUser(secure)).toBe(user.credentials.userId);
  });

  test('a `mode` that names no page renders nothing', async ({ page }) => {
    let secure = await openSecurePage(page, '?mode=not-a-mode');
    await expect(secure.locator('#secure-shell')).toBeEmpty();
  });

  test('creates an account with an invite code, validating its email', async ({
    page,
  }, testInfo) => {
    let username = uniqueName('secure-reg');
    let email = `${username}@example.com`;
    let secure = await openSecurePage(page, 'sign-in');
    await secure.locator('[data-test-secure-register]').click();
    await expect(secure).toHaveURL(/\/register(\?|#|$)/);
    await expect(secure.getByLabel('Your Name')).toBeFocused();
    await expect(secure.locator('[data-test-register-btn]')).toBeDisabled();
    await expect(
      secure.locator(
        '[data-test-secure-field="username"] [data-test-input-group-suffix]',
      ),
    ).toHaveText('localhost');
    await snapshot(testInfo, secure, 'secure-register-1-form');

    await fillRegistration(secure, {
      name: 'Secure Registrant',
      email,
      username,
    });
    await snapshot(testInfo, secure, 'secure-register-2-filled');
    await secure.getByLabel('Confirm Password').press('Enter');

    // Synapse requires an invite code here, as staging does.
    let token = secure.getByLabel('Your invite code');
    await expect(token).toBeVisible();
    await expect(token).toBeFocused();
    await snapshot(testInfo, secure, 'secure-register-3-invite');
    await token.fill('not-an-invite-code');
    await secure.keyboard.press('Enter');
    await expect(
      secure.locator(
        '[data-test-secure-field="token"] [data-test-boxel-input-error-message]',
      ),
    ).toHaveText(
      'This registration token does not exist or has exceeded its usage limit.',
    );
    await snapshot(testInfo, secure, 'secure-register-4-bad-invite');
    await token.fill(REGISTRATION_TOKEN);
    // The account's first sign-in fails once; trying again from the same page
    // still records the invite code.
    let failedOnce = false;
    await secure.route(
      new URL('/_secure-session', appURL).href,
      async (route) => {
        if (!failedOnce && route.request().method() === 'POST') {
          failedOnce = true;
          await route.fulfill({
            status: 503,
            contentType: 'application/vnd.api+json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            json: {
              errors: [
                {
                  status: '503',
                  code: 'unavailable',
                  detail:
                    'signing in is unavailable right now; try again later',
                },
              ],
            },
          });
          return;
        }
        await route.continue();
      },
    );
    await secure.locator('[data-test-next-btn]').click();

    await expect(secure.locator('[data-test-email-validation]')).toHaveText(
      'Please check your email to complete registration',
    );
    await snapshot(testInfo, secure, 'secure-register-5-check-email');

    let validated = await followEmailLink(secure, email, 'Verify Email');
    // The link lands on the secure origin's own page.
    expect(new URL(validated.url()).origin).toBe(
      new URL(secureOriginURL).origin,
    );
    expect(new URL(validated.url()).pathname).toBe('/secure/verify-email');
    await expect(
      validated.locator('[data-test-email-validated]'),
    ).toBeVisible();
    await snapshot(testInfo, validated, 'secure-register-6-email-validated');

    // The page that asked carries on by itself, and ends signed in, once the
    // failed sign-in is tried again.
    await expect(secure.locator('[data-test-secure-error]')).toHaveText(
      'Signing in is unavailable right now; try again later.',
      { timeout: 60000 },
    );
    await secure.locator('[data-test-secure-retry-sign-in]').click();
    let user = await signedInUser(secure);
    expect(user).toBe(`@${username}:localhost`);
    await snapshot(testInfo, secure, 'secure-register-7-signed-in');

    // Set up as the app's first sign-in sets an account up, with the invite
    // code recorded against the new user.
    let [record] = await getSharedSQLExecutor().executeSQL(
      `SELECT matrix_registration_token, session_room_id FROM users WHERE matrix_user_id = '${user}'`,
    );
    expect(record?.matrix_registration_token).toBe(REGISTRATION_TOKEN);
    expect(record?.session_room_id).toBeTruthy();

    // The secure origin is signed in as the new account, so the app's sign-in
    // goes there and comes straight back with the account's login token.
    await page.goto(appURL);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('[data-test-profile-icon-button]')).toBeVisible();
    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-icon-handle]')).toHaveText(
      user,
    );
  });

  test('creating an account checks each field as the app’s form does', async ({
    page,
  }) => {
    let taken = await createSubscribedUser('secure-taken');
    let secure = await openSecurePage(page, 'register');
    let usernameField = '[data-test-secure-field="username"]';
    // A field's error, under its input, or under the username's input group.
    let error = (field: string) =>
      secure.locator(
        `${field} :is([data-test-boxel-input-error-message], [data-test-boxel-input-group-error-message])`,
      );

    await secure.getByLabel('Your Name').focus();
    await secure.getByLabel('Your Name').blur();
    await expect(error('[data-test-secure-field="name"]')).toHaveText(
      'Your name is missing',
    );
    await secure.getByLabel('Email').focus();
    await secure.getByLabel('Email').blur();
    await expect(error('[data-test-secure-field="email"]')).toHaveText(
      'Email address is missing',
    );
    for (let [value, message] of [
      ['_underscore', 'Username cannot start with an underscore'],
      ['realm/name', 'Username cannot start with "realm/"'],
      [taken.username, 'Username is already taken'],
    ]) {
      await secure.getByLabel('Username').fill(value);
      await secure.getByLabel('Username').blur();
      await expect(error(usernameField)).toHaveText(message);
    }
    await secure.getByLabel('Password', { exact: true }).fill('short');
    await secure.getByLabel('Password', { exact: true }).blur();
    await expect(error('[data-test-secure-field="password"]')).toHaveText(
      'Password must be at least 8 characters long',
    );
    await secure.getByLabel('Password', { exact: true }).fill('longenough1');
    await secure.getByLabel('Confirm Password').fill('different1');
    await secure.getByLabel('Confirm Password').blur();
    await expect(
      error('[data-test-secure-field="confirm-password"]'),
    ).toHaveText('Passwords do not match');
    await expect(secure.locator('[data-test-register-btn]')).toBeDisabled();

    // An email address another account holds is refused.
    let heldEmail = `${taken.username}@example.com`;
    await updateSynapseUser(taken.credentials.userId, {
      emailAddresses: [heldEmail],
    });
    await fillRegistration(secure, {
      name: 'Second Registrant',
      email: heldEmail,
      username: uniqueName('secure-dup'),
    });
    await secure.locator('[data-test-register-btn]').click();
    await expect(error('[data-test-secure-field="email"]')).toHaveText(
      'Email address is already attached to a Boxel account',
    );
  });

  test('resets a forgotten password', async ({ page }, testInfo) => {
    let user = await createSubscribedUser('secure-reset');
    let email = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [email],
    });
    // A secure session signed in with the old password, as whoever it leaked
    // to would have.
    let oldSession = await signInSecureSession(
      page,
      user.username,
      user.password,
    );
    expect(await keyWriteTicketStatus(page, oldSession)).toBe(201);

    let secure = await openSecurePage(page, 'sign-in');
    await secure.locator('[data-test-secure-forgot-password]').click();
    await expect(secure).toHaveURL(/\/forgot-password(\?|#|$)/);
    await snapshot(testInfo, secure, 'secure-reset-1-forgot');

    // An address no account holds is refused.
    await secure.getByLabel('Email Address').fill('nobody@example.com');
    await secure.locator('[data-test-reset-your-password-btn]').click();
    await expect(
      secure.locator('[data-test-boxel-input-error-message]'),
    ).toHaveText('No account with the given email address exists');

    await secure.getByLabel('Email Address').fill(email);
    await secure.keyboard.press('Enter');
    await expect(secure.locator('[data-test-email-validation]')).toHaveText(
      'Please check your email to reset your password',
    );
    await snapshot(testInfo, secure, 'secure-reset-2-check-email');

    let confirm = await followEmailLink(secure, email, 'Reset Password');
    await confirm.getByText('Confirm changing my password').click();
    await expect(
      confirm.locator('[data-test-reset-password-btn]'),
    ).toBeVisible();
    let landed = new URL(confirm.url());
    expect(landed.origin).toBe(new URL(secureOriginURL).origin);
    expect(landed.pathname).toBe('/secure/reset-password');
    expect(landed.searchParams.has('clientSecret')).toBe(false);
    expect(landed.hash).toBe('');
    await snapshot(testInfo, confirm, 'secure-reset-3-new-password');

    let newPassword = 'a-new-password-1';
    await confirm
      .getByLabel('Enter New Password', { exact: true })
      .fill('short');
    await confirm.getByLabel('Re-Enter New Password').fill('short');
    await confirm.getByLabel('Re-Enter New Password').blur();
    await expect(
      confirm.locator('[data-test-reset-password-btn]'),
    ).toBeDisabled();
    await confirm
      .getByLabel('Enter New Password', { exact: true })
      .fill(newPassword);
    await confirm.getByLabel('Re-Enter New Password').fill(newPassword);
    await confirm.locator('[data-test-reset-password-btn]').click();
    await expect(
      confirm.locator('[data-test-reset-password-success]'),
    ).toHaveText('Your password is now reset');
    await snapshot(testInfo, confirm, 'secure-reset-4-done');
    expect(
      await keyWriteTicketStatus(page, oldSession),
      'the reset ended the secure session signed in with the old password',
    ).toBe(403);

    await confirm.locator('[data-test-back-to-login-btn]').click();
    await confirm.getByLabel('Email Address or Username').fill(user.username);
    await confirm.getByLabel('Password').fill(newPassword);
    await confirm.keyboard.press('Enter');
    expect(await signedInUser(confirm)).toBe(user.credentials.userId);
  });
});
