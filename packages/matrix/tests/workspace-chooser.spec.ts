import { test, expect } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
} from '../helpers';

test.describe('Workspace Chooser', () => {
  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
  });

  test('back button from a workspace returns to the workspace chooser', async ({
    page,
  }) => {
    const serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);
    const realm1Name = 'realm1';
    let { username } = await createSubscribedUserAndLogin(
      page,
      'workspace-chooser',
      serverIndexUrl,
    );
    await createRealm(page, realm1Name);
    await page.goto(`${serverIndexUrl}/${username}/${realm1Name}`);

    await page.goBack();

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);

    // realm1, skills, and catalog realm
    await expect(page.locator('[data-test-workspace]')).toHaveCount(3);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace="realm1"]`),
    ).toHaveCount(1);
  });
});
