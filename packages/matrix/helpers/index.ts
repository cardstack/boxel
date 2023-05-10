import { expect, type Page } from '@playwright/test';

export const testHost = 'http://127.0.0.1:4200';

interface ProfileAssertions {
  userId?: string;
  displayName?: string;
}

export async function assertLoggedIn(page: Page, opts?: ProfileAssertions) {
  await page.waitForURL(`${testHost}/chat`);
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is not displayed'
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is not displayed'
  ).toHaveCount(0);
  await expect(page.locator('[data-test-field-value="userId"]')).toContainText(
    opts?.userId ?? '@user1:localhost'
  );
  await expect(
    page.locator('[data-test-field-value="displayName"]')
  ).toContainText(opts?.displayName ?? 'user1');
}

export async function assertLoggedOut(page: Page) {
  await page.waitForURL(`${testHost}/chat`);
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is displayed'
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is displayed'
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-field-value="userId"]'),
    'user profile - user ID is not displayed'
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-field-value="displayName"]'),
    'user profile - display name is not displayed'
  ).toHaveCount(0);
}
