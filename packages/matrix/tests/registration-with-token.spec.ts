import { expect, test } from '@playwright/test';
import { writeJSONSync } from 'fs-extra';
import { join } from 'path';
import {
  synapseStart,
  synapseStop,
  getAccountData,
  loginUser,
  type SynapseInstance,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  assertLoggedOut,
  logout,
  login,
  registerRealmUsers,
  enterWorkspace,
  showAllCards,
} from '../helpers';
import { registerUser, createRegistrationToken } from '../docker/synapse';

const REGISTRATION_TOKEN = 'abc123';

test.describe('User Registration w/ Token - isolated realm server', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(60_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();
    realmServer = await startRealmServer();
  });

  test.afterEach(async () => {
    await realmServer.stop();
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('it can register a user with a registration token', async ({ page }) => {
    let serverIndexUrl = new URL(appURL).origin;
    test.setTimeout(120_000);
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerUser(synapse, 'user2', 'pass');
    await registerRealmUsers(synapse);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await clearLocalStorage(page, serverIndexUrl);
    await gotoRegistration(page, serverIndexUrl);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com', {
      onEmailPage: async (page) => {
        await expect(page).toHaveScreenshot('verification-email.png', {
          mask: [page.locator('.messagelist')],
          maxDiffPixelRatio: 0.01,
        });
      },
      onValidationPage: async (page) => {
        await expect(page.locator('body')).toContainText(
          'Your email has now been validated',
        );
        await expect(page).toHaveScreenshot('verification-page.png', {
          maxDiffPixelRatio: 0.01,
        });
      },
    });

    await assertLoggedIn(page, {
      email: 'user1@example.com',
      displayName: 'Test User',
    });

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace-loading-indicator]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator(
        `[data-test-workspace-list] [data-test-workspace="Test User's Workspace"]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test-workspace-list] [data-test-workspace-name]'),
    ).toContainText("Test User's Workspace", { timeout: 30_000 });
    await expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace-visibility]',
      ),
    ).toContainText('private', { timeout: 30_000 });
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"] img`),
      'the "T" icon URL is shown',
    ).toHaveAttribute('src', 'https://i.postimg.cc/tTPJCJkG/Letter-t.png');
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"] .icon`),
      'has background image',
    ).toHaveAttribute('style', /--workspace-background-image-url:/);
    await expect(
      page.locator(`[data-test-workspace-chooser-toggle]`),
      'workspace toggle button is disabled when no workspaces opened',
    ).toBeDisabled();

    let newRealmURL = new URL('user1/personal/', serverIndexUrl).href;
    await enterWorkspace(page, "Test User's Workspace");

    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);
    await showAllCards(page);
    await expect(
      page.locator(`[data-test-cards-grid-item="${newRealmURL}hello-world"]`),
    ).toHaveCount(1);
    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);

    // assert that the registration mode state is cleared properly
    await logout(page);
    await assertLoggedOut(page);

    // assert workspaces state don't leak into other sessions
    await login(page, 'user2', 'pass', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
    });
    await assertLoggedIn(page, {
      userId: '@user2:localhost',
      displayName: 'user2',
    });
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(page.locator(`[data-test-workspace-list]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(0);

    // assert newly registered user can login with their credentials
    await logout(page);
    await assertLoggedOut(page);
    await login(page, 'user1', 'mypassword1!', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
    });
    await assertLoggedIn(page, { displayName: 'Test User' });
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(1);

    // we're including the following assertions in this test because the
    // isolated realm is so expensive, otherwise it would be desireable to have
    // these assertions in their own test

    // assert that logged in user can navigate directly to card in private realm without
    // being asked to login
    await page.goto(`${newRealmURL}hello-world`);
    await expect(
      page.locator(`[data-test-card="${newRealmURL}hello-world"]`),
    ).toContainText('Hello World');

    // assert that host app can subscribe to SSE events of a private realm
    let path = join(
      realmServer.realmPath,
      '..',
      'user1',
      'personal',
      'hello-world.json',
    );
    writeJSONSync(path, {
      data: {
        type: 'card',
        attributes: {
          title: 'Hello Mars',
          description: 'This is a test card instance.',
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });
    await expect(
      page.locator(`[data-test-card="${newRealmURL}hello-world"]`),
    ).toContainText('Hello Mars');

    // assert that non-logged in user is prompted to login before navigating
    // directly to card in private repo
    await logout(page);
    await assertLoggedOut(page);

    await login(page, 'user1', 'mypassword1!', {
      url: `${newRealmURL}hello-world`,
      skipOpeningAssistant: true,
    });
    await assertLoggedIn(page, { displayName: 'Test User' });
    await expect(
      page.locator(`[data-test-card="${newRealmURL}hello-world"]`),
    ).toHaveCount(1);

    let auth = await loginUser(`user1`, 'mypassword1!');
    let realms = await getAccountData<{ realms: string[] } | undefined>(
      auth.userId,
      auth.accessToken,
      'com.cardstack.boxel.realms',
    );
    expect(realms).toEqual({
      realms: ['http://localhost:4205/user1/personal/'],
    });
  });

  test(`it can resend email validation message`, async ({ page }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await clearLocalStorage(page, appURL);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await gotoRegistration(page, appURL);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com', { sendAttempts: 2 });
  });
});

test.describe('User Registration w/ Token', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async () => {
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('it shows an error when the username is already taken', async ({
    page,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await registerUser(synapse, 'user1', 'pass');
    await clearLocalStorage(page);

    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user2@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');

    await expect(
      page.locator(
        '[data-test-username-field][data-test-boxel-input-group-validation-state="invalid"]',
      ),
      'username field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
    ).toContainText('Username is already taken');

    await page.locator('[data-test-username-field]').fill('user2');
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user2@example.com');

    await assertLoggedIn(page, {
      userId: '@user2:localhost',
      displayName: 'Test User',
    });
  });

  test('it shows an error when the username start with an underscore', async ({
    page,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await clearLocalStorage(page);

    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('_user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');

    await expect(
      page.locator(
        '[data-test-username-field][data-test-boxel-input-group-validation-state="invalid"]',
      ),
      'username field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
    ).toContainText('Username cannot start with an underscore');

    await page.locator('[data-test-username-field]').fill('user1');
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com');

    await assertLoggedIn(page, {
      userId: '@user1:localhost',
      displayName: 'Test User',
    });
  });

  test('it shows an error when the username start with "realm/"', async ({
    page,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await clearLocalStorage(page);

    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill('realm/user');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');

    await expect(
      page.locator(
        '[data-test-username-field][data-test-boxel-input-group-validation-state="invalid"]',
      ),
      'username field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
    ).toContainText('Username cannot start with "realm/"');

    await page.locator('[data-test-username-field]').fill('user1');
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, 'user1@example.com');

    await assertLoggedIn(page, {
      userId: '@user1:localhost',
      displayName: 'Test User',
    });
  });

  test(`it show an error when a invalid registration token is used`, async ({
    page,
  }) => {
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    await clearLocalStorage(page);

    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('Test User');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await page.locator('[data-test-token-field]').fill('invalid token');
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'token field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Invalid registration token');

    await page.locator('[data-test-token-field]').fill('abc123');
    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'token field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-next-btn]').click();
    await validateEmail(page, 'user1@example.com');

    await assertLoggedIn(page, {
      userId: '@user1:localhost',
      displayName: 'Test User',
    });
  });

  test(`it shows an error when passwords do not match`, async ({ page }) => {
    await registerRealmUsers(synapse);
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!!');
    await page.locator('[data-test-register-btn]').click();
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText('Passwords do not match');

    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await expect(
      page.locator(
        '[data-test-confirm-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-confirm-password-field] ~ [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);
    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test(`it shows an error when password doesn't follow requirement`, async ({
    page,
  }) => {
    await registerRealmUsers(synapse);
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('short');
    await page.locator('[data-test-confirm-password-field]').fill('short');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toHaveText('Password must be at least 8 characters long');

    await page.locator('[data-test-password-field]').fill('mypassword!1');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword!1');
    await expect(
      page.locator(
        '[data-test-password-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'password field does not have error state',
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-test-password-field] ~ [data-test-boxel-input-error-message]',
      ),
      'password error message does not appear',
    ).toHaveCount(0);

    await page.locator('[data-test-register-btn]').click();
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
  });

  test('it shows an error encountered when registering', async ({ page }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await expect(
      page.locator('[data-test-register-user-error]'),
      'error is not shown',
    ).toHaveCount(0);
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('not-an-email-address');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-register-user-error]')).toContainText(
      'There was an error registering: Email address is invalid',
    );
  });

  test('it shows an error encountered when submitting the token', async ({
    page,
  }) => {
    await clearLocalStorage(page);
    await gotoRegistration(page);

    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();

    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);

    await page.locator('[data-test-token-field]').fill('abc123');
    await page.context().setOffline(true);
    await page.locator('[data-test-next-btn]').click();

    await expect(
      page.locator(
        '[data-test-token-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'token field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText(
      'There was an error verifying token: Could not connect to server',
    );
  });
});
