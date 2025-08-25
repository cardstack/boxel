import { expect, test } from '@playwright/test';
import { registerUser, updateAccountData, updateUser } from '../docker/synapse';
import {
  login,
  setupUserSubscribed,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

import { APP_BOXEL_REALMS_EVENT_TYPE } from '../helpers/matrix-constants';

test.describe('Realm URLs in Matrix account data', () => {
  let testEnv: TestEnvironment;

  let user: { accessToken: string };

  test.beforeEach(async () => {
    testEnv = await startUniqueTestEnvironment();

    let admin = await registerUser(
      testEnv.synapse!,
      'admin',
      'adminpass',
      true,
    );

    user = await registerUser(testEnv.synapse!, 'user1', 'pass');
    await updateUser(testEnv.synapse!, admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@localhost'],
    });

    await updateAccountData(
      testEnv.synapse!,
      '@user1:localhost',
      user.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
      JSON.stringify({ realms: [] }),
    );
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  test('active realms are determined by account data', async ({ page }) => {
    await login(page, 'user1', 'pass', { url: testEnv.config.testHost });

    await page.locator('[data-test-workspace-chooser-toggle]').click();

    await page
      .locator('[data-test-workspace-chooser]')
      .waitFor({ state: 'visible' });

    expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(0);

    await updateAccountData(
      testEnv.synapse!,
      '@user1:localhost',
      user.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
      JSON.stringify({
        realms: ['http://example.com/'],
      }),
    );

    await page
      .locator('[data-test-workspace-list] [data-test-workspace]')
      .waitFor({ state: 'visible' });
    expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(1);

    expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-name]',
      ),
    ).toHaveText('Unknown Workspace');
    expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-visibility]',
      ),
    ).toHaveText('private');
  });
});
