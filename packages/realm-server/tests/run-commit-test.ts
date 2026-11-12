import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Readable } from 'stream';
import type { PgAdapter } from '@cardstack/postgres';
import {
  finishAutomationRun,
  getAutomationRun,
  insertPermissions,
  startAutomationRunAttempt,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  RUN_COMMIT_PATH,
  stageRunOverlayFile,
} from '@cardstack/runtime-common/run-overlay';
import {
  createAutomationRunToken,
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { nodeStreamToBuffer } from '../stream.ts';

// ============================================================================
// Committing a run's overlay: when the script finishes, every file the
// attempt staged lands in the realm as one all-or-nothing batch, or none
// does. The commit is the run's own call, as its identity, who must still be
// a direct writer. It is claimed on the run's row, so a run commits at most
// once, and the overlay is discarded once the batch lands. A file identical
// to the stored one causes no indexing.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-commit-test/');
const OWNER = '@owner:localhost';
const SOURCE = 'application/vnd.card+source';
const JSONAPI = 'application/vnd.api+json';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
    },
    fileSystem: {
      'notes.txt': 'in the realm',
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  function session() {
    return createJWT(realm, OWNER, ['read', 'write']);
  }

  async function body(response: Response & { nodeStream?: Readable }) {
    return response.nodeStream
      ? (await nodeStreamToBuffer(response.nodeStream)).toString()
      : await response.text();
  }

  async function read(token: string, path: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    return {
      status: response.status,
      text: response.status === 200 ? await body(response) : undefined,
    };
  }

  async function stage(token: string, path: string, content: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        body: content,
      }),
    ))!;
    return response.status;
  }

  async function commit(token: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: { Accept: JSONAPI, Authorization: `Bearer ${token}` },
      }),
    ))!;
    let text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { text };
    }
    return { status: response.status, json };
  }

  async function overlayCount(runId: string) {
    let [{ n }] = (await dbAdapter.execute(
      `SELECT count(*)::int AS n FROM run_overlay_files WHERE run_id = $1`,
      { bind: [runId] },
    )) as { n: number }[];
    return n;
  }

  async function latestIndexJobId(): Promise<number> {
    let [row] = (await dbAdapter.execute(
      `SELECT coalesce(max(id), 0)::int AS id FROM jobs
         WHERE job_type = 'incremental-index'
           AND (concurrency_group = $1 OR lane_family = $1)`,
      { bind: [`indexing:${realm.url}`] },
    )) as { id: number }[];
    return row?.id ?? 0;
  }

  test('a commit lands every staged file, records the commit and discards the overlay', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(await stage(token, 'logs/run.jsonl', '{"n":1}\n'), 204);
    assert.strictEqual(
      await stage(token, 'notes.txt', 'updated by the run'),
      204,
    );
    assert.strictEqual(await stage(token, 'deep/nested/file.md', '# hi'), 204);

    let committed = await commit(token);
    assert.strictEqual(committed.status, 200, JSON.stringify(committed.json));
    assert.deepEqual(committed.json.data.attributes.files, [
      'deep/nested/file.md',
      'logs/run.jsonl',
      'notes.txt',
    ]);

    assert.deepEqual(await read(session(), 'logs/run.jsonl'), {
      status: 200,
      text: '{"n":1}\n',
    });
    assert.deepEqual(await read(session(), 'notes.txt'), {
      status: 200,
      text: 'updated by the run',
    });
    assert.deepEqual(await read(session(), 'deep/nested/file.md'), {
      status: 200,
      text: '# hi',
    });
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.ok(row?.commitStartedAt, 'the commit was claimed');
    assert.ok(row?.committedAt, 'the commit was recorded as landed');
    assert.strictEqual(row?.writes, 3, 'the run counts the files it wrote');
    assert.strictEqual(await overlayCount(run.id), 0, 'the overlay is gone');
    assert.ok(
      await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' }),
      'the run finishes complete',
    );
  });

  test('a batch with a file that can’t be written lands none of its files', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(await stage(token, 'aaa-first.txt', 'first'), 204);
    // Staged beneath `notes.txt`, which the realm holds as a file. Staging
    // through the route checks only the run's own files, so this is put in
    // the overlay directly, as a realm that changed since staging would leave
    // it.
    await stageRunOverlayFile(
      dbAdapter,
      { runId: run.id, attempt: 1 },
      'notes.txt/inside.txt',
      new TextEncoder().encode('under a file'),
      10,
    );

    let committed = await commit(token);
    assert.strictEqual(committed.status, 409, JSON.stringify(committed.json));
    assert.strictEqual(committed.json.errors[0].code, 'path-clash');
    assert.strictEqual(
      (await read(session(), 'aaa-first.txt')).status,
      404,
      'no file of the batch landed',
    );
    assert.deepEqual(await read(session(), 'notes.txt'), {
      status: 200,
      text: 'in the realm',
    });
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(row?.commitStartedAt, null, 'no commit was claimed');
    assert.ok(
      await finishAutomationRun(dbAdapter, run.id, 1, {
        state: 'error',
        reason: 'commit-refused',
      }),
      'the run finishes as an error',
    );
    assert.strictEqual(await overlayCount(run.id), 0);
  });

  test('a person who lost direct write can’t commit, even when they can still write', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(await stage(token, 'from-run.txt', 'staged'), 204);
    // The person keeps write only through a wildcard grant, which writes but
    // makes no one a direct writer.
    await dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = $1 AND username = $2`,
      { bind: [realm.url, OWNER] },
    );
    await insertPermissions(dbAdapter, new URL(realm.url), {
      '*': ['read', 'write'],
    });

    let committed = await commit(token);
    assert.strictEqual(committed.status, 403);
    assert.strictEqual(committed.json.errors[0].code, 'not-a-direct-writer');
    assert.strictEqual((await read(session(), 'from-run.txt')).status, 404);
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(row?.commitStartedAt, null, 'no commit was claimed');
  });

  test('a replaced attempt can’t commit, and the newer attempt commits only its own files', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(await stage(token, 'from-first.txt', 'attempt 1'), 204);
    await startAutomationRunAttempt(dbAdapter, run.id, 2);
    assert.strictEqual((await commit(token)).status, 401);

    let retry = mintRunToken({
      realmSecretSeed,
      run: { ...run, attempt: 2 },
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 10,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual(await stage(retry, 'from-second.txt', 'attempt 2'), 204);
    assert.strictEqual((await commit(retry)).status, 200);
    assert.strictEqual((await read(session(), 'from-first.txt')).status, 404);
    assert.strictEqual(
      (await read(session(), 'from-second.txt')).text,
      'attempt 2',
    );
  });

  test('a run commits at most once', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.strictEqual(await stage(token, 'once.txt', 'once'), 204);
    assert.strictEqual((await commit(token)).status, 200);
    let again = await commit(token);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.json.errors[0].code, 'commit-refused');
  });

  test('an unchanged file causes no index pass', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.strictEqual(await stage(token, 'notes.txt', 'in the realm'), 204);
    let before = await latestIndexJobId();
    assert.strictEqual((await commit(token)).status, 200);
    assert.strictEqual(
      await latestIndexJobId(),
      before,
      'committing bytes identical to the stored file enqueued no index job',
    );
  });

  test('only a run commits, and only in its own realm', async function (assert) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: { Accept: JSONAPI, Authorization: `Bearer ${session()}` },
      }),
    ))!;
    assert.strictEqual(response.status, 403);
  });
});
