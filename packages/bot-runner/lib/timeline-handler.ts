import { logger, param, query } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import type { DBAdapter, PgPrimitive } from '@cardstack/runtime-common';
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
}

export function onTimelineEvent({
  authUserId,
  dbAdapter,
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
      let eventType = event.getType?.() ?? event.event?.type;
      if (eventType !== 'app.boxel.bot-trigger') {
        return;
      }

      let eventContent = event.getContent?.() ?? event.event?.content;
      if (eventContent == null) {
        return;
      }
      log.debug('event content', eventContent);
      let senderUsername = getRoomCreator(room);
      if (!senderUsername) {
        return;
      }
      let botRunnerUsername = authUserId;

      let registrations = await getRegistrationsForUser(
        dbAdapter,
        senderUsername,
      );
      let botRunnerRegistrations = await getRegistrationsForUser(
        dbAdapter,
        botRunnerUsername,
      );
      if (!registrations.length && !botRunnerRegistrations.length) {
        return;
      }
      log.debug(
        `received event from ${senderUsername} in room ${room.roomId} with ${registrations.length} registrations`,
      );
      for (let registration of botRunnerRegistrations) {
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
      }
    } catch (error) {
      log.error('error handling timeline event', error);
      Sentry.captureException(error);
    }
  };
}

function getRoomCreator(room: Room | undefined): string | undefined {
  if (!room) {
    return;
  }
  let createEvent = room.currentState.getStateEvents('m.room.create', '');
  return createEvent?.getContent?.()?.creator;
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
    typeof row.created_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    created_at: row.created_at,
  };
}
