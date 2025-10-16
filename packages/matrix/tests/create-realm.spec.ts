import { test, expect } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
} from '../helpers';

test.describe('Create Realm via Dashboard', () => {
  test('it can create a new realm', async ({ page }) => {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    let { username } = await createSubscribedUserAndLogin(
      page,
      'realm-creator',
      serverIndexUrl,
    );

    await createRealm(page, 'new-workspace', '1New Workspace');

    await expect(
      page.locator(`[data-test-workspace="1New Workspace"]`),
    ).toBeVisible();
    await expect(
      page.locator('[data-test-create-workspace-modal]'),
    ).toHaveCount(0);

    await page.locator('[data-test-workspace="1New Workspace"]').click();
    let newRealmURL = new URL(`${username}/new-workspace/`, serverIndexUrl)
      .href;
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-test-boxel-filter-list-button]`),
    ).toHaveCount(2);

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();
    await expect(page.locator('[data-test-host-submode]')).toBeVisible();

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
