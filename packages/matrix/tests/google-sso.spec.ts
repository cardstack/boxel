import { expect, test } from './fixtures.ts';
import type { Credentials } from '../support/synapse/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  setupPermissions,
  updateSynapseUser,
} from '../helpers/index.ts';

// Drives the full Google sign-in round-trip through the real host UI against
// navikt/mock-oauth2-server (wired up in tests/global.setup.ts):
//
//   host login → Synapse SSO redirect → mock /authorize login form →
//   Synapse OIDC callback → BoxelOidcMappingProvider links by verified email →
//   host consumes the loginToken → signed in.
//
// This is the round-trip smoke test that de-risks the SSO infrastructure; the
// per-scenario matrix (unverified email, ambiguous match, new-user signup, …)
// builds on the same wiring.
test.describe('Google sign-in (mock OIDC)', () => {
  let username: string;
  let credentials: Credentials;
  let userEmail: string;

  test.beforeEach(async () => {
    ({ username, credentials } = await createSubscribedUser('google-sso'));
    userEmail = `${username}@example.com`;
    // The mapping provider links a Google sign-in to an existing account by
    // matching the verified email against a registered 3pid.
    await updateSynapseUser(credentials.userId, {
      emailAddresses: [userEmail],
    });
    await setupPermissions(credentials.userId, `${appURL}/`);
  });

  test('a returning user with a matching verified email is linked to their existing account', async ({
    page,
  }) => {
    await page.goto(appURL);

    // The button only renders when the flag is on (host dev build) AND Synapse
    // advertises the oidc-google IdP, so its presence already exercises the
    // login-flow detection.
    await page.locator('[data-test-google-login-btn]').click();

    // Synapse redirects to the mock's interactive login form. `username`
    // becomes the `sub`; the claims textarea carries the verified email the
    // mapping provider keys on.
    await page
      .locator('input[name="username"]')
      .fill('google-oauth2|returning');
    await page.locator('textarea[name="claims"]').fill(
      JSON.stringify({
        email: userEmail,
        email_verified: true,
        name: 'Returning Google User',
      }),
    );
    await page.locator('input[type="submit"]').click();

    // Back on the host with a loginToken, signed in. The operator-mode stack
    // confirms a successful session start.
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);

    // The crucial assertion: we are signed in as the *existing* mxid, not a
    // freshly-created duplicate.
    await page.locator('[data-test-profile-icon-button]').click();
    await expect(page.locator('[data-test-profile-icon-handle]')).toContainText(
      `@${username}:localhost`,
    );
  });
});
