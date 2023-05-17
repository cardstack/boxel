import { test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  openRoom,
  assertMessages,
  sendMessage,
  joinRoom,
} from '../helpers';

test.describe('Encrypted Room messages', () => {
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
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', encrypted: true });
    await createRoom(page, { name: 'Room 2', encrypted: true });
    await openRoom(page, 'Room 1');

    await assertMessages(page, []);
    await sendMessage(page, 'Message 1');

    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await page.reload();
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);
  });

  test(`it lets multiple users send messages in a room`, async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
      encrypted: true,
    });
    await openRoom(page, 'Room 1');
    await sendMessage(page, 'first message');
    await logout(page);

    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await assertMessages(page, [{ from: 'user1', message: 'first message' }]);
    await sendMessage(page, 'second message');
    await assertMessages(page, [
      { from: 'user1', message: 'first message' },
      { from: 'user2', message: 'second message' },
    ]);

    await page.reload();
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
});
