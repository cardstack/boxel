import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Readable } from 'stream';
import type { PgAdapter } from '@cardstack/postgres';
import {
  abandonAutomationRun,
  cancelAutomationRun,
  finishAutomationRun,
  startAutomationRunAttempt,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  createAutomationRunToken,
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { nodeStreamToBuffer } from '../stream.ts';

// ============================================================================
// The run overlay: a run's writes are staged on the realm server, not written
// to the realm, and the run's own reads read through them. Nobody else sees a
// staged file. The run's `writes` cap bounds how many files it stages, a
// retry that takes the run over starts from an empty overlay, and every way a
// run ends discards its overlay.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-overlay-test/');
const OWNER = '@owner:localhost';
const SOURCE = 'application/vnd.card+source';

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
      'logs/2026-11.jsonl': '{"n":1}\n',
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
      ? new Uint8Array(await nodeStreamToBuffer(response.nodeStream))
      : new Uint8Array(await response.arrayBuffer());
  }

  async function readText(token: string, path: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    return {
      status: response.status,
      text:
        response.status === 200
          ? new TextDecoder().decode(await body(response))
          : undefined,
    };
  }

  async function writeText(token: string, path: string, content: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        body: content,
      }),
    ))!;
    return { status: response.status, text: await response.text() };
  }

  async function writeBytes(
    token: string,
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
  ) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        body: bytes,
      }),
    ))!;
    return response.status;
  }

  async function list(token: string, dir = '') {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${dir}`, {
        headers: {
          Accept: 'application/vnd.api+json; boxel=directory',
          Authorization: `Bearer ${token}`,
        },
      }),
    ))!;
    if (response.status !== 200) {
      return { status: response.status, names: [] as string[] };
    }
    let { data } = JSON.parse(await response.text());
    return {
      status: 200,
      names: Object.keys(data.relationships ?? {}).sort(),
    };
  }

  async function overlayRows(runId: string) {
    return (await dbAdapter.execute(
      `SELECT attempt, path, size FROM run_overlay_files WHERE run_id = $1 ORDER BY attempt, path`,
      { bind: [runId] },
    )) as { attempt: string; path: string; size: number }[];
  }

  test('a staged write is visible to the run and invisible to everyone else', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let staged = await writeText(token, 'cards/new.json', '{"staged":true}');
    assert.strictEqual(staged.status, 204, staged.text);

    assert.deepEqual(await readText(token, 'cards/new.json'), {
      status: 200,
      text: '{"staged":true}',
    });
    assert.strictEqual(
      (await readText(session(), 'cards/new.json')).status,
      404,
      'an ordinary reader does not see the staged file',
    );
    assert.strictEqual(
      (await realm.handle(
        new Request(`${realmURL.href}cards/new.json`, {
          method: 'HEAD',
          headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        }),
      ))!.status,
      200,
      'the run finds that the staged file exists',
    );
  });

  test('a run reads the realm for a file it has not staged, and its staged copy once it has', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.deepEqual(await readText(token, 'notes.txt'), {
      status: 200,
      text: 'in the realm',
    });
    await writeText(token, 'notes.txt', 'staged over the realm');
    assert.deepEqual(await readText(token, 'notes.txt'), {
      status: 200,
      text: 'staged over the realm',
    });
    assert.deepEqual(
      await readText(session(), 'notes.txt'),
      { status: 200, text: 'in the realm' },
      'the realm keeps its own copy',
    );
  });

  test('binary content is staged byte for byte', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let bytes = new Uint8Array([0, 255, 128, 1, 2, 3, 0xc3, 0x28]);
    assert.strictEqual(await writeBytes(token, 'images/pixel.bin', bytes), 204);
    let response = (await realm.handle(
      new Request(`${realmURL.href}images/pixel.bin`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    assert.strictEqual(response.status, 200);
    assert.deepEqual([...(await body(response))], [...bytes]);
    assert.strictEqual(
      (await readText(session(), 'images/pixel.bin')).status,
      404,
    );
  });

  test('a run lists its staged files beside the realm’s, and nobody else does', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    await writeText(token, 'logs/2026-12.jsonl', '{"n":2}\n');
    await writeText(token, 'reports/weekly/one.md', '# one');

    assert.deepEqual((await list(token, 'logs/')).names, [
      '2026-11.jsonl',
      '2026-12.jsonl',
    ]);
    assert.deepEqual((await list(session(), 'logs/')).names, ['2026-11.jsonl']);
    assert.true(
      (await list(token)).names.includes('reports/'),
      'a directory only staged files make is listed for the run',
    );
    assert.deepEqual((await list(token, 'reports/')).names, ['weekly/']);
    assert.deepEqual((await list(token, 'reports/weekly/')).names, ['one.md']);
    assert.strictEqual(
      (await list(session(), 'reports/')).status,
      404,
      'the realm has no such directory',
    );
  });

  test('the writes cap bounds the files a run stages, and a rewrite does not count again', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
      {
        writesCap: 2,
      },
    );
    assert.strictEqual((await writeText(token, 'a.txt', 'a')).status, 204);
    assert.strictEqual((await writeText(token, 'b.txt', 'b')).status, 204);
    let refused = await writeText(token, 'c.txt', 'c');
    assert.strictEqual(refused.status, 403);
    assert.true(refused.text.includes('at most 2 files'), refused.text);
    assert.strictEqual(
      (await writeText(token, 'a.txt', 'a again')).status,
      204,
      'rewriting a staged file is not another file',
    );
    assert.deepEqual(
      (await overlayRows(run.id)).map((r) => r.path),
      ['a.txt', 'b.txt'],
    );
  });

  test('a run may not write realm.json', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(
      (await writeText(token, 'realm.json', '{}')).status,
      403,
    );
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a run cannot stage in a realm it may only read', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let token = mintRunToken({
      realmSecretSeed,
      run: {
        ...run,
        realm: 'http://127.0.0.1:4444/run-overlay-elsewhere/' as never,
      },
      realmURL: 'http://127.0.0.1:4444/run-overlay-elsewhere/',
      readRealms: [realmURL.href],
      writesCap: 10,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.notStrictEqual(
      (await writeText(token, 'outside.txt', 'nope')).status,
      204,
    );
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a retry that takes the run over starts from an empty overlay', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    await writeText(token, 'first.txt', 'from attempt 1');
    await startAutomationRunAttempt(dbAdapter, run.id, 2);
    let retry = mintRunToken({
      realmSecretSeed,
      run: { ...run, attempt: 2 },
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 10,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual((await readText(retry, 'first.txt')).status, 404);
    assert.deepEqual(
      await overlayRows(run.id),
      [],
      'the replaced attempt’s staged files are dropped',
    );
    assert.strictEqual(
      (await writeText(token, 'late.txt', 'from attempt 1')).status,
      401,
      'the replaced attempt can no longer stage',
    );
  });

  for (let [ending, end] of [
    [
      'finishes complete (a Preview)',
      (id: string) =>
        finishAutomationRun(dbAdapter, id, 1, { state: 'complete' }),
    ],
    [
      'fails',
      (id: string) =>
        finishAutomationRun(dbAdapter, id, 1, {
          state: 'error',
          reason: 'script-error',
        }),
    ],
    ['is canceled', (id: string) => cancelAutomationRun(dbAdapter, id, OWNER)],
    [
      'is abandoned',
      (id: string) => abandonAutomationRun(dbAdapter, id, 'timed-out'),
    ],
  ] as const) {
    test(`a run that ${ending} leaves no staged file behind`, async function (assert) {
      let { token, run } = await createAutomationRunToken(
        dbAdapter,
        realm,
        OWNER,
      );
      await writeText(token, 'scratch.txt', 'staged');
      await writeBytes(token, 'scratch.bin', new Uint8Array([1, 2, 3]));
      assert.strictEqual((await overlayRows(run.id)).length, 2);
      assert.ok(await end(run.id), 'the run ended');
      assert.deepEqual(await overlayRows(run.id), []);
      assert.strictEqual(
        (await readText(session(), 'scratch.txt')).status,
        404,
        'nothing reached the realm',
      );
    });
  }
});
