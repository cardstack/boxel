import './setup-logger'; // This should be first
import { RoomMemberEvent, RoomEvent, createClient } from 'matrix-js-sdk';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import { param, query } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';

const log = logger('bot-runner');
const startTime = Date.now();

const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
const botUsername = process.env.BOT_RUNNER_USERNAME || 'bot-runner';
const botPassword = process.env.BOT_RUNNER_PASSWORD || 'password';

interface BotRegistration {
  id: string;
  created_at: string;
  username: string;
}

(async () => {
  let client = createClient({
    baseUrl: matrixUrl,
  });

  let auth = await client
    .loginWithPassword(botUsername, botPassword)
    .catch((error) => {
      log.error(error);
      log.error(
        `Bot runner could not login to Matrix at ${matrixUrl}. Check credentials and server availability.`,
      );
      process.exit(1);
    });

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

  async function getRegistrationsForUser(username: string) {
    let rows = await query(dbAdapter, [
      `SELECT br.id, br.username, br.created_at`,
      `FROM bot_registrations br`,
      `WHERE br.username = `,
      param(username),
    ]);
    return rows as BotRegistration[];
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

    let senderUsername = event.getSender();
    if (!senderUsername || senderUsername === auth.user_id) {
      return;
    }
    let registrations: Awaited<ReturnType<typeof getRegistrationsForUser>>;
    try {
      registrations = await getRegistrationsForUser(senderUsername);
    } catch (error) {
      log.error('failed to load bot registrations', error);
      return;
    }
    if (!registrations.length) {
      log.info('no registrations found for sender %s', senderUsername);
      return;
    }
    for (let registration of registrations) {
      let createdAt = Date.parse(registration.created_at);
      if (Number.isNaN(createdAt)) {
        continue;
      }
      if (event.event.origin_server_ts! < createdAt) {
        continue;
      }
      // TODO: filter out events we want to handle based on the registration (e.g. command messages, system events)
      // TODO: handle the event for this registration (e.g. enqueue a job).
    }
  });

  client.startClient();
  log.info('bot runner listening for Matrix events');
})().catch((error) => {
  log.error('bot runner failed to start', error);
  process.exit(1);
});
