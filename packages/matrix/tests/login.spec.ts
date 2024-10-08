import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  clearLocalStorage,
  assertLoggedIn,
  assertLoggedOut,
  login,
  logout,
  openRoot,
  registerRealmUsers,
  testHost,
} from '../helpers';
import jwt from 'jsonwebtoken';

const REALM_SECRET_SEED = "shhh! it's a secret";

test.describe('Login', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async ({ page }, testInfo) => {
    // These tests specifically are pretty slow as there's lots of reloading
    // Add 30s to the overall test timeout
    testInfo.setTimeout(testInfo.timeout + 30000);
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await clearLocalStorage(page);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can login on the realm server home page and see the workspace chooser', async ({
    page,
  }) => {
    await page.goto(`http://localhost:4202/`); // realm server index page

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('pass');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();

    await expect(
      page.locator('[data-test-workspace="Test Workspace A"]'),
    ).toHaveCount(1);

    await page.locator('[data-test-workspace="Test Workspace A"]').click();

    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);

    await logout(page);
    await assertLoggedOut(page);
    await page.reload();
    await assertLoggedOut(page);
  });

  test('it can login after visiting a card and then see the attempted card without choosing a workspace', async ({
    page,
  }) => {
    await page.goto(`http://localhost:4202/test/hassan`);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('pass');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(0);

    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);

    await expect(
      page.locator(`[data-test-stack-card="${testHost}/hassan"]`),
    ).toHaveCount(1);
  });

  test('it can login', async ({ page }) => {
    await openRoot(page);

    await assertLoggedOut(page);
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('pass');
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();

    await assertLoggedIn(page);
    let boxelSession = await page.evaluate(async () => {
      // playwright needs a beat before it get access local storage
      await new Promise((res) => setTimeout(res, 1500));
      return window.localStorage.getItem('boxel-session');
    });
    let token = (JSON.parse(boxelSession!) as { [realmURL: string]: string })[
      `${testHost}/`
    ];
    let claims = jwt.verify(token, REALM_SECRET_SEED) as {
      user: string;
      realm: string;
      permissions: ('read' | 'write' | 'realm-owner')[];
    };
    expect(claims.user).toStrictEqual('@user1:localhost');
    expect(claims.realm).toStrictEqual(`${testHost}/`);
    expect(claims.permissions).toMatchObject(['read', 'write']);

    // reload to page to show that the access token persists
    await page.reload();
    await assertLoggedIn(page);
  });

  test('it can logout', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await assertLoggedIn(page);
    let boxelSession = await page.evaluate(async () => {
      // playwright needs a beat before it get access local storage
      await new Promise((res) => setTimeout(res, 1000));
      return window.localStorage.getItem('boxel-session');
    });
    expect(boxelSession).toBeTruthy();

    await logout(page);
    await assertLoggedOut(page);
    boxelSession = await page.evaluate(async () => {
      // playwright needs a beat before it get access local storage
      await new Promise((res) => setTimeout(res, 1000));
      return window.localStorage.getItem('boxel-session');
    });
    expect(JSON.parse(boxelSession ?? '{}')).toEqual({});

    // reload to page to show that the logout state persists
    await page.reload();
    await assertLoggedOut(page);
  });

  test('it can logout using the profile popover', async ({ page }) => {
    await login(page, 'user1', 'pass');

    await expect(
      page.locator(
        '[data-test-profile-icon-button] > [data-test-profile-icon]',
      ),
    ).toHaveText('U');
    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-icon-handle]')).toHaveText(
      '@user1:localhost',
    );
    await page.locator('[data-test-signout-button]').click();
    await expect(page.locator('[data-test-login-btn]')).toBeVisible();
  });

  test('it shows an error when invalid credentials are provided', async ({
    page,
  }) => {
    await openRoot(page);

    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('bad pass');
    await expect(
      page.locator('[data-test-login-error]'),
      'login error message is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-login-btn]').click();
    await expect(page.locator('[data-test-login-error]')).toContainText(
      'Sign in failed. Please check your credentials and try again',
    );

    await page.locator('[data-test-password-field]').fill('pass');
    await expect(
      page.locator('[data-test-login-error]'),
      'login error message is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-login-btn]').click();

    await assertLoggedIn(page);
  });

  test('it reacts to enter keypresses', async ({ page }) => {
    await openRoot(page);

    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('pass');

    await page.keyboard.press('Enter');

    await assertLoggedIn(page);
  });

  test('it returns to login when auth is invalid', async ({ page }) => {
    await page.addInitScript({
      content: `
        window.localStorage.setItem(
          'auth',
          '{"user_id":"@b:stack.cards","access_token":"INVALID_TOKEN","home_server":"stack.cards","device_id":"HELLO","well_known":{"m.homeserver":{"base_url":"http://example.com/"}}}'
        )`,
    });

    await assertLoggedOut(page);
  });
});
