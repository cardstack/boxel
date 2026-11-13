import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  query,
  param,
  REALM_CHANGE_EVENTS_CHANNEL,
  SupportedMimeType,
  withChangeEvent,
  type ChangeEventChange,
  type LocalPath,
  type Realm,
} from '@cardstack/runtime-common';
import { commitBatch } from '@cardstack/runtime-common/card-operations';
import {
  setChangeJournalSink,
  type ChangeJournalEvent,
} from '@cardstack/runtime-common/card-operations/telemetry';
import {
  setupPermissionedRealmCached,
  createJWT,
  waitUntil,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { FailableChangeJournal } from './helpers/failable-change-journal.ts';
import { logLinesDuring } from './helpers/log-capture.ts';

// The change journal: every change to a recording realm's files leaves one
// `realm_change_events` row, committed with the write's `realm_file_meta`
// update, and a journal failure never fails the write. Each append is
// reported on `boxel:change-journal` once the write's transaction has
// finished, so `written` means the event committed.

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
  let journal = new FailableChangeJournal();
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
    journal.reset();
  }

  // The `boxel:change-journal` records the test realm's writes reported,
  // without their timings.
  let reported: ChangeJournalEvent[] = [];
  function reports() {
    return reported
      .filter((record) => record.realm === realmHref)
      .map(({ outcome, paths, partial, error }) => ({
        outcome,
        paths,
        partial,
        ...(error !== undefined ? { error } : {}),
      }));
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
      reported = [];
      setChangeJournalSink((record) => reported.push(record));
    });

    hooks.afterEach(function () {
      setChangeJournalSink(undefined);
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
      assert.deepEqual(reports(), [
        { outcome: 'written', paths: 1, partial: false },
      ]);
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
      assert.deepEqual(reports(), [
        {
          outcome: 'failed',
          paths: 1,
          partial: false,
          error: 'the change journal is unavailable',
        },
        { outcome: 'written', paths: 1, partial: false },
      ]);
    });

    test('a write whose transaction fails to commit after the append reports no written event', async function (assert) {
      journal.failCommitNext = true;
      let response = await postSource('uncommitted.txt', 'never recorded');
      assert.strictEqual(response.status, 500, 'the write fails');
      assert.strictEqual(
        await fileMeta('uncommitted.txt'),
        undefined,
        'the file meta rolled back',
      );
      assert.strictEqual(
        (await events()).length,
        0,
        'the event rolled back with it',
      );
      let [report, ...rest] = reports();
      assert.strictEqual(rest.length, 0, 'one record for the one append');
      assert.strictEqual(report?.outcome, 'failed', 'reported failed');
      assert.true(
        report?.error?.includes('commit_refused'),
        `with the commit's error: ${report?.error}`,
      );
    });

    test("a write whose append can't be rolled back to its savepoint fails, rather than answering for file meta that never committed", async function (assert) {
      journal.failRollbackNext = true;
      let response = await postSource('unsaved.txt', 'lost');
      assert.strictEqual(response.status, 500, 'the write fails');
      assert.strictEqual(
        await fileMeta('unsaved.txt'),
        undefined,
        'no file meta committed',
      );
      assert.strictEqual((await events()).length, 0, 'no event was written');

      assert.strictEqual(
        (await postSource('after.txt', 'recorded again')).status,
        204,
        'the next write lands',
      );
      assert.strictEqual(
        (await events()).length,
        1,
        'the next write is journaled as usual',
      );
      assert.deepEqual(reports(), [
        {
          outcome: 'failed',
          paths: 1,
          partial: false,
          error: 'the change journal is unavailable',
        },
        { outcome: 'written', paths: 1, partial: false },
      ]);
    });

    // realm-historian hashes the payload to a shard the same way it hashes a
    // realm's registry id, so a task wakes only for the realms of the shards
    // it holds. A payload that named the realm any other way would wake no
    // task, and every task would fall back to its poll.
    test("the journal's notification names the realm by its registry id", async function (assert) {
      let realmId = await setRecording(true);
      let payloads: string[] = [];
      let subscription = await dbAdapter.subscribe(
        REALM_CHANGE_EVENTS_CHANNEL,
        (notification) => payloads.push(notification.payload ?? ''),
      );
      try {
        assert.strictEqual(
          (await postSource('notified.txt', 'wake up')).status,
          204,
        );
        await waitUntil(async () => payloads.length > 0, {
          timeout: 5000,
          interval: 20,
          timeoutMessage: 'the journal notification',
        });
      } finally {
        await subscription.unsubscribe();
      }
      assert.deepEqual(payloads, [realmId]);
    });

    test('a realm whose recording is off writes no event', async function (assert) {
      await setRecording(false);
      assert.strictEqual((await postSource('quiet.txt', 'shh')).status, 204);
      assert.ok(await fileMeta('quiet.txt'), 'the file meta row is written');
      assert.strictEqual((await events()).length, 0);
      assert.deepEqual(reports(), [
        { outcome: 'skipped', paths: 1, partial: false },
      ]);
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

  module('a writer that never appends', function () {
    test('a transaction that commits without appending its event is logged as an error', async function (assert) {
      let lines = await logLinesDuring(['realm:change-journal'], async () => {
        let result = await withChangeEvent(
          journal,
          {
            realmURL: realmHref,
            author: writer,
            channel: 'api',
            changes: [{ path: 'lost.txt', status: 'A' }],
          },
          async () => 'committed',
        );
        assert.strictEqual(result, 'committed', "the writer's result");
      });
      assert.deepEqual(
        lines.map(({ level, message }) => ({ level, message })),
        [
          {
            level: 'error',
            message: `the change event for 1 path(s) in ${realmHref} was never appended: its writer's transaction committed without calling appendChangeEvent`,
          },
        ],
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

  // The shape of the in-browser realm: no journal and no reader.
  module('a realm with no history', function (hooks) {
    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'], [writer]: ['read', 'write'] },
      fileSystem: { 'card.txt': 'hello\n' },
      onRealmSetup,
    });

    test('answers every history read with history-unavailable', async function (assert) {
      let realmId = await setRecording(true);
      let reader = testRealm.historyReader;
      assert.deepEqual(await reader.readHistory(realmId, {}), {
        kind: 'history-unavailable',
      });
      assert.deepEqual(
        await reader.readAtRevision(realmId, 'abc1234', 'card.txt'),
        { kind: 'history-unavailable' },
      );
      assert.deepEqual(await reader.readTreeAtRevision(realmId, 'abc1234'), {
        kind: 'history-unavailable',
      });
    });
  });
});
