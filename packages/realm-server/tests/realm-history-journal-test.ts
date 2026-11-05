import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  query,
  param,
  SupportedMimeType,
  type ChangeEventChange,
  type ChangeEventInput,
  type ChangeJournal,
  type LocalPath,
  type Querier,
  type Realm,
} from '@cardstack/runtime-common';
import { commitBatch } from '@cardstack/runtime-common/card-operations';
import { PostgresChangeJournal } from '../lib/change-journal.ts';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// The change journal: every change to a recording realm's files leaves one
// `realm_change_events` row, committed with the write's `realm_file_meta`
// update, and a journal failure never fails the write.

// The Postgres journal behind a switch a test can throw, so a test can make
// one insert fail without reaching into the realm.
class FailableJournal implements ChangeJournal {
  #inner = new PostgresChangeJournal();
  failNext = false;

  async append(querier: Querier, event: ChangeEventInput): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('the change journal is unavailable');
    }
    return await this.#inner.append(querier, event);
  }
}

interface JournalRow {
  seq: number;
  realm_id: string;
  author: string;
  channel: string;
  partial: boolean;
  changes: ChangeEventChange[];
}

module(basename(import.meta.filename), function () {
  const realmURL = new URL('http://127.0.0.1:4444/test/');
  const realmHref = realmURL.href;
  const writer = '@john:localhost';
  let journal = new FailableJournal();
  let testRealm: Realm;
  let request: RealmRequest;
  let dbAdapter: PgAdapter;

  function onRealmSetup(args: {
    testRealm: Realm;
    request: SuperTest<Test>;
    dbAdapter: PgAdapter;
  }) {
    testRealm = args.testRealm;
    request = withRealmPath(args.request, realmURL);
    dbAdapter = args.dbAdapter;
    journal.failNext = false;
  }

  // Registers the realm the way the realm server's registry would, and turns
  // its recording on or off. The test realm has no registry row of its own.
  async function setRecording(enabled: boolean): Promise<string> {
    await query(dbAdapter, [
      'INSERT INTO realm_registry (url, kind, disk_id, owner_username, pinned) VALUES (',
      param(realmHref),
      ", 'source', 'test/test', '@user:localhost', false) ON CONFLICT (url) DO NOTHING",
    ]);
    let [row] = await query(dbAdapter, [
      'SELECT id::text AS id FROM realm_registry WHERE url =',
      param(realmHref),
    ]);
    let realmId = row.id as string;
    await query(dbAdapter, [
      'INSERT INTO realm_history_state (realm_id, enabled) VALUES (',
      param(realmId),
      '::uuid,',
      param(enabled),
      ') ON CONFLICT (realm_id) DO UPDATE SET enabled = EXCLUDED.enabled',
    ]);
    return realmId;
  }

  async function events(): Promise<JournalRow[]> {
    let rows = await query(dbAdapter, [
      'SELECT seq, realm_id::text AS realm_id, author, channel, partial, changes FROM realm_change_events WHERE realm_url =',
      param(realmHref),
      'ORDER BY seq',
    ]);
    return rows.map((row) => ({
      seq: Number(row.seq),
      realm_id: String(row.realm_id),
      author: String(row.author),
      channel: String(row.channel),
      partial: Boolean(row.partial),
      changes: row.changes as unknown as ChangeEventChange[],
    }));
  }

  async function pathsOf(seq: number): Promise<string[]> {
    let rows = await query(dbAdapter, [
      'SELECT path FROM realm_change_event_paths WHERE seq =',
      param(seq),
      'ORDER BY path',
    ]);
    return rows.map((row) => String(row.path));
  }

  async function fileMeta(
    path: string,
  ): Promise<{ contentHash: string; contentSize: number } | undefined> {
    let [row] = await query(dbAdapter, [
      'SELECT content_hash, content_size FROM realm_file_meta WHERE realm_url =',
      param(realmHref),
      'AND file_path =',
      param(path),
    ]);
    if (!row) {
      return undefined;
    }
    return {
      contentHash: String(row.content_hash),
      contentSize: Number(row.content_size),
    };
  }

  function auth() {
    return `Bearer ${createJWT(testRealm, writer, ['read', 'write'])}`;
  }

  async function postSource(path: string, content: string) {
    let response = await request
      .post(`/${path}`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .set('Authorization', auth())
      .send(content);
    return response;
  }

  module('a recording realm', function (hooks) {
    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        '*': ['read'],
        [writer]: ['read', 'write'],
      },
      fileSystem: {
        'telemetry.log': 'boot\n',
        'existing.txt': 'hello\n',
        'doomed.txt': 'bye\n',
        'doomed-too.txt': 'bye\n',
      },
      history: { journal },
      onRealmSetup,
    });

    hooks.beforeEach(async function () {
      await setRecording(true);
    });

    test('a source write leaves one event that matches the file meta', async function (assert) {
      let response = await postSource('hello.txt', 'hello world');
      assert.strictEqual(response.status, 204);

      let rows = await events();
      assert.strictEqual(rows.length, 1, 'one event for one write');
      let [event] = rows;
      assert.strictEqual(event.author, writer, 'the authenticated user');
      assert.strictEqual(event.channel, 'api', 'a write naming no channel');
      assert.false(event.partial);
      let meta = await fileMeta('hello.txt');
      assert.deepEqual(event.changes, [
        {
          path: 'hello.txt',
          status: 'A',
          contentHash: meta?.contentHash,
          size: meta?.contentSize,
        },
      ]);
      assert.deepEqual(await pathsOf(event.seq), ['hello.txt']);
    });

    test('a write that replaces a file records M, and identical bytes record nothing', async function (assert) {
      assert.strictEqual(
        (await postSource('existing.txt', 'changed\n')).status,
        204,
      );
      let [event] = await events();
      assert.strictEqual(event.changes[0].status, 'M');
      assert.strictEqual(event.changes[0].path, 'existing.txt');

      assert.strictEqual(
        (await postSource('existing.txt', 'changed\n')).status,
        204,
      );
      assert.strictEqual(
        (await events()).length,
        1,
        'the same bytes again change nothing, so no event',
      );
    });

    test('an append records the file size after the append', async function (assert) {
      await commitBatch(
        testRealm.batchCore,
        [
          {
            op: 'appendLine',
            href: `${realmHref}telemetry.log`,
            params: { line: 'deploy 41' },
          },
        ],
        { clientRequestId: 'append-line', actor: writer },
      );
      let [event] = await events();
      let meta = await fileMeta('telemetry.log');
      assert.deepEqual(event.changes, [
        {
          path: 'telemetry.log',
          status: 'M',
          contentHash: meta?.contentHash,
          size: 'boot\ndeploy 41\n'.length,
          appended: true,
        },
      ]);
    });

    test('a delete records D with no content', async function (assert) {
      let response = await request
        .delete('/existing.txt')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', auth());
      assert.strictEqual(response.status, 204);
      let [event] = await events();
      assert.deepEqual(event.changes, [{ path: 'existing.txt', status: 'D' }]);
      assert.strictEqual(await fileMeta('existing.txt'), undefined);
    });

    test('deleting several files is one event', async function (assert) {
      await testRealm.deleteAll([
        'doomed.txt',
        'doomed-too.txt',
      ] as LocalPath[]);
      let rows = await events();
      assert.strictEqual(rows.length, 1);
      assert.deepEqual(rows[0].changes, [
        { path: 'doomed.txt', status: 'D' },
        { path: 'doomed-too.txt', status: 'D' },
      ]);
      assert.deepEqual(await pathsOf(rows[0].seq), [
        'doomed-too.txt',
        'doomed.txt',
      ]);
    });

    test('an atomic batch is one event with every path', async function (assert) {
      let response = await request
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', auth())
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'add',
                href: 'notes/a.md',
                data: {
                  type: 'source',
                  attributes: { content: '# a' },
                  meta: {},
                },
              },
              {
                op: 'add',
                href: 'notes/b.md',
                data: {
                  type: 'source',
                  attributes: { content: '# b' },
                  meta: {},
                },
              },
            ],
          }),
        );
      assert.strictEqual(response.status, 201);
      let rows = await events();
      assert.strictEqual(rows.length, 1);
      assert.deepEqual(
        rows[0].changes.map((change) => [change.path, change.status]),
        [
          ['notes/a.md', 'A'],
          ['notes/b.md', 'A'],
        ],
      );
    });

    test('a binary upload is recorded with its size', async function (assert) {
      let response = await request
        .post('/bytes.bin')
        .set('Content-Type', 'application/octet-stream')
        .set('Authorization', auth())
        .send(Buffer.from([1, 2, 3]));
      assert.strictEqual(response.status, 204);
      let [event] = await events();
      assert.strictEqual(event.changes[0].path, 'bytes.bin');
      assert.strictEqual(event.changes[0].status, 'A');
      assert.strictEqual(event.changes[0].size, 3);
    });

    test('a journal failure rolls back only the insert; the write and its file meta still land', async function (assert) {
      journal.failNext = true;
      let response = await postSource('survives.txt', 'still written');
      assert.strictEqual(response.status, 204, 'the write succeeds');
      let meta = await fileMeta('survives.txt');
      assert.ok(meta, 'the file meta row committed');
      assert.strictEqual((await events()).length, 0, 'no event was written');

      assert.strictEqual(
        (await postSource('after.txt', 'recorded again')).status,
        204,
      );
      assert.strictEqual(
        (await events()).length,
        1,
        'the next write is journaled as usual',
      );
    });

    test('a realm whose recording is off writes no event', async function (assert) {
      await setRecording(false);
      assert.strictEqual((await postSource('quiet.txt', 'shh')).status, 204);
      assert.ok(await fileMeta('quiet.txt'), 'the file meta row is written');
      assert.strictEqual((await events()).length, 0);
    });

    test('every primitive that changes a file leaves exactly one event', async function (assert) {
      let count = 0;
      async function expectOneEvent(what: string) {
        count += 1;
        assert.strictEqual(
          (await events()).length,
          count,
          `${what} leaves one event`,
        );
      }

      await testRealm.write('prim-write.txt' as LocalPath, 'one', {
        initiatingUser: writer,
      });
      await expectOneEvent('write');

      await testRealm.writeMany(
        new Map([
          ['prim-many-a.txt' as LocalPath, 'a'],
          ['prim-many-b.txt' as LocalPath, 'b'],
        ]),
        { initiatingUser: writer },
      );
      await expectOneEvent('writeMany');

      await commitBatch(
        testRealm.batchCore,
        [
          {
            op: 'appendLine',
            href: `${realmHref}telemetry.log`,
            params: { line: 'prim' },
          },
        ],
        { clientRequestId: 'prim-append', actor: writer },
      );
      await expectOneEvent('append');

      await testRealm.delete('prim-write.txt' as LocalPath, {
        initiatingUser: writer,
      });
      await expectOneEvent('delete');

      await testRealm.deleteAll([
        'prim-many-a.txt' as LocalPath,
        'prim-many-b.txt' as LocalPath,
      ]);
      await expectOneEvent('deleteAll');

      let atomic = await request
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', auth())
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'add',
                href: 'prim-atomic.md',
                data: {
                  type: 'source',
                  attributes: { content: '# atomic' },
                  meta: {},
                },
              },
            ],
          }),
        );
      assert.strictEqual(atomic.status, 201);
      await expectOneEvent('atomic batch');

      let upload = await request
        .post('/prim-bytes.bin')
        .set('Content-Type', 'application/octet-stream')
        .set('Authorization', auth())
        .send(Buffer.from([9, 9]));
      assert.strictEqual(upload.status, 204);
      await expectOneEvent('binary upload');

      assert.strictEqual(
        (await postSource('prim-source.txt', 'source')).status,
        204,
      );
      await expectOneEvent('source write');
    });
  });

  module('a batch that fails partway', function (hooks) {
    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        '*': ['read'],
        [writer]: ['read', 'write'],
      },
      fileSystem: {},
      fileSizeLimitBytes: 64,
      history: { journal },
      onRealmSetup,
    });

    hooks.beforeEach(async function () {
      await setRecording(true);
    });

    test('records the paths that landed as a partial event and still fails the caller', async function (assert) {
      let error: unknown;
      try {
        await testRealm.writeMany(
          new Map([
            ['landed.txt' as LocalPath, 'small'],
            ['refused.txt' as LocalPath, 'x'.repeat(200)],
          ]),
          { initiatingUser: writer },
        );
      } catch (e: unknown) {
        error = e;
      }
      assert.ok(error, 'the write fails');
      assert.ok(await fileMeta('landed.txt'), 'the landed file has its row');
      assert.strictEqual(
        await fileMeta('refused.txt'),
        undefined,
        'the refused file has none',
      );
      let rows = await events();
      assert.strictEqual(rows.length, 1);
      assert.true(rows[0].partial, 'the event is marked partial');
      assert.deepEqual(
        rows[0].changes.map((change) => change.path),
        ['landed.txt'],
      );
    });
  });

  module('a published realm', function (hooks) {
    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: {},
      published: true,
      history: { journal },
      onRealmSetup,
    });

    test('never writes an event, even with recording on', async function (assert) {
      let [row] = await query(dbAdapter, [
        'SELECT id::text AS id, kind FROM realm_registry WHERE url =',
        param(realmHref),
      ]);
      assert.strictEqual(row.kind, 'published');
      await query(dbAdapter, [
        'INSERT INTO realm_history_state (realm_id, enabled) VALUES (',
        param(row.id as string),
        '::uuid, true) ON CONFLICT (realm_id) DO UPDATE SET enabled = true',
      ]);
      await testRealm.write('published.txt' as LocalPath, 'content');
      assert.ok(await fileMeta('published.txt'));
      assert.strictEqual((await events()).length, 0);
    });
  });
});
