import { RoomMemberEvent, createClient } from 'matrix-js-sdk';
import type { MatrixClient } from 'matrix-js-sdk';

import { expect, test } from './fixtures.ts';
import { createUser, getMatrixTestContext } from '../helpers/index.ts';
import {
  getJoinedRooms,
  loginUser,
  registerUser,
} from '../support/synapse/index.ts';
import type { Credentials } from '../support/synapse/index.ts';
import { getSynapseURL } from '../support/environment-config.ts';
import { onMembershipEvent } from '../../bot-runner/lib/membership-handler.ts';

// Synapse delivers an invite as stripped state, with no origin_server_ts, so
// the bot-runner's unit tests, which build the event by hand, can't tell
// whether the real one is accepted.

test.describe('submission bot invites', () => {
  let bot: Credentials;
  let submitter: Credentials;
  let botClient: MatrixClient | undefined;

  test.beforeEach(async () => {
    bot = await submissionBotCredentials();
    submitter = (await createUser('submitter')).credentials;
  });

  test.afterEach(() => {
    botClient?.stopClient();
    botClient = undefined;
  });

  test('the bot joins a room it is invited to while running', async () => {
    botClient = await startBot(bot);
    let roomId = await createRoomInviting(submitter, bot.userId);

    await expect
      .poll(() => getJoinedRooms(bot.accessToken), { timeout: 15_000 })
      .toContain(roomId);
  });

  test('the bot joins a room it was invited to before it started', async () => {
    let roomId = await createRoomInviting(submitter, bot.userId);
    botClient = await startBot(bot);

    await expect
      .poll(() => getJoinedRooms(bot.accessToken), { timeout: 15_000 })
      .toContain(roomId);
  });
});

// The homeserver lets an end user invite the submission bot because its
// invite check knows the bot by its localpart, `submissionbot`. The test signs
// in as that account, not a uniquely named one, whose invite the check would
// refuse as one between two end users who share no realm.
async function submissionBotCredentials(): Promise<Credentials> {
  let { synapse } = getMatrixTestContext();
  try {
    await registerUser(synapse, 'submissionbot', 'password');
  } catch {
    // An earlier test registered it.
  }
  return await loginUser('submissionbot', 'password');
}

async function startBot(credentials: Credentials) {
  let client = createClient({
    baseUrl: getSynapseURL(),
    accessToken: credentials.accessToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
  });
  client.on(
    RoomMemberEvent.Membership,
    onMembershipEvent({ client, authUserId: credentials.userId }),
  );
  await client.startClient();
  return client;
}

async function createRoomInviting(creator: Credentials, inviteeId: string) {
  let response = await fetch(
    `${getSynapseURL()}/_matrix/client/v3/createRoom`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${creator.accessToken}` },
      body: JSON.stringify({
        name: 'PR: example listing',
        invite: [inviteeId],
      }),
    },
  );
  expect(response.ok, await response.clone().text()).toBe(true);
  let { room_id } = (await response.json()) as { room_id: string };
  return room_id;
}
