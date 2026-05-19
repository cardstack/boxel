import type { DBAdapter } from '@cardstack/runtime-common';
import { fetchSessionRoom } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

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
      console.error(
        `Failed to send event: ${eventType}, cannot find session room for user: ${user}`,
      );
    }

    await matrixClient.sendEvent(roomId!, 'm.room.message', {
      body: JSON.stringify({ eventType, data }),
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
    });
  };
}
