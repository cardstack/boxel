import { expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  openRoom,
  assertMessages,
  writeMessage,
  sendMessage,
  joinRoom,
  testHost,
  reloadAndOpenAiAssistant,
  test,
  isInRoom,
} from '../helpers';

test.describe('Room messages', () => {
  test.beforeEach(async ({ synapse }) => {
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });
  test(`it can send a message in a room`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });
    await createRoom(page, { name: 'Room 2' });
    await page.locator(`[data-test-past-sessions-button]`).click();
    await openRoom(page, 'Room 1');

    await expect(page.locator('[data-test-timeline-start]')).toHaveCount(1);
    await expect(page.locator('[data-test-no-messages]')).toHaveCount(1);
    await expect(page.locator('[data-test-message-field]')).toHaveValue('');
    await assertMessages(page, []);

    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await writeMessage(page, 'Room 1', 'Message 1');
    await expect(page.locator('[data-test-send-message-btn]')).toBeEnabled();
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-message-field]')).toHaveValue('');
    await expect(page.locator('[data-test-no-messages]')).toHaveCount(0);
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    // make sure that room state doesn't leak
    await page.locator(`[data-test-past-sessions-button]`).click();
    await openRoom(page, 'Room 2');
    await isInRoom(page, 'Room 2');
    await assertMessages(page, []);

    await page.locator(`[data-test-past-sessions-button]`).click();
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
  });

  test(`it lets multiple users send messages in a room`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
    });
    await sendMessage(page, 'Room 1', 'first message');
    await logout(page);

    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await assertMessages(page, [{ from: 'user1', message: 'first message' }]);
    await sendMessage(page, 'Room 1', 'second message');
    await assertMessages(page, [
      { from: 'user1', message: 'first message' },
      { from: 'user2', message: 'second message' },
    ]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, 'Room 1');
    await assertMessages(page, [
      { from: 'user1', message: 'first message' },
      { from: 'user2', message: 'second message' },
    ]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await assertMessages(page, [
      { from: 'user1', message: 'first message' },
      { from: 'user2', message: 'second message' },
    ]);
  });

  test(`it can load all events back to beginning of timeline for timelines that truncated`, async ({
    page,
  }) => {
    // generally the matrix server paginates after 10 messages
    const totalMessageCount = 20;

    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
    });

    for (let i = 1; i <= totalMessageCount; i++) {
      await sendMessage(page, 'Room 1', `message ${i}`);
    }
    await logout(page);

    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    let displayedMessageCount = await page
      .locator('[data-test-message-index]')
      .count();
    expect(displayedMessageCount).toEqual(totalMessageCount);
  });

  test(`it can send a markdown message`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
    });
    await sendMessage(page, 'Room 1', 'message with _style_');
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message with style',
      },
    ]);
    await expect(
      page.locator(`[data-test-message-index="0"] .content em`),
    ).toContainText('style');
  });

  test(`it can create a room specific pending message`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });
    await createRoom(page, { name: 'Room 2' });
    await openRoom(page, 'Room 1');

    await writeMessage(page, 'Room 1', 'room 1 message');
    await openRoom(page, 'Room 2');
    await expect(
      page.locator('[data-test-message-field="Room 2"]'),
    ).toHaveValue('');

    await writeMessage(page, 'Room 2', 'room 2 message');
    await openRoom(page, 'Room 1');
    await expect(
      page.locator('[data-test-message-field="Room 1"]'),
    ).toHaveValue('room 1 message');
    await openRoom(page, 'Room 2');
    await expect(
      page.locator('[data-test-message-field="Room 2"]'),
    ).toHaveValue('room 2 message');
  });

  test('can add a card to a markdown message', async ({ page }) => {
    const testCard = `${testHost}/hassan`;
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await page.locator('[data-test-choose-card-btn]').click();
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(page.locator('[data-test-send-message-btn]')).toBeEnabled();
    await expect(
      page.locator(`[data-test-selected-card="${testCard}"]`),
    ).toContainText('Person: Hassan');

    await page.locator('[data-test-message-field]').fill('This is _my_ card');
    await page.locator('[data-test-send-message-btn]').click();

    await assertMessages(page, [
      {
        from: 'user1',
        message: 'This is my card',
        card: { id: testCard, text: 'Hassan' },
      },
    ]);
    await expect(
      page.locator(`[data-test-message-index="0"] .content em`),
    ).toContainText('my');
  });

  test('can send only a card as a message', async ({ page }) => {
    const testCard = `${testHost}/hassan`;
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await sendMessage(page, 'Room 1', undefined, testCard);
    await assertMessages(page, [
      {
        from: 'user1',
        card: { id: testCard, text: 'Hassan' },
      },
    ]);
  });

  test('can remove a card from a pending message', async ({ page }) => {
    const testCard = `${testHost}/hassan`;
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await page.locator('[data-test-choose-card-btn]').click();
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(
      page.locator(`[data-test-selected-card="${testCard}"]`),
    ).toContainText('Person: Hassan');
    await page.locator('[data-test-remove-card-btn]').click();
    await expect(page.locator(`[data-test-selected-card]`)).toHaveCount(0);

    await page.locator('[data-test-message-field]').fill('no card');
    await page.locator('[data-test-send-message-btn]').click();

    await assertMessages(page, [
      {
        from: 'user1',
        message: 'no card',
      },
    ]);
  });

  test('can render multiple cards in a room', async ({ page }) => {
    // the loader deadlocking issue would otherwise prevent this

    const testCard1 = `${testHost}/hassan`;
    const testCard2 = `${testHost}/mango`;

    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await sendMessage(page, 'Room 1', 'message 1', testCard1);
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message 1',
        card: {
          id: testCard1,
          text: 'Hassan',
        },
      },
    ]);

    await sendMessage(page, 'Room 1', 'message 2', testCard2);
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message 1',
        card: {
          id: testCard1,
          text: 'Hassan',
        },
      },
      {
        from: 'user1',
        message: 'message 2',
        card: {
          id: testCard2,
          text: 'Mango',
        },
      },
    ]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, 'Room 1');
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message 1',
        card: {
          id: testCard1,
          text: 'Hassan',
        },
      },
      {
        from: 'user1',
        message: 'message 2',
        card: {
          id: testCard2,
          text: 'Mango',
        },
      },
    ]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message 1',
        card: {
          id: testCard1,
          text: 'Hassan',
        },
      },
      {
        from: 'user1',
        message: 'message 2',
        card: {
          id: testCard2,
          text: 'Mango',
        },
      },
    ]);
  });
});
