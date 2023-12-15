import { expect } from '@playwright/test';
import {
  Credentials,
  registerUser,
  updateDisplayName,
} from '../docker/synapse';
import {
  assertLoggedIn,
  assertLoggedOut,
  login,
  logout,
  openRoot,
  openChat,
  reloadAndOpenChat,
  toggleOperatorMode,
  test,
} from '../helpers';

let registeredUser: Credentials | undefined;

test.describe('Login', () => {
  test.beforeEach(async ({ synapse }) => {
    registeredUser = await registerUser(synapse, 'user1', 'pass');
  });

  test('it can login', async ({ page }) => {
    await openRoot(page);
    await toggleOperatorMode(page);

    await assertLoggedOut(page);
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('pass');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await openChat(page);

    await assertLoggedIn(page);

    // edit the display name to show that our access token works
    await page.locator('[data-test-profile-edit-btn]').click();
    await page.locator('[data-test-displayName-field]').fill('New Name');
    await page.locator('[data-test-profile-save-btn]').click();
    await expect(
      page.locator('[data-test-field-value="displayName"]'),
    ).toContainText('New Name');

    // reload to page to show that the access token persists
    await reloadAndOpenChat(page);
    await assertLoggedIn(page, { displayName: 'New Name' });
  });

  test('it can logout', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await assertLoggedIn(page);

    await logout(page);
    await assertLoggedOut(page);

    // reload to page to show that the logout state persists
    await page.reload();
    await assertLoggedOut(page);
  });

  test('it can logout using the profile menu', async ({ page }) => {
    await login(page, 'user1', 'pass');

    await expect(
      page.locator(
        '[data-test-profile-icon-button] > [data-test-profile-icon]',
      ),
    ).toHaveText('U');
    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-icon-handle]')).toHaveText(
      '@user1:localhost',
    );
    await page.locator('[data-test-signout-button]').click();
    await expect(page.locator('[data-test-login-form]')).toBeVisible();
  });

  test('the profile reflects display name changes', async ({
    page,
    synapse,
  }) => {
    page.on('console', (msg) => console.log(msg.text()));
    await login(page, 'user1', 'pass');

    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-display-name]')).toHaveText(
      'user1',
    );

    await updateDisplayName(
      synapse,
      registeredUser!.userId,
      registeredUser!.accessToken,
      'newname',
    );

    await expect(page.locator('[data-test-profile-display-name]')).toHaveText(
      'newname',
    );
  });

  test('it shows an error when invalid credentials are provided', async ({
    page,
  }) => {
    await openRoot(page);
    await toggleOperatorMode(page);
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('bad pass');
    await expect(
      page.locator('[data-test-login-error]'),
      'login error message is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-login-btn]').click();
    await expect(page.locator('[data-test-login-error]')).toContainText(
      'Sign in failed. Please check your credentials and try again',
    );

    await page.locator('[data-test-password-field]').fill('pass');
    await expect(
      page.locator('[data-test-login-error]'),
      'login error message is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-login-btn]').click();
    await openChat(page);

    await assertLoggedIn(page);
  });

  test('it reacts to enter keypresses', async ({ page }) => {
    await openRoot(page);
    await toggleOperatorMode(page);

    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('pass');

    await page.keyboard.press('Enter');

    await openChat(page);
    await assertLoggedIn(page);
  });

  test('it returns to login when auth is invalid', async ({ page }) => {
    await page.addInitScript({
      content: `
        window.localStorage.setItem(
          'auth',
          '{"user_id":"@b:stack.cards","access_token":"INVALID_TOKEN","home_server":"stack.cards","device_id":"HELLO","well_known":{"m.homeserver":{"base_url":"http://example.com/"}}}'
        )`,
    });

    await openRoot(page);
    await toggleOperatorMode(page);

    await assertLoggedOut(page);
  });
});
