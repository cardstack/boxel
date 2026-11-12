import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import {
  cancelAutomationRun,
  createAutomationRun,
  finishAutomationRun,
  ri,
  rri,
  startAutomationRunAttempt,
  type AutomationRun,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import { runTokenSecret } from '@cardstack/runtime-common/run-token';
import {
  createAutomationRunToken,
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { mintRunToken, verifyRunToken } from '../lib/run-token.ts';
import type { Readable } from 'stream';
import { nodeStreamToBuffer } from '../stream.ts';

// ============================================================================
// The run token: what an automation run's calls carry. Every request with one
// reaches the realm through `Realm.handleAutomation`, which admits it only in
// the run's realm (or, for a read, a realm the token lets the run read), only
// while the run's row says the run is running and owned by the token's
// attempt, and only before the run's time limit. An admitted call is checked
// as the person the run acts as. A request without a run token takes the
// ordinary path.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-token-test/');
const elsewhereURL = new URL('http://127.0.0.1:4444/run-token-elsewhere/');
const OWNER = '@owner:localhost';
const READER = '@reader:localhost';
const SOURCE = 'application/vnd.card+source';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [READER]: ['read'],
    },
    fileSystem: {
      'notes.txt': 'hello',
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  // A file's bytes ride the response's node stream.
  async function body(response: Response & { nodeStream?: Readable }) {
    return response.nodeStream
      ? (await nodeStreamToBuffer(response.nodeStream)).toString()
      : await response.text();
  }

  function read(token: string, path = 'notes.txt') {
    return realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    );
  }

  function write(token: string, path: string, content: string) {
    return realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        body: content,
      }),
    );
  }

  // A run of an automation in another realm, started by attempt 1.
  async function runElsewhere(): Promise<AutomationRun> {
    let run = await createAutomationRun(dbAdapter, {
      automationId: rri(`${elsewhereURL.href}Automation/a`),
      realm: ri(elsewhereURL.href),
      trigger: 'test',
      slot: randomUUID(),
      actsAs: OWNER,
    });
    let start = await startAutomationRunAttempt(dbAdapter, run.id, 1);
    if (start.kind !== 'run') {
      throw new Error(`expected the run to start, got ${start.kind}`);
    }
    return start.run;
  }

  function tokenElsewhere(run: AutomationRun, readRealms: string[] = []) {
    return mintRunToken({
      realmSecretSeed,
      run,
      realmURL: elsewhereURL.href,
      readRealms,
      writesCap: 100,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
  }

  test('a run reads and writes its own realm', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let response = (await read(token))!;
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await body(response), 'hello');

    let saved = (await write(token, 'from-run.txt', 'written by the run'))!;
    assert.strictEqual(saved.status, 204, await saved.text());
    let back = (await read(token, 'from-run.txt'))!;
    assert.strictEqual(await body(back), 'written by the run');
  });

  test('a run is checked as the person it acts as', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, READER);
    assert.strictEqual((await read(token))!.status, 200);
    assert.strictEqual(
      (await write(token, 'from-reader.txt', 'nope'))!.status,
      403,
      'a run acting as a reader may not write',
    );
  });

  test('a token for another realm is refused here', async function (assert) {
    let token = tokenElsewhere(await runElsewhere());
    let response = (await read(token))!;
    assert.strictEqual(response.status, 401);
    assert.strictEqual(await response.text(), 'Token invalid');
  });

  test('a realm the token lets the run read is read-only to it', async function (assert) {
    let token = tokenElsewhere(await runElsewhere(), [realmURL.href]);
    assert.strictEqual((await read(token))!.status, 200);
    assert.strictEqual(
      (await write(token, 'from-elsewhere.txt', 'nope'))!.status,
      403,
    );
  });

  test('a finished run’s token is refused', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });
    let response = (await read(token))!;
    assert.strictEqual(response.status, 401);
    assert.strictEqual(
      await response.text(),
      'The automation run is not running',
    );
  });

  test('a canceled run’s token is refused at its next call', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual((await read(token))!.status, 200);
    await cancelAutomationRun(dbAdapter, run.id, OWNER);
    assert.strictEqual((await read(token))!.status, 401);
  });

  test('a token is refused once a newer attempt takes the run over', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    await startAutomationRunAttempt(dbAdapter, run.id, 2);
    assert.strictEqual(
      (await write(token, 'stale.txt', 'from a replaced attempt'))!.status,
      401,
    );
    let newer = mintRunToken({
      realmSecretSeed,
      run: { ...run, attempt: 2 },
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 100,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual((await read(newer))!.status, 200);
  });

  test('a token past the run’s time limit is refused', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let now = Math.floor(Date.now() / 1000);
    let expired = jsonwebtoken.sign(
      {
        user: OWNER,
        realm: realmURL.href,
        permissions: [],
        realmServerURL: realm.realmServerURL,
        run: { id: run.id, attempt: 1, readRealms: [], writesCap: 100 },
        iat: now - 700,
        exp: now - 100,
      },
      runTokenSecret(realmSecretSeed),
    );
    let response = (await read(expired))!;
    assert.strictEqual(response.status, 401);
    assert.strictEqual(await response.text(), 'Token expired');
  });

  test('a token that names a run but is signed with the session key is refused', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let forged = jsonwebtoken.sign(
      {
        user: OWNER,
        realm: realmURL.href,
        permissions: ['read', 'write'],
        realmServerURL: realm.realmServerURL,
        run: { id: run.id, attempt: 1, readRealms: [], writesCap: 100 },
      },
      realmSecretSeed,
      { expiresIn: 600 },
    );
    assert.strictEqual((await read(forged))!.status, 401);
  });

  test('handleAutomation refuses a request without a run token', async function (assert) {
    let response = (await realm.handleAutomation(
      new Request(`${realmURL.href}notes.txt`, {
        headers: {
          Accept: SOURCE,
          Authorization: `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
        },
      }),
    ))!;
    assert.strictEqual(response.status, 401);
  });

  test('a request with an ordinary session takes the ordinary path', async function (assert) {
    let session = createJWT(realm, OWNER, ['read', 'write']);
    assert.strictEqual((await read(session))!.status, 200);
    assert.strictEqual(
      (await write(session, 'interactive.txt', 'from a person'))!.status,
      204,
    );
  });

  test('verifyRunToken answers what a run token says, and nothing for any other token', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let context = verifyRunToken(token, realmSecretSeed);
    assert.strictEqual(context?.runId, run.id);
    assert.strictEqual(context?.attempt, 1);
    assert.strictEqual(context?.actsAs, OWNER);
    assert.strictEqual(context?.realm, realmURL.href);
    assert.deepEqual(context?.readRealms, []);
    assert.strictEqual(
      verifyRunToken(createJWT(realm, OWNER, ['read']), realmSecretSeed),
      undefined,
      'an ordinary session is not a run token',
    );
    assert.strictEqual(
      verifyRunToken(token, 'another seed'),
      undefined,
      'a token signed under another seed does not verify',
    );
  });
});
