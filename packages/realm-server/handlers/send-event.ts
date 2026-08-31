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
    if (!matrixClient.isLoggedIn()) {
      await matrixClient.login();
    }
    let roomId = await fetchSessionRoom(dbAdapter, user);
    if (!roomId) {
      // No session room means nobody is listening: the user has never
      // established a session, which is ordinary for a realm created by the
      // CLI, by an admin, or by a test fixture. There is nothing to deliver
      // and nowhere to deliver it, so this is a skip rather than a failure —
      // sending anyway addressed a `null` room, which Matrix answered `403`
      // and every caller logged as a failed notify with a stack trace.
      log.debug(
        `skipping ${eventType} for ${user}: no session room, nothing is listening`,
      );
      return;
    }

    await matrixClient.sendEvent(roomId, 'm.room.message', {
      body: JSON.stringify({ eventType, data }),
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
    });
  };
}
