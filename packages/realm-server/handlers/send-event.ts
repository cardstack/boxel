import type { DBAdapter } from '@cardstack/runtime-common';
import { fetchSessionRoom, logger } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

const log = logger('realm-server:send-event');

export type SendEventDeps = {
  matrixClient: MatrixClient;
  dbAdapter: DBAdapter;
};

export type SendEvent = (
  user: string,
  eventType: string,
  data?: Record<string, any>,
) => Promise<void>;

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

    await matrixClient.sendEvent(roomId, 'm.room.message', {
      body: JSON.stringify({ eventType, data }),
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
    });
  };
}
