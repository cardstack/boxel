import { test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  login,
  assertRooms,
  createRoom,
  leaveRoom,
  reloadAndOpenAiAssistant,
  registerRealmUsers,
} from '../helpers';

test.describe('Room membership', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can leave a joined room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    let name = await createRoom(page);
    await assertRooms(page, [name]);

    await leaveRoom(page, name);
    await assertRooms(page, []);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, []);
  });
});
