import { writeFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { Frame, Page, TestInfo } from '@playwright/test';
import { appURL, secureOriginURL } from '../support/isolated-realm-server.ts';
import {
  REGISTRATION_TOKEN,
  createSubscribedUser,
  getSharedSQLExecutor,
  updateSynapseUser,
} from '../helpers/index.ts';
import {
  fillRegistration,
  followEmailLink,
  keyWriteTicketStatus,
  openSecurePage,
  signInSecureSession,
  signedInUser,
  uniqueName,
} from '../helpers/secure-origin-pages.ts';

// The secure origin's sign-in, account creation and password reset pages:
// the app's own screens, drawn the same and worded the same, on an origin card
// code can't reach. These drive them in a real browser against real Synapse,
// with its email going to smtp4dev. That Synapse asks for an invite code;
// creating an account where it asks for none is
// with-synapse/test-without-registration-token/secure-origin-open-registration.spec.ts.

async function snapshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

// How far apart, in any colour channel out of 255, two pixels may be and
// still count as the same: the browser may shade a rounded edge, or the
// fringe of a glyph, a little differently from one page to the other. A
// shifted or restyled element differs by far more.
const PIXEL_TOLERANCE = 32;

// How many pixels of two same-sized screenshots differ by more than
// `tolerance` in any colour channel, decoded and compared in a blank page.
async function differingPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  tolerance: number,
  skip?: { x: number; y: number; width: number; height: number },
): Promise<number> {
  let scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(
      async ({ a, b, tolerance, skip }) => {
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
          let x = (i / 4) % first.width;
          let y = Math.floor(i / 4 / first.width);
          if (
            skip &&
            x >= Math.floor(skip.x) &&
            x < Math.ceil(skip.x + skip.width) &&
            y >= Math.floor(skip.y) &&
            y < Math.ceil(skip.y + skip.height)
          ) {
            continue;
          }
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
      { a: a.toString('base64'), b: b.toString('base64'), tolerance, skip },
    );
  } finally {
    await scratch.close();
  }
}

async function expectAppFields(page: Page) {
  await expect(
    page
      .frameLocator('[data-test-credential-fields-frame]')
      .locator('[data-test-password-field]'),
  ).toBeVisible();
}

// The app's page and the secure origin's, drawn in the same browser, are
// compared with each other pixel for pixel, so neither can drift from the
// other. Both screenshots are attached, and kept with the test's results.
//
// The app draws its password fields in a frame, and the browser may place the
// frame's text a pixel apart from the same text drawn in a page, so the
// frame's area is left out of the pixel comparison. Its fields are compared
// instead by where each label and input is, to a hundredth of a pixel, and by
// how each is styled.
async function expectSamePixels(
  testInfo: TestInfo,
  name: string,
  app: Page,
  secure: Page,
) {
  let frame = app.locator('[data-test-credential-fields-frame]');
  let frameBox = (await frame.count()) > 0 ? await frame.boundingBox() : null;
  let shots: Buffer[] = [];
  // Nothing hovered on either page.
  await app.mouse.move(0, 0);
  await secure.mouse.move(0, 0);
  for (let [side, page] of [
    ['app', app],
    ['secure', secure],
  ] as const) {
    let shot = await settledScreenshot(page);
    await testInfo.attach(`${side}-${name}`, {
      body: shot,
      contentType: 'image/png',
    });
    writeFileSync(testInfo.outputPath(`${side}-${name}.png`), shot);
    shots.push(shot);
  }
  if (frameBox) {
    let appFrame = (await (await frame.elementHandle())!.contentFrame())!;
    let appFields = await fieldLayout(appFrame, frameBox);
    expect(appFields.length).toBeGreaterThan(0);
    expect(
      await fieldLayout(
        secure,
        { x: 0, y: 0 },
        appFields.map(({ name }) => name),
      ),
      `the secure origin's ${name} page lays out and styles the password fields as the app's do`,
    ).toEqual(appFields);
  }
  expect(
    await differingPixels(
      app,
      shots[0],
      shots[1],
      PIXEL_TOLERANCE,
      frameBox ?? undefined,
    ),
    `pixels the secure origin's ${name} page draws differently from the app's (compare the attached screenshots)`,
  ).toBe(0);
}

// Where each visible input and its label are, offset by `origin`, and how
// they're styled, by the input's name: all of them, or those `names` lists.
async function fieldLayout(
  target: Page | Frame,
  origin: { x: number; y: number },
  names?: string[],
) {
  return await target.evaluate(
    ({ origin, names }) => {
      let round = (n: number) => Math.round(n * 100) / 100;
      let box = (element: Element) => {
        let r = element.getBoundingClientRect();
        return [
          round(r.x + origin.x),
          round(r.y + origin.y),
          round(r.width),
          round(r.height),
        ];
      };
      let style = (element: Element) => {
        let s = getComputedStyle(element);
        return [
          s.font,
          s.letterSpacing,
          s.color,
          s.backgroundColor,
          s.border,
          s.borderRadius,
          s.padding,
        ].join(' | ');
      };
      let inputs = [
        ...document.querySelectorAll<HTMLInputElement>('input[name]'),
      ].filter(
        (input) => !input.hidden && (!names || names.includes(input.name)),
      );
      return inputs.map((input) => {
        let label = input
          .closest('[data-test-boxel-field]')
          ?.querySelector('[data-test-boxel-field-label]');
        return {
          name: input.name,
          input: box(input),
          inputStyle: style(input),
          placeholder: input.placeholder,
          label: label ? box(label) : null,
          labelStyle: label ? style(label) : null,
          labelText: label?.textContent?.trim() ?? null,
        };
      });
    },
    { origin, names },
  );
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

test.describe('The secure origin’s pages', () => {
  test('the sign-in page looks exactly like the app’s', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await expect(page.locator('[data-test-google-login-btn]')).toBeVisible();
    await expectAppFields(page);
    let secure = await openSecurePage(page, 'mode=sign-in');
    await expect(secure.locator('[data-test-secure-google]')).toBeVisible();
    // The secure page starts with the email field focused, which the app's
    // doesn't; with focus elsewhere, the two match.
    await secure.evaluate(() => (document.activeElement as HTMLElement).blur());
    await expectSamePixels(testInfo, 'sign-in', page, secure);
  });

  test('the account creation page looks exactly like the app’s', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.locator('[data-test-register-user]').click();
    await expectAppFields(page);
    // Leaving the name empty shows its error, on both pages.
    await page.locator('[data-test-name-field]').focus();
    await page.locator('[data-test-name-field]').blur();
    let secure = await openSecurePage(page, 'mode=register');
    await expect(
      secure.locator(
        '[data-test-secure-field="username"] [data-test-input-group-suffix]',
      ),
    ).toHaveText('localhost');
    await secure.getByLabel('Your Name').blur();
    await expect(
      secure.locator('[data-test-boxel-input-error-message]'),
    ).toHaveText('Your name is missing');
    await expectSamePixels(testInfo, 'register', page, secure);
  });

  test('the forgotten password page looks exactly like the app’s', async ({
    page,
  }, testInfo) => {
    await page.goto(appURL);
    await page.locator('[data-test-forgot-password]').click();
    await page.locator('[data-test-email-field]').focus();
    let secure = await openSecurePage(page, 'mode=forgot-password');
    await expect(secure.getByLabel('Email Address')).toBeFocused();
    await expectSamePixels(testInfo, 'forgot-password', page, secure);
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
    await expect(secure.locator('[data-test-secure-divider-label]')).toHaveText(
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
    await expect(
      secure.locator('[data-test-secure-register-prompt]'),
    ).toHaveText("Don't have an account?");
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
      secure.locator(
        '[data-test-secure-field="username"] [data-test-input-group-suffix]',
      ),
    ).toHaveText('localhost');
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
    ).toHaveText(
      'This registration token does not exist or has exceeded its usage limit.',
    );
    await snapshot(testInfo, secure, 'secure-register-4-bad-invite');
    await token.fill(REGISTRATION_TOKEN);
    // The account's first sign-in fails once; trying again from the same page
    // still records the invite code.
    let failedOnce = false;
    await secure.route(
      new URL('/_secure-session', appURL).href,
      async (route) => {
        if (!failedOnce && route.request().method() === 'POST') {
          failedOnce = true;
          await route.fulfill({
            status: 503,
            contentType: 'application/vnd.api+json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            json: {
              errors: [
                {
                  status: '503',
                  code: 'unavailable',
                  detail:
                    'signing in is unavailable right now; try again later',
                },
              ],
            },
          });
          return;
        }
        await route.continue();
      },
    );
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

    // The page that asked carries on by itself, and ends signed in, once the
    // failed sign-in is tried again.
    await expect(secure.locator('[data-test-secure-error]')).toHaveText(
      'Signing in is unavailable right now; try again later.',
      { timeout: 60000 },
    );
    await secure.locator('[data-test-secure-retry-sign-in]').click();
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

  test('resets a forgotten password', async ({ page }, testInfo) => {
    let user = await createSubscribedUser('secure-reset');
    let email = `${user.username}@example.com`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [email],
    });
    // A secure session signed in with the old password, as whoever it leaked
    // to would have.
    let oldSession = await signInSecureSession(
      page,
      user.username,
      user.password,
    );
    expect(await keyWriteTicketStatus(page, oldSession)).toBe(201);

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
    expect(
      await keyWriteTicketStatus(page, oldSession),
      'the reset ended the secure session signed in with the old password',
    ).toBe(403);

    await confirm.locator('[data-test-back-to-login-btn]').click();
    await confirm.getByLabel('Email Address or Username').fill(user.username);
    await confirm.getByLabel('Password').fill(newPassword);
    await confirm.keyboard.press('Enter');
    expect(await signedInUser(confirm)).toBe(user.credentials.userId);
  });
});
