import { test, expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('Host mode', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    testEnv = await startUniqueTestEnvironment();
    await registerUser(
      testEnv.synapse!,
      'user1',
      'pass',
      false,
      undefined,
      testEnv.config.testHost,
    );
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  test('card in a published realm renders in host mode', async ({ page }) => {
    await page.goto('http://published.realm/mango.json');

    await expect(
      page.locator('[data-test-card="http://published.realm/mango"]'),
    ).toBeVisible();
    await expect(page.locator('h1:first-of-type')).toHaveText('Mango');
  });
});
