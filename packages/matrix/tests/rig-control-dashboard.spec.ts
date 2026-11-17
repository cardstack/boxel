// Proof rig only, never merged: the dashboard back-button test with the old
// clearLocalStorage step (open the signed-out app, clear storage), as a
// control for tests/dashboard.spec.ts.
import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { createRealm, createSubscribedUserAndLogin } from '../helpers/index.ts';

test.describe('Rig control: Dashboard', () => {
  test('back button from a workspace returns to the dashboard (old clearLocalStorage)', async ({
    page,
  }) => {
    const serverIndexUrl = new URL(appURL).origin;
    await page.goto(serverIndexUrl);
    await page.evaluate(() => window.localStorage.clear());
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
  });
});
