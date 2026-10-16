import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  createSubscribedUserAndLogin,
  setupPermissions,
  subjectFor,
  updateSynapseUser,
} from '../helpers/index.ts';

// The secure window signs the user in on its own, on the secure origin: a
// session card code in the app page can't reach, which is what minting a key
// write ticket requires. These drive the window in a real browser against
// real Synapse and the mock Google identity provider.

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
    await snapshot(testInfo, secure, 'secure-window-1-account');

    await secure.locator('[data-test-secure-username]').fill(username);
    await secure.locator('[data-test-secure-continue]').click();
    await expect(secure.locator('[data-test-secure-password]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-user]')).toHaveText(
      credentials.userId,
    );
    await snapshot(testInfo, secure, 'secure-window-2-password');

    await secure
      .locator('[data-test-secure-password]')
      .fill('not-the-password');
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-error]')).toContainText(
      'not right',
    );

    await secure.locator('[data-test-secure-password]').fill(password);
    await secure.locator('[data-test-secure-password-submit]').click();
    await expect(secure.locator('[data-test-secure-sign-out]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-user]')).toHaveText(
      credentials.userId,
    );
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

    await secure.locator('[data-test-secure-sign-out]').click();
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

  test('signs in by confirming with Google', async ({ page }, testInfo) => {
    let { username, credentials } = await createSubscribedUser('secure-google');
    let email = `${username}@example.com`;
    await updateSynapseUser(credentials.userId, { emailAddresses: [email] });
    await setupPermissions(credentials.userId, `${appURL}/`);
    let identity = {
      sub: subjectFor(username),
      email,
      name: 'Secure Google User',
    };

    // Signed in to the app through Google first, as a Google user is.
    await page.goto(appURL);
    await page.locator('[data-test-google-login-btn]').click();
    await page.locator('input[name="username"]').fill(identity.sub);
    await page.locator('textarea[name="claims"]').fill(
      JSON.stringify({
        email: identity.email,
        email_verified: true,
        name: identity.name,
      }),
    );
    await page.locator('input[type="submit"]').click();
    await expectAppSignedIn(page);

    let secure = await openSecureWindow(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-username]').fill(email);
    await secure.locator('[data-test-secure-continue]').click();
    await expect(secure.locator('[data-test-secure-sso]')).toBeVisible();
    await snapshot(testInfo, secure, 'secure-window-4-google-option');

    let confirmation = secure.context().waitForEvent('page');
    await secure.locator('[data-test-secure-sso]').click();
    let sso = await confirmation;
    await expect(sso.locator('[data-test-sso-confirm-action]')).toBeVisible();
    await snapshot(testInfo, sso, 'secure-window-5-confirm-with-google');
    await sso.locator('[data-test-sso-confirm-continue]').click();

    // The mock identity provider asks again unless it remembers this browser.
    let idpForm = sso.locator('input[name="username"]');
    if (
      await idpForm
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await idpForm.fill(identity.sub);
      await sso.locator('textarea[name="claims"]').fill(
        JSON.stringify({
          email: identity.email,
          email_verified: true,
          name: identity.name,
        }),
      );
      await sso.locator('input[type="submit"]').click();
    }

    // The window continues on its own once Synapse has the confirmation.
    await expect(secure.locator('[data-test-secure-sign-out]')).toBeVisible({
      timeout: 30000,
    });
    await expect(secure.locator('[data-test-secure-user]')).toHaveText(
      credentials.userId,
    );
    await snapshot(testInfo, secure, 'secure-window-6-google-signed-in');
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
    await snapshot(testInfo, secure, 'secure-window-7-cli');
    await secure.locator('[data-test-secure-continue]').click();
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
    expect(
      await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
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
