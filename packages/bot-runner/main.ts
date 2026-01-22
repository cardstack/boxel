import './setup-logger'; // This should be first
import { RoomMemberEvent, RoomEvent, createClient } from 'matrix-js-sdk';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import { query } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';

const log = logger('bot-runner');
const startTime = Date.now();

const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
const botUsername = process.env.BOT_RUNNER_USERNAME || 'bot-runner';
const botPassword = process.env.BOT_RUNNER_PASSWORD || 'password';

(async () => {
  let client = createClient({
    baseUrl: matrixUrl,
  });

  let auth = await client.loginWithPassword(botUsername, botPassword).catch(
    (error) => {
      log.error(error);
      log.error(
        `Bot runner could not login to Matrix at ${matrixUrl}. Check credentials and server availability.`,
      );
      process.exit(1);
    },
  );

  log.info(`logged in as ${auth.user_id}`);

  let dbAdapter = new PgAdapter();
  let queuePublisher = new PgQueuePublisher(dbAdapter);

  const shutdown = async () => {
    log.info('shutting down bot runner...');
    try {
      await queuePublisher.destroy();
      await dbAdapter.close();
    } catch (error) {
      log.error('error during shutdown', error);
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  async function getRegisteredUsers() {
    let rows = await query(dbAdapter, [
      `SELECT u.matrix_user_id, br.created_at`,
      `FROM bot_registrations br`,
      `JOIN users u ON u.id = br.user_id`,
    ]);
    let users = new Map<string, number>();
    for (let row of rows as Array<{ matrix_user_id: string; created_at: string }>) {
      if (!row.matrix_user_id || !row.created_at) {
        continue;
      }
      let createdAtMs = Date.parse(row.created_at);
      if (Number.isNaN(createdAtMs)) {
        continue;
      }
      users.set(row.matrix_user_id, createdAtMs);
    }
    return users;
  }

  let registeredUsers = new Map<string, number>();
  try {
    registeredUsers = await getRegisteredUsers();
  } catch (error) {
    log.error('failed to load bot registrations', error);
    process.exit(1);
  }

  client.on(RoomMemberEvent.Membership, function (event, member) {
    if (event.event.origin_server_ts! < startTime) {
      return;
    }
    if (member.membership === 'invite' && member.userId === auth.user_id) {
      client
        .joinRoom(member.roomId)
        .then(function () {
          log.info('%s auto-joined %s', member.name, member.roomId);
        })
        .catch(function (err) {
          log.info(
            'Error joining room after invite (user may have left before join)',
            err,
          );
        });
    }
  });

  client.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
    if (!room || toStartOfTimeline) {
      return;
    }
    if (room.getMyMembership() !== 'join') {
      return;
    }

    let senderMatrixUserId = event.getSender();
    if (!senderMatrixUserId || senderMatrixUserId === auth.user_id) {
      return;
    }
    let registrationCreatedAt = registeredUsers.get(senderMatrixUserId);
    if (!registrationCreatedAt) {
      return;
    }
    if (event.event.origin_server_ts! < registrationCreatedAt) {
      return;
    }

    let eventBody = event.getContent()?.body || '';
    log.info(
      'received event in room %s (%s): %s',
      room.name,
      room.roomId,
      eventBody,
    );

    // TODO: filter out events we want to handle (e.g. command messages, system events)
    // TODO: enqueue bot command job via queuePublisher.publish(...)
  });

  client.startClient();
  log.info('bot runner listening for Matrix events');
})().catch((error) => {
  log.error('bot runner failed to start', error);
  process.exit(1);
});
