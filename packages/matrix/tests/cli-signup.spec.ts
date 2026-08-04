import { expect, test } from './fixtures.ts';
import { getAccountData } from '../support/synapse/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  validateEmail,
  getUniqueUsername,
  getUniquePassword,
  REGISTRATION_TOKEN,
  getMatrixTestContext,
  createSubscribedUser,
} from '../helpers/index.ts';
import { browserLogin } from '../../boxel-cli/src/lib/sso-login.ts';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '../support/matrix-constants.ts';

// The realm server serves the host app, so /cli-auth lives at its root. Taken
// from `appURL` rather than written out, since that names a realm on the same
// server (`https://localhost:4205/test`) — resolving the page against `appURL`
// directly would ask for `/test/cli-auth`.
const HOST_URL = new URL('/', appURL).href;
const serverIndexUrl = new URL(appURL).origin;

// A brand-new user can authorize the CLI by signing up on the /cli-auth page,
// not just logging in. The page reuses the web app's <RegisterUser> flow — email
// verification, invite token, and the same post-signup bootstrap that gives the
// user a personal realm — then POSTs the device registration mints to the
// loopback listener the CLI is holding open, exactly like the password branch.
//
// Everything below is real: the CLI's listener, the host page, Synapse, and the
// smtp4dev inbox the verification email lands in. `browserLogin` takes its
// browser-opener as an argument, so this hands it a Playwright page.
test.describe('boxel-cli browser sign-up', () => {
  test('a registration hands the CLI a working, bootstrapped session', async ({
    page,
  }) => {
    const { matrixUrl } = getMatrixTestContext();
    const username = getUniqueUsername('cli-signup');
    const password = getUniquePassword();
    const email = `${username}@localhost`;
    const displayName = 'CLI Signup User';

    const auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: HOST_URL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);

        // Switch from the password form into the reused registration flow.
        await page.locator('[data-test-cli-auth-register]').click();

        await page.locator('[data-test-name-field]').fill(displayName);
        await page.locator('[data-test-email-field]').fill(email);
        await page.locator('[data-test-username-field]').fill(username);
        await page.locator('[data-test-password-field]').fill(password);
        await page.locator('[data-test-confirm-password-field]').fill(password);
        await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
        await page.locator('[data-test-register-btn]').click();

        // Boxel is invite-only, so registration collects the token before the
        // email round-trip.
        await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
        await page.locator('[data-test-next-btn]').click();

        // Verifying the email lets registration complete: the page then runs the
        // post-signup bootstrap and POSTs the minted session to the loopback.
        await validateEmail(page, email);
        return true;
      },
    });

    expect(auth.userId).toBe(`@${username}:localhost`);
    expect(auth.matrixUrl).toBe(matrixUrl);

    // A session the CLI can actually use — the registration device, handed over
    // whole.
    const whoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      user_id: auth.userId,
      device_id: auth.deviceId,
    });

    // The full web-parity bootstrap ran before the hand-off: the new user has a
    // personal realm, so they are immediately usable rather than an empty shell.
    const realms = await getAccountData<{ realms: string[] } | undefined>(
      auth.userId,
      auth.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    );
    expect(realms).toEqual({
      realms: [`${serverIndexUrl}/${username}/personal/`],
    });
  });

  // The page offers registration to a browser that is already signed in — it
  // even prefills that account's username on the password form — so the session
  // it holds has to be gone before the bootstrap starts. The realm-server token
  // is the one that bites: it persists in localStorage apart from the Matrix
  // session and carries a `sessionRoom` claim, and the realm-auth handshake
  // adopts that room. Left behind, it hands the new account a session room
  // belonging to the signed-in one, which it was never invited to and cannot
  // join — the bootstrap dies there, before the personal realm exists, and the
  // CLI is left waiting on a hand-off that never comes.
  test('registering from a browser that already holds a session hands the CLI its device anyway', async ({
    page,
  }) => {
    const { matrixUrl } = getMatrixTestContext();
    const {
      username: existingUsername,
      password: existingPassword,
      credentials: existingCredentials,
    } = await createSubscribedUser('cli-signup-signed-in');

    const username = getUniqueUsername('cli-signup-2nd');
    const password = getUniquePassword();
    const email = `${username}@localhost`;
    const displayName = 'CLI Signup Second User';

    // Sign in through the app's own form, and let it establish realm auth, so the
    // register flow starts from the state that used to break it. Not the `login`
    // helper: it re-injects the session on every navigation in the context, which
    // would put back the very session this flow has to shed.
    await page.goto(appURL);
    await page.locator('[data-test-username-field]').fill(existingUsername);
    await page.locator('[data-test-password-field]').fill(existingPassword);
    await page.locator('[data-test-login-btn]').click();
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(window.localStorage.getItem('boxel-realm-server-session')),
        ),
      )
      .toBe(true);

    const auth = await browserLogin({
      matrixUrl: matrixUrl!,
      hostUrl: HOST_URL,
      log: () => {},
      openBrowserFn: async (authUrl) => {
        await page.goto(authUrl);

        // The signed-in account is the one the password form offers.
        await expect(
          page.locator('[data-test-cli-auth-signed-in-as]'),
        ).toContainText(`@${existingUsername}:localhost`);

        // Entering register mode reloads, keeping the CLI's port and nonce, and
        // says that this browser is no longer signed in.
        await page.locator('[data-test-cli-auth-register]').click();
        await expect(
          page.locator('[data-test-cli-auth-signed-out-note]'),
        ).toBeVisible();
        expect(
          await page.evaluate(() => [
            window.localStorage.getItem('auth'),
            window.localStorage.getItem('boxel-realm-server-session'),
            window.localStorage.getItem('boxel-session'),
          ]),
        ).toEqual([null, null, null]);

        await page.locator('[data-test-name-field]').fill(displayName);
        await page.locator('[data-test-email-field]').fill(email);
        await page.locator('[data-test-username-field]').fill(username);
        await page.locator('[data-test-password-field]').fill(password);
        await page.locator('[data-test-confirm-password-field]').fill(password);
        await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
        await page.locator('[data-test-register-btn]').click();

        await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
        await page.locator('[data-test-next-btn]').click();

        await validateEmail(page, email);
        return true;
      },
    });

    // The hand-off is the new account's, not the account that was signed in.
    expect(auth.userId).toBe(`@${username}:localhost`);

    const whoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      },
    );
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      user_id: auth.userId,
      device_id: auth.deviceId,
    });

    // The bootstrap ran to completion — this is what the stale token used to
    // prevent.
    const realms = await getAccountData<{ realms: string[] } | undefined>(
      auth.userId,
      auth.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    );
    expect(realms).toEqual({
      realms: [`${serverIndexUrl}/${username}/personal/`],
    });

    // Signing this browser out was local to the browser: nothing was revoked, so
    // that account's other sessions still work.
    const existingWhoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      {
        headers: { Authorization: `Bearer ${existingCredentials.accessToken}` },
      },
    );
    expect(existingWhoami.status).toBe(200);
    expect(await existingWhoami.json()).toMatchObject({
      user_id: existingCredentials.userId,
      device_id: existingCredentials.deviceId,
    });
  });
});
