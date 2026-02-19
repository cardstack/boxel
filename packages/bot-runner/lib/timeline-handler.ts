import {
  isBotTriggerEvent,
  isBotCommandFilter,
  assertIsResolvedCodeRef,
  logger,
  param,
  query,
  userInitiatedPriority,
  ensureTrailingSlash,
} from '@cardstack/runtime-common';
import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import * as Sentry from '@sentry/node';
import type {
  DBAdapter,
  PgPrimitive,
  QueuePublisher,
} from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import type { MatrixEvent, Room } from 'matrix-js-sdk';

const log = logger('bot-runner');
export interface BotRegistration {
  id: string;
  created_at: string;
  username: string;
}

export interface TimelineHandlerOptions {
  authUserId: string;
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
}

export function onTimelineEvent({
  authUserId,
  dbAdapter,
  queuePublisher,
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
        let createdAt = Date.parse(registration.created_at);
        if (Number.isNaN(createdAt)) {
          continue;
        }
        let eventTimestamp = event.event.origin_server_ts;
        if (eventTimestamp == null || eventTimestamp < createdAt) {
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
        });
      }
      for (let registration of registrations) {
        let createdAt = Date.parse(registration.created_at);
        if (Number.isNaN(createdAt)) {
          continue;
        }
        let eventTimestamp = event.event.origin_server_ts;
        if (eventTimestamp == null || eventTimestamp < createdAt) {
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
}: {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  runAs: string;
  eventContent: { type?: unknown; input?: unknown; realm?: unknown };
  allowedCommands: { type: string; command: string }[];
}) {
  if (
    !allowedCommands.length ||
    typeof eventContent.type !== 'string' ||
    !allowedCommands.some((entry) => entry.type === eventContent.type)
  ) {
    return;
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
  let commandURL = commandRegistration?.command;
  let command = commandURL
    ? commandUrlToCodeRef(commandURL, realmURL)
    : undefined;
  let commandInput: Record<string, any> | null = input;

  if (!realmURL || !commandURL || !command) {
    log.warn(
      'bot trigger missing required input for command (need realmURL and command)',
      { realmURL, commandURL, command },
    );
    return;
  }

  assertIsResolvedCodeRef(command);

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

function commandUrlToCodeRef(
  commandUrl: string,
  realmURL: string | undefined,
): ResolvedCodeRef | undefined {
  if (!commandUrl) {
    return undefined;
  }

  try {
    let url = new URL(commandUrl);
    let path = url.pathname;

    // TODO: boxel-host commands are not exposed internally as HTTP URLs; they
    // are only available via module specifiers, so we map those URLs to code refs.
    let boxelHostPrefix = '/boxel-host/commands/';
    if (path.includes(boxelHostPrefix)) {
      let rest = path.split(boxelHostPrefix)[1] ?? '';
      let [commandName, exportName = 'default'] = rest.split('/');
      if (!commandName) {
        return undefined;
      }
      return {
        module: `@cardstack/boxel-host/commands/${commandName}`,
        name: exportName || 'default',
      };
    }

    let commandsPrefix = '/commands/';
    if (path.includes(commandsPrefix)) {
      if (!realmURL) {
        return undefined;
      }
      let rest = path.split(commandsPrefix)[1] ?? '';
      let [commandName, exportName = 'default'] = rest.split('/');
      if (!commandName) {
        return undefined;
      }
      return {
        module: `${ensureTrailingSlash(realmURL)}commands/${commandName}`,
        name: exportName || 'default',
      };
    }
  } catch {
    // ignore invalid URLs
  }

  return undefined;
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
  row: Record<string, PgPrimitive>,
): BotRegistration | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.username !== 'string' ||
    typeof row.created_at !== 'object'
  ) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    created_at: String(row.created_at),
  };
}
