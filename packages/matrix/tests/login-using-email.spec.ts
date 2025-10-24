import { expect, test } from '@playwright/test';
import { updateUser } from '../docker/synapse';
import { appURL } from '../helpers/isolated-realm-server';
import {
  openRoot,
  clearLocalStorage,
  gotoRegistration,
  assertLoggedIn,
  createSubscribedUser,
} from '../helpers';

test.describe('Login using email', () => {
  let user: {
    username: string;
    password: string;
    credentials: any;
  };
  let userEmail: string;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    let adminAccessToken = process.env.ADMIN_ACCESS_TOKEN!;

    user = await createSubscribedUser('email-login');
    userEmail = `${user.username}@example.com`;
    await updateUser(adminAccessToken, user.credentials.userId, {
      emailAddresses: [userEmail],
      displayname: 'Test User',
    });
  });

  test('Login using email', async ({ page }) => {
    await openRoot(page, appURL);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill(userEmail);
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill(user.password);
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page, {
      email: userEmail,
      userId: user.credentials.userId,
      displayName: 'Test User',
    });
  });
});
