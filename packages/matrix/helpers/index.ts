import { expect, type Page } from '@playwright/test';
import { type SynapseInstance } from '../docker/synapse';
import { registerUser } from '../docker/synapse';
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

export async function registerRealmUsers(synapse: SynapseInstance) {
  await registerUser(synapse, 'base_realm', 'password');
  await registerUser(synapse, 'drafts_realm', 'password');
  await registerUser(synapse, 'published_realm', 'password');
  await registerUser(synapse, 'test_realm', 'password');
  await registerUser(synapse, 'node-test_realm', 'password');
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
  }
}

export async function logout(page: Page) {
  await page.locator('[data-test-profile-icon-button]').click();
  await page.locator('[data-test-signout-button]').click();
  await expect(page.locator('[data-test-login-btn]')).toHaveCount(1);
}

export async function createRoom(page: Page, name?: string) {
  let roomName: string;
  await page.locator('[data-test-create-room-mode-btn]').click();
  if (name) {
    roomName = name;
    await page.locator('[data-test-room-name-field]').fill(name);
  } else {
    roomName = await page.locator('[data-test-room-name-field]').inputValue();
  }
  await page.locator('[data-test-create-room-btn]').click();
  await isInRoom(page, roomName);
  return roomName;
}

export async function isInRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-room-name="${roomName}"]`).waitFor();
  await expect(page.locator(`[data-test-room-settled]`)).toHaveCount(1);
}

export async function leaveRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-leave-room-btn="${roomName}"]`).click();
}

export async function openRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-past-sessions-button]`).click(); // toggle past sessions on
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

export async function selectCardFromCatalog(page: Page, cardId: string) {
  await page.locator('[data-test-choose-card-btn]').click();
  await page.locator(`[data-test-select="${cardId}"]`).click();
  await page.locator('[data-test-card-catalog-go-button]').click();
}

export async function sendMessage(
  page: Page,
  roomName: string,
  message: string | undefined,
  cardIds?: string[],
) {
  if (message == null && cardIds == null) {
    throw new Error(
      `sendMessage requires at least a message or a card ID be specified`,
    );
  }
  if (message != null) {
    await writeMessage(page, roomName, message);
  }
  if (cardIds?.length) {
    await Promise.all(cardIds.map((id) => selectCardFromCatalog(page, id)));
  }
  // can we check it's higher than before?
  await page.waitForSelector(`[data-test-room-settled]`);
  await page.locator('[data-test-send-message-btn]').click();
}

export async function assertMessages(
  page: Page,
  messages: {
    from: string;
    message?: string;
    cards?: { id: string; title?: string }[];
  }[],
) {
  await expect(page.locator('[data-test-message-idx]')).toHaveCount(
    messages.length,
  );
  for (let [index, { from, message, cards }] of messages.entries()) {
    await expect(
      page.locator(
        `[data-test-message-idx="${index}"][data-test-boxel-message-from="${from}"]`,
      ),
    ).toHaveCount(1);
    if (message != null) {
      await expect(
        page.locator(`[data-test-message-idx="${index}"] .content`),
      ).toContainText(message);
    }
    if (cards?.length) {
      await expect(page.locator(`[data-test-message-cards]`)).toHaveCount(1);
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"] [data-test-message-card]`,
        ),
      ).toHaveCount(cards.length);
      cards.map(async (card) => {
        if (card.title) {
          if (message != null && card.title.includes(message)) {
            throw new Error(
              `This is not a good test since the message '${message}' overlaps with the asserted card text '${card.title}'`,
            );
          }
          // note: attached cards are in atom format (which display the title by default)
          await expect(
            page.locator(
              `[data-test-message-idx="${index}"] [data-test-message-card="${card.id}"]`,
            ),
          ).toContainText(card.title);
        }
      });
    } else {
      await expect(page.locator(`[data-test-message-cards]`)).toHaveCount(0);
    }
  }
}

export async function assertRooms(page: Page, rooms: string[]) {
  await page.locator(`[data-test-past-sessions-button]`).click(); // toggle past sessions on
  if (rooms && rooms.length > 0) {
    await page.waitForFunction(
      (rooms) =>
        document.querySelectorAll('[data-test-joined-room]').length ===
        rooms.length,
      rooms,
    );
    rooms.map(
      async (name) =>
        await expect(
          page.locator(`[data-test-joined-room="${name}"]`),
          `the joined room '${name}' is displayed`,
        ).toHaveCount(1),
    );
  } else {
    await expect(
      page.locator('[data-test-joined-room]'),
      `joined rooms are not displayed`,
    ).toHaveCount(0);
  }
  await page.locator(`[data-test-close-past-sessions]`).click();
}

export async function assertLoggedIn(page: Page, opts?: ProfileAssertions) {
  await page.locator('[data-test-profile-icon-button]').click();

  await expect(
    page.locator('[data-test-username-field]'),
    'username field is not displayed',
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is not displayed',
  ).toHaveCount(0);

  await expect(page.locator('[data-test-profile-display-name]')).toContainText(
    opts?.displayName ?? 'user1',
  );
  await expect(page.locator('[data-test-profile-icon-handle]')).toContainText(
    opts?.userId ?? '@user1:localhost',
  );

  if (opts?.email) {
    await page.locator('[data-test-settings-button]').click();
    await expect(page.locator('[data-test-current-email]')).toContainText(
      opts.email,
    );
    await page.locator('[data-test-confirm-cancel-button]').click(); // close settings modal + popover
  } else {
    await page.locator('[data-test-profile-icon-button]').click(); // close profile popover
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
