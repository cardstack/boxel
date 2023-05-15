import { test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '../docker/synapse';
import { login, logout, assertRooms, createRoom } from '../helpers';

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

  test.skip(`it can send a message in a room`, async ({ page }) => {
    // make sure to test that room state doesn't leak
  });

  test.skip(`it can scroll back to beginning of timeline`, async ({
    page,
  }) => {});

  test.skip(`it can send a markdown message`, async ({ page }) => {});

  test.skip(`it can create a room specific pending message`, async ({
    page,
  }) => {});
});
