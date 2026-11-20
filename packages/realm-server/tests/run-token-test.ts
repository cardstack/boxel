import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import {
  cancelAutomationRun,
  insertPermissions,
  createAutomationRun,
  finishAutomationRun,
  getAutomationRun,
  ri,
  rri,
  startAutomationRunAttempt,
  VirtualNetwork,
  type AutomationRun,
} from '@cardstack/runtime-common';
import { RUN_STATE_PATH } from '@cardstack/runtime-common/automation-run-command';
import { cancelAutomationRunFor } from '@cardstack/runtime-common/automations';
import { stageRunOverlayFile } from '@cardstack/runtime-common/run-overlay';
import type { Realm } from '@cardstack/runtime-common';
import { runTokenSecret } from '@cardstack/runtime-common/run-token';
import {
  createAutomationRunToken,
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import type { SuperTest, Test } from 'supertest';
import { mintRunToken, verifyRunToken } from '../lib/run-token.ts';
import type { Readable } from 'stream';
import { nodeStreamToBuffer } from '../stream.ts';

// ============================================================================
// The run token: what an automation run's calls carry. Every request with one
// reaches the realm through `Realm.handleAutomation`, which admits it only in
// the run's realm (or, for a read, a realm the token lets the run read), only
// while the run's row says the run is running and owned by the token's
// attempt, only before the run's time limit, and only while the person the
// run acts as is a direct writer of the run's realm. An admitted call is
// checked as that person. A request without a run token takes the ordinary
// path.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-token-test/');
const elsewhereURL = new URL('http://127.0.0.1:4444/run-token-elsewhere/');
const OWNER = '@owner:localhost';
const READER = '@reader:localhost';
const SOURCE = 'application/vnd.card+source';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let request: SuperTest<Test>;

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
      request = args.request;
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

  // A run of an automation in another realm, started by attempt 1, acting as
  // a direct writer of that realm.
  async function runElsewhere(): Promise<AutomationRun> {
    await insertPermissions(dbAdapter, elsewhereURL, {
      [OWNER]: ['read', 'write'],
    });
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

  test('a run acting as someone who is not a direct writer is refused, even a read', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, READER);
    let refused = (await write(token, 'from-reader.txt', 'nope'))!;
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(
      JSON.parse(await refused.text()).errors[0].code,
      'not-a-direct-writer',
    );

    let { token: another } = await createAutomationRunToken(
      dbAdapter,
      realm,
      READER,
    );
    let read403 = (await read(another))!;
    assert.strictEqual(read403.status, 403, 'a read is refused too');
    assert.strictEqual(
      JSON.parse(await read403.text()).errors[0].code,
      'not-a-direct-writer',
    );
  });

  test('a run whose person loses direct write mid-run is refused at its next call, which ends the run', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual((await read(token))!.status, 200);
    // The person keeps write only through a wildcard row, which writes but
    // makes no one a direct writer.
    await dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    await insertPermissions(dbAdapter, realmURL, { '*': ['read', 'write'] });

    let refused = (await read(token))!;
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(
      JSON.parse(await refused.text()).errors[0].code,
      'not-a-direct-writer',
    );
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.deepEqual(
      [row?.state, row?.errorReason],
      ['error', 'not-a-direct-writer'],
      'the refused call ended the run',
    );

    // The calls after it, and the run-state check that stops the script in
    // its tab, answer that the run is not running.
    let after = (await write(token, 'after-losing-write.txt', 'nope'))!;
    assert.strictEqual(after.status, 401);
    assert.strictEqual(await after.text(), 'The automation run is not running');
    assert.strictEqual((await runState(token))!.status, 401);
  });

  test('the tab’s run-state check ends a run whose person lost direct write, though its script makes no call', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual((await runState(token))!.status, 200);
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [realmURL.href, OWNER] },
    );
    assert.strictEqual((await runState(token))!.status, 403);
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.errorReason,
      'not-a-direct-writer',
    );
    assert.strictEqual(
      (await runState(token))!.status,
      401,
      'the next check answers 401, which stops the script',
    );
  });

  test('a call to a realm the run may read is refused once its person loses direct write of the run’s realm', async function (assert) {
    let token = tokenElsewhere(await runElsewhere(), [realmURL.href]);
    assert.strictEqual((await read(token))!.status, 200);
    await dbAdapter.execute(
      `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
      { bind: [elsewhereURL.href, OWNER] },
    );
    assert.strictEqual(
      (await read(token))!.status,
      403,
      'the person still reads this realm, but no longer writes the run’s own',
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

  function runState(token: string) {
    return realm.handle(
      new Request(`${realmURL.href}${RUN_STATE_PATH.slice(1)}`, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `Bearer ${token}`,
        },
      }),
    );
  }

  test('a run’s tab learns of a cancel: the run state answers 200 while the run runs, and 401 once a direct writer cancels it', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let running = (await runState(token))!;
    assert.strictEqual(running.status, 200);
    assert.deepEqual((await running.json()).data, {
      type: 'automation-run',
      id: run.id,
      attributes: { state: 'running' },
    });
    await stageRunOverlayFile(
      dbAdapter,
      { runId: run.id, attempt: 1 },
      'staged.txt',
      new TextEncoder().encode('staged by the run'),
      100,
    );

    let canceled = await cancelAutomationRunFor(
      dbAdapter,
      { runId: run.id, user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork: new VirtualNetwork() },
    );
    assert.true(canceled.ok, JSON.stringify(canceled));

    let stopped = (await runState(token))!;
    assert.strictEqual(stopped.status, 401);
    assert.strictEqual(
      await stopped.text(),
      'The automation run is not running',
    );
    assert.strictEqual(
      (await write(token, 'after-cancel.txt', 'too late'))!.status,
      401,
      'the run’s next write is refused',
    );
    assert.strictEqual(
      (await read(token, 'staged.txt'))!.status,
      401,
      'the run’s next read is refused',
    );
    let staged = (await dbAdapter.execute(
      `SELECT path FROM run_overlay_files WHERE run_id = '${run.id}'`,
    )) as unknown[];
    assert.strictEqual(staged.length, 0, 'what the run staged is discarded');
  });

  test('only a run asks its own realm whether it is running', async function (assert) {
    let session = (await realm.handle(
      new Request(`${realmURL.href}${RUN_STATE_PATH.slice(1)}`, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
        },
      }),
    ))!;
    assert.strictEqual(session.status, 403);
    assert.strictEqual((await session.json()).errors[0].code, 'not-a-run');

    let elsewhere = tokenElsewhere(await runElsewhere(), [realmURL.href]);
    let reading = (await runState(elsewhere))!;
    assert.strictEqual(
      reading.status,
      403,
      'a run that may only read this realm is not this realm’s run',
    );
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

  test('a run token reaches the realm through the realm server', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let response = await request
      .get('/run-token-test/notes.txt')
      .set('Accept', SOURCE)
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, 'hello');
  });

  test('a run token without its Bearer prefix, as the host sends a session, is still a run token', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let response = await request
      .get('/run-token-test/notes.txt')
      .set('Accept', SOURCE)
      .set('Authorization', token);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, 'hello');
  });

  test('capture URLs signed with a run token are not bound to the person the run acts as', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let url = `${realmURL.href}_capture/notes`;
    let response = await request
      .post('/run-token-test/_sign-capture-urls')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .send(JSON.stringify({ urls: [url] }));
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      response.body.signed[0],
      { url, signedUrl: url, expiresAt: null },
      'the URL comes back unsigned, as for a caller who is no one',
    );
  });

  test('a realm the token names in prefix form, or that resolves to no realm, is refused, not an error', async function (assert) {
    for (let readRealms of [['@cardstack/base/'], ['not a realm']]) {
      let token = tokenElsewhere(await runElsewhere(), readRealms);
      let response = (await read(token))!;
      assert.strictEqual(response.status, 401, JSON.stringify(readRealms));
    }
  });

  test('maybeHandle sends a run token through handleAutomation too', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let request = () =>
      new Request(`${realmURL.href}notes.txt`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      });
    assert.strictEqual((await realm.maybeHandle(request()))!.status, 200);
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });
    assert.strictEqual(
      (await realm.maybeHandle(request()))!.status,
      401,
      'the run row is checked on that path as well',
    );
  });

  test('a token for another realm is refused even where anyone may read', async function (assert) {
    await insertPermissions(dbAdapter, realmURL, { '*': ['read'] });
    let token = tokenElsewhere(await runElsewhere());
    assert.strictEqual(
      (await read(token))!.status,
      401,
      'a run token is never read as an anonymous caller',
    );
  });

  test('a token whose run is in another realm is refused', async function (assert) {
    let run = await runElsewhere();
    let token = mintRunToken({
      realmSecretSeed,
      run,
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 100,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual((await read(token))!.status, 401);
  });

  test('a run never administers a realm', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let response = (await realm.handle(
      new Request(`${realmURL.href}_permissions`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }),
    ))!;
    assert.strictEqual(response.status, 403);
  });

  test('a token is refused once its person’s sessions are revoked', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.strictEqual((await read(token))!.status, 200);
    await dbAdapter.execute(
      `INSERT INTO users (matrix_user_id, sessions_revoked_at)
         VALUES ($1, EXTRACT(EPOCH FROM now())::bigint + 10)
         ON CONFLICT (matrix_user_id)
         DO UPDATE SET sessions_revoked_at = EXCLUDED.sessions_revoked_at`,
      { bind: [OWNER] },
    );
    let response = (await read(token))!;
    assert.strictEqual(response.status, 401);
    assert.strictEqual(await response.text(), 'Session revoked');
  });

  test('a retry’s token keeps the run’s deadline', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let started = Date.parse(run.startedAt!);
    let retry = mintRunToken({
      realmSecretSeed,
      run: { ...run, attempt: 2 },
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 100,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
      now: started + 400_000,
    });
    let { exp } = jsonwebtoken.decode(retry) as { exp: number };
    assert.true(
      Math.abs(exp * 1000 - (started + 600_000)) <= 1000,
      'the token expires at the first start plus the time limit',
    );
    assert.throws(
      () =>
        mintRunToken({
          realmSecretSeed,
          run,
          realmURL: realmURL.href,
          readRealms: [],
          writesCap: 100,
          realmServerURL: realm.realmServerURL,
          timeLimitSeconds: 600,
          now: started + 601_000,
        }),
      /time limit passed/,
      'no token is minted for a run past its deadline',
    );
  });
});
