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
  await page.goto(`/chat`);
  await page.locator('[data-test-logout-btn]').click();
}

export async function createRoom(
  page: Page,
  roomDetails: { name: string; invites?: string[] }
) {
  await page.locator('[data-test-create-room-mode-btn]').click();
  await page.locator('[data-test-room-name-field]').fill(roomDetails.name);
  if (roomDetails.invites && roomDetails.invites.length > 0) {
    await page
      .locator('[data-test-room-invite-field]')
      .fill(roomDetails.invites.join(', '));
  }
  await page.locator('[data-test-create-room-btn]').click();
}

interface RoomAssertions {
  joinedRooms?: string[];
  invitedRooms?: { name: string; sender: string }[];
}

export async function assertRooms(page: Page, rooms: RoomAssertions) {
  if (rooms.joinedRooms && rooms.joinedRooms.length > 0) {
    await expect(
      page.locator('[data-test-joined-room]'),
      `${rooms.joinedRooms.length} joined room(s) are displayed`
    ).toHaveCount(rooms.joinedRooms.length);
    for (let name of rooms.joinedRooms) {
      await expect(
        page.locator(`[data-test-joined-room="${name}"]`),
        `the joined room '${name}' is displayed`
      ).toHaveCount(1);
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
