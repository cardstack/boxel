import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { secureOriginURL } from '../support/isolated-realm-server.ts';
import { mailHost } from './index.ts';

// Driving the secure origin's sign-in, account creation and password reset
// pages, for the specs that exercise them.

export const STORAGE_KEY = 'boxel-secure-session';

export async function openSecurePage(page: Page, query: string): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}?${query}`);
  return secure;
}

export async function signedInUser(secure: Page): Promise<string> {
  await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible({
    timeout: 60000,
  });
  return JSON.parse(
    (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  ).user;
}

// The newest email to `email` in smtp4dev whose body contains `button`, and
// clicks that button, which opens a page. Returns it.
export async function followEmailLink(
  page: Page,
  email: string,
  button: string,
  count = 1,
): Promise<Page> {
  let context = page.context();
  let emailPage = await context.newPage();
  await emailPage.goto(mailHost);
  let messages = emailPage
    .locator('.messagelist .unread')
    .filter({ hasText: email });
  await expect(messages).toHaveCount(count);
  await messages.first().click();
  let body = emailPage.frameLocator('.messageview iframe');
  await expect(body.locator('body')).toContainText(button);
  let opened = context.waitForEvent('page');
  // smtp4dev needs a moment before the link opens a window.
  await emailPage.waitForTimeout(500);
  await body.getByText(button).last().click();
  let linked = await opened;
  await linked.waitForLoadState();
  await emailPage.close();
  return linked;
}

export function uniqueName(prefix: string) {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export async function fillRegistration(
  secure: Page,
  { name, email, username }: { name: string; email: string; username: string },
  password = 'mypassword1!',
) {
  await secure.getByLabel('Your Name').fill(name);
  await secure.getByLabel('Email').fill(email);
  await secure.getByLabel('Username').fill(username);
  await secure.getByLabel('Username').blur();
  await expect(secure.locator('[data-test-username-available]')).toBeVisible();
  await secure.getByLabel('Password', { exact: true }).fill(password);
  await secure.getByLabel('Confirm Password').fill(password);
  await secure.getByLabel('Confirm Password').blur();
  await expect(secure.locator('[data-test-password-valid]')).toBeVisible();
  await expect(secure.locator('[data-test-passwords-match]')).toBeVisible();
}
