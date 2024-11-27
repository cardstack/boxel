import { expect, type Page } from '@playwright/test';
import {
  loginUser,
  getAllRoomEvents,
  getJoinedRooms,
  type SynapseInstance,
  sync,
} from '../docker/synapse';
import { realmPassword } from './realm-credentials';
import { registerUser } from '../docker/synapse';
import { IsolatedRealmServer } from './isolated-realm-server';

export const testHost = 'http://localhost:4202/test';
export const mailHost = 'http://localhost:5001';
export const initialRoomName = 'New AI Assistant Chat';

const realmSecretSeed = "shhh! it's a secret";

interface ProfileAssertions {
  userId?: string;
  displayName?: string;
  email?: string;
}
interface LoginOptions {
  url?: string;
  expectFailure?: true;
  skipOpeningAssistant?: true;
}

export async function registerRealmUsers(synapse: SynapseInstance) {
  await registerUser(
    synapse,
    'base_realm',
    await realmPassword('base_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'experiments_realm',
    await realmPassword('experiments_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'seed_realm',
    await realmPassword('seed_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'catalog_realm',
    await realmPassword('catalog_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'test_realm',
    await realmPassword('test_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'node-test_realm',
    await realmPassword('node-test_realm', realmSecretSeed),
  );
  await registerUser(
    synapse,
    'realm_server',
    await realmPassword('realm_server', realmSecretSeed),
  );
}

export async function reloadAndOpenAiAssistant(page: Page) {
  await page.reload();
  await openAiAssistant(page);
}

export async function openAiAssistant(page: Page) {
  await page.locator('[data-test-open-ai-assistant]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-test-close-ai-assistant]'),
  );

  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-test-room]')
        ?.getAttribute('data-test-room'),
  ); // Opening the AI assistant either opens last room or creates one - wait for it to settle
}

export async function createRealm(
  page: Page,
  endpoint: string,
  name = endpoint,
) {
  await page.locator('[data-test-add-workspace]').click();
  await page.locator('[data-test-display-name-field]').fill(name);
  await page.locator('[data-test-endpoint-field]').fill(endpoint);
  await page.locator('[data-test-create-workspace-submit]').click();
  await expect(page.locator(`[data-test-workspace="${name}"]`)).toBeVisible();
  await expect(page.locator('[data-test-create-workspace-modal]')).toHaveCount(
    0,
  );
}

export async function openRoot(page: Page, url = testHost) {
  await page.goto(url);
}

export async function clearLocalStorage(page: Page, appURL = testHost) {
  await openRoot(page, appURL);
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

export async function gotoRegistration(page: Page, appURL = testHost) {
  await openRoot(page, appURL);

  await page.locator('[data-test-register-user]').click();
  await expect(page.locator('[data-test-register-btn]')).toHaveCount(1);
}

export async function gotoForgotPassword(page: Page, appURL = testHost) {
  await openRoot(page, appURL);

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
  await openRoot(page, opts?.url);

  await page.waitForFunction(() =>
    document.querySelector('[data-test-username-field]'),
  );
  await page.locator('[data-test-username-field]').fill(username);
  await page.locator('[data-test-password-field]').fill(password);
  await page.locator('[data-test-login-btn]').click();

  if (opts?.expectFailure) {
    await expect(page.locator('[data-test-login-error]')).toHaveCount(1);
  } else {
    if (!opts?.skipOpeningAssistant) {
      await openAiAssistant(page);
    }
  }
}

export async function enterWorkspace(
  page: Page,
  workspace = 'Test Workspace A',
) {
  await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);
  await expect(
    page.locator(`[data-test-workspace="${workspace}"]`),
  ).toHaveCount(1);
  await page.locator(`[data-test-workspace="${workspace}"]`).click();
  await expect(
    page.locator(
      `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
    ),
  ).toContainText(workspace);
}

export async function showAllCards(page: Page) {
  await expect(
    page.locator(`[data-test-boxel-filter-list-button="All Cards"]`),
  ).toHaveCount(1);
  await page
    .locator(`[data-test-boxel-filter-list-button="All Cards"]`)
    .click();
}

export async function logout(page: Page) {
  await page.locator('[data-test-profile-icon-button]').click();
  await page.locator('[data-test-signout-button]').click();
  await expect(page.locator('[data-test-login-btn]')).toHaveCount(1);
}

export async function createRoom(page: Page) {
  await page.locator('[data-test-create-room-btn]').click();
  let roomId = await getRoomId(page);
  await isInRoom(page, roomId);
  return roomId;
}

export async function createRoomWithMessage(page: Page, message?: string) {
  let roomId = await createRoom(page);
  await sendMessage(page, roomId, message ?? 'Hello, world!');
  return roomId;
}

export async function getRoomId(page: Page) {
  await page.locator(`[data-test-room-settled]`).waitFor();
  let roomId = await page
    .locator('[data-test-room]')
    .getAttribute('data-test-room');
  if (roomId == null) {
    throw new Error('room ID is not found');
  }
  return roomId;
}

export async function isInRoom(page: Page, roomId: string) {
  await page.locator(`[data-test-room="${roomId}"]`).waitFor();
  await expect(page.locator(`[data-test-room-settled]`)).toHaveCount(1);
}

export async function deleteRoom(page: Page, roomId: string) {
  await page.locator(`[data-test-past-sessions-button]`).click();

  // Here, past sessions could be rerendered because in one case we're creating a new room when opening an AI panel, so we need to wait for the past sessions to settle
  await page.waitForTimeout(500);
  await page
    .locator(`[data-test-past-session-options-button="${roomId}"]`)
    .click();

  await page.locator(`[data-test-boxel-menu-item-text="Delete"]`).click();
  await page
    .locator(
      `[data-test-delete-modal-container] [data-test-confirm-delete-button]`,
    )
    .click();
}

export async function openRoom(page: Page, roomId: string) {
  await page.locator(`[data-test-past-sessions-button]`).click(); // toggle past sessions on
  await page.locator(`[data-test-enter-room="${roomId}"]`).click();
  await isInRoom(page, roomId);
}

export async function openRenameMenu(page: Page, roomId: string) {
  await page.locator(`[data-test-past-sessions-button]`).click();
  await page.waitForTimeout(500); // without this, the click on the options button result in the menu staying open
  await page
    .locator(`[data-test-past-session-options-button="${roomId}"]`)
    .click();
  await expect(
    page.locator(`[data-test-boxel-menu-item-text="Rename"]`),
  ).toHaveCount(1);
  await page.locator(`[data-test-boxel-menu-item-text="Rename"]`).click();
  await page.locator(`[data-test-name-field]`).waitFor();
}

export async function writeMessage(
  page: Page,
  roomId: string,
  message: string,
) {
  await page.locator(`[data-test-message-field="${roomId}"]`).fill(message);
  await expect(
    page.locator(`[data-test-message-field="${roomId}"]`),
  ).toHaveValue(message);
}

export async function selectCardFromCatalog(
  page: Page,
  cardId: string,
  realmName = 'Test Workspace A',
) {
  await page.locator('[data-test-choose-card-btn]').click();
  await page
    .locator(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
    .click();
  await page
    .locator(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
    .click();
  await page.locator(`[data-test-select="${cardId}"]`).click();
  await page.locator('[data-test-card-catalog-go-button]').click();
}

export async function setupTwoStackItems(
  page: Page,
  leftStackTopCardId: string,
  rightStackTopCardId: string,
) {
  await page
    .locator(
      `[data-test-stack-item-content] [data-test-cards-grid-item='${rightStackTopCardId}']`,
    )
    .click();
  await page
    .locator(
      `[data-test-stack-card='${rightStackTopCardId}'] [data-test-close-button]`,
    )
    .click();
  await page
    .locator(
      `[data-test-stack-item-content] [data-test-cards-grid-item='${leftStackTopCardId}']`,
    )
    .click();
  await page.locator('[data-test-add-card-right-stack]').click();
  await page
    .locator(`[data-test-search-result="${rightStackTopCardId}"]`)
    .click();
}

export async function sendMessage(
  page: Page,
  roomId: string,
  message: string | undefined,
  cardIds?: string[],
) {
  if (message == null && cardIds == null) {
    throw new Error(
      `sendMessage requires at least a message or a card ID be specified`,
    );
  }
  if (message != null) {
    await writeMessage(page, roomId, message);
  }
  if (cardIds?.length) {
    for (let cardId of cardIds) {
      await selectCardFromCatalog(page, cardId);
    }
  }
  // can we check it's higher than before?
  await page.waitForSelector(`[data-test-room-settled]`);
  await page.waitForSelector(`[data-test-can-send-msg]`);
  await page.locator('[data-test-send-message-btn]').click();
}

export async function assertMessages(
  page: Page,
  messages: {
    from: string;
    message?: string;
    cards?: { id: string; title?: string; realmIconUrl?: string }[];
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
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"] [data-test-message-cards]`,
        ),
      ).toHaveCount(1);
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"] [data-test-attached-card]`,
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
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"]`,
            ),
          ).toContainText(card.title);
        }

        if (card.realmIconUrl) {
          await expect(
            page.locator(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"] [data-test-realm-icon-url="${card.realmIconUrl}"]`,
            ),
          ).toHaveCount(1);
        }
      });
    } else {
      await expect(
        page.locator(
          `[data-test-message-idx="${index}"] [data-test-message-cards]`,
        ),
      ).toHaveCount(0);
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
    await Promise.all(
      rooms.map((name) =>
        expect(
          page.locator(`[data-test-joined-room="${name}"]`),
          `the joined room '${name}' is displayed`,
        ).toHaveCount(1),
      ),
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

export async function assertPaymentSetup(page: Page, username: string) {
  const stripePaymentLink = 'https://buy.stripe.com/test_4gw01WfWb2c1dBm7sv';
  const expectedLink = `${stripePaymentLink}?client_reference_id=${username}`;
  await expect(page.locator('[data-test-setup-payment]')).toHaveAttribute(
    'href',
    expectedLink,
  );
}

export async function setupUser(
  username: string,
  realmServer: IsolatedRealmServer,
) {
  await realmServer.executeSQL(
    `INSERT INTO users (matrix_user_id) VALUES ('${username}')`,
  );
}

export async function setupPayment(
  username: string,
  realmServer: IsolatedRealmServer,
  page?: Page,
) {
  // decode the username from base64
  const decodedUsername = decodeFromAlphanumeric(username);

  // mock trigger stripe webhook 'checkout.session.completed'
  let freePlan = await realmServer.executeSQL(
    `SELECT * FROM plans WHERE name = 'Free'`,
  );

  const randomNumber = Math.random().toString(36).substring(2, 12);

  let subscriptionId = `sub_${randomNumber}`;
  let stripeCustomerId = `cus_${randomNumber}`;

  await realmServer.executeSQL(
    `UPDATE users SET stripe_customer_id = '${stripeCustomerId}' WHERE matrix_user_id = '${decodedUsername}'`,
  );

  let findUser = await realmServer.executeSQL(
    `SELECT * FROM users WHERE matrix_user_id = '${decodedUsername}'`,
  );

  const userId = findUser[0].id;

  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const oneYearFromNow = now + 31536000; // One year in seconds
  const oneMonthFromNow = now + 2592000; // One month in seconds

  // mock trigger stripe webhook 'invoice.payment_succeeded'
  await realmServer.executeSQL(
    `INSERT INTO subscriptions (
      user_id, 
      plan_id, 
      started_at, 
      ended_at,
      status, 
      stripe_subscription_id
    ) VALUES (
      '${userId}',
      '${freePlan[0].id}',
      ${now},
      ${oneYearFromNow},
      'active',
      '${subscriptionId}'
    )`,
  );

  const getSubscription = await realmServer.executeSQL(
    `SELECT id FROM subscriptions WHERE stripe_subscription_id = '${subscriptionId}'`,
  );
  const subscriptionUUID = getSubscription[0].id;

  await realmServer.executeSQL(
    `INSERT INTO subscription_cycles (
      subscription_id, 
      period_start, 
      period_end
    ) VALUES (
      '${subscriptionUUID}',
      ${now},
      ${oneMonthFromNow}
    )`,
  );

  let subscriptionCycle = await realmServer.executeSQL(
    `SELECT id FROM subscription_cycles WHERE subscription_id = '${subscriptionUUID}'`,
  );
  const subscriptionCycleUUID = subscriptionCycle[0].id;

  await realmServer.executeSQL(
    `INSERT INTO credits_ledger (user_id, credit_amount, credit_type, subscription_cycle_id) VALUES ('${userId}', ${freePlan[0].credits_included}, 'plan_allowance', '${subscriptionCycleUUID}')`,
  );

  // Return url example: https://realms-staging.stack.cards/?from-free-plan-payment-link=true
  // extract return url from page.url()
  // assert return url contains ?from-free-plan-payment-link=true
  if (page) {
    const currentUrl = new URL(page.url());
    const currentParams = currentUrl.searchParams;
    await currentParams.append('from-free-plan-payment-link', 'true');
    const returnUrl = `${currentUrl.origin}${
      currentUrl.pathname
    }?${currentParams.toString()}`;

    await page.goto(returnUrl);
  }
}

export async function setupUserSubscribed(
  username: string,
  realmServer: IsolatedRealmServer,
) {
  const matrixUserId = encodeToAlphanumeric(username);
  await setupUser(username, realmServer);
  await setupPayment(matrixUserId, realmServer);
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

export async function getRoomEvents(
  username = 'user1',
  password = 'pass',
  roomId?: string,
) {
  let { accessToken } = await loginUser(username, password);
  let rooms = await getJoinedRooms(accessToken);
  if (!roomId) {
    let roomsWithEvents = await Promise.all(
      rooms.map((r) => getAllRoomEvents(r, accessToken)),
    );
    // there will generally be 2 rooms, one is the DM room we do for
    // authentication, the other is the actual chat (with org.boxel.message events)
    return (
      roomsWithEvents.find((messages) => {
        return messages.find(
          (message) =>
            message.type === 'm.room.message' &&
            message.content?.msgtype === 'org.boxel.message',
        );
      }) ?? []
    );
  }
  return await getAllRoomEvents(roomId, accessToken);
}

export async function getRoomsFromSync(username = 'user1', password = 'pass') {
  let { accessToken } = await loginUser(username, password);
  let response = (await sync(accessToken)) as any;
  return response.rooms;
}

export async function waitUntil<T>(
  condition: () => Promise<T>,
  timeout = 10000,
  interval = 250,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

export function encodeToAlphanumeric(string: string) {
  return Buffer.from(string)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, ''); // Remove padding
}

export function decodeFromAlphanumeric(encodedString: string) {
  const base64 = encodedString.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}
