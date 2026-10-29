import { expect, test } from './fixtures.ts';
import type { Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  createSubscribedUser,
  getMatrixTestContext,
  getSharedSQLExecutor,
  logout,
  postCardSource,
  setupPermissions,
} from '../helpers/index.ts';
import { browserLogin } from '../../boxel-cli/src/lib/sso-login.ts';
import jwt from 'jsonwebtoken';

// The app draws no sign-in form: a signed-out app sends the user to the
// secure origin's page, which signs them in and hands the app a single-use
// Matrix login token by navigating back.

const APP_ORIGIN = new URL(appURL).origin;
const SECURE_SESSION_KEY = 'boxel-secure-session';
// The isolated realm server's secret seed, which signs its sessions.
const REALM_SECRET_SEED = "shhh! it's a secret";

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

async function signInOnSecurePage(
  page: Page,
  username: string,
  password: string,
) {
  await page.locator('[data-test-secure-username]').fill(username);
  await page.locator('[data-test-secure-password]').fill(password);
  await page.locator('[data-test-secure-password-submit]').click();
}

function onSecureOrigin(page: Page, secureOriginPage: string) {
  let url = new URL(page.url());
  return (
    url.origin === new URL(secureOriginURL).origin &&
    url.pathname.endsWith(`/${secureOriginPage}`)
  );
}

test.describe('Sign in on the secure origin', () => {
  let username: string;
  let password: string;
  let userId: string;

  test.beforeEach(async () => {
    let user = await createSubscribedUser('secure-sign-in');
    username = user.username;
    password = user.password;
    userId = user.credentials.userId;
    await setupPermissions(user.credentials.userId, `${appURL}/`);
  });

  test('a signed-out deep link signs in on the secure origin and comes back to the same page', async ({
    page,
  }, testInfo) => {
    let state = JSON.stringify({
      stacks: [[{ id: `${appURL}/index`, format: 'isolated' }]],
      submode: 'interact',
    });
    let deepLink = `${appURL}/?operatorModeState=${encodeURIComponent(state)}`;
    await page.goto(deepLink);

    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    expect(onSecureOrigin(page, 'sign-in')).toBe(true);
    expect(
      new URL(page.url()).hash,
      'the page to come back to is taken out of the address',
    ).toBe('');
    await expect(page.locator('[data-test-secure-sign-in-form]')).toBeVisible();
    await snapshot(testInfo, page, 'secure origin sign-in, sent from the app');

    await signInOnSecurePage(page, username, password);

    await page.waitForURL((url) => url.origin === APP_ORIGIN);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });
    let back = new URL(page.url());
    expect(back.searchParams.has('loginToken')).toBe(false);
    expect(
      JSON.parse(back.searchParams.get('operatorModeState')!).stacks[0][0].id,
    ).toBe(`${appURL}/index`);
    await snapshot(testInfo, page, 'back in the app, signed in');
  });

  test('coming back signed out at once stops sending the user round', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    // Back to the app without signing in, as a hand-off that never
    // completed would.
    await page.goto(appURL);
    await expect(page.locator('[data-test-secure-sign-in-status]')).toHaveText(
      'Sign-in didn’t complete',
    );
    expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
    await expect(
      page.locator('[data-test-secure-sign-in-button]'),
    ).toHaveAttribute('href', /\/sign-in#return=/);
    await expect(
      page.locator('iframe'),
      'the app draws no credential frame of its own',
    ).toHaveCount(0);
    await snapshot(testInfo, page, 'app: sign-in did not complete');

    await page.locator('[data-test-secure-sign-in-button]').click();
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await signInOnSecurePage(page, username, password);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });
  });

  test('a password reset link in an email sent to the app lands on the secure origin’s reset page', async ({
    page,
  }, testInfo) => {
    // Reset emails link to the app, with the client secret in the query and
    // the email address and validation session in the fragment.
    let email = `${username}@example.com`;
    await page.goto(
      `${appURL}/?clientSecret=example-client-secret#email=${encodeURIComponent(email)}&sid=example-sid`,
    );

    await page.waitForURL((url) => url.pathname.endsWith('/reset-password'));
    expect(onSecureOrigin(page, 'reset-password')).toBe(true);
    await expect(page.locator('[data-test-reset-password-form]')).toBeVisible();
    expect(
      new URL(page.url()).hash,
      'the reset link’s secrets are taken out of the address',
    ).toBe('');
    await snapshot(
      testInfo,
      page,
      'secure origin reset page, from a reset link sent to the app',
    );
  });

  test('signing out goes through the secure origin and ends its session too', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await signInOnSecurePage(page, username, password);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });

    await logout(page);

    // Through the secure origin's sign-out, back to the app signed out, and
    // so on to sign in again.
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await expect(page.locator('[data-test-secure-sign-in-form]')).toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SECURE_SESSION_KEY,
      ),
      "the secure origin's session is gone",
    ).toBeNull();
    await snapshot(testInfo, page, 'signed out, at the secure sign-in');
  });

  test("the secure window stays signed in past its first week while the app's session lasts", async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await signInOnSecurePage(page, username, password);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });

    let sql = getSharedSQLExecutor();
    let appDevice = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth') ?? '{}').device_id,
    );
    let rows = (await sql.executeSQL(
      `SELECT app_device_id FROM secure_sessions
        WHERE user_id = '${userId}' AND client = 'window'`,
    )) as { app_device_id: string | null }[];
    expect(
      rows.map((r) => r.app_device_id),
      "the window's session is bound to the device the app signed in as",
    ).toEqual([appDevice]);

    // A week on: the window's row has lapsed, and so has the token the
    // window stored, which ends with it.
    let [{ id }] = (await sql.executeSQL(
      `SELECT id FROM secure_sessions
        WHERE user_id = '${userId}' AND client = 'window'`,
    )) as { id: string }[];
    let lapsedAt = Math.floor(Date.now() / 1000) - 60 * 60;
    await sql.executeSQL(
      `UPDATE secure_sessions SET expires_at = to_timestamp(${lapsedAt})
        WHERE id = '${id}'`,
    );
    let lapsed = {
      token: jwt.sign(
        {
          user: userId,
          sessionRoom: 'test-session',
          secureSession: id,
          exp: lapsedAt,
        },
        REALM_SECRET_SEED,
      ),
      user: userId,
      expiresAt: new Date(lapsedAt * 1000).toISOString(),
    };
    await page.context().addInitScript(
      ({ secureOrigin, key, lapsed }) => {
        // Once, before the first secure-origin page this test opens next.
        if (
          location.origin !== secureOrigin ||
          localStorage.getItem('test-session-aged')
        ) {
          return;
        }
        localStorage.setItem('test-session-aged', 'true');
        localStorage.setItem(key, JSON.stringify(lapsed));
      },
      {
        secureOrigin: new URL(secureOriginURL).origin,
        key: SECURE_SESSION_KEY,
        lapsed,
      },
    );

    let opened = page.context().waitForEvent('page');
    await page.evaluate((url) => {
      window.open(url, '_blank', 'noopener,popup,width=520,height=720');
    }, `${secureOriginURL}/keys`);
    let keys = await opened;
    await keys.setViewportSize({ width: 520, height: 720 });
    await expect(keys.locator('[data-test-key-list-empty]')).toBeVisible({
      timeout: 60_000,
    });
    await snapshot(testInfo, keys, 'key page, signed in past its first week');
    let renewed = JSON.parse(
      (await keys.evaluate(
        (key) => localStorage.getItem(key),
        SECURE_SESSION_KEY,
      )) ?? 'null',
    );
    expect(
      Date.parse(renewed.expiresAt) - Date.now(),
      'renewed for another week',
    ).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SECURE_SESSION_KEY,
      ),
      'and the app page holds none of it',
    ).toBeNull();
    await keys.close();

    // Once the app signs out, its device is gone, and nothing renews the
    // window's session.
    await logout(page);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    let ended = (await sql.executeSQL(
      `SELECT app_device_id, expires_at <= NOW() AS ended FROM secure_sessions
        WHERE user_id = '${userId}' AND client = 'window'`,
    )) as { app_device_id: string | null; ended: boolean }[];
    expect(ended).toEqual([{ app_device_id: null, ended: true }]);
  });

  test("a private realm's images load after the hand-off, and stop once signed out", async ({
    page,
  }) => {
    // A workspace of the user's own, which no one else may read.
    let realmName = `secure-sign-in-${Date.now().toString(36)}`;
    let realmURL = `${APP_ORIGIN}/${username}/${realmName}/`;
    let imageURL = `${realmURL}probe.svg`;
    let loads = (url: string) =>
      page.evaluate(
        (src) =>
          new Promise<boolean>((resolve) => {
            let img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = `${src}?nocache=${Math.random()}`;
          }),
        url,
      );

    await page.goto(APP_ORIGIN);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    await signInOnSecurePage(page, username, password);
    await page.waitForURL((url) => url.origin === APP_ORIGIN);
    await createRealm(page, realmName);
    await postCardSource(
      page,
      realmURL,
      imageURL.slice(realmURL.length),
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
    );
    let anonymous = await fetch(imageURL);
    expect(anonymous.status, 'the realm is private').toBe(401);

    await expect
      .poll(() => loads(imageURL), {
        message: "the service worker attaches the realm's token",
        timeout: 30_000,
      })
      .toBe(true);

    await logout(page);
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
    // Back on the app, held there rather than sent on to sign in again.
    await page.route(
      (url) => url.origin === new URL(secureOriginURL).origin,
      (route) => route.fulfill({ status: 204 }),
    );
    await page.goto(appURL);
    await expect(
      page.locator('[data-test-secure-sign-in-button]'),
    ).toBeVisible();
    expect(
      await loads(imageURL),
      "the signed-out app's images carry no token",
    ).toBe(false);
  });

  test("the app's CLI sign-in page sends the browser on to the secure origin's, which hands the CLI its sign-in", async ({
    page,
  }, testInfo) => {
    // `boxel profile add` against a deployment whose secure origin it doesn't
    // know opens the app's `/cli-auth` with the port its loopback listener is
    // on and a state it checks when the sign-in comes back. The secure
    // origin's CLI page draws the same sign-in screen as the app's, with the
    // same test attributes and title, so only the address tells the two
    // origins apart.
    let { matrixUrl } = getMatrixTestContext();
    let opened: URL | undefined;
    let auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: `${APP_ORIGIN}/`,
      log: () => {},
      openBrowserFn: async (link) => {
        opened = new URL(link);
        await page.goto(link);
        await page.waitForURL(
          (url) => url.origin === new URL(secureOriginURL).origin,
        );
        expect(onSecureOrigin(page, 'cli-auth')).toBe(true);
        let landed = new URL(page.url());
        expect(landed.searchParams.get('port')).toBe(
          opened.searchParams.get('port'),
        );
        expect(landed.searchParams.get('state')).toBe(
          opened.searchParams.get('state'),
        );
        await snapshot(
          testInfo,
          page,
          'secure origin CLI sign-in, sent from the app',
        );
        await signInOnSecurePage(page, username, password);
        return true;
      },
    });

    expect(opened!.origin).toBe(APP_ORIGIN);
    expect(opened!.pathname).toBe('/cli-auth');
    // Only `port` and `state` cross from the app, so the secure origin hands
    // the CLI a login token alone, with no secure session beside it.
    expect(auth.secureSession).toBeUndefined();
    expect(auth.userId).toBe(userId);
    let whoami = await fetch(`${matrixUrl}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      user_id: userId,
      device_id: auth.deviceId,
    });
  });

  test('a sign-in is never handed to an origin the realm server does not list', async ({
    page,
  }, testInfo) => {
    await page.goto(
      `${secureOriginURL}/sign-in#return=${encodeURIComponent(
        'https://elsewhere.example/collect',
      )}`,
    );
    await signInOnSecurePage(page, username, password);
    await expect(page.locator('[data-test-secure-signed-in]')).toBeVisible({
      timeout: 60_000,
    });
    expect(onSecureOrigin(page, 'sign-in')).toBe(true);
    await snapshot(
      testInfo,
      page,
      'secure origin: signed in, nothing handed over',
    );
  });

  test('a hand-off to a program on this computer asks first', async ({
    page,
  }, testInfo) => {
    await page.goto(`${secureOriginURL}/sign-in`);
    await signInOnSecurePage(page, username, password);
    await expect(page.locator('[data-test-secure-signed-in]')).toBeVisible({
      timeout: 60_000,
    });
    // Signed in; a page on the user's own machine asks for the sign-in. A
    // fresh document, since only the fragment would differ from this one.
    await page.goto('about:blank');
    await page.goto(
      `${secureOriginURL}/sign-in#return=${encodeURIComponent(
        'http://localhost:4299/',
      )}`,
    );
    await expect(page.locator('[data-test-secure-title]')).toHaveText(
      'Continue to http://localhost:4299?',
    );
    await snapshot(testInfo, page, 'secure origin: continue to localhost?');
    await page.locator('[data-test-secure-loopback-cancel]').click();
    await expect(page.locator('[data-test-secure-signed-in]')).toBeVisible();
  });
});
