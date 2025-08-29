import { expect, test } from '@playwright/test';
import {
  openRoot,
  clearLocalStorage,
  gotoRegistration,
  assertLoggedIn,
  setupUserSubscribed,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';
import {
  createRegistrationToken,
  registerUser,
  updateUser,
} from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('Login using email', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    testEnv = await startUniqueTestEnvironment();

    let admin = await registerUser(
      testEnv.synapse!,
      'admin',
      'adminpass',
      true,
    );
    await createRegistrationToken(
      testEnv.synapse!,
      admin.accessToken,
      REGISTRATION_TOKEN,
    );

    await clearLocalStorage(page, testEnv.config.testHost);
    await gotoRegistration(page, testEnv.config.testHost);
    await registerUser(testEnv.synapse!, 'user1', 'mypassword1!');
    await updateUser(testEnv.synapse!, admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@example.com'],
      displayname: 'Test User',
    });
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  test('Login using email', async ({ page }) => {
    await openRoot(page, testEnv.config.testHost);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();
    await assertLoggedIn(page, {
      email: 'user1@example.com',
      displayName: 'Test User',
    });
  });
});
