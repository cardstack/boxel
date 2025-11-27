import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
} from '../helpers';

test.describe('Head tags', () => {
  let user: { username: string; password: string; credentials: any };

  async function openPublishRealmModal(page: Page) {
    let serverIndexUrl = new URL(appURL).origin;
    await clearLocalStorage(page, serverIndexUrl);

    user = await createSubscribedUserAndLogin(
      page,
      'publish-realm',
      serverIndexUrl,
    );

    await createRealm(page, 'new-workspace', '1New Workspace');
    await page.locator('[data-test-workspace="1New Workspace"]').click();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();
  }

  async function publishDefaultRealm(page: Page) {
    await openPublishRealmModal(page);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    await page.waitForSelector('[data-test-unpublish-button]');
    await expect(
      page.locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      ),
    ).toBeVisible();
  }

  test('the HTML response from a published realm has relevant meta tags', async ({
    page,
  }) => {
    await publishDefaultRealm(page);

    let publishedRealmURLString = `http://${user.username}.localhost:4205/new-workspace/index`;
    let response = await page.goto(publishedRealmURLString);

    expect(response?.status()).toBe(200);

    let body = await response!.text();
    expect(body).toBeDefined();
    expect(body).toContain('property="og:title"');
    expect(body).toContain('property="og:type"');
    expect(body).toContain(
      `property="og:url" content="${publishedRealmURLString}"`,
    );
  });
});
