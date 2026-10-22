import { expect, test } from './fixtures.ts';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  logout,
  setupPermissions,
} from '../helpers/index.ts';

// With sign-in on the secure origin, the app draws no sign-in form: a
// signed-out app sends the user to the secure origin's page, which signs them
// in and hands the app a single-use Matrix login token by navigating back.
// The realm server writes the deployment's setting into the host's config
// each time it serves the app; these tests turn it on by rewriting that
// config in the documents the app is served as.

const APP_ORIGIN = new URL(appURL).origin;
const SECURE_SESSION_KEY = 'boxel-secure-session';
const CONFIG_META =
  /(<meta name="@cardstack\/host\/config\/environment" content=")([^"]+)(")/;

async function signInOnSecureOrigin(context: BrowserContext) {
  await context.route(
    (url) => url.origin === APP_ORIGIN,
    async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.fallback();
        return;
      }
      let response = await route.fetch();
      let body = await response.text();
      await route.fulfill({
        response,
        body: body.replace(CONFIG_META, (_m, open, content, close) => {
          let config = JSON.parse(decodeURIComponent(content));
          config.signInOnSecureOrigin = true;
          return `${open}${encodeURIComponent(JSON.stringify(config))}${close}`;
        }),
      });
    },
  );
}

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

function onSecureOrigin(page: Page, mode: string) {
  let url = new URL(page.url());
  return (
    url.origin === new URL(secureOriginURL).origin &&
    url.searchParams.get('mode') === mode
  );
}

test.describe('Sign in on the secure origin', () => {
  let username: string;
  let password: string;

  test.beforeEach(async ({ context }) => {
    let user = await createSubscribedUser('secure-sign-in');
    username = user.username;
    password = user.password;
    await setupPermissions(user.credentials.userId, `${appURL}/`);
    await signInOnSecureOrigin(context);
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

    await page.waitForURL((url) => url.searchParams.get('mode') === 'sign-in');
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
    await expect(page.locator('[data-test-login-form]')).toHaveCount(0);
    await snapshot(testInfo, page, 'back in the app, signed in');
  });

  test('coming back signed out at once stops sending the user round', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.waitForURL((url) => url.searchParams.get('mode') === 'sign-in');
    // Back to the app without signing in, as a hand-off that never
    // completed would.
    await page.goto(appURL);
    await expect(page.locator('[data-test-secure-sign-in-status]')).toHaveText(
      'Sign-in didn’t complete',
    );
    expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
    await expect(
      page.locator('[data-test-secure-sign-in-button]'),
    ).toHaveAttribute('href', /mode=sign-in#return=/);
    await expect(
      page.locator('[data-test-login-form]'),
      'the app draws no sign-in form of its own',
    ).toHaveCount(0);
    await expect(page.locator('iframe'), 'nor a credential frame').toHaveCount(
      0,
    );
    await snapshot(testInfo, page, 'app: sign-in did not complete');

    await page.locator('[data-test-secure-sign-in-button]').click();
    await page.waitForURL((url) => url.searchParams.get('mode') === 'sign-in');
    await signInOnSecurePage(page, username, password);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });
  });

  test('signing out goes through the secure origin and ends its session too', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.waitForURL((url) => url.searchParams.get('mode') === 'sign-in');
    await signInOnSecurePage(page, username, password);
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1, { timeout: 60_000 });

    await logout(page);

    // Through the secure origin's sign-out, back to the app signed out, and
    // so on to sign in again.
    await page.waitForURL((url) => url.searchParams.get('mode') === 'sign-in');
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

  test('a sign-in is never handed to an origin the realm server does not list', async ({
    page,
  }, testInfo) => {
    await page.goto(
      `${secureOriginURL}?mode=sign-in#return=${encodeURIComponent(
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
    await page.goto(`${secureOriginURL}?mode=sign-in`);
    await signInOnSecurePage(page, username, password);
    await expect(page.locator('[data-test-secure-signed-in]')).toBeVisible({
      timeout: 60_000,
    });
    // Signed in; a page on the user's own machine asks for the sign-in.
    await page.goto(
      `${secureOriginURL}?mode=sign-in#return=${encodeURIComponent(
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
