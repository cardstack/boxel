import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { secureOriginURL } from '../support/isolated-realm-server.ts';
import { mailHost } from './index.ts';

// Driving the secure origin's sign-in, account creation and password reset
// pages, for the specs that exercise them.

export const STORAGE_KEY = 'boxel-secure-session';

// Opens one of the secure origin's pages, `address` beneath its URL: a page's
// path, with its query string and fragment.
export async function openSecurePage(
  page: Page,
  address: string,
): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}/${address}`);
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

// Signs a secure session in with the account's password, from a page on the
// secure origin as the secure window does, and returns its token. An account
// that has never signed in to Boxel gets its first-sign-in setup.
export async function signInSecureSession(
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  let secure = await openSecurePage(page, 'sign-in');
  try {
    let { status, body } = await secure.evaluate(
      async ({ username, password }) => {
        let realmServerURL = document
          .querySelector('meta[name="boxel-realm-server-url"]')!
          .getAttribute('content')!;
        let response = await fetch(new URL('_secure-session', realmServerURL), {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json',
          },
          body: JSON.stringify({
            data: {
              type: 'secure-session',
              attributes: { username, password, client: 'window' },
            },
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      { username, password },
    );
    expect(status, 'the secure session signs in').toBe(201);
    return body.data.attributes.token;
  } finally {
    await secure.close();
  }
}

// The status minting a key write ticket gets under a secure session: 201 while
// it is signed in, 403 once it has ended.
export async function keyWriteTicketStatus(
  page: Page,
  token: string,
): Promise<number> {
  let secure = await openSecurePage(page, 'sign-in');
  try {
    return await secure.evaluate(async (token) => {
      let realmServerURL = document
        .querySelector('meta[name="boxel-realm-server-url"]')!
        .getAttribute('content')!;
      let response = await fetch(
        new URL('_key-write-tickets', realmServerURL),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: { type: 'key-write-ticket', attributes: { action: 'add' } },
          }),
        },
      );
      return response.status;
    }, token);
  } finally {
    await secure.close();
  }
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
