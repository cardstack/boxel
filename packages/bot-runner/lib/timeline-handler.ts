import {
  isBotTriggerEvent,
  isBotCommandFilter,
  logger,
  param,
  query,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import * as Sentry from '@sentry/node';
import type { DBAdapter, QueuePublisher } from '@cardstack/runtime-common';
import {
  openCreateListingPR,
  type BotTriggerEventContent,
} from './create-listing-pr-handler';
import type { GitHubClient } from './github';
import type {
  DBAdapter,
  PgPrimitive,
  QueuePublisher,
} from '@cardstack/runtime-common';
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
        let eventTimestamp = event.event.origin_server_ts;
        if (
          eventTimestamp == null ||
          eventTimestamp < registration.created_at_ms
        ) {
        let createdAt = Date.parse(registration.created_at);
        if (Number.isNaN(createdAt)) {
          continue;
        }
        if (eventTimestamp < createdAt) {
          continue;
        }
        log.debug(
          `handling event for bot runner registration ${registration.id} in room ${room.roomId}`,
          eventContent,
        );
        let allowedCommands = await getCommandsForRegistration(
          dbAdapter,
          registration.id,
        );
        await maybeEnqueueCommand({
          dbAdapter,
          queuePublisher,
          runAs: senderUsername,
          eventContent,
          allowedCommands,
          githubClient,
        });
      }
      for (let registration of registrations) {
        let eventTimestamp = event.event.origin_server_ts;
        if (
          eventTimestamp == null ||
          eventTimestamp < registration.created_at_ms
        ) {
        let createdAt = Date.parse(registration.created_at);
        if (Number.isNaN(createdAt)) {
          continue;
        }
        if (eventTimestamp < createdAt) {
          continue;
        }
        // TODO: filter out events we want to handle based on the registration (e.g. command messages, system events)
        log.debug(
          `handling event for registration ${registration.id} in room ${room.roomId}`,
          eventContent,
        );
        let allowedCommands = await getCommandsForRegistration(
          dbAdapter,
          registration.id,
        );
        await maybeEnqueueCommand({
          dbAdapter,
          queuePublisher,
          runAs: senderUsername,
          eventContent,
          allowedCommands,
          githubClient,
        });
      }
    } catch (error) {
      log.error('error handling timeline event', error);
      Sentry.captureException(error);
    }
  };
}

async function maybeEnqueueCommand({
  dbAdapter,
  queuePublisher,
  runAs,
  eventContent,
  allowedCommands,
  githubClient,
}: {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  runAs: string;
  eventContent: BotTriggerEventContent;
  allowedCommands: { type: string; command: string }[];
  githubClient: GitHubClient;
}): Promise<void> {
  try {
    if (
      !allowedCommands.length ||
      typeof eventContent.type !== 'string' ||
      !allowedCommands.some((entry) => entry.type === eventContent.type)
    ) {
      return;
    }

    if (eventContent.type === 'pr-listing-create') {
      // Temporary workaround: handle PR creation directly until this flow is moved to a proper command path.
      await openCreateListingPR({
        eventContent,
        runAs,
        githubClient,
      });
    }

    if (!eventContent?.input || typeof eventContent.input !== 'object') {
      return;
    }

    let input = eventContent.input as Record<string, unknown>;
    let realmURL =
      typeof eventContent.realm === 'string' ? eventContent.realm : undefined;
    let commandRegistration = allowedCommands.find(
      (entry) => entry.type === eventContent.type,
    );
    let command = commandRegistration?.command?.trim();
    let commandInput: Record<string, any> | null = input;

    if (!realmURL || !command) {
      log.warn(
        'bot trigger missing required input for command (need realmURL and command)',
        { realmURL, command },
      );
      return;
    }

    await enqueueRunCommandJob(
      {
        realmURL,
        realmUsername: runAs,
        runAs,
        command,
        commandInput,
      },
      queuePublisher,
      dbAdapter,
      userInitiatedPriority,
    );
  } catch (error) {
    log.error('error in maybeEnqueueCommand', {
      runAs,
      eventType: eventContent.type,
      error,
    });
    throw error;
  }
}

function getRoomCreator(room: Room | undefined): string | undefined {
  return room?.getCreator?.() ?? undefined;
}

async function getCommandsForRegistration(
  dbAdapter: DBAdapter,
  registrationId: string,
): Promise<{ type: string; command: string }[]> {
  let rows = await query(dbAdapter, [
    `SELECT command_filter, command FROM bot_commands WHERE bot_id = `,
    param(registrationId),
  ]);

  let commands: { type: string; command: string }[] = [];
  for (let row of rows) {
    let filter = row.command_filter;
    if (!isBotCommandFilter(filter)) {
      continue;
    }
    if (typeof row.command !== 'string' || !row.command.trim()) {
      continue;
    }
    commands.push({ type: filter.content_type, command: row.command });
  }
  return commands;
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
