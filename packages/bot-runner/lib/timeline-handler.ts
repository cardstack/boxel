import { param, query } from '@cardstack/runtime-common';
import type { DBAdapter, PgPrimitive } from '@cardstack/runtime-common';
import type { MatrixEvent, Room } from 'matrix-js-sdk';

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
    if (!room || toStartOfTimeline) {
      return;
    }
    if (room.getMyMembership() !== 'join') {
      return;
    }

    let senderUsername = event.getSender();
    if (!senderUsername || senderUsername === authUserId) {
      return;
    }

    let registrations: BotRegistration[];
    try {
      registrations = await getRegistrationsForUser(dbAdapter, senderUsername);
    } catch (error) {
      return;
    }
    if (!registrations.length) {
      return;
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
      // TODO: handle the event for this registration (e.g. enqueue a job).
    }
  };
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
