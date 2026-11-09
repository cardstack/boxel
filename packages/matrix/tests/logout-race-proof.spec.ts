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
// Off-origin, so no service worker of the app's controls it; route.fulfill
// answers it before any DNS lookup.
const target = 'https://logout-race-target.test/';

// The app registers an auth service worker at `/`. Requests from a page it
// controls skip Playwright's routes, which is why the first version of this
// rig never held anything. So the spec blocks service workers and routes at
// the context, and counts each route's hits to prove the rig engaged.
test.use({ serviceWorkers: 'block' });

async function rig(page: Page) {
  let hits = { logout: 0, target: 0 };
  await page.context().route('**/_matrix/client/*/logout', async (route) => {
    hits.logout++;
    await new Promise((r) => setTimeout(r, SLOW_MATRIX_LOGOUT_MS));
    await route.continue();
  });
  await page.context().route(target, async (route) => {
    hits.target++;
    await new Promise((r) => setTimeout(r, SLOW_TARGET_MS));
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p data-test-race-target>target</p>',
    });
  });
  return hits;
}

test.describe('logout race proof', () => {
  let hits: { logout: number; target: number };
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await createSubscribedUserAndLogin(page, 'logout-race', serverIndexUrl);
    hits = await rig(page);
  });

  test('control: the old click-and-return logout lets the sign-out interrupt the next navigation', async ({
    page,
  }) => {
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-signout-button]').click();
    await expect(
      page.goto(target, { waitUntil: 'domcontentloaded' }),
    ).rejects.toThrow(/interrupted by another navigation|ERR_ABORTED/);
    expect(hits, 'both held routes were hit').toEqual({ logout: 1, target: 1 });
  });

  test('fixed: the next navigation after logout() lands and stays', async ({
    page,
  }) => {
    await logout(page);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-test-race-target]')).toBeVisible();
    await page.waitForTimeout(SLOW_MATRIX_LOGOUT_MS + 1000);
    expect(page.url()).toBe(target);
    expect(hits, 'both held routes were hit').toEqual({ logout: 1, target: 1 });
  });
});
