import { expect, type Page } from '@playwright/test';

export const testHost = 'http://127.0.0.1:4200';

interface ProfileAssertions {
  userId?: string;
  displayName?: string;
}

export async function login(page: Page, username: string, password: string) {
  await page.goto(`/chat`);
  await page.locator('[data-test-username-field]').fill(username);
  await page.locator('[data-test-password-field]').fill(password);
  await page.locator('[data-test-login-btn]').click();
}

export async function logout(page: Page) {
  await page.locator('[data-test-logout-btn]').click();
}

export async function createRoom(
  page: Page,
  roomDetails: { name: string; invites?: string[]; encrypted?: true }
) {
  await page.locator('[data-test-create-room-mode-btn]').click();
  await page.locator('[data-test-room-name-field]').fill(roomDetails.name);
  if (roomDetails.encrypted) {
    await page.locator('[data-test-encrypted-field]').click();
  }
  if (roomDetails.invites && roomDetails.invites.length > 0) {
    await page
      .locator('[data-test-room-invite-field]')
      .fill(roomDetails.invites.join(', '));
  }
  await page.locator('[data-test-create-room-btn]').click();
}

export async function openRoom(page: Page, roomName: string) {
  await page.locator(`[data-test-enter-room="${roomName}"]`).click();
}

export async function sendMessage(page: Page, message: string) {
  await page.locator('[data-test-message-field]').fill(message);
  await page.locator('[data-test-send-message-btn]').click();
}

export async function assertMessages(
  page: Page,
  messages: { from: string; message: string }[]
) {
  const limit = 5;
  if (messages.length > limit) {
    throw new Error(
      `don't use assertMessages() for more than ${limit} messages as pagination may unnecessarily break the assertion`
    );
  }
  await expect(page.locator('[data-test-message-idx]')).toHaveCount(
    messages.length
  );
  for (let [index, { from, message }] of messages.entries()) {
    await expect(
      page.locator(
        `[data-test-message-idx="${index}"] [data-test-boxel-message-name]`
      )
    ).toContainText(from);
    await expect(
      page.locator(`[data-test-message-idx="${index}"] .boxel-message__content`)
    ).toContainText(message);
  }
}

interface RoomAssertions {
  joinedRooms?: { name: string; encrypted?: boolean }[];
  invitedRooms?: { name: string; sender: string }[];
}

export async function assertRooms(page: Page, rooms: RoomAssertions) {
  if (rooms.joinedRooms && rooms.joinedRooms.length > 0) {
    await expect(
      page.locator('[data-test-joined-room]'),
      `${rooms.joinedRooms.length} joined room(s) are displayed`
    ).toHaveCount(rooms.joinedRooms.length);
    for (let { name, encrypted } of rooms.joinedRooms) {
      await expect(
        page.locator(`[data-test-joined-room="${name}"]`),
        `the joined room '${name}' is displayed`
      ).toHaveCount(1);
      if (encrypted) {
        await expect(
          page.locator(
            `[data-test-joined-room="${name}"] [data-test-encrypted-room]`
          )
        ).toHaveCount(1);
      } else {
        await expect(
          page.locator(
            `[data-test-joined-room="${name}"] [data-test-encrypted-room]`
          )
        ).toHaveCount(0);
      }
    }
  } else {
    await expect(
      page.locator('[data-test-joined-room]'),
      `joined rooms are not displayed`
    ).toHaveCount(0);
  }
  if (rooms.invitedRooms && rooms.invitedRooms.length > 0) {
    await expect(
      page.locator('[data-test-invited-room]'),
      `${rooms.invitedRooms.length} invited room(s) are displayed`
    ).toHaveCount(rooms.invitedRooms.length);
    for (let { name, sender } of rooms.invitedRooms) {
      await expect(
        page.locator(
          `[data-test-invited-room="${name}"] [data-test-invite-sender="${sender}"]`
        ),
        `the invited room '${name}' from '${sender}' is displayed`
      ).toHaveCount(1);
    }
  } else {
    await expect(
      page.locator('[data-test-invited-room]'),
      `invited rooms are not displayed`
    ).toHaveCount(0);
  }
}

export async function assertLoggedIn(page: Page, opts?: ProfileAssertions) {
  await page.waitForURL(`${testHost}/chat`);
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is not displayed'
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is not displayed'
  ).toHaveCount(0);
  await expect(page.locator('[data-test-field-value="userId"]')).toContainText(
    opts?.userId ?? '@user1:localhost'
  );
  await expect(
    page.locator('[data-test-field-value="displayName"]')
  ).toContainText(opts?.displayName ?? 'user1');
}

export async function assertLoggedOut(page: Page) {
  await page.waitForURL(`${testHost}/chat`);
  await expect(
    page.locator('[data-test-username-field]'),
    'username field is displayed'
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-password-field]'),
    'password field is displayed'
  ).toHaveCount(1);
  await expect(
    page.locator('[data-test-field-value="userId"]'),
    'user profile - user ID is not displayed'
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test-field-value="displayName"]'),
    'user profile - display name is not displayed'
  ).toHaveCount(0);
}
