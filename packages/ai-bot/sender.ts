import { createClient, ClientEvent } from 'matrix-js-sdk';
import { createInterface } from 'readline';

// Hardcoded credentials
const USERNAME = 'sender_user';
const PASSWORD = 'sender_pass';
const MATRIX_URL = process.env.MATRIX_URL || 'http://localhost:8008';
const AI_BOT_USERNAME = 'aibot';

async function main() {
  console.log('Starting sender client');

  // Create Matrix client
  const client = createClient({
    baseUrl: MATRIX_URL,
  });

  // Login to Matrix
  console.log(`Logging in as ${USERNAME}...`);
  try {
    const auth = await client.loginWithPassword(USERNAME, PASSWORD);
    console.log(`Logged in successfully with user ID: ${auth.user_id}`);
  } catch (e) {
    console.error(`Login failed: ${e}`);
    console.log(`
Common issues are:
- The server is not running (configured to use ${MATRIX_URL})
  - Check it is reachable at ${MATRIX_URL}/_matrix/client/versions
- The user is not registered on the matrix server
  - The sender uses the username ${USERNAME}
- The user is registered but the password is incorrect
    `);
    process.exit(1);
  }

  // Start client and wait for sync
  console.log('Starting Matrix client...');
  await client.startClient();

  // Wait for initial sync to complete
  await new Promise<void>((resolve) => {
    const onSync = (state: string) => {
      if (state === 'PREPARED') {
        client.removeListener(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });

  console.log('Matrix client synced');

  // Get rooms after client is synced
  const rooms = client.getRooms();
  console.log(`Found ${rooms.length} rooms`);

  let roomId: string | null = null;

  if (rooms.length > 0) {
    // Use the first room if any exists
    roomId = rooms[0].roomId;
    console.log(`Using existing room: ${roomId}`);
  } else {
    // Create a new room
    console.log('No rooms found, creating a new room...');
    try {
      const { room_id } = await client.createRoom({
        name: 'Test Room',
      });
      roomId = room_id;
      console.log(`Created new room: ${roomId}`);

      // Invite the AI bot
      console.log(`Inviting ${AI_BOT_USERNAME} to the room...`);
      await client.invite(
        roomId,
        `@${AI_BOT_USERNAME}:${new URL(MATRIX_URL).hostname}`,
      );
      console.log(`Invitation sent to ${AI_BOT_USERNAME}`);
    } catch (e) {
      console.error(`Failed to create room or invite: ${e}`);
      await client.logout();
      process.exit(1);
    }
  }

  // Set up readline interface for user input
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, logging out and exiting...');
    rl.close();
    await client.logout();
    process.exit(0);
  });

  // Message sending loop
  const askForMessage = () => {
    rl.question(
      'Enter message to send (or Ctrl+C to exit): ',
      async (message) => {
        if (message.trim()) {
          try {
            const response = await client.sendMessage(roomId!, {
              body: message,
              msgtype: 'm.text',
            });
            console.log(
              `Message sent successfully with event ID: ${response.event_id}`,
            );
          } catch (e) {
            console.error(`Failed to send message: ${e}`);
          }
        }

        // Ask for next message
        askForMessage();
      },
    );
  };

  // Start the message loop
  askForMessage();
}

main().catch((e) => {
  console.error(`Unhandled error: ${e}`);
  process.exit(1);
});
