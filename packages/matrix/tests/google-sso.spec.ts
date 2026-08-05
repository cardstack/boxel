import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import type { Credentials } from '../support/synapse/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createSubscribedUser,
  getExternalIdsForIdp,
  setRealmRedirects,
  setupPermissions,
  subjectFor,
  updateSynapseUser,
} from '../helpers/index.ts';

// Synapse surfaces the `google` provider to clients — and stores its
// `user_external_ids` rows — as `oidc-google`.
const GOOGLE_IDP = 'oidc-google';

interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

// Drives one sign-in from the host's Google button through the mock IdP's
// interactive login form and back. `sub` is what the mock echoes as the subject
// claim, so each caller controls the identity being presented.
async function signInWithGoogle(
  page: Page,
  { sub, email, name }: GoogleIdentity,
) {
  await page.goto(appURL);
  await page.locator('[data-test-google-login-btn]').click();
  await page.locator('input[name="username"]').fill(sub);
  await page
    .locator('textarea[name="claims"]')
    .fill(JSON.stringify({ email, email_verified: true, name }));
  await page.locator('input[type="submit"]').click();
}

async function expectSignedInAs(page: Page, userId: string) {
  // The operator-mode stack confirms a successful session start.
  await expect(page.locator('[data-test-operator-mode-stack="0"]')).toHaveCount(
    1,
  );
  await page.locator('[data-test-profile-icon-button]').click();
  await expect(page.locator('[data-test-profile-icon-handle]')).toContainText(
    userId,
  );
  await page.keyboard.press('Escape');
}

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
    // The Google button only renders when the flag is on (host dev build) AND
    // Synapse advertises the oidc-google IdP, so signing in through it already
    // exercises the login-flow detection.
    await signInWithGoogle(page, {
      sub: subjectFor(username),
      email: userEmail,
      name: 'Returning Google User',
    });

    // The crucial assertion: we are signed in as the *existing* mxid, not a
    // freshly-created duplicate.
    await expectSignedInAs(page, `@${username}:localhost`);
  });

  // Two people signing in from two devices. The identity Synapse *stores* is what
  // the next sign-in gets matched against, so landing in the right account is not
  // enough — a correct-looking session can still write a row that hands the
  // account to somebody else. Hence assertions on the stored external ids rather
  // than on the session alone.
  test('each Google identity signs in to its own account and is stored under its own subject claim', async ({
    browser,
    page,
  }) => {
    let other = await createSubscribedUser('google-sso-other');
    let otherEmail = `${other.username}@example.com`;
    await updateSynapseUser(other.credentials.userId, {
      emailAddresses: [otherEmail],
    });
    await setupPermissions(other.credentials.userId, `${appURL}/`);

    let sub = subjectFor(username);
    let otherSub = subjectFor(other.username);

    await signInWithGoogle(page, { sub, email: userEmail, name: 'First User' });
    await expectSignedInAs(page, `@${username}:localhost`);

    // A separate context is the second device: its own cookie jar, so the mock
    // IdP prompts again instead of reusing the first sign-in's session, and the
    // host cannot carry over any client-side state.
    let context = await browser.newContext();
    let otherPage = await context.newPage();
    try {
      await setRealmRedirects(otherPage);
      await signInWithGoogle(otherPage, {
        sub: otherSub,
        email: otherEmail,
        name: 'Second User',
      });
      await expectSignedInAs(otherPage, `@${other.username}:localhost`);
    } finally {
      await context.close().catch(() => {});
    }

    // Each account is linked to exactly the subject claim it presented.
    expect(await getExternalIdsForIdp(credentials.userId, GOOGLE_IDP)).toEqual([
      sub,
    ]);
    expect(
      await getExternalIdsForIdp(other.credentials.userId, GOOGLE_IDP),
    ).toEqual([otherSub]);
  });
});
