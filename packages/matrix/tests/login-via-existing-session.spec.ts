import { expect, test } from '@playwright/test';
import { getSynapseURL } from '../support/environment-config.ts';
import { createUser } from '../helpers/index.ts';

// Exercises Synapse's login_via_existing_session feature (MSC3882), which the
// test homeserver config enables. A client holding an access token mints a
// short-lived, single-use login token and exchanges it for a fresh session —
// the mechanism that hands a pre-authenticated session off to the browser.
test.describe('login_via_existing_session', () => {
  test('an access-token holder can mint a login token and exchange it for a session', async () => {
    let { credentials } = await createUser('login-token');

    // Mint a login token with the existing session's access token.
    let getTokenResponse = await fetch(
      `${getSynapseURL()}/_matrix/client/v1/login/get_token`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        body: JSON.stringify({}),
      },
    );
    expect(
      getTokenResponse.status,
      'get_token succeeds for an authenticated caller',
    ).toBe(200);
    let { login_token, expires_in_ms } = (await getTokenResponse.json()) as {
      login_token: string;
      expires_in_ms: number;
    };
    expect(login_token, 'a login token is returned').toBeTruthy();
    // token_timeout is configured as "2m" in the test homeserver.yaml.
    expect(expires_in_ms).toBe(120_000);

    // Exchange the login token for a brand-new session belonging to the same user.
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
    expect(session.device_id).toBeTruthy();
    // The handed-off session is independent of the caller's device.
    expect(session.device_id).not.toBe(credentials.deviceId);
  });

  test('the endpoint is recognized and requires authentication', async () => {
    // Before the feature is enabled Synapse returns M_UNRECOGNIZED for this
    // route; with it enabled an unauthenticated call is rejected as
    // M_MISSING_TOKEN, proving the endpoint is wired up and enforcing auth.
    let response = await fetch(
      `${getSynapseURL()}/_matrix/client/v1/login/get_token`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(response.status).toBe(401);
    let body = (await response.json()) as { errcode: string };
    expect(body.errcode).toBe('M_MISSING_TOKEN');
  });

  test('a login token is single-use', async () => {
    let { credentials } = await createUser('login-token-reuse');

    let { login_token } = (await (
      await fetch(`${getSynapseURL()}/_matrix/client/v1/login/get_token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        body: JSON.stringify({}),
      })
    ).json()) as { login_token: string };

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
