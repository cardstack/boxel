import {
  isBotTriggerEvent,
  logger,
  param,
  query,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import { CommandRunner } from './command-runner';
import type { GitHubClient } from './github';
import type { DBAdapter, QueuePublisher } from '@cardstack/runtime-common';
import type { MatrixEvent, Room } from 'matrix-js-sdk';

const log = logger('bot-runner');
export interface BotRegistration {
  id: string;
  created_at_ms: number;
  username: string;
}

export interface TimelineHandlerOptions {
  authUserId: string;
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  githubClient: GitHubClient;
  startTime: number;
}

export function onTimelineEvent({
  authUserId,
  dbAdapter,
  queuePublisher,
  githubClient,
  startTime,
}: TimelineHandlerOptions) {
  let commandRunner = new CommandRunner(dbAdapter, queuePublisher, githubClient);
  return async function handleTimelineEvent(
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
  ) {
    try {
      if (!room || toStartOfTimeline) {
        return;
      }
      let rawEvent = event.event ?? event;
      if (!isBotTriggerEvent(rawEvent)) {
        return;
      }
      let eventTimestamp = rawEvent.origin_server_ts;
      if (eventTimestamp == null || eventTimestamp < startTime) {
        return;
      }
      let eventContent = rawEvent.content;
      log.debug('event content', eventContent);
      let senderUsername =
        event.getSender?.() ??
        (typeof rawEvent.sender === 'string' ? rawEvent.sender : undefined) ??
        getRoomCreator(room);
      if (!senderUsername) {
        return;
      }
      let submissionBotUserId = authUserId;

      let registrations = await getRegistrationsForUser(
        dbAdapter,
        senderUsername,
      );
      let submissionBotRegistrations = await getRegistrationsForUser(
        dbAdapter,
        submissionBotUserId,
      );
      if (!registrations.length && !submissionBotRegistrations.length) {
        return;
      }
      log.debug(
        `received event from ${senderUsername} in room ${room.roomId} with ${registrations.length} registrations`,
      );
      for (let registration of submissionBotRegistrations) {
        if (eventTimestamp < registration.created_at_ms) {
          continue;
        }
        log.debug(
          `handling event for bot runner registration ${registration.id} in room ${room.roomId}`,
          eventContent,
        );
        await commandRunner.maybeEnqueueCommand(
          senderUsername,
          eventContent,
          registration.id,
        );
      }
      for (let registration of registrations) {
        if (eventTimestamp < registration.created_at_ms) {
          continue;
        }
        // TODO: filter out events we want to handle based on the registration (e.g. command messages, system events)
        log.debug(
          `handling event for registration ${registration.id} in room ${room.roomId}`,
          eventContent,
        );
        await commandRunner.maybeEnqueueCommand(
          senderUsername,
          eventContent,
          registration.id,
        );
      }
    } catch (error) {
      log.error('error handling timeline event', error);
      Sentry.captureException(error);
    }
  };
}

function getRoomCreator(room: Room | undefined): string | undefined {
  return room?.getCreator?.() ?? undefined;
}

async function getRegistrationsForUser(
  dbAdapter: DBAdapter,
  username: string,
): Promise<BotRegistration[]> {
  let rows = await query(dbAdapter, [
    `SELECT br.id, br.username, br.created_at`,
    `FROM bot_registrations br`,
    `WHERE br.username = `,
    param(username),
  ]);

  let registrations: BotRegistration[] = [];
  for (let row of rows) {
    let registration = toBotRegistration(row);
    if (registration) {
      registrations.push(registration);
    }
  }
  return registrations;
}

function toBotRegistration(
  row: Record<string, unknown>,
): BotRegistration | null {
  if (typeof row.id !== 'string' || typeof row.username !== 'string') {
    return null;
  }
  let createdAtMs = toEpochMs(row.created_at);
  if (createdAtMs == null) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    created_at_ms: createdAtMs,
  };
}

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    let time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    let parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
