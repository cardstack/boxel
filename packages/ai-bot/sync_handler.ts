import {
  RoomEvent,
  createClient,
  type MatrixEvent,
  RoomMemberEvent,
} from 'matrix-js-sdk';

// Configure logging
const log = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

// Constants
const AI_BOT_USERNAME = 'aibot';
const MATRIX_URL = process.env.MATRIX_URL || 'http://localhost:8008';
const MATRIX_PASSWORD = process.env.BOXEL_AIBOT_PASSWORD || 'pass';

// Add fetch type declarations for TypeScript
declare global {
  // eslint-disable-next-line
  var fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

// Helper function to check if event requires a response
function eventRequiresResponse(event: MatrixEvent) {
  // If it's a message, we should respond
  if (event.getType() === 'm.room.message') {
    return true;
  }
  return false;
}

async function sendEvents(
  client: MatrixClient,
  roomId: string,
  eventBody: string,
) {
  // Get access token for authentication
  const accessToken = client.getAccessToken();

  for (let i = 0; i < 10; i++) {
    const timestamp = new Date().toISOString();
    log.info(`Iteration ${i + 1}/10: Current time is ${timestamp}`);

    // Generate a unique transaction ID
    const txnId = `async-op-${Date.now()}-${i}`;

    // Send message to room using fetch directly to the Matrix API
    let result = await fetch(
      `${MATRIX_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: `Async iteration ${i + 1}/10 at time ${timestamp}`,
        }),
      },
    );

    const responseBody = await result.json();
    log.info(
      `Sent message via fetch API: ${result.status} - Event ID: ${responseBody.event_id || 'unknown'}`,
    );
  }

  log.info(`Completed async operation for message: ${eventBody}`);

  // Send a final message with client method for comparison
  await client.sendTextMessage(
    roomId,
    `Processed your message: "${eventBody}" with 10 async iterations`,
  );
}

async function main() {
  const startTime = Date.now();

  log.info(`Starting async handler, connecting to ${MATRIX_URL}`);

  // Create Matrix client
  const client = createClient({
    baseUrl: MATRIX_URL,
  });

  // Login as aibot
  try {
    const auth = await client.loginWithPassword(
      AI_BOT_USERNAME,
      MATRIX_PASSWORD,
    );
    log.info(`Logged in successfully as ${auth.user_id}`);
  } catch (e) {
    log.error(`Login failed: ${e}`);
    log.info(`The matrix bot could not login to the server.
Common issues are:
- The server is not running (configured to use ${MATRIX_URL})
- The bot is not registered on the matrix server
- The bot is registered but the password is incorrect
    `);
    process.exit(1);
  }

  // Auto-join rooms when invited
  client.on(RoomMemberEvent.Membership, function (_event, member) {
    if (
      member.membership === 'invite' &&
      member.userId === client.getUserId()
    ) {
      client
        .joinRoom(member.roomId)
        .then(() => {
          log.info(`Auto-joined room: ${member.roomId}`);
        })
        .catch((e) => {
          log.error(`Failed to join room: ${e}`);
        });
    }
  });

  // Listen for new messages
  client.on(RoomEvent.Timeline, function (event, room, toStartOfTimeline) {
    try {
      if (!room) return;
      if (event.event.origin_server_ts! < startTime) return;
      if (toStartOfTimeline) return; // Don't handle paginated results
      if (!eventRequiresResponse(event)) return;

      const senderMatrixUserId = event.getSender();
      if (senderMatrixUserId === client.getUserId()) return; // Don't respond to self

      const eventBody = event.getContent().body || '';

      log.info(
        '(%s) (Room: "%s" %s) (Message: %s %s)',
        event.getType(),
        room?.name,
        room?.roomId,
        senderMatrixUserId,
        eventBody,
      );

      log.info(`Starting async operation for message: ${eventBody}`);
      // trigger the async function and ignore the promise
      sendEvents(client, room.roomId, eventBody);
    } catch (e) {
      log.error(`Error handling message: ${e}`);
    }
  });

  // Start the client
  await client.startClient();
  log.info('Matrix client started and ready to receive messages');
}

main().catch((e) => {
  log.error(`Unhandled error: ${e}`);
  process.exit(1);
});
