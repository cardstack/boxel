import { test, expect } from '@playwright/test';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  setupPayment,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('User Registration w/o Token', () => {
  let testEnv: TestEnvironment;
  let appURL: string;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(60_000);
    testEnv = await startUniqueTestEnvironment();
    appURL = testEnv.config.testHost;
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  // CS-8381
  test.skip('it can register a user without a registration token', async ({
    page,
  }) => {
    await clearLocalStorage(page, appURL);
    await gotoRegistration(page, appURL);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();
    await validateEmail(page, 'user1@example.com');

    await page.bringToFront();

    await expect(page.locator('[data-test-email-validated]')).toContainText(
      'Success! Your email has been validated',
    );

    await setupPayment('@user1:localhost', testEnv.realmServer!, page);
    await assertLoggedIn(page);
  });
});
