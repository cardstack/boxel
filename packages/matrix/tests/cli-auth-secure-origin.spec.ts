import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import {
  REGISTRATION_TOKEN,
  createSubscribedUser,
  getMatrixTestContext,
  oauthErrorResponseURL,
  subjectFor,
  updateSynapseUser,
} from '../helpers/index.ts';
import {
  STORAGE_KEY,
  fillRegistration,
  followEmailLink,
  keyWriteTicketStatus,
  openSecurePage,
  signedInUser,
  uniqueName,
} from '../helpers/secure-origin-pages.ts';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import { browserLogin } from '../../boxel-cli/src/lib/sso-login.ts';
import type { BrowserLoginResult } from '../../boxel-cli/src/lib/sso-login.ts';

// `boxel profile add` signs in on the secure origin's `cli-auth` page, which
// hands the CLI's loopback listener a single-use Matrix login token, and a
// secure session for `boxel keys` beside it. Everything here is real: the
// CLI's listener and its `browserLogin`, the secure origin's pages served by
// the realm server, Synapse, smtp4dev and the mock Google identity provider.
// `browserLogin` takes its browser-opener as an argument, so these hand it a
// Playwright page.

const HOST_URL = new URL('/', appURL).href;

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

// `browserLogin` against the secure origin, with `openBrowser` driving the
// page it opens.
async function signInForProfile(
  openBrowser: (link: string) => Promise<void>,
): Promise<BrowserLoginResult> {
  let { matrixUrl } = getMatrixTestContext();
  return await browserLogin({
    matrixUrl: matrixUrl!,
    hostUrl: HOST_URL,
    secureOriginUrl: secureOriginURL,
    log: () => {},
    openBrowserFn: async (link) => {
      await openBrowser(link);
      return true;
    },
  });
}

// The Matrix device the CLI redeemed the login token for is its own, and
// works.
async function expectOwnDevice(auth: BrowserLoginResult, userId: string) {
  let { matrixUrl } = getMatrixTestContext();
  expect(auth.userId).toBe(userId);
  let whoami = await fetch(`${matrixUrl}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  expect(whoami.status).toBe(200);
  expect(await whoami.json()).toMatchObject({
    user_id: userId,
    device_id: auth.deviceId,
  });
}

// The secure session handed beside it authorizes key changes, as `boxel keys`
// uses it.
async function expectSecureSession(
  page: Page,
  auth: BrowserLoginResult,
  userId: string,
) {
  expect(auth.secureSession?.userId).toBe(userId);
  expect(await keyWriteTicketStatus(page, auth.secureSession!.token)).toBe(201);
}

test.describe('boxel profile add on the secure origin', () => {
  test('a password sign-in hands the CLI a device and a secure session', async ({
    page,
  }, testInfo) => {
    let { username, password, credentials } =
      await createSubscribedUser('cli-auth-pw');
    let opened: URL | undefined;

    let auth = await signInForProfile(async (link) => {
      opened = new URL(link);
      await page.goto(link);
      await expect(page.locator('[data-test-secure-title]')).toHaveText(
        'Authorize Boxel CLI',
      );
      await snapshot(testInfo, page, 'cli-auth-1-sign-in');
      await page.getByLabel('Email Address or Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.locator('[data-test-secure-password-submit]').click();
    });

    expect(opened!.origin).toBe(new URL(secureOriginURL).origin);
    expect(opened!.pathname).toBe('/secure/cli-auth');
    expect(opened!.search).not.toMatch(/localhost:|127\.0\.0\.1/);
    await expectOwnDevice(auth, credentials.userId);
    expect(auth.deviceId).not.toBe(credentials.deviceId);
    await expectSecureSession(page, auth, credentials.userId);
    await expect(page.locator('h1')).toHaveText('You’re signed in');
    await snapshot(testInfo, page, 'cli-auth-2-done');

    // The window keeps no session of its own.
    let check = await openSecurePage(page, '?mode=none');
    expect(
      await check.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBeNull();
  });

  test('a Google sign-in hands the CLI a device and a secure session', async ({
    page,
  }, testInfo) => {
    let { username, credentials } = await createSubscribedUser('cli-auth-g');
    let email = `${username}@example.com`;
    await updateSynapseUser(credentials.userId, { emailAddresses: [email] });

    let auth = await signInForProfile(async (link) => {
      await page.goto(link);
      await page.locator('[data-test-secure-google]').click();
      await page.locator('input[name="username"]').fill(subjectFor(username));
      await page.locator('textarea[name="claims"]').fill(
        JSON.stringify({
          email,
          email_verified: true,
          name: 'CLI Auth Google User',
        }),
      );
      await page.locator('input[type="submit"]').click();
    });

    await expectOwnDevice(auth, credentials.userId);
    await expectSecureSession(page, auth, credentials.userId);
    await snapshot(testInfo, page, 'cli-auth-3-google-done');
  });

  test('a window already signed in asks its account to confirm the password', async ({
    page,
  }, testInfo) => {
    let { username, password, credentials } =
      await createSubscribedUser('cli-auth-confirm');
    let secure = await openSecurePage(page, 'sign-in');
    await secure.getByLabel('Email Address or Username').fill(username);
    await secure.getByLabel('Password').fill(password);
    await secure.keyboard.press('Enter');
    await signedInUser(secure);

    let auth = await signInForProfile(async (link) => {
      await page.goto(link);
      await expect(
        page.locator('[data-test-secure-cli-auth-signed-in-as]'),
      ).toHaveText(credentials.userId);
      await expect(page.getByLabel('Email Address or Username')).toHaveValue(
        username,
      );
      await expect(page.getByLabel('Password')).toBeFocused();
      await snapshot(testInfo, page, 'cli-auth-4-already-signed-in');
      await page.getByLabel('Password').fill(password);
      await page.keyboard.press('Enter');
    });

    await expectOwnDevice(auth, credentials.userId);
    await expectSecureSession(page, auth, credentials.userId);
  });

  test('creating an account hands the new account to the CLI', async ({
    page,
  }, testInfo) => {
    let username = uniqueName('cli-auth-reg');
    let email = `${username}@example.com`;

    let auth = await signInForProfile(async (link) => {
      await page.goto(link);
      await page.locator('[data-test-secure-register]').click();
      await expect(page).toHaveURL(/\/register(\?|#|$)/);
      await fillRegistration(page, {
        name: 'CLI Auth Registrant',
        email,
        username,
      });
      await page.getByLabel('Confirm Password').press('Enter');
      await page.getByLabel('Your invite code').fill(REGISTRATION_TOKEN);
      await page.locator('[data-test-next-btn]').click();
      await expect(page.locator('[data-test-email-validation]')).toHaveText(
        'Please check your email to complete registration',
      );
      await expect(page.locator('[data-test-secure-cli-wait]')).toHaveText(
        "The CLI stops waiting after 30 minutes. If signing in doesn't reach it, run boxel profile add again.",
      );
      await snapshot(testInfo, page, 'cli-auth-5-register-check-email');
      await followEmailLink(page, email, 'Verify Email');
    });

    await expectOwnDevice(auth, `@${username}:localhost`);
    await expectSecureSession(page, auth, `@${username}:localhost`);
  });

  test('a forgotten password is reset without losing the CLI', async ({
    page,
  }, testInfo) => {
    let user = await createSubscribedUser('cli-auth-reset');
    let email = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [email],
    });
    let newPassword = 'a-new-password-1';

    let auth = await signInForProfile(async (link) => {
      await page.goto(link);
      await page.locator('[data-test-secure-forgot-password]').click();
      await page.getByLabel('Email Address').fill(email);
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-test-secure-cli-wait]')).toBeVisible();
      let confirm = await followEmailLink(page, email, 'Reset Password');
      await confirm.getByText('Confirm changing my password').click();
      await expect(
        confirm.locator('[data-test-secure-cli-wait]'),
      ).toBeVisible();
      await snapshot(testInfo, confirm, 'cli-auth-6-reset');
      await confirm
        .getByLabel('Enter New Password', { exact: true })
        .fill(newPassword);
      await confirm.getByLabel('Re-Enter New Password').fill(newPassword);
      await confirm.locator('[data-test-reset-password-btn]').click();
      await confirm.locator('[data-test-back-to-login-btn]').click();
      // Back on the CLI's page, which still names the waiting listener.
      await expect(confirm).toHaveURL(/\/cli-auth(\?|#|$)/);
      await confirm.getByLabel('Email Address or Username').fill(user.username);
      await confirm.getByLabel('Password').fill(newPassword);
      await confirm.keyboard.press('Enter');
    });

    await expectOwnDevice(auth, user.credentials.userId);
  });

  test('cancelling at Google returns to the CLI’s page, and the CLI still signs in', async ({
    page,
  }) => {
    let { username, password, credentials } =
      await createSubscribedUser('cli-auth-cancel');

    let auth = await signInForProfile(async (link) => {
      await page.goto(link);
      await page.locator('[data-test-secure-google]').click();
      await expect(page.locator('input[name="username"]')).toBeVisible();
      await page.goto(oauthErrorResponseURL(page.url(), 'access_denied'));
      await page.waitForURL((url) => url.pathname.endsWith('/cli-auth'));
      await page.getByLabel('Email Address or Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.keyboard.press('Enter');
    });

    await expectOwnDevice(auth, credentials.userId);
  });

  test('says it can’t authorize a link without a usable listener, as the app does', async ({
    page,
  }) => {
    let secure = await openSecurePage(page, 'cli-auth?port=0&state=x');
    await expect(secure.locator('[data-test-secure-title]')).toHaveText(
      "Can't authorize",
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveCount(0);
  });
});
