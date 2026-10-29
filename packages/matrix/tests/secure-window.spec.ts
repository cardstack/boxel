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
  assertLoggedOut,
  logout,
  oauthErrorResponseURL,
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

// The status a key write ticket mint gets with the given session, asked from
// the secure window as the window asks.
async function mintStatus(secure: Page, token: string): Promise<number> {
  return await secure.evaluate(
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
}

async function signedInUser(secure: Page): Promise<string> {
  await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible({
    timeout: 60000,
  });
  return JSON.parse(
    (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  ).user;
}

async function openSecureWindow(page: Page, address: string): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}/${address}`);
  return secure;
}

// Stands in for the CLI's loopback listener: resolves `received` with the
// form the secure window posts to it.
async function startCliListener() {
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let { port } = server.address() as AddressInfo;
  return { port, received, close: () => server.close() };
}

// Starts a Google sign-in from the secure window and, from the identity
// provider's login page, returns the window to its callback with an OAuth
// error response, as Google does when the user presses Cancel.
async function returnFromGoogleWithError(secure: Page, error: string) {
  await secure.locator('[data-test-secure-google]').click();
  await expect(secure.locator('input[name="username"]')).toBeVisible();
  await secure.goto(oauthErrorResponseURL(secure.url(), error));
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
    }, `${secureOriginURL}/sign-in`);
    let secure = await opened;
    await expect(secure.locator('[data-test-secure-username]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await snapshot(testInfo, secure, 'secure-window-1-sign-in');

    await secure.locator('[data-test-secure-username]').fill(username);
    await secure
      .locator('[data-test-secure-password]')
      .fill('not-the-password');
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-error]')).toHaveText(
      'Sign-in failed. Please check your credentials and try again.',
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
    expect(await mintStatus(secure, token)).toBe(403);
  });

  test('signing out of the app signs the secure window out', async ({
    page,
  }, testInfo) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'secure-app-sign-out',
    );
    await expectAppSignedIn(page);

    let secure = await openSecureWindow(page, 'sign-in');
    await secure.locator('[data-test-secure-username]').fill(username);
    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible();
    let stored = (await secure.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY,
    ))!;
    let { token } = JSON.parse(stored);
    expect(await mintStatus(secure, token)).toBe(201);

    // The secure window stays open while the user signs out of the app.
    await logout(page);
    await assertLoggedOut(page);

    // The app's sign-out tells the realm server without waiting on it. Asked
    // from the secure origin, where only an ended session is refused.
    await expect(async () => {
      expect(await mintStatus(secure, token)).toBe(403);
    }).toPass();

    // The open window's next mint finds its session ended, forgets it, and
    // says the user is signed out.
    let refused = await secure.evaluate(async (base) => {
      let session = await import(`${base}/session.js`);
      try {
        await session.mintKeyWriteTicket(session.readConfig(), {
          action: 'add',
        });
        return 'minted';
      } catch (e: any) {
        return e.code;
      }
    }, secureOriginURL);
    expect(refused).toBe('signed-out');
    expect(
      await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBeNull();
    await secure.close();

    // A window opened with the ended session still stored checks it with the
    // server, forgets it, and offers to sign in, with no error.
    let check = await openSecureWindow(page, '?mode=none');
    await check.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, stored],
    );
    await check.close();
    let reopened = await openSecureWindow(page, 'sign-in');
    await expect(reopened.locator('[data-test-secure-username]')).toBeVisible();
    await expect(reopened.locator('[data-test-secure-error]')).toBeHidden();
    expect(
      await reopened.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBeNull();
    await snapshot(testInfo, reopened, 'secure-window-6-after-app-sign-out');
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

    let secure = await openSecureWindow(page, 'sign-in');
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
    expect(new URL(secure.url()).pathname).toBe('/secure/sign-in');
    expect(new URL(secure.url()).search, 'no code is left in the address').toBe(
      '',
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

    let secure = await openSecureWindow(page, 'sign-in');
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

    let secure = await openSecureWindow(page, 'sign-in');
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
    let secure = await openSecureWindow(page, 'sign-in');
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
    let secure = await openSecureWindow(page, 'sign-in');
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

    let { port, received, close } = await startCliListener();
    let state = randomBytes(16).toString('hex');

    let secure = await openSecureWindow(
      page,
      `cli-sign-in?port=${port}&state=${state}&user=${username}`,
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveValue(
      username,
    );
    await snapshot(testInfo, secure, 'secure-window-5-cli');
    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();

    let posted = await received;
    close();
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
    let check = await openSecureWindow(page, '?mode=none');
    expect(
      await check.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
      "the CLI's session is not kept in the window",
    ).toBeNull();
  });

  test('says when to try again after too many failed sign-ins, as the app does', async ({
    page,
  }) => {
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'secure-window-limit',
    );
    await expectAppSignedIn(page);
    let secure = await openSecureWindow(page, 'sign-in');
    let error = secure.locator('[data-test-secure-error]');
    await expect(secure.locator('[data-test-secure-username]')).toBeVisible();
    // An account may fail three times in a row; the fourth attempt waits for
    // the first failure to drain, which takes a few seconds. The failures are
    // sent together from the window, so they all land well within that time.
    let statuses = await secure.evaluate(async (username) => {
      let realmServerURL = document
        .querySelector('meta[name="boxel-realm-server-url"]')!
        .getAttribute('content')!;
      return await Promise.all(
        [0, 1, 2].map(async (attempt) => {
          let response = await fetch(
            new URL('_secure-session', realmServerURL),
            {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
              },
              body: JSON.stringify({
                data: {
                  type: 'secure-session',
                  attributes: {
                    username,
                    password: `not-the-password-${attempt}`,
                    client: 'window',
                  },
                },
              }),
            },
          );
          return response.status;
        }),
      );
    }, username);
    expect(statuses).toEqual([401, 401, 401]);
    await secure.locator('[data-test-secure-username]').fill(username);
    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(error).toHaveText(
      'Sign-in failed. Too many failed attempts, try again in a few seconds.',
    );
  });

  test('cancelling at Google returns the window to its sign-in', async ({
    page,
  }) => {
    let secure = await openSecureWindow(page, 'sign-in');
    await returnFromGoogleWithError(secure, 'access_denied');

    await secure.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-error]')).toBeHidden();
  });

  test('cancelling at Google returns a CLI sign-in to its own page, and the CLI still gets its session', async ({
    page,
  }) => {
    let { username, password, credentials } =
      await createSubscribedUserAndLogin(page, 'secure-cli-cancel');
    await expectAppSignedIn(page);
    let { port, received, close } = await startCliListener();
    let state = randomBytes(16).toString('hex');

    let secure = await openSecureWindow(
      page,
      `cli-sign-in?port=${port}&state=${state}&user=${username}`,
    );
    await returnFromGoogleWithError(secure, 'access_denied');

    // Back on the CLI's sign-in, for the same listener and username.
    await secure.waitForURL(
      (url) =>
        url.pathname.endsWith('/cli-sign-in') &&
        url.searchParams.get('port') === String(port) &&
        url.searchParams.get('state') === state &&
        url.searchParams.get('user') === username,
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveValue(
      username,
    );

    // The CLI has kept waiting, and signing in with a password reaches it.
    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();
    let posted = await received;
    close();
    expect(posted.get('state')).toBe(state);
    expect(posted.get('user_id')).toBe(credentials.userId);
  });

  test('a Google sign-in that fails during a CLI sign-in starts again on the CLI’s page', async ({
    page,
  }) => {
    let state = randomBytes(16).toString('hex');
    let secure = await openSecureWindow(
      page,
      `cli-sign-in?port=4999&state=${state}&user=someone`,
    );
    await returnFromGoogleWithError(secure, 'server_error');

    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'Google sign-in didn’t finish',
    );
    let startAgain = new URL(
      (await secure
        .locator('[data-test-secure-start-again]')
        .getAttribute('href'))!,
      secure.url(),
    );
    expect(startAgain.pathname).toBe('/secure/cli-sign-in');
    expect(Object.fromEntries(startAgain.searchParams)).toEqual({
      port: '4999',
      state,
      user: 'someone',
    });
  });

  test('refuses a CLI sign-in link that names no listener on this machine', async ({
    page,
  }) => {
    let secure = await openSecureWindow(
      page,
      'cli-sign-in?port=not-a-port&state=x',
    );
    await expect(
      secure.locator('[data-test-secure-sign-in] [data-test-secure-title]'),
    ).toHaveText('This sign-in link is not complete');
    await expect(secure.locator('[data-test-secure-username]')).toHaveCount(0);
  });
});
