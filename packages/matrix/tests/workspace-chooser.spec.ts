import { test, expect, type Page } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  clearLocalStorage,
  createRealm,
  login,
  setupUserSubscribed,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('Workspace Chooser', () => {
  let testEnv: TestEnvironment;
  const realm1Name = 'realm1';

  async function setupRealms(page: Page) {
    let serverIndexUrl = new URL(testEnv.config.testHost).origin;
    let realm1URL = new URL(`user1/${realm1Name}/`, serverIndexUrl).href;

    await clearLocalStorage(page, serverIndexUrl);
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });
    await createRealm(page, realm1Name);
    await page.goto(realm1URL);
  }

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

  test('back button from a workspace returns to the workspace chooser', async ({
    page,
  }) => {
    await setupRealms(page);

    await page.goBack();

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);

    // realm1, skills, and catalog realm
    await expect(page.locator('[data-test-workspace]')).toHaveCount(3);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace="realm1"]`),
    ).toHaveCount(1);
  });
});
