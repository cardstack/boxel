import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  computeContentHash,
} from '@cardstack/runtime-common';
import {
  BLOB_MODE,
  hashObject,
  ObjectStore,
  TREE_MODE,
} from '../src/git-objects.ts';
import {
  initRepo,
  parseSizeOnlyMarker,
  runGit,
  writeSizeOnlyEntry,
} from '../src/repo-format.ts';
import { sweepKind, walkRealm, type RecordedPath } from '../src/sweeper.ts';
import { backfillKind } from '../src/backfill.ts';
import type { RecordedRealm } from '../src/realms.ts';
import {
  appendEvent,
  insertRealm,
  setCursor,
  setupTestDatabase,
  type TestRealm,
} from './helpers.ts';

const execFileAsync = promisify(execFile);
const MB = 1024 * 1024;

module('sweeper: walking a realm', (hooks) => {
  let root: string;
  let realmDir: string;
  let store: ObjectStore;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-sweeper-'));
    realmDir = join(root, 'realm');
    await mkdir(realmDir);
    let gitDir = join(root, 'history.git');
    await initRepo(gitDir);
    store = new ObjectStore(gitDir);
  });

  hooks.afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(path: string, content: string | Uint8Array) {
    let full = join(realmDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  function recordedAs(content: string | Uint8Array): RecordedPath {
    let bytes = typeof content === 'string' ? Buffer.from(content) : content;
    return {
      contentHash: computeContentHash(bytes),
      size: bytes.byteLength,
      objectId: hashObject('blob', bytes),
    };
  }

  test('it skips symlinks, special files, names history cannot hold and partial writes', async (assert) => {
    await write('a.json', '{"a":1}');
    await write('dir/c.json', '{"c":1}');
    await symlink(join(realmDir, 'a.json'), join(realmDir, 'link.json'));
    await symlink(root, join(realmDir, 'outside'));
    await execFileAsync('mkfifo', [join(realmDir, 'pipe')]);
    await write('.git/config', '[core]');
    await write('x/.realm-history-size-only', 'not a marker');
    await write('b.json.boxel-partial', 'half');

    let walk = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map(),
    });
    assert.deepEqual([...walk.changes.keys()].sort(), ['a.json', 'dir/c.json']);
    assert.deepEqual(walk.changes.get('a.json'), {
      path: 'a.json',
      entry: {
        mode: BLOB_MODE,
        id: hashObject('blob', Buffer.from('{"a":1}')),
      },
      fingerprint: computeContentHash('{"a":1}'),
      size: 7,
    });
    let id = walk.changes.get('dir/c.json')!.entry!.id;
    assert.strictEqual(
      (await runGit(store.gitDir, ['cat-file', 'blob', id])).toString(),
      '{"c":1}',
      'the blob is written',
    );
    assert.strictEqual(walk.files, 2);
  });

  test('a file that matches its path state is unchanged, and a recorded path with no file is a deletion', async (assert) => {
    await write('same.json', '{"same":true}');
    await write('changed.json', '{"v":2}');
    await write('gone', 'a directory where a file was recorded');
    await rm(join(realmDir, 'gone'));
    await mkdir(join(realmDir, 'gone'));
    let walk = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map([
        ['same.json', recordedAs('{"same":true}')],
        ['changed.json', recordedAs('{"v":1}')],
        ['deleted.json', recordedAs('{}')],
        ['gone', recordedAs('was a file')],
      ]),
    });
    assert.deepEqual(
      Object.fromEntries(
        [...walk.changes].map(([path, change]) => [
          path,
          change.entry?.mode ?? null,
        ]),
      ),
      { 'changed.json': BLOB_MODE, 'deleted.json': null, gone: null },
    );
  });

  test('a file above the whole-hash limit is fingerprinted from bounded reads, and read whole only when it differs', async (assert) => {
    let big = Buffer.alloc(CONTENT_HASH_WHOLE_LIMIT_BYTES + MB, 7);
    await write('big.bin', big);
    let unchanged = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map([['big.bin', recordedAs(big)]]),
    });
    assert.strictEqual(unchanged.changes.size, 0);
    assert.strictEqual(
      unchanged.bytesRead,
      CONTENT_HASH_WHOLE_LIMIT_BYTES,
      'only the head and tail are read',
    );

    let edited = Buffer.from(big);
    edited[edited.length - 1] = 8;
    await write('big.bin', edited);
    let changed = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map([['big.bin', recordedAs(big)]]),
    });
    assert.strictEqual(
      changed.bytesRead,
      CONTENT_HASH_WHOLE_LIMIT_BYTES + edited.byteLength,
      'the head and tail, then the whole file',
    );
    assert.deepEqual(changed.changes.get('big.bin'), {
      path: 'big.bin',
      entry: { mode: BLOB_MODE, id: hashObject('blob', edited) },
      fingerprint: computeContentHash(edited),
      size: edited.byteLength,
    });
  });

  test('a file HEAD holds as a size-only entry stays one', async (assert) => {
    let id = await writeSizeOnlyEntry(store, { size: 100, fingerprint: 'old' });
    let content = 'x'.repeat(200);
    await write('app.log', content);
    let walk = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map([
        ['app.log', { contentHash: 'old', size: 100, objectId: id }],
      ]),
      sizeOnlyThresholdBytes: 50,
    });
    let change = walk.changes.get('app.log')!;
    assert.strictEqual(change.entry!.mode, TREE_MODE);
    let marker = await runGit(store.gitDir, [
      'cat-file',
      'blob',
      `${change.entry!.id}:.realm-history-size-only`,
    ]);
    assert.deepEqual(parseSizeOnlyMarker(marker), {
      size: 200,
      fingerprint: computeContentHash(content),
    });
  });

  test('a file above the size cap that differs becomes a size-only entry without a whole read', async (assert) => {
    let big = Buffer.alloc(CONTENT_HASH_WHOLE_LIMIT_BYTES + MB, 3);
    await write('video.mp4', big);
    let walk = await walkRealm({
      directory: realmDir,
      store,
      recorded: new Map(),
      sizeOnlyAboveBytes: CONTENT_HASH_WHOLE_LIMIT_BYTES,
    });
    let change = walk.changes.get('video.mp4')!;
    assert.strictEqual(change.entry!.mode, TREE_MODE);
    assert.strictEqual(change.size, big.byteLength);
    assert.strictEqual(change.fingerprint, computeContentHash(big));
    assert.strictEqual(walk.bytesRead, CONTENT_HASH_WHOLE_LIMIT_BYTES);
  });

  test('a realm directory that cannot be read fails the walk rather than reading as empty', async (assert) => {
    await assert.rejects(
      walkRealm({
        directory: join(root, 'missing'),
        store,
        recorded: new Map([['a.json', recordedAs('{}')]]),
      }),
      /ENOENT/,
    );
  });

  test('an aborted walk ends', async (assert) => {
    await write('a.json', '{}');
    let abort = new AbortController();
    abort.abort();
    await assert.rejects(
      walkRealm({
        directory: realmDir,
        store,
        recorded: new Map(),
        signal: abort.signal,
      }),
    );
  });
});

module('sweeper: the schedule', (hooks) => {
  let database = setupTestDatabase(hooks);
  let realm: TestRealm;
  const DAY = 24 * 60 * 60_000;

  hooks.beforeEach(async () => {
    realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/realm/',
    });
  });

  function recorded(): RecordedRealm {
    return {
      id: realm.id,
      url: realm.url,
      kind: 'source',
      shard: 0,
      directory: '/realms/test-user/realm',
      cursor: { xid: '0', seq: 0 },
      head: undefined,
    };
  }

  async function set(assignments: string): Promise<void> {
    await database.db.execute(
      `UPDATE realm_history_state SET ${assignments} WHERE realm_id = $1`,
      { bind: [realm.id] },
    );
  }

  test('a sweep is due daily on a realm with a HEAD, and whenever one is asked for', async (assert) => {
    let kind = sweepKind({ db: database.db, everyMs: DAY });
    let due = async () => (await kind.poll!([realm.id])).includes(realm.id);
    assert.false(await due(), 'a realm with no HEAD is left to the backfill');
    await set(`sweep_requested_at = now()`);
    assert.true(await due(), 'unless a sweep is asked for');

    await set(`head = 'a-head', sweep_requested_at = NULL`);
    assert.true(await due(), 'a realm never swept is due');
    assert.true(await kind.isDue!(recorded()));
    await set(`last_swept_at = now()`);
    assert.false(await due(), 'one swept just now is not');
    assert.false(await kind.isDue!(recorded()));
    await set(`sweep_requested_at = now() + interval '1 second'`);
    assert.true(await due(), 'until a sweep is asked for after it');
    await set(
      `sweep_requested_at = NULL, last_swept_at = now() - interval '25 hours'`,
    );
    assert.true(await due(), 'or a day has passed');
    await set(`status = 'stalled'`);
    assert.false(await due(), 'a stalled realm is never due');
    await set(`status = 'ok', enabled = false`);
    assert.false(await due(), 'nor one that no longer records');
  });

  test('a backfill is due on a realm with no HEAD and no events to record', async (assert) => {
    let kind = backfillKind({ db: database.db });
    assert.true(await kind.isDue!(recorded()));
    let appended = await appendEvent(database.db, realm, {
      changes: [{ path: 'a.json', status: 'A' }],
    });
    assert.false(
      await kind.isDue!(recorded()),
      'the recorder snapshots a realm with events before its first revision',
    );
    await setCursor(database.db, realm, {
      xid: appended.xid,
      seq: appended.seq,
    });
    assert.true(await kind.isDue!(recorded()));
    await set(`head = 'a-head'`);
    assert.false(await kind.isDue!(recorded()), 'a realm with a HEAD has one');
  });
});
