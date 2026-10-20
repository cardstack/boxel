import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  createSubscribedUserAndLogin,
  getExternalIdsForIdp,
  setupPermissions,
  subjectFor,
  updateSynapseUser,
} from '../helpers/index.ts';

// The secure window signs in on its own, on the secure origin: a session card
// code in the app page can't reach, which is what minting a key write ticket
// requires. These drive the window in a real browser against real Synapse and
// the mock Google identity provider.

const STORAGE_KEY = 'boxel-secure-session';

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

async function expectAppSignedIn(page: Page) {
  // The app has made its realm-server session, and with it the user's
  // session room, which signing in to the secure window expects.
  await expect(page.locator('[data-test-operator-mode-stack="0"]')).toHaveCount(
    1,
  );
}

async function signedInUser(secure: Page): Promise<string> {
  await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible({
    timeout: 60000,
  });
  return JSON.parse(
    (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  ).user;
}

async function openSecureWindow(page: Page, query: string): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}?${query}`);
  return secure;
}

// Signs in on the mock identity provider's form, as the given Google account.
async function signInAtGoogle(
  page: Page,
  identity: {
    sub: string;
    email: string;
    name: string;
    emailVerified?: boolean;
  },
) {
  await page.locator('input[name="username"]').fill(identity.sub);
  await page.locator('textarea[name="claims"]').fill(
    JSON.stringify({
      email: identity.email,
      email_verified: identity.emailVerified ?? true,
      name: identity.name,
    }),
  );
  await page.locator('input[type="submit"]').click();
}

test.describe('the secure window signs in on its own', () => {
  test('signs in with a password, keeps its session from the app, and signs out', async ({
    page,
  }, testInfo) => {
    let { username, password, credentials } =
      await createSubscribedUserAndLogin(page, 'secure-window');
    await expectAppSignedIn(page);

    // Everything the app page hears from other windows.
    await page.evaluate(() => {
      (window as any).__messages = [];
      window.addEventListener('message', (event) =>
        (window as any).__messages.push(JSON.stringify(event.data ?? null)),
      );
    });

    // Opened from the app page, as the app opens it.
    let opened = page.context().waitForEvent('page');
    await page.evaluate((url) => {
      (window as any).__secureWindow = window.open(url, '_blank');
    }, `${secureOriginURL}?mode=sign-in`);
    let secure = await opened;
    await expect(secure.locator('[data-test-secure-username]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await snapshot(testInfo, secure, 'secure-window-1-sign-in');

    await secure.locator('[data-test-secure-username]').fill(username);
    await secure
      .locator('[data-test-secure-password]')
      .fill('not-the-password');
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'don’t match',
    );
    await snapshot(testInfo, secure, 'secure-window-2-wrong-password');

    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible();
    expect(
      JSON.parse(
        (await secure.evaluate(
          (key) => localStorage.getItem(key),
          STORAGE_KEY,
        ))!,
      ).user,
      'the window is signed in as the account',
    ).toBe(credentials.userId);
    await snapshot(testInfo, secure, 'secure-window-3-signed-in');

    let stored = await secure.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY,
    );
    let { token } = JSON.parse(stored!);
    expect(typeof token).toBe('string');

    // The app page, where cards run, can't see the session: not in its own
    // storage, not through the window it opened, and not in any message.
    let appStorage = await page.evaluate(() =>
      Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? ''),
    );
    expect(appStorage.some((value) => value.includes(token))).toBe(false);
    expect(
      await page.evaluate(() => {
        let handle = (window as any).__secureWindow;
        try {
          return handle.closed === true && handle.document === undefined;
        } catch {
          return true;
        }
      }),
      'the app keeps no usable handle to the window',
    ).toBe(true);
    let messages: string[] = await page.evaluate(
      () => (window as any).__messages,
    );
    expect(messages.some((message) => message.includes(token))).toBe(false);

    // The window mints key write tickets with its own session.
    let ticket = await secure.evaluate(async (base) => {
      let session = await import(`${base}/session.js`);
      return await session.mintKeyWriteTicket(session.readConfig(), {
        action: 'add',
      });
    }, secureOriginURL);
    expect(typeof ticket.ticket).toBe('string');

    // The window has no sign-out control; its console function signs out.
    await secure.evaluate(() => (window as any).boxelSignOut());
    await expect(secure.locator('[data-test-secure-username]')).toBeVisible();
    expect(
      await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBeNull();
    // A session that has signed out mints nothing.
    let afterSignOut = await secure.evaluate(
      async ({ realmServer, token }) => {
        let response = await fetch(`${realmServer}_key-write-tickets`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: { type: 'key-write-ticket', attributes: { action: 'add' } },
          }),
        });
        return response.status;
      },
      { realmServer: new URL('/', appURL).href, token },
    );
    expect(afterSignOut).toBe(403);
  });

  test('signs in with Google, returning to the secure window', async ({
    page,
  }, testInfo) => {
    let { username, credentials } = await createSubscribedUser('secure-google');
    let email = `${username}@example.com`;
    await updateSynapseUser(credentials.userId, { emailAddresses: [email] });
    await setupPermissions(credentials.userId, `${appURL}/`);
    let identity = {
      sub: subjectFor(username),
      email,
      name: 'Secure Google User',
    };

    // Signed in to the app through Google first, as a Google user is, which
    // links the Google account to theirs.
    await page.goto(appURL);
    await page.locator('[data-test-google-login-btn]').click();
    await signInAtGoogle(page, identity);
    await expectAppSignedIn(page);

    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, identity);

    // Google returns to the secure window, which finishes on its own.
    await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible({
      timeout: 30000,
    });
    expect(
      JSON.parse(
        (await secure.evaluate(
          (key) => localStorage.getItem(key),
          STORAGE_KEY,
        ))!,
      ).user,
      'the window is signed in as the account',
    ).toBe(credentials.userId);
    expect(new URL(secure.url()).search, 'no code is left in the address').toBe(
      '?mode=sign-in',
    );
    await snapshot(testInfo, secure, 'secure-window-4-google-signed-in');
  });

  test('links Google to the account that registered its email with a password', async ({
    page,
  }, testInfo) => {
    let { username, credentials } = await createSubscribedUserAndLogin(
      page,
      'secure-link',
    );
    await expectAppSignedIn(page);
    let email = `${username}@example.com`;
    await updateSynapseUser(credentials.userId, { emailAddresses: [email] });
    let sub = subjectFor(username);

    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, { sub, email, name: 'Linked Google User' });
    expect(
      await signedInUser(secure),
      'the window is signed in as the account that holds the email',
    ).toBe(credentials.userId);
    expect(
      await getExternalIdsForIdp(credentials.userId, 'oidc-google'),
    ).toEqual([sub]);
    await snapshot(testInfo, secure, 'secure-window-6-google-linked-by-email');
  });

  test('makes an account for a new Google user', async ({ page }, testInfo) => {
    let localpart = `secure-new-${randomBytes(6).toString('hex')}`;
    let sub = subjectFor(localpart);

    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, {
      sub,
      email: `${localpart}@example.com`,
      name: 'New Google User',
    });
    let user = await signedInUser(secure);
    expect(user, 'the account takes the email’s local part').toBe(
      `@${localpart}:localhost`,
    );
    expect(await getExternalIdsForIdp(user, 'oidc-google')).toEqual([sub]);
    await snapshot(testInfo, secure, 'secure-window-7-google-new-account');
  });

  test('refuses a Google account whose email isn’t verified', async ({
    page,
  }, testInfo) => {
    let localpart = `secure-unverified-${randomBytes(6).toString('hex')}`;
    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, {
      sub: subjectFor(localpart),
      email: `${localpart}@example.com`,
      name: 'Unverified Google User',
      emailVerified: false,
    });
    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'Google sign-in requires a verified email address.',
    );
    await expect(
      secure.locator('[data-test-secure-start-again]'),
    ).toBeVisible();
    await snapshot(testInfo, secure, 'secure-window-8-google-unverified');
  });

  test('refuses a deactivated account with Google', async ({
    page,
  }, testInfo) => {
    let { username, credentials } = await createSubscribedUser('secure-gone');
    let email = `${username}@example.com`;
    await updateSynapseUser(credentials.userId, { emailAddresses: [email] });
    let identity = {
      sub: subjectFor(username),
      email,
      name: 'Deactivated Google User',
    };
    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, identity);
    expect(await signedInUser(secure)).toBe(credentials.userId);
    // Back on its sign-in page, the window's console function signs it out.
    await secure.reload();
    await secure.evaluate(() => (window as any).boxelSignOut());
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();

    await updateSynapseUser(credentials.userId, { deactivated: true });
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, identity);
    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'Sign-in failed. Please check your credentials and try again.',
    );
    await snapshot(testInfo, secure, 'secure-window-9-google-deactivated');
  });

  test('hands a session to the CLI listening on this machine', async ({
    page,
  }, testInfo) => {
    let { username, password, credentials } =
      await createSubscribedUserAndLogin(page, 'secure-cli');
    await expectAppSignedIn(page);

    // Stands in for the CLI's loopback listener.
    let resolveReceived!: (body: URLSearchParams) => void;
    let received = new Promise<URLSearchParams>(
      (resolve) => (resolveReceived = resolve),
    );
    let server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          Connection: 'close',
        });
        res.end('<h1>You’re signed in</h1>', () =>
          resolveReceived(new URLSearchParams(body)),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    let { port } = server.address() as AddressInfo;
    let state = randomBytes(16).toString('hex');

    let secure = await openSecureWindow(
      page,
      `mode=cli-sign-in&port=${port}&state=${state}&user=${username}`,
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveValue(
      username,
    );
    await snapshot(testInfo, secure, 'secure-window-5-cli');
    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();

    let posted = await received;
    server.close();
    expect(posted.get('state')).toBe(state);
    expect(posted.get('user_id')).toBe(credentials.userId);
    let claims = JSON.parse(
      Buffer.from(
        posted.get('secure_session')!.split('.')[1],
        'base64url',
      ).toString(),
    );
    expect(typeof claims.secureSession).toBe('string');

    // The window has left for the listener; the secure origin's storage,
    // read from a page of its own, holds no session.
    await secure.waitForURL(`http://127.0.0.1:${port}/callback`);
    let check = await openSecureWindow(page, 'mode=none');
    expect(
      await check.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
      "the CLI's session is not kept in the window",
    ).toBeNull();
  });

  test('refuses a CLI sign-in link that names no listener on this machine', async ({
    page,
  }) => {
    let secure = await openSecureWindow(
      page,
      'mode=cli-sign-in&port=not-a-port&state=x',
    );
    await expect(secure.locator('[data-test-secure-sign-in] h1')).toHaveText(
      'This sign-in link is not complete',
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveCount(0);
  });
});
