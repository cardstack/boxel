import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import fsExtra from 'fs-extra';
import type { PgAdapter } from '@cardstack/postgres';
import {
  fetchSessionRoom,
  insertPermissions,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import { NodeAdapter } from '../node-realm.ts';
import { insertUser, setupDB } from './helpers/index.ts';

module(basename(import.meta.filename), function (hooks) {
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

module(`${basename(import.meta.filename)} | file stat probing`, function () {
  test('openFile and lastModified treat a path nested under a regular file as nonexistent', async function (assert) {
    let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
    try {
      fsExtra.writeFileSync(join(dir, 'plain.txt'), 'hello');
      let adapter = new NodeAdapter(dir);

      assert.strictEqual(
        await adapter.openFile('plain.txt/nested'),
        undefined,
        'openFile reports not-found instead of throwing ENOTDIR',
      );
      assert.strictEqual(
        await adapter.lastModified('plain.txt/nested'),
        undefined,
        'lastModified reports not-found instead of throwing ENOTDIR',
      );
    } finally {
      fsExtra.removeSync(dir);
    }
  });

  test('openFile and lastModified treat a missing path as nonexistent', async function (assert) {
    let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
    try {
      let adapter = new NodeAdapter(dir);

      assert.strictEqual(await adapter.openFile('absent.txt'), undefined);
      assert.strictEqual(await adapter.lastModified('absent.txt'), undefined);
    } finally {
      fsExtra.removeSync(dir);
    }
  });

  test('readdir treats a directory that vanished before it is read as empty', async function (assert) {
    let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
    try {
      let adapter = new NodeAdapter(dir);

      // A directory a traversal expected to descend — a parent listing yielded
      // it — that a concurrent delete removes before this read opens it, e.g. a
      // published realm unpublished mid-mtimes-traversal. It lists as empty
      // rather than surfacing a raw scandir ENOENT, which would otherwise
      // escape the traversal as an unhandled rejection.
      let vanished: string[] = [];
      for await (let entry of adapter.readdir('published/vanished')) {
        vanished.push(entry.path);
      }
      assert.deepEqual(
        vanished,
        [],
        'a missing directory yields no entries instead of throwing ENOENT',
      );

      // A path whose target is a regular file is a genuine not-a-directory:
      // it must still surface ENOTDIR so directory-listing callers can reject
      // it, rather than being masked as a successful empty listing.
      fsExtra.writeFileSync(join(dir, 'plain.txt'), 'hello');
      let notDirError: NodeJS.ErrnoException | undefined;
      try {
        await adapter.readdir('plain.txt').next();
      } catch (err) {
        notDirError = err as NodeJS.ErrnoException;
      }
      assert.strictEqual(
        notDirError?.code,
        'ENOTDIR',
        'listing a regular file still throws ENOTDIR',
      );

      // A directory that exists still lists its entries.
      fsExtra.ensureDirSync(join(dir, 'real'));
      fsExtra.writeFileSync(join(dir, 'real', 'card.json'), '{}');
      let names: string[] = [];
      for await (let entry of adapter.readdir('real')) {
        names.push(entry.name);
      }
      assert.deepEqual(
        names,
        ['card.json'],
        'an existing directory still lists its entries',
      );
    } finally {
      fsExtra.removeSync(dir);
    }
  });
});
