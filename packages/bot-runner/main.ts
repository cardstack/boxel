import './instrument';
import './setup-logger'; // This should be first
import { RoomMemberEvent, RoomEvent, createClient } from 'matrix-js-sdk';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import { onMembershipEvent } from './lib/membership-handler';
import { onTimelineEvent } from './lib/timeline-handler';

const log = logger('bot-runner');
const startTime = Date.now();

const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
const submissionBotUsername =
  process.env.SUBMISSION_BOT_USERNAME || 'submissionbot';
const botPassword = process.env.SUBMISSION_BOT_PASSWORD || 'password';

(async () => {
  let client = createClient({
    baseUrl: matrixUrl,
  });

  let auth;
  try {
    auth = await client.loginWithPassword(submissionBotUsername, botPassword);
  } catch (error) {
    throw new Error(
      `Bot runner could not login to Matrix at ${matrixUrl}. Check credentials and server availability.`,
      { cause: error },
    );
  }

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

  client.on(
    RoomMemberEvent.Membership,
    onMembershipEvent({
      client,
      authUserId: auth.user_id,
      startTime,
    }),
  );

  let handleTimelineEvent = onTimelineEvent({
    authUserId: auth.user_id,
    dbAdapter,
  });
  client.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
    await handleTimelineEvent(event, room, toStartOfTimeline);
  });

  client.startClient();
  log.info('bot runner listening for Matrix events');
})().catch((error) => {
  log.error('bot runner failed to start', error);
  Sentry.captureException(error);
});
