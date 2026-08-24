import { expect, test } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { getSynapseURL } from '../support/environment-config.ts';
import {
  createUser,
  createSubscribedUser,
  setupPermissions,
  assertLoggedIn,
} from '../helpers/index.ts';

// Exercises Synapse's login_via_existing_session feature (MSC3882), which the
// test homeserver config enables. A client holding an access token mints a
// short-lived, single-use login token and hands a session off to the browser
// via ?loginToken — the pre-authenticated hand-off this repo consumes in
// packages/host/app/components/matrix/login.gts.
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
