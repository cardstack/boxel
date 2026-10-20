import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { Page, Route, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  REGISTRATION_TOKEN,
  createSubscribedUser,
  getSharedSQLExecutor,
  mailHost,
  updateSynapseUser,
} from '../helpers/index.ts';

// The secure origin's sign-in, account creation and password reset pages:
// the app's own screens, drawn the same and worded the same, on an origin card
// code can't reach. These drive them in a real browser against real Synapse,
// with its email going to smtp4dev.

const STORAGE_KEY = 'boxel-secure-session';
const MATRIX_URL = 'http://localhost:8008';

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

async function openSecurePage(page: Page, query: string): Promise<Page> {
  let secure = await page.context().newPage();
  await secure.goto(`${secureOriginURL}?${query}`);
  return secure;
}

async function signedInUser(secure: Page): Promise<string> {
  await expect(secure.locator('[data-test-secure-signed-in]')).toBeVisible({
    timeout: 60000,
  });
  return JSON.parse(
    (await secure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  ).user;
}

// How far apart, in any colour channel out of 255, two pixels may be and
// still count as the same.
const PIXEL_TOLERANCE = 8;

// How many pixels of two same-sized screenshots differ by more than
// `tolerance` in any colour channel, decoded and compared in a blank page.
async function differingPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  tolerance: number,
): Promise<number> {
  let scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(
      async ({ a, b, tolerance }) => {
        async function pixels(base64: string) {
          let bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          let bitmap = await createImageBitmap(
            new Blob([bytes], { type: 'image/png' }),
          );
          let canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          let context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        }
        let [first, second] = await Promise.all([pixels(a), pixels(b)]);
        if (first.width !== second.width || first.height !== second.height) {
          return first.width * first.height;
        }
        let count = 0;
        for (let i = 0; i < first.data.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) {
            if (
              Math.abs(first.data[i + channel] - second.data[i + channel]) >
              tolerance
            ) {
              count++;
              break;
            }
          }
        }
        return count;
      },
      { a: a.toString('base64'), b: b.toString('base64'), tolerance },
    );
  } finally {
    await scratch.close();
  }
}

// A screenshot of the page once its typeface has loaded and it has stopped
// changing: two in a row that are the same.
async function settledScreenshot(page: Page): Promise<Buffer> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  let options = { animations: 'disabled', caret: 'hide' } as const;
  let previous = await page.screenshot(options);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    let next = await page.screenshot(options);
    if (next.equals(previous)) {
      return next;
    }
    previous = next;
  }
  return previous;
}

// The newest email to `email` in smtp4dev whose body contains `button`, and
// clicks that button, which opens a page. Returns it.
async function followEmailLink(
  page: Page,
  email: string,
  button: string,
  count = 1,
): Promise<Page> {
  let context = page.context();
  let emailPage = await context.newPage();
  await emailPage.goto(mailHost);
  let messages = emailPage
    .locator('.messagelist .unread')
    .filter({ hasText: email });
  await expect(messages).toHaveCount(count);
  await messages.first().click();
  let body = emailPage.frameLocator('.messageview iframe');
  await expect(body.locator('body')).toContainText(button);
  let opened = context.waitForEvent('page');
  // smtp4dev needs a moment before the link opens a window.
  await emailPage.waitForTimeout(500);
  await body.getByText(button).last().click();
  let linked = await opened;
  await linked.waitForLoadState();
  await emailPage.close();
  return linked;
}

function uniqueName(prefix: string) {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

async function fillRegistration(
  secure: Page,
  { name, email, username }: { name: string; email: string; username: string },
  password = 'mypassword1!',
) {
  await secure.getByLabel('Your Name').fill(name);
  await secure.getByLabel('Email').fill(email);
  await secure.getByLabel('Username').fill(username);
  await secure.getByLabel('Username').blur();
  await expect(secure.locator('[data-test-username-available]')).toBeVisible();
  await secure.getByLabel('Password', { exact: true }).fill(password);
  await secure.getByLabel('Confirm Password').fill(password);
  await secure.getByLabel('Confirm Password').blur();
  await expect(secure.locator('[data-test-password-valid]')).toBeVisible();
  await expect(secure.locator('[data-test-passwords-match]')).toBeVisible();
}

test.describe('The secure origin’s pages', () => {
  test('the sign-in page looks exactly like the app’s', async ({
    page,
  }, testInfo) => {
    // The two pages are drawn in the same browser and compared with each
    // other, pixel for pixel, so neither can drift from the other.
    await page.goto(appURL);
    await expect(page.locator('[data-test-google-login-btn]')).toBeVisible();
    await expect(
      page
        .frameLocator('[data-test-credential-fields-frame]')
        .locator('[data-test-password-field]'),
    ).toBeVisible();
    let app = await settledScreenshot(page);
    await testInfo.attach('app-sign-in', {
      body: app,
      contentType: 'image/png',
    });
    writeFileSync(testInfo.outputPath('app-sign-in.png'), app);

    let secure = await openSecurePage(page, 'mode=sign-in');
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    // The secure page starts with the email field focused, which the app's
    // doesn't; with focus elsewhere, the two match.
    await secure.evaluate(() => (document.activeElement as HTMLElement).blur());
    let secureShot = await settledScreenshot(secure);
    await testInfo.attach('secure-sign-in', {
      body: secureShot,
      contentType: 'image/png',
    });
    writeFileSync(testInfo.outputPath('secure-sign-in.png'), secureShot);
    // The browser may shade a rounded edge a level or two differently from
    // one page to the other (the app's fields are a frame, placed at a
    // fraction of a pixel); anything more than that is a difference.
    expect(
      await differingPixels(page, app, secureShot, PIXEL_TOLERANCE),
      'pixels the secure origin’s sign-in page draws differently from the app’s (compare the attached screenshots)',
    ).toBe(0);
  });

  test('the sign-in page reads and works from the keyboard as the app’s does', async ({
    page,
  }) => {
    let user = await createSubscribedUser('secure-keyboard');
    let secure = await openSecurePage(page, 'mode=sign-in');
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    await expect(secure.locator('[data-test-secure-sign-in-title]')).toHaveText(
      'Sign in to your Boxel Account',
    );
    await expect(
      secure.locator('[data-test-secure-sign-in-subtitle]'),
    ).toHaveText(
      "Use Google to get started in one tap - we'll create your Boxel account if you don't have one yet.",
    );
    await expect(secure.locator('[data-test-secure-google]')).toHaveText(
      'Continue with Google',
    );
    await expect(secure.locator('.divider-label')).toHaveText(
      'or use your email',
    );
    let username = secure.getByLabel('Email Address or Username');
    let password = secure.getByLabel('Password');
    await expect(username).toHaveAttribute('placeholder', 'Your email address');
    await expect(password).toHaveAttribute('placeholder', 'Your password');
    await expect(username).toHaveAttribute('autocomplete', 'username');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(
      secure.locator('[data-test-secure-forgot-password]'),
    ).toHaveText('Forgot password?');
    await expect(secure.locator('.register-prompt-text')).toHaveText(
      "Don't have an account?",
    );
    await expect(secure.locator('[data-test-secure-register]')).toHaveText(
      'Create a new Boxel account',
    );

    // Focus starts in the first field; Sign In waits for both.
    await expect(username).toBeFocused();
    let submit = secure.locator('[data-test-secure-password-submit]');
    await expect(submit).toBeDisabled();
    await secure.keyboard.type(user.username);
    await expect(submit).toBeDisabled();
    await secure.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await secure.keyboard.type('not-the-password');
    await expect(submit).toBeEnabled();
    await secure.keyboard.press('Tab');
    await expect(
      secure.locator('[data-test-secure-forgot-password]'),
    ).toBeFocused();
    await secure.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await secure.keyboard.press('Tab');
    await expect(secure.locator('[data-test-secure-register]')).toBeFocused();
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await secure.keyboard.press('Shift+Tab');
    await expect(secure.locator('[data-test-secure-google]')).toBeFocused();

    // Enter submits; a refused password reads as the app's does, and typing
    // clears it.
    await password.focus();
    await secure.keyboard.press('Enter');
    let error = secure.locator('[data-test-secure-error]');
    await expect(error).toHaveText(
      'Sign-in failed. Please check your credentials and try again.',
    );
    await password.fill(user.password);
    await expect(error).toBeHidden();
    await secure.keyboard.press('Enter');
    expect(await signedInUser(secure)).toBe(user.credentials.userId);
  });

  test('an unknown mode renders nothing', async ({ page }) => {
    let secure = await openSecurePage(page, 'mode=not-a-mode');
    await expect(secure.locator('#secure-shell')).toBeEmpty();
  });

  test('creates an account with an invite code, validating its email', async ({
    page,
  }, testInfo) => {
    let username = uniqueName('secure-reg');
    let email = `${username}@example.com`;
    let secure = await openSecurePage(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-register]').click();
    await expect(secure).toHaveURL(/[?&]mode=register\b/);
    await expect(secure.getByLabel('Your Name')).toBeFocused();
    await expect(secure.locator('[data-test-register-btn]')).toBeDisabled();
    await expect(
      secure.locator('[data-test-secure-field="username"] .accessory.suffix'),
    ).toHaveText(':localhost');
    await snapshot(testInfo, secure, 'secure-register-1-form');

    await fillRegistration(secure, {
      name: 'Secure Registrant',
      email,
      username,
    });
    await snapshot(testInfo, secure, 'secure-register-2-filled');
    await secure.getByLabel('Confirm Password').press('Enter');

    // Synapse requires an invite code here, as staging does.
    let token = secure.getByLabel('Your invite code');
    await expect(token).toBeVisible();
    await expect(token).toBeFocused();
    await snapshot(testInfo, secure, 'secure-register-3-invite');
    await token.fill('not-an-invite-code');
    await secure.keyboard.press('Enter');
    await expect(
      secure.locator(
        '[data-test-secure-field="token"] [data-test-boxel-input-error-message]',
      ),
    ).toBeVisible();
    await snapshot(testInfo, secure, 'secure-register-4-bad-invite');
    await token.fill(REGISTRATION_TOKEN);
    await secure.locator('[data-test-next-btn]').click();

    await expect(secure.locator('[data-test-email-validation]')).toHaveText(
      'Please check your email to complete registration',
    );
    await snapshot(testInfo, secure, 'secure-register-5-check-email');

    let validated = await followEmailLink(secure, email, 'Verify Email');
    // The link lands on the secure origin's own page.
    expect(new URL(validated.url()).origin).toBe(
      new URL(secureOriginURL).origin,
    );
    expect(new URL(validated.url()).searchParams.get('mode')).toBe(
      'verify-email',
    );
    await expect(
      validated.locator('[data-test-email-validated]'),
    ).toBeVisible();
    await snapshot(testInfo, validated, 'secure-register-6-email-validated');

    // The page that asked carries on by itself, and ends signed in.
    let user = await signedInUser(secure);
    expect(user).toBe(`@${username}:localhost`);
    await snapshot(testInfo, secure, 'secure-register-7-signed-in');

    // Set up as the app's first sign-in sets an account up, with the invite
    // code recorded against the new user.
    let [record] = await getSharedSQLExecutor().executeSQL(
      `SELECT matrix_registration_token, session_room_id FROM users WHERE matrix_user_id = '${user}'`,
    );
    expect(record?.matrix_registration_token).toBe(REGISTRATION_TOKEN);
    expect(record?.session_room_id).toBeTruthy();

    // The new account signs in to the app with its password.
    await page.goto(appURL);
    let fields = page.frameLocator('[data-test-credential-fields-frame]');
    await fields.locator('[data-test-username-field]').fill(username);
    await fields.locator('[data-test-password-field]').fill('mypassword1!');
    await page.locator('[data-test-login-btn]').click();
    await expect(
      page.locator('[data-test-operator-mode-stack="0"]'),
    ).toHaveCount(1);
  });

  test('creating an account checks each field as the app’s form does', async ({
    page,
  }) => {
    let taken = await createSubscribedUser('secure-taken');
    let secure = await openSecurePage(page, 'mode=register');
    let usernameField = '[data-test-secure-field="username"]';
    let error = (field: string) =>
      secure.locator(`${field} [data-test-boxel-input-error-message]`);

    await secure.getByLabel('Your Name').focus();
    await secure.getByLabel('Your Name').blur();
    await expect(error('[data-test-secure-field="name"]')).toHaveText(
      'Your name is missing',
    );
    await secure.getByLabel('Email').focus();
    await secure.getByLabel('Email').blur();
    await expect(error('[data-test-secure-field="email"]')).toHaveText(
      'Email address is missing',
    );
    for (let [value, message] of [
      ['_underscore', 'Username cannot start with an underscore'],
      ['realm/name', 'Username cannot start with "realm/"'],
      [taken.username, 'Username is already taken'],
    ]) {
      await secure.getByLabel('Username').fill(value);
      await secure.getByLabel('Username').blur();
      await expect(error(usernameField)).toHaveText(message);
    }
    await secure.getByLabel('Password', { exact: true }).fill('short');
    await secure.getByLabel('Password', { exact: true }).blur();
    await expect(error('[data-test-secure-field="password"]')).toHaveText(
      'Password must be at least 8 characters long',
    );
    await secure.getByLabel('Password', { exact: true }).fill('longenough1');
    await secure.getByLabel('Confirm Password').fill('different1');
    await secure.getByLabel('Confirm Password').blur();
    await expect(
      error('[data-test-secure-field="confirm-password"]'),
    ).toHaveText('Passwords do not match');
    await expect(secure.locator('[data-test-register-btn]')).toBeDisabled();

    // An email address another account holds is refused.
    let heldEmail = `${taken.username}@example.com`;
    await updateSynapseUser(taken.credentials.userId, {
      emailAddresses: [heldEmail],
    });
    await fillRegistration(secure, {
      name: 'Second Registrant',
      email: heldEmail,
      username: uniqueName('secure-dup'),
    });
    await secure.locator('[data-test-register-btn]').click();
    await expect(error('[data-test-secure-field="email"]')).toHaveText(
      'Email address is already attached to a Boxel account',
    );
  });

  test('creates an account without an invite step where registration is open', async ({
    page,
  }) => {
    // Production's Matrix server doesn't ask for an invite code. This suite's
    // does, so here the server is shown to the page as an open one: each
    // registration request the page makes has its invite stage completed
    // first, out of the page's sight, and the stage is taken out of every
    // answer the page sees. The page follows the stages it is given, so it
    // never shows the invite step.
    let completedInvite = new Set<string>();
    await page
      .context()
      .route(
        `${MATRIX_URL}/_matrix/client/v3/register`,
        async (route: Route) => {
          let request = route.request();
          if (request.method() !== 'POST') {
            await route.continue();
            return;
          }
          let body = request.postDataJSON();
          let session = body?.auth?.session;
          if (session && !completedInvite.has(session)) {
            await fetch(`${MATRIX_URL}/_matrix/client/v3/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: body.username,
                password: body.password,
                auth: {
                  type: 'm.login.registration_token',
                  token: REGISTRATION_TOKEN,
                  session,
                },
              }),
            });
            completedInvite.add(session);
          }
          let response = await route.fetch();
          let json = await response.json();
          if (response.status() === 401 && Array.isArray(json.flows)) {
            json.flows = json.flows.map((flow: { stages: string[] }) => ({
              ...flow,
              stages: flow.stages.filter(
                (stage) => stage !== 'm.login.registration_token',
              ),
            }));
            json.completed = (json.completed ?? []).filter(
              (stage: string) => stage !== 'm.login.registration_token',
            );
          }
          await route.fulfill({ response, json });
        },
      );

    let username = uniqueName('secure-open');
    let email = `${username}@example.com`;
    let secure = await openSecurePage(page, 'mode=register');
    await fillRegistration(secure, {
      name: 'Open Registrant',
      email,
      username,
    });
    await secure.locator('[data-test-register-btn]').click();
    await expect(secure.locator('[data-test-email-validation]')).toBeVisible();
    await expect(secure.locator('[data-test-token-field]')).toBeHidden();
    await followEmailLink(secure, email, 'Verify Email');
    expect(await signedInUser(secure)).toBe(`@${username}:localhost`);
    let [record] = await getSharedSQLExecutor().executeSQL(
      `SELECT matrix_registration_token FROM users WHERE matrix_user_id = '@${username}:localhost'`,
    );
    expect(record?.matrix_registration_token ?? null).toBeNull();
  });

  test('resets a forgotten password', async ({ page }, testInfo) => {
    let user = await createSubscribedUser('secure-reset');
    let email = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [email],
    });

    let secure = await openSecurePage(page, 'mode=sign-in');
    await secure.locator('[data-test-secure-forgot-password]').click();
    await expect(secure).toHaveURL(/[?&]mode=forgot-password\b/);
    await snapshot(testInfo, secure, 'secure-reset-1-forgot');

    // An address no account holds is refused.
    await secure.getByLabel('Email Address').fill('nobody@example.com');
    await secure.locator('[data-test-reset-your-password-btn]').click();
    await expect(
      secure.locator('[data-test-boxel-input-error-message]'),
    ).toHaveText('No account with the given email address exists');

    await secure.getByLabel('Email Address').fill(email);
    await secure.keyboard.press('Enter');
    await expect(secure.locator('[data-test-email-validation]')).toHaveText(
      'Please check your email to reset your password',
    );
    await snapshot(testInfo, secure, 'secure-reset-2-check-email');

    let confirm = await followEmailLink(secure, email, 'Reset Password');
    await confirm.getByText('Confirm changing my password').click();
    await expect(
      confirm.locator('[data-test-reset-password-btn]'),
    ).toBeVisible();
    let landed = new URL(confirm.url());
    expect(landed.origin).toBe(new URL(secureOriginURL).origin);
    expect(landed.searchParams.get('mode')).toBe('reset-password');
    expect(landed.searchParams.has('clientSecret')).toBe(false);
    expect(landed.hash).toBe('');
    await snapshot(testInfo, confirm, 'secure-reset-3-new-password');

    let newPassword = 'a-new-password-1';
    await confirm
      .getByLabel('Enter New Password', { exact: true })
      .fill('short');
    await confirm.getByLabel('Re-Enter New Password').fill('short');
    await confirm.getByLabel('Re-Enter New Password').blur();
    await expect(
      confirm.locator('[data-test-reset-password-btn]'),
    ).toBeDisabled();
    await confirm
      .getByLabel('Enter New Password', { exact: true })
      .fill(newPassword);
    await confirm.getByLabel('Re-Enter New Password').fill(newPassword);
    await confirm.locator('[data-test-reset-password-btn]').click();
    await expect(
      confirm.locator('[data-test-reset-password-success]'),
    ).toHaveText('Your password is now reset');
    await snapshot(testInfo, confirm, 'secure-reset-4-done');

    await confirm.locator('[data-test-back-to-login-btn]').click();
    await confirm.getByLabel('Email Address or Username').fill(user.username);
    await confirm.getByLabel('Password').fill(newPassword);
    await confirm.keyboard.press('Enter');
    expect(await signedInUser(confirm)).toBe(user.credentials.userId);
  });
});
