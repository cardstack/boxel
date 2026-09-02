import { expect, test } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { getSynapseURL } from '../support/environment-config.ts';
import {
  createUser,
  createSubscribedUser,
  createSubscribedUserAndLogin,
  setupPermissions,
  assertLoggedIn,
} from '../helpers/index.ts';

// Exercises Synapse's login_via_existing_session feature (MSC3882), which the
// test homeserver config enables. A client holding an access token mints a
// short-lived, single-use login token and hands a session off to the browser
// via ?loginToken — the pre-authenticated hand-off this repo consumes in the
// <Login> component (packages/host/app/components/matrix/login.gts) when logged
// out, and in the index route (packages/host/app/routes/index.gts) to switch
// accounts when already logged in.
//
// NOTE: Synapse rate-limits get_token to one request per minute per user id
// (hardcoded in the servlet — no rc_* setting relaxes it), so every test here
// mints for a freshly registered user.
async function mintLoginToken(
  accessToken: string,
): Promise<{ login_token: string; expires_in_ms: number }> {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v1/login/get_token`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    },
  );
  expect(
    response.status,
    'get_token succeeds for an authenticated caller',
  ).toBe(200);
  return response.json();
}

test.describe('login_via_existing_session', () => {
  test('a pre-authenticated client hands off a session to the browser via ?loginToken', async ({
    page,
  }) => {
    let { username, credentials } = await createSubscribedUser(
      'login-token-handoff',
    );
    await setupPermissions(credentials.userId, `${appURL}/`);

    let { login_token } = await mintLoginToken(credentials.accessToken);

    // The browser lands pre-authenticated with only the login token — no
    // username/password is ever entered.
    await page.goto(`${appURL}?loginToken=${login_token}`);

    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });

    // The single-use token is stripped from the URL so a refresh doesn't
    // re-trigger the (now spent) exchange, and the session persists.
    expect(new URL(page.url()).searchParams.has('loginToken')).toBe(false);
    await page.reload();
    await assertLoggedIn(page, {
      displayName: username,
      userId: credentials.userId,
    });
  });

  test('a ?loginToken switches accounts when the browser is already logged in as another user', async ({
    page,
  }) => {
    // User A is signed in in the browser.
    let userA = await createSubscribedUserAndLogin(page, 'account-switch-a');
    await assertLoggedIn(page, {
      displayName: userA.username,
      userId: userA.credentials.userId,
    });

    // User B hands off a session via a minted login token.
    let { username: usernameB, credentials: credentialsB } =
      await createSubscribedUser('account-switch-b');
    await setupPermissions(credentialsB.userId, `${appURL}/`);
    let { login_token } = await mintLoginToken(credentialsB.accessToken);

    // The switch must go straight from session A to session B: record whether
    // the password form ever mounts during the hand-off page load.
    await page.addInitScript(() => {
      let w = window as {
        __sawPasswordForm?: boolean;
        __passwordFormObserverInstalled?: boolean;
      };
      new MutationObserver(() => {
        if (document.querySelector('[data-test-password-field]')) {
          w.__sawPasswordForm = true;
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
      w.__passwordFormObserverInstalled = true;
    });

    // Landing with ?loginToken while logged in as A switches to B.
    await page.goto(`${appURL}?loginToken=${login_token}`);

    await assertLoggedIn(page, {
      displayName: usernameB,
      userId: credentialsB.userId,
    });
    let observed = await page.evaluate(() => {
      let w = window as {
        __sawPasswordForm?: boolean;
        __passwordFormObserverInstalled?: boolean;
      };
      return {
        installed: w.__passwordFormObserverInstalled,
        saw: w.__sawPasswordForm,
      };
    });
    expect(observed.installed, 'the password-form observer installed').toBe(
      true,
    );
    expect(
      observed.saw,
      'the login form never appears during the switch',
    ).toBeFalsy();
    // The single-use token is stripped so a refresh can't re-trigger the
    // (now spent) exchange.
    expect(new URL(page.url()).searchParams.has('loginToken')).toBe(false);
  });

  test('a ?loginToken with a cardPath deep-links into the card after switching accounts', async ({
    page,
  }) => {
    await createSubscribedUserAndLogin(page, 'account-switch-deeplink-a');

    let { username: usernameB, credentials: credentialsB } =
      await createSubscribedUser('account-switch-deeplink-b');
    await setupPermissions(credentialsB.userId, `${appURL}/`);
    let { login_token } = await mintLoginToken(credentialsB.accessToken);

    // The shape `boxel browse test/fadhlan --profile B` produces: a login
    // token plus a deep link into a card.
    await page.goto(
      `${appURL}?loginToken=${login_token}&cardPath=test/fadhlan`,
    );

    // The deep link survives the account switch: the card opens for the new
    // session instead of the workspace chooser.
    await expect(
      page.locator(`[data-test-stack-card="${appURL}/fadhlan"]`),
    ).toHaveCount(1);
    await assertLoggedIn(page, {
      displayName: usernameB,
      userId: credentialsB.userId,
    });
  });

  test('a failed token exchange while logged in stays signed in as the current account', async ({
    page,
  }) => {
    let userA = await createSubscribedUserAndLogin(
      page,
      'account-switch-bad-token',
    );
    await assertLoggedIn(page, {
      displayName: userA.username,
      userId: userA.credentials.userId,
    });

    // The token is validated before any teardown, so a dead token (expired,
    // spent, or bogus) leaves the current session intact rather than logging
    // the user out.
    await page.goto(`${appURL}?loginToken=not-a-real-token`);

    await assertLoggedIn(page, {
      displayName: userA.username,
      userId: userA.credentials.userId,
    });
    // The single-use token is still stripped so a refresh can't re-attempt it.
    expect(new URL(page.url()).searchParams.has('loginToken')).toBe(false);
  });

  test('a ?loginToken switches accounts even when the stored session is revoked server-side', async ({
    page,
  }) => {
    let userA = await createSubscribedUserAndLogin(
      page,
      'account-switch-stale-a',
    );
    await assertLoggedIn(page, {
      displayName: userA.username,
      userId: userA.credentials.userId,
    });

    // Revoke A's session server-side while leaving it persisted in the browser:
    // the days-old-session shape `boxel browse` targets, where the stored auth
    // is now dead. Booting it first would fail and drop the token, so the switch
    // has to run ahead of the boot.
    let accessTokenA = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth') ?? '{}').access_token,
    );
    let revoke = await fetch(`${getSynapseURL()}/_matrix/client/v3/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessTokenA}` },
    });
    expect(revoke.status, 'A’s stored session is revoked server-side').toBe(
      200,
    );

    let { username: usernameB, credentials: credentialsB } =
      await createSubscribedUser('account-switch-stale-b');
    await setupPermissions(credentialsB.userId, `${appURL}/`);
    let { login_token } = await mintLoginToken(credentialsB.accessToken);

    await page.goto(`${appURL}?loginToken=${login_token}`);

    await assertLoggedIn(page, {
      displayName: usernameB,
      userId: credentialsB.userId,
    });
    expect(new URL(page.url()).searchParams.has('loginToken')).toBe(false);
  });

  test('switching accounts revokes the previous account server-side', async ({
    page,
  }) => {
    let userA = await createSubscribedUserAndLogin(
      page,
      'account-switch-revoke-a',
    );
    await assertLoggedIn(page, {
      displayName: userA.username,
      userId: userA.credentials.userId,
    });

    // Capture A's access token from the browser before the switch clears it.
    let accessTokenA = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth') ?? '{}').access_token,
    );
    let whoamiA = () =>
      fetch(`${getSynapseURL()}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${accessTokenA}` },
      });
    expect(
      (await whoamiA()).status,
      'A’s token is valid before the switch',
    ).toBe(200);

    let { username: usernameB, credentials: credentialsB } =
      await createSubscribedUser('account-switch-revoke-b');
    await setupPermissions(credentialsB.userId, `${appURL}/`);
    let { login_token } = await mintLoginToken(credentialsB.accessToken);

    await page.goto(`${appURL}?loginToken=${login_token}`);
    await assertLoggedIn(page, {
      displayName: usernameB,
      userId: credentialsB.userId,
    });

    // The switch logs A out server-side even though A was never booted in this
    // browser session — the tear-down is handed A's captured auth.
    expect(
      (await whoamiA()).status,
      'A’s token is rejected after the switch',
    ).toBe(401);
  });

  test('the minted token carries the configured 2-minute lifetime and exchanges for a new session', async () => {
    let { credentials } = await createUser('login-token');

    let { login_token, expires_in_ms } = await mintLoginToken(
      credentials.accessToken,
    );
    expect(login_token, 'a login token is returned').toBeTruthy();
    // token_timeout is configured as "2m" in the test homeserver.yaml; this is
    // the one assertion that catches the config block failing to reach Synapse.
    expect(expires_in_ms).toBe(120_000);

    let loginResponse = await fetch(
      `${getSynapseURL()}/_matrix/client/v3/login`,
      {
        method: 'POST',
        body: JSON.stringify({ type: 'm.login.token', token: login_token }),
      },
    );
    expect(loginResponse.status, 'login with the token succeeds').toBe(200);
    let session = (await loginResponse.json()) as {
      user_id: string;
      access_token: string;
      device_id: string;
    };
    expect(session.user_id).toBe(credentials.userId);
    expect(session.access_token, 'a fresh access token is issued').toBeTruthy();
    // The hand-off mints a new device independent of the caller's — a
    // separately-revocable session, not a copy of the minting one.
    expect(session.device_id).toBeTruthy();
    expect(session.device_id).not.toBe(credentials.deviceId);
  });

  test('a login token is single-use', async () => {
    let { credentials } = await createUser('login-token-reuse');
    let { login_token } = await mintLoginToken(credentials.accessToken);

    let first = await fetch(`${getSynapseURL()}/_matrix/client/v3/login`, {
      method: 'POST',
      body: JSON.stringify({ type: 'm.login.token', token: login_token }),
    });
    expect(first.status, 'the first exchange succeeds').toBe(200);

    let second = await fetch(`${getSynapseURL()}/_matrix/client/v3/login`, {
      method: 'POST',
      body: JSON.stringify({ type: 'm.login.token', token: login_token }),
    });
    expect(second.status, 'the token cannot be reused').toBe(403);
  });
});
