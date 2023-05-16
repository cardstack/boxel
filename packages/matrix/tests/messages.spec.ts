import { expect, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '../docker/synapse';
import {
  login,
  logout,
  assertRooms,
  createRoom,
  openRoom,
  assertMessages,
} from '../helpers';

test.describe('Room messages', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test(`it can send a message in a room`, async ({ page }) => {
    // make sure to test that room state doesn't leak
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });
    await openRoom(page, 'Room 1');

    await expect(page.locator('[data-test-timeline-start]')).toHaveCount(1);
    await expect(page.locator('[data-test-no-messages]')).toHaveCount(1);
    await assertMessages(page, []);

    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await page.locator('[data-test-message-field]').fill('Message 1');
    await expect(page.locator('[data-test-send-message-btn]')).toBeEnabled();
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-no-messages]')).toHaveCount(0);
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await page.reload();
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
  });

  test.skip(`it can scroll back to beginning of timeline`, async ({
    page,
  }) => {});

  test.skip(`it can send a markdown message`, async ({ page }) => {});

  test.skip(`it can create a room specific pending message`, async ({
    page,
  }) => {});
});
