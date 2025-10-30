import { expect, test } from './fixtures';
import {
  loginUser,
  registerUser,
  getAccountData,
  type SynapseInstance,
} from '../docker/synapse';
import { appURL } from '../helpers/isolated-realm-server';
import {
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  assertLoggedOut,
  logout,
  login,
  enterWorkspace,
  showAllCards,
  createSubscribedUser,
  getUniqueUsername,
  getUniquePassword,
  REGISTRATION_TOKEN,
  getMatrixTestContext,
} from '../helpers';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '../helpers/matrix-constants';

const serverIndexUrl = new URL(appURL).origin;

function getSynapse(): SynapseInstance {
  return getMatrixTestContext().synapse;
}

function makeRegistrationUser(
  prefix: string,
  opts?: { displayName?: string; emailDomain?: string },
) {
  let username = getUniqueUsername(prefix);
  let password = getUniquePassword();
  return {
    username,
    password,
    email: `${username}@$localhost`,
    displayName: opts?.displayName ?? `${prefix} User`,
  };
}

test.describe('User Registration w/ Token', () => {
  test.beforeEach(async () => {
  });

  test('it can register a user with a registration token', async ({ page }) => {
    let secondUser = await createSubscribedUser('token-registration-2');
    let firstUser = makeRegistrationUser('token-registration-1', {
      displayName: 'Test User',
    });

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toHaveCount(1);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(firstUser.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(firstUser.email);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill(firstUser.username);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill(firstUser.password);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(firstUser.password);
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, firstUser.email, {
      onEmailPage: async (emailPage) => {
        await expect(emailPage).toHaveScreenshot('verification-email.png', {
          mask: [emailPage.locator('.messagelist')],
          maxDiffPixelRatio: 0.1,
        });
      },
      onValidationPage: async (validationPage) => {
        await expect(validationPage.locator('body')).toContainText(
          'Your email has now been validated',
        );
        await expect(validationPage).toHaveScreenshot('verification-page.png', {
          maxDiffPixelRatio: 0.1,
        });
      },
    });

    await page.bringToFront();

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
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
      page.locator(
        `[data-test-workspace="Test User's Workspace"] [data-test-realm-icon-url]`,
      ),
      'the "T" icon URL is shown',
    ).toHaveAttribute(
      'style',
      'background-image: url("https://boxel-images.boxel.ai/icons/Letter-t.png");',
    );
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"] .icon`),
      'has background image',
    ).toHaveAttribute('style', /--workspace-background-image-url:/);
    await expect(
      page.locator(`[data-test-workspace-chooser-toggle]`),
      'workspace toggle button is disabled when no workspaces opened',
    ).toBeDisabled();
    await expect(
      page.locator(
        `[data-test-catalog-list] [data-test-workspace="Test Workspace A"]`,
      ),
    ).toHaveCount(1);

    let newRealmURL = new URL(`${firstUser.username}/personal/`, serverIndexUrl)
      .href;

    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(1);

    await enterWorkspace(page, "Test User's Workspace");

    await expect(
      page.locator(
        `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
      ),
    ).toContainText("Test User's Workspace");

    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);
    await showAllCards(page);
    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await page.locator(`[data-test-workspace-chooser-toggle]`).click();
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);

    await logout(page);
    await assertLoggedOut(page);

    await login(page, secondUser.username, secondUser.password, {
      url: serverIndexUrl,
    });

    await assertLoggedIn(page, {
      userId: secondUser.credentials.userId,
      displayName: secondUser.username,
    });
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(page.locator(`[data-test-workspace-list]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace-list] [data-test-workspace]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(
        `[data-test-catalog-list] [data-test-workspace="Test Workspace A"]`,
      ),
    ).toHaveCount(1);

    await logout(page);
    await assertLoggedOut(page);

    let firstUserCredentials = await loginUser(
      firstUser.username,
      firstUser.password,
    );
    await login(page, firstUser.username, firstUser.password, {
      url: serverIndexUrl,
    });
    await assertLoggedIn(page, {
      displayName: firstUser.displayName,
      userId: firstUserCredentials.userId,
    });
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.locator(`[data-test-workspace="Test User's Workspace"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-catalog-list] [data-test-workspace="Test Workspace A"]`,
      ),
    ).toHaveCount(1);

    await page.goto(newRealmURL);
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);

    await logout(page);
    await assertLoggedOut(page);

    await login(page, firstUser.username, firstUser.password, {
      url: newRealmURL,
    });
    await assertLoggedIn(page, {
      displayName: firstUser.displayName,
      userId: firstUserCredentials.userId,
    });
    await expect(
      page.locator(`[data-test-stack-card="${newRealmURL}index"]`),
    ).toHaveCount(1);

    let realms = await getAccountData<{ realms: string[] } | undefined>(
      firstUserCredentials.userId,
      firstUserCredentials.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    );
    expect(realms).toEqual({
      realms: [`http://localhost:4205/${firstUser.username}/personal/`],
    });
  });

  test('it can resend email validation message', async ({ page }) => {
    const user = makeRegistrationUser('token-resend-email');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await page.locator('[data-test-email-field]').fill(user.email);
    await page.locator('[data-test-username-field]').fill(user.username);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);
    await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();

    await validateEmail(page, user.email, { sendAttempts: 2 });
  });

  test('it shows an error when the username is already taken', async ({
    page,
  }) => {
    let synapse = getSynapse();
    let existingUser = makeRegistrationUser('token-username-taken-existing');
    await registerUser(synapse, existingUser.username, existingUser.password);
    let registrationUser = makeRegistrationUser(
      'token-username-taken-registration',
    );

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-name-field]')
      .fill(registrationUser.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(registrationUser.email);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-username-field]')
      .fill(existingUser.username);
    await page
      .locator('[data-test-password-field]')
      .fill(registrationUser.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(registrationUser.password);

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

    await page
      .locator('[data-test-username-field]')
      .fill(registrationUser.username);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
  });

  test('it shows an error when the username start with an underscore', async ({
    page,
  }) => {
    const user = makeRegistrationUser('token-underscore');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(user.email);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill(`_${user.username}`);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);

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

    await page.locator('[data-test-username-field]').fill(user.username);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
  });

  test('it shows an error when the username start with "realm/"', async ({
    page,
  }) => {
    const user = makeRegistrationUser('token-realm-prefix');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(user.email);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page
      .locator('[data-test-username-field]')
      .fill(`realm/${user.username}`);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);

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

    await page.locator('[data-test-username-field]').fill(user.username);
    await expect(
      page.locator(
        '[data-test-username-field] ~ [data-test-boxel-input-group-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
  });

  test('it show an error when a invalid registration token is used', async ({
    page,
  }) => {
    const user = makeRegistrationUser('token-invalid');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(user.email);
    await page.locator('[data-test-username-field]').fill(user.username);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);
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
    ).toContainText(
      'This registration token does not exist or has exceeded its usage limit.',
    );

    await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
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
  });

  test('it shows an error when passwords do not match', async ({ page }) => {
    const user = makeRegistrationUser('token-password-mismatch');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-email-field]').fill(user.email);
    await page.locator('[data-test-username-field]').fill(user.username);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(`${user.password}-mismatch`);
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
      .fill(user.password);
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

  test("it shows an error when password doesn't follow requirement", async ({
    page,
  }) => {
    const user = makeRegistrationUser('token-password-requirement');

    await gotoRegistration(page, serverIndexUrl);

    await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await page.locator('[data-test-email-field]').fill(user.email);
    await page.locator('[data-test-username-field]').fill(user.username);
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

    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);
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
    const user = makeRegistrationUser('token-register-error');

    await gotoRegistration(page, serverIndexUrl);

    await expect(
      page.locator('[data-test-register-user-error]'),
      'error is not shown',
    ).toHaveCount(0);
    await page.locator('[data-test-name-field]').fill(user.displayName);
    await page.locator('[data-test-email-field]').fill('not-an-email-address');
    await page.locator('[data-test-username-field]').fill(user.username);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);
    await page.locator('[data-test-register-btn]').click();

    await expect(page.locator('[data-test-register-user-error]')).toContainText(
      'There was an error registering: Email address is invalid',
    );
  });

  test('it shows an error encountered when submitting the token', async ({
    page,
  }) => {
    const user = makeRegistrationUser('token-submit-error');

    await gotoRegistration(page, serverIndexUrl);

    await page.locator('[data-test-name-field]').fill(user.displayName);
    await page.locator('[data-test-email-field]').fill(user.email);
    await page.locator('[data-test-username-field]').fill(user.username);
    await page.locator('[data-test-password-field]').fill(user.password);
    await page
      .locator('[data-test-confirm-password-field]')
      .fill(user.password);
    await page.locator('[data-test-register-btn]').click();

    await expect(
      page.locator(
        '[data-test-token-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);

    await page.locator('[data-test-token-field]').fill(REGISTRATION_TOKEN);
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
    ).toContainText('Could not connect to server');
    await page.context().setOffline(false);
  });
});
