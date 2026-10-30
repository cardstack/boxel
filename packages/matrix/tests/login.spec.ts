import { expect, test } from './fixtures.ts';
import {
  getJoinedRooms,
  getAccountData,
  type Credentials,
} from '../support/synapse/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  signInOnSecureOrigin,
  assertLoggedIn,
  assertLoggedOut,
  login,
  logout,
  openRoot,
  createSubscribedUser,
  setupPermissions,
} from '../helpers/index.ts';
import jwt from 'jsonwebtoken';

const REALM_SECRET_SEED = "shhh! it's a secret";

test.describe('Login', () => {
  let credentials: Credentials;
  let username: string;
  let password: string;

  test.beforeEach(async () => {
    ({ username, password, credentials } =
      await createSubscribedUser('login-tests'));
    await setupPermissions(credentials.userId, `${appURL}/`);
  });

  test('it can login on the realm server home page', async ({ page }) => {
    await page.goto(appURL);

    await signInOnSecureOrigin(page, username, password);

    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);
    await expect(page.locator('[data-test-dashboard]')).toHaveCount(0);

    await logout(page);
    await assertLoggedOut(page);
    await page.reload();
    await assertLoggedOut(page);
  });

  test('it can log in with query parameters to access interact submode with multiple stack items', async ({
    page,
  }) => {
    const operatorModeState = {
      stacks: [
        [
          {
            id: `${appURL}/fadhlan`,
            format: 'isolated',
          },
          {
            id: `${appURL}/jersey`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'interact',
      fileView: 'inspector',
      openDirs: {},
    };
    const stateParam = encodeURIComponent(JSON.stringify(operatorModeState));
    await page.goto(`${appURL}?operatorModeState=${stateParam}`);

    await signInOnSecureOrigin(page, username, password);

    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-stack-card="${appURL}/fadhlan"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-stack-card="${appURL}/jersey"]`),
    ).toHaveCount(1);

    await logout(page);
    await assertLoggedOut(page);
  });

  test('it can log in with query parameters to access code submode', async ({
    page,
  }) => {
    const operatorModeState = {
      stacks: [
        [
          {
            id: `${appURL}/fadhlan`,
            format: 'isolated',
          },
          {
            id: `${appURL}/jersey`,
            format: 'isolated',
          },
        ],
      ],
      codePath: `${appURL}/person.gts`,
      submode: 'code',
      fileView: 'inspector',
      openDirs: {},
    };
    const stateParam = encodeURIComponent(JSON.stringify(operatorModeState));
    await page.goto(`${appURL}?operatorModeState=${stateParam}`);

    await signInOnSecureOrigin(page, username, password);

    await expect(
      page.locator(`[data-test-card-url-bar-realm-info]`),
    ).toContainText('in Test Workspace A');
    await expect(page.locator(`[data-test-card-url-bar] input`)).toHaveValue(
      `${appURL}/person.gts`,
    );
    await page.locator(`[data-test-editor]`).waitFor();
    await expect(page.locator(`[data-test-editor]`)).toContainText(
      'export class Person extends CardDef',
    );

    await logout(page);
    await assertLoggedOut(page);
  });

  test('it can login after visiting a card and then see the attempted card without choosing a workspace', async ({
    page,
  }) => {
    await page.goto(`${appURL}/hassan`);

    await signInOnSecureOrigin(page, username, password);

    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);

    await expect(
      page.locator(`[data-test-stack-card="${appURL}/hassan"]`),
    ).toHaveCount(1);
    // after the card renders, so it can't pass before the app has
    await expect(page.locator('[data-test-dashboard]')).toHaveCount(0);
  });

  test('it can login', async ({ page }) => {
    await openRoot(page, appURL);

    await assertLoggedOut(page);
    await signInOnSecureOrigin(page, username, password);

    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
    // The authentication to the realm could possibly be processed when fetching the card,
    // so we have to wait until the card is loaded before checking the tokens.
    await page.waitForSelector('[data-test-stack-item-content]');
    let boxelSession = await page.evaluate(async () => {
      // playwright needs a beat before it get access local storage
      await new Promise((res) => setTimeout(res, 1500));
      return window.localStorage.getItem('boxel-session');
    });
    let token = (JSON.parse(boxelSession!) as { [realmURL: string]: string })[
      `${appURL}/`
    ];
    let claims = jwt.verify(token, REALM_SECRET_SEED) as {
      user: string;
      realm: string;
      sessionRoom: string;
      permissions: ('read' | 'write' | 'realm-owner')[];
    };
    expect(claims.user).toStrictEqual(credentials.userId);
    expect(claims.realm).toStrictEqual(`${appURL}/`);
    expect(claims.sessionRoom).toMatch(/!\w*:localhost/);
    expect(claims.permissions).toMatchObject(['read', 'write']);

    // reload to page to show that the access token persists
    await page.reload();
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
  });

  test('login joins the session rooms for all realm tokens', async ({
    page,
  }) => {
    await login(page, username, password, { url: appURL });
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
    await page.waitForSelector('[data-test-stack-item-content]');

    let boxelSession = await page.evaluate(async () => {
      await new Promise((res) => setTimeout(res, 1500));
      return window.localStorage.getItem('boxel-session');
    });

    expect(boxelSession).toBeTruthy();

    let tokens = Object.values(
      JSON.parse(boxelSession!) as { [realmURL: string]: string },
    ).filter((token): token is string => Boolean(token));

    expect(tokens.length).toBeGreaterThan(0);

    let joinedRooms = await getJoinedRooms(credentials.accessToken);
    let directAccountData = await getAccountData<{
      [userId: string]: string[];
    }>(credentials.userId, credentials.accessToken, 'm.direct');

    for (let token of tokens) {
      let claims = jwt.verify(token, REALM_SECRET_SEED) as {
        sessionRoom: string;
      };
      expect(joinedRooms).toContain(claims.sessionRoom);
      expect(directAccountData?.[credentials.userId] ?? []).toContain(
        claims.sessionRoom,
      );
    }
  });

  test('it can login to the dashboard', async ({ page }) => {
    await openRoot(page, new URL(appURL).origin);

    await assertLoggedOut(page);
    await signInOnSecureOrigin(page, username, password);

    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
    await expect(page.locator('[data-test-dashboard]')).toHaveCount(1);
    // The two workspaces the user was given, and the personal workspace the
    // first sign-in on the secure origin makes.
    await expect(page.locator('[data-test-workspace-visibility]')).toHaveCount(
      3,
    );
    await expect(
      page.locator(`[data-test-workspace="${username}'s Workspace"]`),
    ).toHaveCount(1);
    let boxelSession = await page.evaluate(async () => {
      // playwright needs a beat before it get access local storage
      await new Promise((res) => setTimeout(res, 1500));
      return window.localStorage.getItem('boxel-session');
    });
    let token = (JSON.parse(boxelSession!) as { [realmURL: string]: string })[
      `${appURL}/`
    ];
    let claims = jwt.verify(token, REALM_SECRET_SEED) as {
      user: string;
      realm: string;
      sessionRoom: string;
      permissions: ('read' | 'write' | 'realm-owner')[];
    };
    expect(claims.user).toStrictEqual(credentials.userId);
    expect(claims.realm).toStrictEqual(`${appURL}/`);
    expect(claims.sessionRoom).toMatch(/!\w*:localhost/);
    expect(claims.permissions).toMatchObject(['read', 'write']);

    // reload to page to show that the access token persists
    await page.reload();
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
  });

  test('it can logout', async ({ page }) => {
    await login(page, username, password, { url: appURL });
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
    // The authentication to the realm could possibly be processed when fetching the card,
    // so we have to wait until the card is loaded before checking the tokens.
    await page.waitForSelector('[data-test-stack-item-content]');
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
    await login(page, username, password, { url: appURL });

    await expect(
      page.locator(
        '[data-test-profile-icon-button] > [data-test-profile-icon]',
      ),
    ).toHaveText(username[0].toUpperCase());
    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-icon-handle]')).toHaveText(
      credentials.userId,
    );
    await page.locator('[data-test-signout-button]').click();
    await assertLoggedOut(page);
  });

  test('it can sign back in after signing out', async ({ page }) => {
    await login(page, username, password, { url: appURL });
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });

    await logout(page);
    await signInOnSecureOrigin(page, username, password);

    await expect(page.locator('[data-test-dashboard]')).toHaveCount(1);
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
  });

  test('it returns to login when auth is invalid', async ({ page }) => {
    await page.addInitScript({
      content: `
        window.localStorage.setItem(
          'auth',
          '{"user_id":"@b:stack.cards","access_token":"INVALID_TOKEN","home_server":"stack.cards","device_id":"HELLO","well_known":{"m.homeserver":{"base_url":"http://example.com/"}}}'
        )`,
    });
    // Once the init script is in, we can navigate
    // If the openRoot is called before, then the script isn't run and the test
    // passes regardless because the opening page is the login screen.
    await openRoot(page, appURL);
    await assertLoggedOut(page);
  });
});
