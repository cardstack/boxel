import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  createSubscribedUserAndLogin,
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

async function openSecureWindow(page: Page, query: string): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}?${query}`);
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
  identity: { sub: string; email: string; name: string },
) {
  await page.locator('input[name="username"]').fill(identity.sub);
  await page.locator('textarea[name="claims"]').fill(
    JSON.stringify({
      email: identity.email,
      email_verified: true,
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

  test('refuses a Google account not linked to Boxel', async ({ page }) => {
    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-google]').click();
    await signInAtGoogle(secure, {
      sub: `unlinked-${randomBytes(6).toString('hex')}`,
      email: `unlinked-${randomBytes(6).toString('hex')}@example.com`,
      name: 'Unlinked Google User',
    });
    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'isn’t linked to Boxel',
    );
    await expect(
      secure.locator('[data-test-secure-start-again]'),
    ).toBeVisible();
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
      `mode=cli-sign-in&port=${port}&state=${state}&user=${username}`,
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
    let check = await openSecureWindow(page, 'mode=none');
    expect(
      await check.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
      "the CLI's session is not kept in the window",
    ).toBeNull();
  });

  test('cancelling at Google returns the window to its sign-in', async ({
    page,
  }) => {
    let secure = await openSecureWindow(page, 'mode=sign-in');
    await returnFromGoogleWithError(secure, 'access_denied');

    await secure.waitForURL(
      (url) => url.searchParams.get('mode') === 'sign-in',
    );
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-error]')).toHaveCount(0);
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
      `mode=cli-sign-in&port=${port}&state=${state}&user=${username}`,
    );
    await returnFromGoogleWithError(secure, 'access_denied');

    // Back on the CLI's sign-in, for the same listener and username.
    await secure.waitForURL(
      (url) =>
        url.searchParams.get('mode') === 'cli-sign-in' &&
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
      `mode=cli-sign-in&port=4999&state=${state}&user=someone`,
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
    expect(Object.fromEntries(startAgain.searchParams)).toEqual({
      mode: 'cli-sign-in',
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
      'mode=cli-sign-in&port=not-a-port&state=x',
    );
    await expect(secure.locator('[data-test-secure-sign-in] h1')).toHaveText(
      'This sign-in link is not complete',
    );
    await expect(secure.locator('[data-test-secure-username]')).toHaveCount(0);
  });
});
