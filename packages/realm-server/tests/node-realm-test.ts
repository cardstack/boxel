import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  fetchSessionRoom,
  insertPermissions,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import { NodeAdapter } from '../node-realm';
import { insertUser, setupDB } from './helpers';

module(basename(__filename), function (hooks) {
  let dbAdapter: PgAdapter;
  const realmURL = new URL('http://127.0.0.1:4444/test/');
  const staleRoomId = '!room-alice:localhost';

  setupDB(hooks, {
    beforeEach: async (_dbAdapter) => {
      dbAdapter = _dbAdapter;
    },
  });

  async function insertSessionForAlice() {
    await insertUser(
      dbAdapter,
      '@alice:localhost',
      'cus_alice',
      'alice@example.com',
    );
    await upsertSessionRoom(dbAdapter, '@alice:localhost', staleRoomId);
    await insertPermissions(dbAdapter, realmURL, {
      '@alice:localhost': ['read'],
    });
  }

  function makeEvent(): RealmEventContent {
    return {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [`${realmURL.href}card`],
      clientRequestId: null,
      realmURL: realmURL.href,
    };
  }

  test('clears a stale session room when the realm server is no longer in it', async function (assert) {
    await insertSessionForAlice();

    let sendEventCalls = 0;
    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      sendEvent: async () => {
        sendEventCalls++;
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 403 - {"errcode":"M_FORBIDDEN","error":"User @realm_server:localhost not in room ${staleRoomId}"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp');
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.strictEqual(
      sendEventCalls,
      1,
      'attempted to send to the stale room',
    );
    assert.strictEqual(
      await fetchSessionRoom(dbAdapter, '@alice:localhost'),
      null,
      'clears the stale session room from the user record',
    );
  });

  test('keeps the session room when the send failure is unrelated', async function (assert) {
    await insertSessionForAlice();

    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      sendEvent: async () => {
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 500 - {"errcode":"M_UNKNOWN","error":"boom"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp');
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.strictEqual(
      await fetchSessionRoom(dbAdapter, '@alice:localhost'),
      staleRoomId,
      'leaves the stored session room alone for other send errors',
    );
  });

  test('does not reject when clearing a stale session room fails', async function (assert) {
    await insertSessionForAlice();
    let originalExecute = dbAdapter.execute.bind(dbAdapter);
    let failCleanup = false;
    dbAdapter.execute = (async (
      ...args: Parameters<typeof dbAdapter.execute>
    ) => {
      if (failCleanup) {
        throw new Error('boom');
      }
      return await originalExecute(...args);
    }) as typeof dbAdapter.execute;

    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      sendEvent: async () => {
        failCleanup = true;
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 403 - {"errcode":"M_FORBIDDEN","error":"User @realm_server:localhost not in room ${staleRoomId}"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp');

    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.true(true, 'broadcast resolves even if stale room cleanup fails');
  });
});
