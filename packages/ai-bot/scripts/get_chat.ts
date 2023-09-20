import { aiBotUsername } from '@cardstack/runtime-common';
import { createClient, IRoomEvent } from 'matrix-js-sdk';
import { constructHistory } from '../helpers';
import { writeFileSync } from 'fs';
console.log(aiBotUsername);
(async () => {
  const roomId = process.argv[2];
  if (!roomId) {
    console.error('Please provide a room ID as a command line argument');
    process.exit(1);
  }

  let client = createClient({
    baseUrl: process.env.MATRIX_URL || 'http://localhost:8008',
  });
  let auth = await client.loginWithPassword(
    aiBotUsername,
    process.env.BOXEL_AIBOT_PASSWORD || 'pass',
  );
  await client.startClient();
  const room = await client.joinRoom(roomId);
  console.log(`Joined room ${room.name}`);
  let initial = await client.roomInitialSync(room!.roomId, 1000);
  let eventList = initial!.messages?.chunk || [];
  console.log(eventList);

  console.log('Total event list', eventList.length);
  let history: IRoomEvent[] = constructHistory(eventList);
  writeFileSync(`prompts/${roomId}.json`, JSON.stringify(history, null, 2));
  console.log(history);
  client.stopClient();
})().catch((e) => {
  console.log(e);
  process.exit(1);
});
