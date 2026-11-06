// THROWAWAY: proves the logout-helper fix on CI. Not for merge.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  clearLocalStorage,
  createSubscribedUserAndLogin,
  logout,
} from '../helpers/index.ts';

const serverIndexUrl = new URL(appURL).origin;
// The app awaits the Matrix /logout before it replaces the page with the
// secure origin's sign-out. Holding it open widens the window in which a
// test's next navigation can be interrupted.
const SLOW_MATRIX_LOGOUT_MS = 1500;
// The next navigation's response arrives after the late sign-out
// navigation, so it is still in flight when that navigation starts.
const SLOW_TARGET_MS = 4000;
const target = `${serverIndexUrl}/__logout-race-target`;

async function rig(page: Page) {
  await page.route('**/_matrix/client/*/logout', async (route) => {
    await new Promise((r) => setTimeout(r, SLOW_MATRIX_LOGOUT_MS));
    await route.continue();
  });
  await page.route(target, async (route) => {
    await new Promise((r) => setTimeout(r, SLOW_TARGET_MS));
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p data-test-race-target>target</p>',
    });
  });
}

test.describe('logout race proof', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await createSubscribedUserAndLogin(page, 'logout-race', serverIndexUrl);
    await rig(page);
  });

  test('control: the old click-and-return logout lets the sign-out interrupt the next navigation', async ({
    page,
  }) => {
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-signout-button]').click();
    await expect(
      page.goto(target, { waitUntil: 'domcontentloaded' }),
    ).rejects.toThrow(/interrupted by another navigation|ERR_ABORTED/);
  });

  test('fixed: the next navigation after logout() lands and stays', async ({
    page,
  }) => {
    await logout(page);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-test-race-target]')).toBeVisible();
    await page.waitForTimeout(SLOW_MATRIX_LOGOUT_MS + 1000);
    expect(page.url()).toBe(target);
  });
});
