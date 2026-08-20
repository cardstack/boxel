import { expect, test } from './fixtures.ts';
import { getAccountData } from '../support/synapse/index.ts';
import {
  createSubscribedUser,
  getMatrixTestContext,
  getUniqueUsername,
  subjectFor,
  updateSynapseUser,
} from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import { browserLogin } from '../../boxel-cli/src/lib/sso-login.ts';
import { ensurePersonalRealm } from '../../boxel-cli/src/lib/personal-realm.ts';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '../support/matrix-constants.ts';

// The realm server serves the host app, so /cli-auth lives at its root. Taken
// from `appURL` rather than written out, since that names a realm on the same
// server (`https://localhost:4205/test`) — resolving the page against `appURL`
// directly would ask for `/test/cli-auth`.
const HOST_URL = new URL('/', appURL).href;

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
      hostUrl: HOST_URL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);
        await page.locator('[data-test-cli-auth-username]').fill(username);
        await page.locator('[data-test-cli-auth-password]').fill(password);
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
      hostUrl: HOST_URL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);
        await page.locator('[data-test-cli-auth-google]').click();
        // The mock provider's login form: its `username` field becomes the sub,
        // and `claims` carries the verified email. See `subjectFor` for why the
        // sub is derived rather than fixed.
        await page.locator('input[name="username"]').fill(subjectFor(username));
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

  // A Google identity whose verified email matches no account gets a brand-new
  // one, minted by Synapse's mapping provider with no Boxel page in the loop —
  // the browser goes IdP → Synapse → the CLI's listener, so the web signup
  // bootstrap that gives an account its personal realm never runs. The CLI
  // closes that gap itself after saving the profile (`ensurePersonalRealm`,
  // exercised here directly the same way `browserLogin` is): the account must
  // come out with a personal realm, indistinguishable from one that signed up
  // through the web.
  test('a Google sign-in that mints a brand-new account gives it a personal realm', async ({
    page,
  }) => {
    const { matrixUrl } = getMatrixTestContext();
    const username = getUniqueUsername('cli-sso-new');
    const userEmail = `${username}@example.com`;
    const serverIndexUrl = new URL(appURL).origin;

    const auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: HOST_URL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);
        await page.locator('[data-test-cli-auth-google]').click();
        await page.locator('input[name="username"]').fill(subjectFor(username));
        await page.locator('textarea[name="claims"]').fill(
          JSON.stringify({
            email: userEmail,
            email_verified: true,
            name: 'CLI New Google User',
          }),
        );
        await page.locator('input[type="submit"]').click();
        return true;
      },
    });

    // A brand-new account, its localpart derived from the email's local part.
    expect(auth.userId).toBe(`@${username}:localhost`);

    // The realm server speaks HTTPS with the mkcert leaf, which this runner
    // process has no CA path to (NODE_EXTRA_CA_CERTS is only guaranteed in
    // mise-run children — see isolated-realm-server.ts, which relaxes its
    // spawned services the same way). Loopback only, so relax validation just
    // around the bootstrap calls.
    const priorTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const result = await ensurePersonalRealm(auth, `${serverIndexUrl}/`);
      expect(result).toEqual({
        outcome: 'created',
        realmUrl: `${serverIndexUrl}/${username}/personal/`,
      });

      // Running it again — a second `boxel profile add` for the same account —
      // must leave the account alone rather than erroring or double-linking.
      expect(await ensurePersonalRealm(auth, `${serverIndexUrl}/`)).toEqual({
        outcome: 'has-realms',
      });
    } finally {
      if (priorTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = priorTlsSetting;
      }
    }

    // The account's realm list — what a web session assembles from — names the
    // new realm, exactly as it would after a web signup (see cli-signup.spec).
    const realms = await getAccountData<{ realms: string[] } | undefined>(
      auth.userId,
      auth.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    );
    expect(realms).toEqual({
      realms: [`${serverIndexUrl}/${username}/personal/`],
    });
  });

  test('reaches password reset without leaving the authorization', async ({
    page,
  }) => {
    // The reset email links back to this page carrying the same port and nonce,
    // so a user who resets mid-flow can finish authorizing rather than starting
    // over — which only works if the reset lives here rather than in the app.
    await page.goto(`${HOST_URL}cli-auth?port=53412&state=abc123def456`);
    await page.locator('[data-test-cli-auth-forgot-password]').click();

    await expect(page.locator('[data-test-email-field]')).toBeVisible();
    await expect(page.locator('[data-test-cli-auth-form]')).toHaveCount(0);

    // And back again, with the callback still named in the URL.
    await page.locator('[data-test-cancel-reset-password-btn]').click();
    await expect(page.locator('[data-test-cli-auth-form]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('port')).toBe('53412');
  });

  test('offers no sign-in without a usable callback port', async ({ page }) => {
    // The page addresses loopback and nothing else, so a port it can't use
    // leaves it with nowhere to send a session — and it should say so rather
    // than collect a password it would have to discard.
    await page.goto(`${HOST_URL}cli-auth?port=0&state=abc123def456`);
    await expect(page.locator('[data-test-cli-auth-error]')).toBeVisible();
    await expect(page.locator('[data-test-cli-auth-form]')).toHaveCount(0);
  });
});
