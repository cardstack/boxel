import './setup-logger'; // This should be first
import { RoomEvent, MsgType } from 'matrix-js-sdk';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import {
  logger,
  uuidv4,
  submissionBotUsername,
} from '@cardstack/runtime-common';
import {
  createBotMatrixClient,
  acquireRoomLock,
  releaseRoomLock,
  createShutdownHandler,
  setupSignalHandlers,
  isShuttingDown,
  createSlidingSync,
  setupAutoJoinOnInvite,
} from '@cardstack/bot-core';
import { PgAdapter } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('submission-bot');

// Bot configuration
const botInstanceId = uuidv4();

// Track active submissions for graceful shutdown
const activeSubmissions = new Map<
  string,
  { roomId: string; startedAt: number }
>();

// Room state event type for submission context
const SUBMISSION_CONTEXT_EVENT_TYPE = 'com.cardstack.submission_context';

interface SubmissionContext {
  /** What is being submitted (e.g., PR URL, card ID) */
  target: string;
  /** Type of submission */
  type: 'pull-request' | 'card' | 'other';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Whether to start processing immediately after joining */
  autoStart?: boolean;
}

/**
 * Sends a text message to a room.
 */
async function sendTextMessage(
  client: Awaited<ReturnType<typeof createBotMatrixClient>>['client'],
  roomId: string,
  message: string,
): Promise<void> {
  await client.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body: message,
    format: 'org.matrix.custom.html',
    formatted_body: message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
  });
}

/**
 * Sends a greeting message when the bot joins a room.
 */
async function sendGreetingMessage(
  client: Awaited<ReturnType<typeof createBotMatrixClient>>['client'],
  roomId: string,
  context?: SubmissionContext,
): Promise<void> {
  let message: string;

  if (context) {
    switch (context.type) {
      case 'pull-request':
        message = `Hi! 👋 I'm the Submission Bot. I see you want to submit a pull request: **${context.target}**\n\nI'll help you with the submission process. Let me check the details...`;
        break;
      case 'card':
        message = `Hi! 👋 I'm the Submission Bot. I'll help you submit: **${context.target}**`;
        break;
      default:
        message = `Hi! 👋 I'm the Submission Bot. I'm ready to help with your submission.`;
    }
  } else {
    message = `Hi! 👋 I'm the Submission Bot. I was invited to this room but didn't receive any submission context. Please use the invite command with proper parameters.`;
  }

  await sendTextMessage(client, roomId, message);
}

/**
 * Retrieves submission context from room state.
 */
async function getSubmissionContext(
  client: Awaited<ReturnType<typeof createBotMatrixClient>>['client'],
  roomId: string,
): Promise<SubmissionContext | undefined> {
  try {
    const stateEvent = await client.getStateEvent(
      roomId,
      SUBMISSION_CONTEXT_EVENT_TYPE,
      '',
    );
    return stateEvent as SubmissionContext;
  } catch (e) {
    // State event doesn't exist
    log.debug(`No submission context found for room ${roomId}`);
    return undefined;
  }
}

/**
 * Handles the submission flow for a pull request.
 */
async function handlePullRequestSubmission(
  client: Awaited<ReturnType<typeof createBotMatrixClient>>['client'],
  roomId: string,
  context: SubmissionContext,
): Promise<void> {
  const submissionId = uuidv4();
  activeSubmissions.set(submissionId, { roomId, startedAt: Date.now() });

  try {
    await sendTextMessage(client, roomId, '🔍 Analyzing pull request...');

    // TODO: Implement actual PR submission logic
    // - Fetch PR details from GitHub API
    // - Validate PR meets requirements
    // - Create/update relevant cards
    // - Report status back to room

    await sendTextMessage(
      client,
      roomId,
      '✅ Pull request analysis complete. (Implementation pending)',
    );
  } finally {
    activeSubmissions.delete(submissionId);
  }
}

/**
 * Handles timeline events in rooms.
 */
async function handleTimelineEvent(
  client: Awaited<ReturnType<typeof createBotMatrixClient>>['client'],
  pgAdapter: PgAdapter,
  botUserId: string,
  event: MatrixEvent,
  room: Room | undefined,
  startTime: number,
): Promise<void> {
  if (!room) return;

  const eventId = event.getId()!;
  const senderUserId = event.getSender()!;

  // Ignore old events
  if (event.event.origin_server_ts! < startTime) return;

  // Ignore own messages
  if (senderUserId === botUserId) return;

  // Only respond to message events
  if (event.getType() !== 'm.room.message') return;

  const eventBody = event.getContent().body || '';

  // Acquire room lock to prevent concurrent processing
  const gotLock = await acquireRoomLock(
    pgAdapter,
    room.roomId,
    botInstanceId,
    eventId,
  );

  if (!gotLock) {
    log.debug(`Could not acquire lock for room ${room.roomId}, skipping`);
    return;
  }

  try {
    if (isShuttingDown()) {
      return;
    }

    log.info(
      `[${room.roomId}] Processing message from ${senderUserId}: ${eventBody.substring(0, 50)}...`,
    );

    // TODO: Implement command parsing and handling
    // Example commands the submission bot might handle:
    // - "submit PR <url>" - Submit a pull request
    // - "status" - Check submission status
    // - "cancel" - Cancel current submission

    if (eventBody.toLowerCase().startsWith('submit pr ')) {
      const prUrl = eventBody.substring('submit pr '.length).trim();
      const context: SubmissionContext = {
        target: prUrl,
        type: 'pull-request',
      };
      await handlePullRequestSubmission(client, room.roomId, context);
    } else if (eventBody.toLowerCase() === 'status') {
      await sendTextMessage(
        client,
        room.roomId,
        `📊 Active submissions: ${activeSubmissions.size}`,
      );
    } else if (eventBody.toLowerCase() === 'help') {
      await sendTextMessage(
        client,
        room.roomId,
        `**Submission Bot Commands:**
- \`submit pr <url>\` - Submit a pull request for review
- \`status\` - Check current submission status
- \`help\` - Show this help message`,
      );
    }
  } catch (e) {
    log.error(`Error processing event ${eventId}:`, e);
    Sentry.captureException(e, {
      extra: { roomId: room.roomId, eventId },
    });
  } finally {
    await releaseRoomLock(pgAdapter, room.roomId);
  }
}

// Main entry point
(async () => {
  const startTime = Date.now();
  const matrixUrl = process.env.MATRIX_URL || 'http://localhost:8008';
  const enableDebugLogging = !process.env.DISABLE_MATRIX_JS_LOGGING;

  log.info('Starting Submission Bot...');

  // Create and authenticate Matrix client using bot-core
  const { client, userId: botUserId } = await createBotMatrixClient({
    matrixUrl,
    username: submissionBotUsername,
    password: process.env.BOXEL_SUBMISSION_BOT_PASSWORD || 'pass',
    enableDebugLogging,
  }).catch((e) => {
    log.error('Failed to create Matrix client:', e);
    process.exit(1);
  });

  const pgAdapter = new PgAdapter();

  // Set up graceful shutdown using bot-core
  const handleShutdown = createShutdownHandler({
    activeWork: activeSubmissions,
    workLabel: 'active submissions',
  });
  setupSignalHandlers({
    onShutdown: handleShutdown,
    botName: 'submission-bot',
  });

  // Set up auto-join on invite using bot-core
  // Key difference from ai-bot: we send a greeting message when joining!
  setupAutoJoinOnInvite({
    client,
    botUserId,
    ignoreEventsBefore: startTime,
    botName: 'submission-bot',
    onRoomJoined: async (roomId: string) => {
      log.info(`Joined room ${roomId}, sending greeting...`);

      // Get submission context from room state (set by invite command)
      const context = await getSubmissionContext(client, roomId);

      // Send greeting message (bot sends first!)
      await sendGreetingMessage(client, roomId, context);

      // If autoStart is enabled, begin processing immediately
      if (context?.autoStart && context.type === 'pull-request') {
        await handlePullRequestSubmission(client, roomId, context);
      }
    },
  });

  // Set up timeline event handler
  client.on(
    RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      if (toStartOfTimeline) return; // Don't process paginated results

      await handleTimelineEvent(
        client,
        pgAdapter,
        botUserId,
        event,
        room,
        startTime,
      );
    },
  );

  // Set up sliding sync using bot-core
  const slidingSync = createSlidingSync({ client });
  await client.startClient({ slidingSync });

  log.info('Submission Bot started successfully');
})().catch((e) => {
  log.error('Fatal error:', e);
  Sentry.captureException(e);
  process.exit(1);
});
