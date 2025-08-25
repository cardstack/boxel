import { test, expect } from '@playwright/test';
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

test.describe('Create Realm via Dashboard', () => {
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

  test('it can create a new realm', async ({ page }) => {
    let serverIndexUrl = new URL(testEnv.config.testHost).origin;
    await clearLocalStorage(page, serverIndexUrl);

    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);

    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await createRealm(page, 'new-workspace', '1New Workspace');
    await page.locator('[data-test-workspace="1New Workspace"]').click();
    let newRealmURL = new URL('user1/new-workspace/', serverIndexUrl).href;
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-test-boxel-filter-list-button]`),
    ).toHaveCount(1);

    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(
      page.locator(
        `[data-test-workspace="1New Workspace"] [data-test-realm-icon-url]`,
      ),
      'the "N" icon URL is shown',
    ).toHaveAttribute(
      'style',
      'background-image: url("https://boxel-images.boxel.ai/icons/Letter-n.png");',
    );
  });
});
