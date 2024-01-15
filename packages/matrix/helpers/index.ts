import { expect, type Page, test as base } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
export const testHost = 'http://localhost:4202/test';
export const mailHost = 'http://localhost:5001';

interface ProfileAssertions {
  userId?: string;
  displayName?: string;
  email?: string;
}
interface LoginOptions {
  expectFailure?: true;
}

export const test = base.extend<{ synapse: SynapseInstance }>({
  // eslint-disable-next-line no-empty-pattern
  synapse: async ({}, use) => {
    let synapseInstance = await synapseStart();
    await use(synapseInstance);
    await synapseStop(synapseInstance.synapseId);
  },

  page: async ({ page, synapse }, use) => {
    // Setup overrides
    await setupMatrixOverride(page, synapse);
    await use(page);
  },
});

export async function setupMatrixOverride(
  page: Page,
  synapse: SynapseInstance,
) {
  // Save the original goto function keeping mind this override function may be
  // called more than once
  const originalGoto = (page as any).originalGoto ?? page.goto.bind(page);
  (page as any).originalGoto = originalGoto;

  // Patch the goto function
  page.goto = async (url, options) => {
    const newUrl = new URL(url);
    const params = new URLSearchParams(newUrl.search);

    // Override the matrixURL
    params.set('matrixURL', `http://localhost:${synapse.mappedPort}`);
    newUrl.search = params.toString();

    // Call the original goto function with the new URL
    return await originalGoto(newUrl.href, options);
  };

  // Patch the reload function
  page.reload = async (options) => {
    return await page.goto(page.url(), options);
  };
}

export async function reloadAndOpenAiAssistant(page: Page) {
  await page.reload();
  await openAiAssistant(page);
}

export async function toggleOperatorMode(page: Page) {
  await page.locator('[data-test-operator-mode-btn]').click();
}

export async function openAiAssistant(page: Page) {
  await page.locator('[data-test-open-ai-assistant]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-test-close-ai-panel]'),
  );
}

export async function openRoot(page: Page) {
  await page.goto(testHost);
}

export async function clearLocalStorage(page: Page) {
  await openRoot(page);
  await page.evaluate(() => window.localStorage.clear());
}

export async function validateEmail(
  appPage: Page,
  email: string,
  opts?: {
    onEmailPage?: (page: Page) => Promise<void>;
    onValidationPage?: (page: Page) => Promise<void>;
    sendAttempts?: number;
    isLoggedInWhenValidated?: true;
    onAppTrigger?: (page: Page) => Promise<void>;
  },
) {
  let sendAttempts = opts?.sendAttempts ?? 1;
  if (opts?.onAppTrigger) {
    await opts.onAppTrigger(appPage);
  } else {
    await expect(appPage.locator('[data-test-email-validation]')).toContainText(
      'Please check your email to complete registration.',
    );
  }

  for (let i = 0; i < sendAttempts - 1; i++) {
    await appPage.waitForTimeout(500);
    await appPage.locator('[data-test-resend-validation]').click();
  }

  let context = appPage.context();
  let emailPage = await context.newPage();
  await emailPage.goto(mailHost);
  await expect(
    emailPage.locator('.messagelist .unread').filter({ hasText: email }),
  ).toHaveCount(sendAttempts);
  await emailPage
    .locator('.messagelist .unread')
    .filter({ hasText: email })
    .first()
    .click();
  await expect(
    emailPage.frameLocator('.messageview iframe').locator('body'),
  ).toContainText('Verify Email');
  await expect(
    emailPage.locator('.messageview .messageviewheader'),
  ).toContainText(`To:${email}`);

  if (opts?.onEmailPage) {
    await opts.onEmailPage(emailPage);
  }

  const validationPagePromise = context.waitForEvent('page');
  let textBtn = emailPage
    .frameLocator('.messageview iframe')
    .getByText('Verify Email');
  // We have to delay before going to validation window
  // to avoid the validation window won't open
  await emailPage.waitForTimeout(500);
  await textBtn.click();

  const validationPage = await validationPagePromise;
  await validationPage.waitForLoadState();
  if (opts?.onValidationPage) {
    await opts.onValidationPage(validationPage);
  }
}

export async function validateEmailForResetPassword(
  appPage: Page,
  email: string,
  opts?: {
    onEmailPage?: (page: Page) => Promise<void>;
    onValidationPage?: (page: Page) => Promise<void>;
    sendAttempts?: number;
    isLoggedInWhenValidated?: true;
  },
): Promise<Page> {
  let sendAttempts = opts?.sendAttempts ?? 1;
  await expect(appPage.locator('[data-test-email-validation]')).toContainText(
    'Please check your email to reset your password',
  );

  for (let i = 0; i < sendAttempts - 1; i++) {
    await appPage.waitForTimeout(500);
    await appPage.locator('[data-test-resend-validation-btn]').click();
  }

  let context = appPage.context();
  let emailPage = await context.newPage();
  await emailPage.goto(mailHost);
  await expect(
    emailPage.locator('.messagelist .unread').filter({ hasText: email }),
  ).toHaveCount(sendAttempts);
  await emailPage
    .locator('.messagelist .unread')
    .filter({ hasText: email })
    .first()
    .click();
  await expect(
    emailPage.frameLocator('.messageview iframe').locator('body'),
  ).toContainText('Reset Password');
  await expect(
    emailPage.locator('.messageview .messageviewheader'),
  ).toContainText(`To:${email}`);

  if (opts?.onEmailPage) {
    await opts.onEmailPage(emailPage);
  }

  const pagePromise = context.waitForEvent('page');
  let btn = emailPage
    .frameLocator('.messageview iframe')
    .getByText('Reset Password')
    .last();
  // We have to delay before going to validation window
  // to avoid the validation window won't open
  await emailPage.waitForTimeout(500);
  await btn.click();

  const validationPage = await pagePromise;
  await validationPage.waitForLoadState();
  if (opts?.onValidationPage) {
    await opts.onValidationPage(validationPage);
  }
  let validationBtn = validationPage
    .locator('body')
    .getByText('Confirm changing my password');
  await validationPage.waitForTimeout(500);
  await validationBtn.click();

  const resetPasswordPage = await pagePromise;
  await resetPasswordPage.waitForLoadState();
  return resetPasswordPage;
}

export async function gotoRegistration(page: Page) {
  await openRoot(page);
  await toggleOperatorMode(page);
  await page.locator('[data-test-register-user]').click();
  await expect(page.locator('[data-test-register-btn]')).toHaveCount(1);
}

export async function gotoForgotPassword(page: Page) {
  await openRoot(page);
  await toggleOperatorMode(page);
  await page.locator('[data-test-forgot-password]').click();
  await expect(page.locator('[data-test-reset-your-password-btn]')).toHaveCount(
    1,
  );
}

export async function login(
  page: Page,
  username: string,
  password: string,
  opts?: LoginOptions,
) {
  await openRoot(page);
  await toggleOperatorMode(page);
  await page.waitForFunction(() =>
    document.querySelector('[data-test-username-field]'),
  );
  await page.locator('[data-test-username-field]').fill(username);
  await page.locator('[data-test-password-field]').fill(password);
  await page.locator('[data-test-login-btn]').click();

  if (opts?.expectFailure) {
    await expect(page.locator('[data-test-login-error]')).toHaveCount(1);
  } else {
    await openAiAssistant(page);
    await expect(page.locator('[data-test-rooms-list]')).toHaveCount(1);
  }
}

export async function logout(page: Page) {
  await page.locator('[data-test-profile-icon-button]').click();
  await page.locator('[data-test-signout-button]').click();
  await expect(page.locator('[data-test-login-btn]')).toHaveCount(1);
}

export async function register(
  page: Page,
  name: string,
  email: string,
  username: string,
  password: string,
  registrationToken?: string,
) {
  await expect(
    page.locator('[data-test-token-field]'),
    'token field is not displayed',
  ).toHaveCount(0);
  await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
  await page.locator('[data-test-name-field]').fill(name);
  await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
  await page.locator('[data-test-email-field]').fill(email);
  await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
  await page.locator('[data-test-username-field]').fill(username);
  await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
  await page.locator('[data-test-password-field]').fill(password);
  await expect(page.locator('[data-test-register-btn]')).toBeDisabled();
  await page.locator('[data-test-confirm-password-field]').fill(password);
  await expect(page.locator('[data-test-register-btn]')).toBeEnabled();
  await page.locator('[data-test-register-btn]').click();

  if (registrationToken) {
    await expect(page.locator('[data-test-token-field]')).toHaveCount(1);
    await expect(
      page.locator('[data-test-username-field]'),
      'username field is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-next-btn]')).toBeDisabled();
    await page.locator('[data-test-token-field]').fill(registrationToken);
    await expect(page.locator('[data-test-next-btn]')).toBeEnabled();
    await page.locator('[data-test-next-btn]').click();
  }

  await validateEmail(page, email);

  await openAiAssistant(page);
  await assertLoggedIn(page, { email, displayName: name });
  await logout(page);
  await assertLoggedOut(page);
}

export async function createRoom(
  page: Page,
  roomDetails: { name: string; invites?: string[] },
) {
  await page.locator('[data-test-create-room-mode-btn]').click();
  await page.locator('[data-test-room-name-field]').fill(roomDetails.name);
  await page.locator('[data-test-create-room-btn]').click();
  await isInRoom(page, roomDetails.name);

  if (roomDetails.invites && roomDetails.invites.length > 0) {
    await page.locator('[data-test-invite-mode-btn]').click();
    await page
      .locator('[data-test-room-invite-field]')
      .fill(roomDetails.invites.join(', '));
    await expect(page.locator('[data-test-room-invite-btn]')).toBeEnabled();
    await page.locator('[data-test-room-invite-btn]').click();
  }
}

export async function isInRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-room-name="${roomName}"]`).waitFor();
  await expect(page.locator(`[data-test-room-settled]`)).toHaveCount(1);
}

export async function joinRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-join-room-btn="${roomName}"]`).click();
}

export async function leaveRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-leave-room-btn="${roomName}"]`).click();
}

export async function openRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-enter-room="${roomName}"]`).click();
  await isInRoom(page, roomName);
}

export async function writeMessage(
  page: Page,
  roomName: string,
  message: string,
) {
  await page.locator(`[data-test-message-field="${roomName}"]`).fill(message);
  await expect(
    page.locator(`[data-test-message-field="${roomName}"]`),
  ).toHaveValue(message);
}

export async function setObjective(page: Page, objectiveURI: string) {
  await page.locator(`[data-test-set-objective-btn]`).click();
  await page.locator(`[data-test-select="${objectiveURI}"]`).click();
  await page.locator('[data-test-card-catalog-go-button]').click();
  await expect(page.locator(`[data-test-room-settled]`)).toHaveCount(1);
  await expect(page.locator(`[data-test-objective]`)).toHaveCount(1);
}

export async function sendMessage(
  page: Page,
  roomName: string,
  message: string | undefined,
  cardId?: string,
) {
  if (message == null && cardId == null) {
    throw new Error(
      `sendMessage requires at least a message or a card ID be specified`,
    );
  }
  if (message != null) {
    await writeMessage(page, roomName, message);
  }
  if (cardId != null) {
    await page.locator('[data-test-choose-card-btn]').click();
    await page.locator(`[data-test-select="${cardId}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
  }
  // can we check it's higher than before?
  await expect(page.locator(`[data-test-room-settled]`)).toHaveCount(1);
  await page.locator('[data-test-send-message-btn]').click();
}

export async function inviteToRoom(page: Page, invites: string[]) {
  await page.locator(`[data-test-invite-mode-btn]`).click();
  await page.locator('[data-test-room-invite-field]').fill(invites.join(', '));
  await page.locator('[data-test-room-invite-btn]').click();
}

export async function assertMessages(
  page: Page,
  messages: {
    from: string;
    message?: string;
    card?: { id: string; text?: string };
  }[],
) {
  await expect(page.locator('[data-test-message-index]')).toHaveCount(
    messages.length,
  );
  for (let [index, { from, message, card }] of messages.entries()) {
    await expect(
      page.locator(
        `[data-test-message-index="${index}"][data-test-boxel-message-from="${from}"]`,
      ),
    ).toHaveCount(1);
    if (message != null) {
      await expect(
        page.locator(`[data-test-message-index="${index}"] .content`),
      ).toContainText(message);
    }
    if (card) {
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"][data-test-message-card="${card.id}"]`,
        ),
      ).toHaveCount(1);
      if (card.text) {
        if (message != null && card.text.includes(message)) {
          throw new Error(
            `This is not a good test since the message '${message}' overlaps with the asserted card text '${card.text}'`,
          );
        }
        await expect(
          page.locator(
            `[data-test-message-idx="${index}"][data-test-message-card="${card.id}"]`,
          ),
        ).toContainText(card.text);
      }
    } else {
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"][data-test-message-card]`,
        ),
      ).toHaveCount(0);
    }
  }
}

interface RoomAssertions {
  joinedRooms?: { name: string }[];
  invitedRooms?: { name: string; sender: string }[];
}

export async function assertRooms(page: Page, rooms: RoomAssertions) {
  if (rooms.joinedRooms && rooms.joinedRooms.length > 0) {
    await page.waitForFunction(
      (rooms: RoomAssertions) =>
        document.querySelectorAll('[data-test-joined-room]').length ===
        rooms.joinedRooms!.length,
      rooms,
    );
    for (let { name } of rooms.joinedRooms) {
      await expect(
        page.locator(`[data-test-joined-room="${name}"]`),
        `the joined room '${name}' is displayed`,
      ).toHaveCount(1);
    }
  } else {
    await expect(
      page.locator('[data-test-joined-room]'),
      `joined rooms are not displayed`,
    ).toHaveCount(0);
  }
  if (rooms.invitedRooms && rooms.invitedRooms.length > 0) {
    await page.waitForFunction(
      (rooms: RoomAssertions) =>
        document.querySelectorAll('[data-test-invited-room]').length ===
        rooms.invitedRooms!.length,
      rooms,
    );
    for (let { name, sender } of rooms.invitedRooms) {
      await expect(
        page.locator(
          `[data-test-invited-room="${name}"] [data-test-invite-sender="${sender}"]`,
        ),
        `the invited room '${name}' from '${sender}' is displayed`,
      ).toHaveCount(1);
    }
  } else {
    await expect(
      page.locator('[data-test-invited-room]'),
      `invited rooms are not displayed`,
    ).toHaveCount(0);
  }
}

export async function assertLoggedIn(page: Page, opts?: ProfileAssertions) {
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is not displayed',
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is not displayed',
  ).toHaveCount(0);
  await expect(page.locator('[data-test-field-value="userId"]')).toContainText(
    opts?.userId ?? '@user1:localhost',
  );
  await expect(
    page.locator('[data-test-field-value="displayName"]'),
  ).toContainText(opts?.displayName ?? 'user1');
  if (opts?.email) {
    await expect(page.locator('[data-test-field-value="email"]')).toHaveText(
      opts.email,
    );
  }
}

export async function assertLoggedOut(page: Page) {
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is displayed',
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is displayed',
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-field-value="userId"]'),
    'user profile - user ID is not displayed',
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-field-value="displayName"]'),
    'user profile - display name is not displayed',
  ).toHaveCount(0);
}
