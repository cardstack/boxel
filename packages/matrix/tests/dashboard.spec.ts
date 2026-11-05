import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

test.describe('Dashboard', () => {
  test('back button from a workspace returns to the dashboard', async ({
    page,
  }) => {
    const serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);
    const realm1Name = 'realm1';
    let { username } = await createSubscribedUserAndLogin(
      page,
      'dashboard',
      serverIndexUrl,
    );
    await createRealm(page, realm1Name);
    await page.goto(`${serverIndexUrl}/${username}/${realm1Name}`);

    await page.goBack();

    await expect(page.locator('[data-test-dashboard]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace="realm1"]`),
    ).toHaveCount(1);
    // the skills and catalog realms
    await expect(
      page.locator('[data-test-catalog-list] [data-test-workspace]'),
    ).toHaveCount(2);
  });
});
