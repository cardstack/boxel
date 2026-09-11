import type { DBAdapter } from './db.ts';
import { logger } from './log.ts';
import type { MatrixClient } from './matrix-client.ts';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from './matrix-constants.ts';
import {
  fetchSessionRoom,
  clearSessionRoom,
} from './db-queries/session-room-queries.ts';

const log = logger('matrix:send-event');

export type SendEventDeps = {
  matrixClient: MatrixClient;
  dbAdapter: DBAdapter;
};

export type SendEvent = (
  user: string,
  eventType: string,
  data?: Record<string, any>,
) => Promise<void>;

// Parse the JSON body a failed `matrixClient.sendEvent` carries on its Error
// message (the client stringifies `status <n> - <body>`), so callers can
// branch on the homeserver's errcode instead of substring-matching the whole
// message.
export function parseMatrixSendEventError(error: unknown): {
  status?: number;
  errcode?: string;
  error?: string;
} | null {
  if (!(error instanceof Error)) {
    return null;
  }

  let match = error.message.match(/status (\d+) - (\{.*\})$/);
  if (!match) {
    return null;
  }

  let [, status, body] = match;
  try {
    return {
      status: Number(status),
      ...(JSON.parse(body) as { errcode?: string; error?: string }),
    };
  } catch (_err) {
    return { status: Number(status) };
  }
}

// A send fails this way when the stored session room predates the current
// sender account (e.g. a room minted by a different bot before session-room
// creation consolidated onto one account). The row is stale: the sender was
// never a member. Callers clear it so the user's next auth mints a fresh room
// the current account is in.
export function isRealmServerNotInRoomError(
  error: unknown,
  roomId: string,
): boolean {
  let details = parseMatrixSendEventError(error);
  return Boolean(
    details?.status === 403 &&
    details?.errcode === 'M_FORBIDDEN' &&
    details?.error?.includes(`not in room ${roomId}`),
  );
}

// Build a best-effort "notify one user" sender addressed to that user's session
// DM room. Used by every server-side path that pokes a single running session
// (realm-permission grants, the grafana upsert handler, and so on) so the room
// lookup, login, message shape, and stale-room recovery live in one place.
export function createSendEvent({
  matrixClient,
  dbAdapter,
}: SendEventDeps): SendEvent {
  return async function sendEvent(user, eventType, data) {
    // The room lookup runs before any Matrix call: it is the step that can
    // make this a no-op, and it is a local database read, so a user with
    // nothing to receive never depends on the homeserver being reachable.
    let roomId = await fetchSessionRoom(dbAdapter, user);
    if (!roomId) {
      // No session room means nowhere to deliver to. Usually the user has
      // never established one, which is ordinary for a realm created by the
      // CLI, by an admin, or by a test fixture. `clearSessionRoom` also nulls
      // the column for a live session whose DM the realm server has left,
      // until that session mints a fresh room on its next `_server-session`
      // or realm auth — inside that window a notify the user would have
      // received is dropped here, at a level nothing surfaces, so an absent
      // row is not proof that nobody is listening. Either way there is
      // nothing addressable, and callers treat the notify as best-effort.
      log.debug(
        `skipping ${eventType} for ${user}: no session room to deliver to`,
      );
      return;
    }

    if (!matrixClient.isLoggedIn()) {
      await matrixClient.login();
    }

    try {
      await matrixClient.sendEvent(roomId, 'm.room.message', {
        body: JSON.stringify({ eventType, data }),
        msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
      });
    } catch (e) {
      if (isRealmServerNotInRoomError(e, roomId)) {
        // Stale room: the sender was never a member. Clear it so the user's
        // next auth re-mints one this account is in, and treat this notify as
        // the best-effort no-op it always was rather than surfacing a throw.
        let cleared = await clearSessionRoom(dbAdapter, user, roomId);
        log.warn(
          `skipping ${eventType} for ${user}: stale session room ${roomId} (sender not a member); cleared=${cleared}`,
        );
        return;
      }
      throw e;
    }
  };
}
