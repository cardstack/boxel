import { expect, test } from './fixtures.ts';
import { getMatrixTestContext } from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { createSubscribedUser, updateSynapseUser } from '../helpers/index.ts';
import { browserLogin } from '../../boxel-cli/src/lib/sso-login.ts';

// boxel-cli authorizes a machine by opening the host app's /cli-auth page and
// waiting on a loopback listener. The page offers the same two choices as the
// web sign-in, and each one finishes by getting a Matrix session to the CLI:
//
//   password — the page signs in against the homeserver and POSTs the session
//   Google   — Synapse redirects to the listener with a single-use token
//
// Everything below is real: the CLI's listener, the host page, Synapse, and
// (for the Google branch) the mock OIDC provider. `browserLogin` takes its
// browser-opener as an argument, so these tests hand it a Playwright page.

test.describe('boxel-cli browser authorization', () => {
  test('a password sign-in hands the CLI a working session', async ({
    page,
  }) => {
    const { matrixUrl } = getMatrixTestContext();
    const { username, password, credentials } =
      await createSubscribedUser('cli-pw');

    const auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: appURL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);
        await page
          .locator('[data-test-cli-auth-username] input')
          .fill(username);
        await page
          .locator('[data-test-cli-auth-password] input')
          .fill(password);
        await page.locator('[data-test-cli-auth-submit]').click();
        return true;
      },
    });

    expect(auth.userId).toBe(`@${username}:localhost`);
    expect(auth.matrixUrl).toBe(matrixUrl);

    // A session the CLI can actually use, on a device of its own rather than
    // one borrowed from the browser.
    const whoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      user_id: auth.userId,
      device_id: auth.deviceId,
    });
    expect(auth.deviceId).not.toBe(credentials.deviceId);
  });

  test('a Google sign-in hands the CLI a working session', async ({ page }) => {
    const { matrixUrl } = getMatrixTestContext();
    const { username, credentials } = await createSubscribedUser('cli-sso');
    const userEmail = `${username}@example.com`;
    // The mapping provider links a Google identity to an existing account by
    // matching the verified email against a registered 3pid.
    await updateSynapseUser(credentials.userId, {
      emailAddresses: [userEmail],
    });

    const auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: appURL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);
        await page.locator('[data-test-cli-auth-google]').click();
        // The mock OIDC provider's interactive login form: `username` becomes
        // the sub, and `claims` carries the verified email.
        await page.locator('input[name="username"]').fill('google-oauth2|cli');
        await page.locator('textarea[name="claims"]').fill(
          JSON.stringify({
            email: userEmail,
            email_verified: true,
            name: 'CLI Test User',
          }),
        );
        await page.locator('input[type="submit"]').click();
        return true;
      },
    });

    // Linked to the existing account, not a freshly minted duplicate.
    expect(auth.userId).toBe(`@${username}:localhost`);

    const whoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    expect(whoami.status).toBe(200);
  });

  test('refuses to send a session anywhere but this machine', async ({
    page,
  }) => {
    // The redirect target is attacker-controllable, so the page has to reject
    // a non-loopback one rather than hand a session to it.
    await page.goto(
      `${appURL}/cli-auth?redirect=${encodeURIComponent('https://evil.example.com/steal')}`,
    );
    await expect(page.locator('[data-test-cli-auth-error]')).toBeVisible();
    await expect(page.locator('[data-test-cli-auth-form]')).toHaveCount(0);
  });
});
