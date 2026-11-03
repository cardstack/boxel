import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import fsExtra from 'fs-extra';
import type { PgAdapter } from '@cardstack/postgres';
import {
  fetchRealmEventRoom,
  fetchSessionRoom,
  insertPermissions,
  insertRealmEventRoom,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import { NodeAdapter } from '../node-realm.ts';
import { RealmEventDispatcher } from '../realm-event-dispatcher.ts';
import { MatrixRequestError } from '@cardstack/runtime-common/matrix-client';
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
      isLoggedIn: () => true,
      nextTxnId: () => 'txn-1',
      sendEvent: async () => {
        sendEventCalls++;
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 403 - {"errcode":"M_FORBIDDEN","error":"User @realm_server:localhost not in room ${staleRoomId}"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp', false, new RealmEventDispatcher());
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
      isLoggedIn: () => true,
      nextTxnId: () => 'txn-1',
      sendEvent: async () => {
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 500 - {"errcode":"M_UNKNOWN","error":"boom"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp', false, new RealmEventDispatcher());
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
      isLoggedIn: () => true,
      nextTxnId: () => 'txn-1',
      sendEvent: async () => {
        failCleanup = true;
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 403 - {"errcode":"M_FORBIDDEN","error":"User @realm_server:localhost not in room ${staleRoomId}"}`,
        );
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp', false, new RealmEventDispatcher());

    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.true(true, 'broadcast resolves even if stale room cleanup fails');
  });

  test('retries a send synapse answers as overloaded, with the same transaction id', async function (assert) {
    await insertSessionForAlice();

    let txnIds: string[] = [];
    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => `txn-${txnIds.length}`,
      sendEvent: async (
        _roomId: string,
        _type: string,
        _content: unknown,
        txnId: string,
      ) => {
        txnIds.push(txnId);
        if (txnIds.length === 1) {
          throw new MatrixRequestError(
            `Unable to send room event 'app.boxel.realm-event' to room ${staleRoomId}: status 504 - non-JSON body (122 bytes)`,
            504,
          );
        }
        return '$event';
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter(
      '/tmp',
      false,
      new RealmEventDispatcher({ initialBackoffMs: 1 }),
    );
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.deepEqual(
      txnIds,
      ['txn-0', 'txn-0'],
      'the retry reuses the transaction id of the first attempt',
    );
    assert.strictEqual(
      await fetchSessionRoom(dbAdapter, '@alice:localhost'),
      staleRoomId,
      'an overloaded homeserver does not clear the session room',
    );
  });

  test('logs in again after a login synapse answers as overloaded, rather than skip the event', async function (assert) {
    await insertSessionForAlice();

    let logins = 0;
    let sent: string[] = [];
    let matrixClient = {
      login: async () => {
        logins++;
        if (logins === 1) {
          throw new MatrixRequestError(
            `Unable to login to matrix: status 502 - non-JSON body (150 bytes)`,
            502,
          );
        }
      },
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => 'txn-1',
      sendEvent: async (roomId: string) => {
        sent.push(roomId);
        return '$event';
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter(
      '/tmp',
      false,
      new RealmEventDispatcher({ initialBackoffMs: 1 }),
    );
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.strictEqual(logins, 2, 'the login is tried again after a pause');
    assert.deepEqual(sent, [staleRoomId], 'the event still reaches the room');
  });

  test('delivers only to the named recipients when the broadcast names any', async function (assert) {
    await insertSessionForAlice();
    await insertUser(
      dbAdapter,
      '@carol:localhost',
      'cus_carol',
      'c@example.com',
    );
    await upsertSessionRoom(
      dbAdapter,
      '@carol:localhost',
      '!room-carol:localhost',
    );
    await insertPermissions(dbAdapter, realmURL, {
      '@carol:localhost': ['read'],
    });

    let sentTo: string[] = [];
    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => `txn-${sentTo.length}`,
      sendEvent: async (roomId: string) => {
        sentTo.push(roomId);
        return '$event';
      },
    } as unknown as MatrixClient;

    let adapter = new NodeAdapter('/tmp', false, new RealmEventDispatcher());
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );
    assert.deepEqual(
      sentTo.sort(),
      ['!room-alice:localhost', '!room-carol:localhost'],
      'with no recipients, every subscriber receives the event',
    );

    sentTo = [];
    await adapter.broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
      { recipients: ['@carol:localhost', '@nobody:localhost'] },
    );
    assert.deepEqual(
      sentTo,
      ['!room-carol:localhost'],
      "only the named subscriber's room receives the event",
    );
  });

  function recordingMatrixClient() {
    let sentTo: string[] = [];
    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => 'txn',
      sendEvent: async (roomId: string) => {
        sentTo.push(roomId);
        return '$event';
      },
    } as unknown as MatrixClient;
    return { matrixClient, sentTo };
  }

  async function insertSessionFor(user: string, roomId: string) {
    let name = user.slice(1, user.indexOf(':'));
    await insertUser(dbAdapter, user, `cus_${name}`, `${name}@example.com`);
    await upsertSessionRoom(dbAdapter, user, roomId);
  }

  test("sends a private realm's event once, into the realm's event room", async function (assert) {
    await insertSessionFor('@alice:localhost', '!alice:localhost');
    await insertSessionFor('@bob:localhost', '!bob:localhost');
    await insertPermissions(dbAdapter, realmURL, {
      '@alice:localhost': ['read', 'write'],
      '@bob:localhost': ['read'],
    });
    await insertRealmEventRoom(dbAdapter, realmURL.href, '!events:localhost');

    let { matrixClient, sentTo } = recordingMatrixClient();
    await new NodeAdapter('/tmp').broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.deepEqual(
      sentTo,
      ['!events:localhost'],
      'sent to the realm event room and to no session room',
    );
  });

  test("sends a private realm's event to session rooms until it has an event room", async function (assert) {
    await insertSessionFor('@alice:localhost', '!alice:localhost');
    await insertSessionFor('@bob:localhost', '!bob:localhost');
    await insertPermissions(dbAdapter, realmURL, {
      '@alice:localhost': ['read', 'write'],
      '@bob:localhost': ['read'],
    });

    let { matrixClient, sentTo } = recordingMatrixClient();
    await new NodeAdapter('/tmp').broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.deepEqual(
      sentTo.sort(),
      ['!alice:localhost', '!bob:localhost'],
      "sent to each grantee's session room",
    );
  });

  test("sends a world-readable realm's event to session rooms even when it has an event room", async function (assert) {
    await insertSessionFor('@alice:localhost', '!alice:localhost');
    await insertPermissions(dbAdapter, realmURL, {
      '*': ['read'],
      '@alice:localhost': ['read', 'write'],
    });
    await insertRealmEventRoom(dbAdapter, realmURL.href, '!events:localhost');

    let { matrixClient, sentTo } = recordingMatrixClient();
    await new NodeAdapter('/tmp').broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
    );

    assert.deepEqual(
      sentTo,
      ['!alice:localhost'],
      "the room holds only named users, so a world-readable realm's readers would not hear it",
    );
  });

  test('sends an event meant for named recipients to their session rooms, not to the event room', async function (assert) {
    await insertSessionFor('@alice:localhost', '!alice:localhost');
    await insertSessionFor('@bob:localhost', '!bob:localhost');
    await insertPermissions(dbAdapter, realmURL, {
      '@alice:localhost': ['read', 'write'],
      '@bob:localhost': ['read'],
    });
    await insertRealmEventRoom(dbAdapter, realmURL.href, '!events:localhost');

    let { matrixClient, sentTo } = recordingMatrixClient();
    await new NodeAdapter('/tmp').broadcastRealmEvent(
      makeEvent(),
      realmURL.href,
      matrixClient,
      dbAdapter,
      { recipients: ['@alice:localhost'] },
    );

    assert.deepEqual(sentTo, ['!alice:localhost']);
  });

  test("forgets a private realm's event room the realm server is no longer in", async function (assert) {
    await insertPermissions(dbAdapter, realmURL, {
      '@alice:localhost': ['read'],
    });
    await insertRealmEventRoom(dbAdapter, realmURL.href, '!events:localhost');

    let matrixClient = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => 'txn-1',
      sendEvent: async () => {
        throw new Error(
          `Unable to send room event 'app.boxel.realm-event' to room !events:localhost: status 403 - {"errcode":"M_FORBIDDEN","error":"User @realm_server:localhost not in room !events:localhost"}`,
        );
      },
    } as unknown as MatrixClient;

    await new NodeAdapter(
      '/tmp',
      false,
      new RealmEventDispatcher(),
    ).broadcastRealmEvent(makeEvent(), realmURL.href, matrixClient, dbAdapter);

    assert.deepEqual(
      await fetchRealmEventRoom(dbAdapter, realmURL.href),
      { isPrivate: true, roomId: null },
      'the next host to ask gets a new room',
    );
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

  test('file operations refuse a path that resolves outside the realm directory', async function (assert) {
    let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
    try {
      let realmDir = join(dir, 'realm');
      fsExtra.ensureDirSync(realmDir);
      fsExtra.writeFileSync(join(dir, 'outside.txt'), 'outside');
      fsExtra.writeFileSync(join(realmDir, '..inside.txt'), 'inside');
      let adapter = new NodeAdapter(realmDir);
      let outside = '../outside.txt' as LocalPath;

      await assert.rejects(adapter.openFile(outside), /outside the realm/);
      await assert.rejects(adapter.exists(outside), /outside the realm/);
      await assert.rejects(adapter.write(outside, 'x'), /outside the realm/);
      await assert.rejects(adapter.remove(outside), /outside the realm/);
      assert.strictEqual(
        fsExtra.readFileSync(join(dir, 'outside.txt'), 'utf8'),
        'outside',
        'the file outside the realm is untouched',
      );
      assert.true(
        await adapter.exists('..inside.txt'),
        'a name that only starts with two dots is inside the realm',
      );
    } finally {
      fsExtra.removeSync(dir);
    }
  });

  test('lastModified and openFile report the second mtimeMs falls in, even in its last half-millisecond', async function (assert) {
    let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
    try {
      let path = join(dir, 'late.txt');
      fsExtra.writeFileSync(path, 'hello');
      // An mtime 0.4ms before the next second, which `Stats.mtime` rounds up
      // into that next second and `mtimeMs` does not.
      let seconds = 1791998271;
      fsExtra.utimesSync(path, seconds + 0.9996, seconds + 0.9996);
      let stat = fsExtra.statSync(path);
      assert.strictEqual(
        Math.floor(stat.mtime.getTime() / 1000),
        seconds + 1,
        `the file system keeps sub-millisecond mtimes (mtimeMs ${stat.mtimeMs}), so the rounded Date lands in the next second`,
      );

      let adapter = new NodeAdapter(dir);
      assert.strictEqual(
        await adapter.lastModified('late.txt'),
        seconds,
        'lastModified reports the second mtimeMs falls in',
      );
      let ref = await adapter.openFile('late.txt');
      assert.strictEqual(
        ref?.lastModified,
        seconds,
        'openFile reports the second mtimeMs falls in',
      );
      assert.strictEqual(
        ref?.lastModified,
        Math.floor(ref!.lastModifiedMs! / 1000),
        'openFile’s whole-second time agrees with its own lastModifiedMs',
      );
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

module(
  `${basename(import.meta.filename)} | file content and length`,
  function () {
    async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
      let chunks: Buffer[] = [];
      for await (let chunk of stream) {
        chunks.push(Buffer.from(chunk as Buffer));
      }
      return Buffer.concat(chunks).toString('utf8');
    }

    test('openContent reports the length of the bytes it streams, not the earlier stat', async function (assert) {
      let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
      try {
        fsExtra.writeFileSync(join(dir, 'page.html'), '<p>hello world</p>');
        let adapter = new NodeAdapter(dir);
        let ref = await adapter.openFile('page.html');

        // The file changes between the stat the ref was opened with and the
        // read, as when another host rewrites it.
        fsExtra.writeFileSync(join(dir, 'page.html'), '<p>hello</p>');
        let opened = ref!.openContent!();

        assert.strictEqual(
          opened.size,
          Buffer.byteLength('<p>hello</p>'),
          'the length describes the content that is streamed',
        );
        assert.strictEqual(
          await readAll(opened.content as NodeJS.ReadableStream),
          '<p>hello</p>',
          'the stream delivers the content the length describes',
        );
        assert.strictEqual(
          ref!.content,
          opened.content,
          'content and openContent share one stream',
        );
      } finally {
        fsExtra.removeSync(dir);
      }
    });

    test('write replaces a file whole, so a read already open keeps the content it opened', async function (assert) {
      let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
      try {
        let adapter = new NodeAdapter(dir);
        let original = 'a'.repeat(64 * 1024);
        await adapter.write('page.html', original);
        let opened = (await adapter.openFile('page.html'))!.openContent!();

        await adapter.write('page.html', 'b');

        assert.strictEqual(
          await readAll(opened.content as NodeJS.ReadableStream),
          original,
          'the open read sees the whole file it opened, not a truncated rewrite',
        );
        assert.strictEqual(opened.size, original.length);
        assert.strictEqual(
          fsExtra.readFileSync(join(dir, 'page.html'), 'utf8'),
          'b',
          'the new content is in place',
        );
        assert.deepEqual(
          fsExtra.readdirSync(dir),
          ['page.html'],
          'no staging file is left beside it',
        );
      } finally {
        fsExtra.removeSync(dir);
      }
    });

    test('openContent stops at the length it measured when the file grows during the read', async function (assert) {
      let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
      try {
        let adapter = new NodeAdapter(dir);
        await adapter.write('log.txt', 'a'.repeat(100));
        let opened = (await adapter.openFile('log.txt'))!.openContent!();

        await adapter.append('log.txt' as LocalPath, 'b'.repeat(50));

        assert.strictEqual(opened.size, 100);
        assert.strictEqual(
          await readAll(opened.content as NodeJS.ReadableStream),
          'a'.repeat(100),
          'the stream delivers exactly the measured length',
        );
      } finally {
        fsExtra.removeSync(dir);
      }
    });

    test('openContent of an empty file reports no bytes and streams none', async function (assert) {
      let dir = fsExtra.mkdtempSync(join(tmpdir(), 'node-realm-test-'));
      try {
        fsExtra.writeFileSync(join(dir, 'empty.txt'), '');
        let adapter = new NodeAdapter(dir);
        let opened = (await adapter.openFile('empty.txt'))!.openContent!();

        assert.strictEqual(opened.size, 0);
        assert.strictEqual(
          await readAll(opened.content as NodeJS.ReadableStream),
          '',
        );
      } finally {
        fsExtra.removeSync(dir);
      }
    });
  },
);
