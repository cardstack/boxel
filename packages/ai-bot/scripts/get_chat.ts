import { aiBotUsername } from '@cardstack/runtime-common';
import { createClient, IRoomEvent } from 'matrix-js-sdk';
import { constructHistory } from '../helpers';
import { writeFileSync } from 'fs';
console.log(aiBotUsername);
(async () => {
  const room = process.argv[2];
  let roomId, joinedRoom;
  if (!room) {
    console.error(
      'Please provide a room ID or name as a command line argument',
    );
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
  console.log(client.getHomeserverUrl());

  if (room.startsWith('#')) {
    // We're looking at a room name/alias - we need to resolve it
    // It must be url encoded, but *not* the first #
    // and we have to add in the server name
    console.log(`Assuming room server name is ${auth.home_server}`);
    let roomName = `#${encodeURIComponent(room.slice(1))}:${auth.home_server}`;
    console.log(`Looking up room name encoded as ${roomName}`);
    let roomDetails = await client.getRoomIdForAlias(roomName);
    roomId = roomDetails.room_id;
    console.log(`Room ID resolved to ${room}`);
  } else if (room.startsWith('!')) {
    // This is a room id, use it as-is
    console.log(`Using room ID ${room}`);
    roomId = room;
  } else {
    console.error(
      'Please provide a room ID or name as a command line argument, it should start with a # for a room name or a ! for a room ID',
    );
    process.exit(1);
  }

  try {
    joinedRoom = await client.joinRoom(roomId);
  } catch (e) {
    console.log(`Error joining room ${roomId}`);
    console.log(e);
    process.exit(1);
  }
  console.log(`Joined room ${joinedRoom.name}`);
  let initial = await client.roomInitialSync(joinedRoom.roomId, 1000);
  let eventList = initial!.messages?.chunk || [];

  console.log('Total event list', eventList.length);
  let history: IRoomEvent[] = constructHistory(eventList);
  writeFileSync(
    `tests/resources/chats/${roomId}.json`,
    JSON.stringify(history, null, 2),
  );
  console.log(
    `Wrote ${history.length} events to tests/resources/chats/${roomId}.json`,
  );
  client.stopClient();
})().catch((e) => {
  console.log(e);
  process.exit(1);
});
