import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import {
  isOperationFailure,
  runOperation,
} from '@cardstack/runtime-common/card-operations';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// Under a policy, a `.jsonl` or `.log` file's bytes are granted to no one:
// neither read (`readSource`) nor replaced (`update`), whatever type a rule
// names, and the base log types' `record` is the one write a grant reaches
// on a log. Who wrote a line is the actor the realm stamped on it, which
// means nothing if a caller may rewrite the log. A grant on `FileDef` that
// admits a stranger to a text file's bytes reaches no log, and a grant on a
// log type of anything but `record` is recorded when the policy compiles.
// The realm's own permissions are not the policy's: a reader still reads a
// log, a writer still rewrites one, and a realm with no policy is as it was.
const LOGS = 'http://127.0.0.1:4444/logs/';
const PLAIN = 'http://127.0.0.1:4444/plain/';
const ORG = 'http://127.0.0.1:4444/org/';
const OWNER = '@owner:localhost';
const WRITER = '@writer:localhost';
const READER = '@reader:localhost';
const STRANGER = '@stranger:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const FILE_DEF = { module: rri('@cardstack/base/card-api'), name: 'FileDef' };
const JSONL_FILE = {
  module: rri('@cardstack/base/jsonl-file-def'),
  name: 'JSONLFile',
};
const LOG_FILE = {
  module: rri('@cardstack/base/log-file-def'),
  name: 'LogFile',
};

const NOTES = 'notes.txt';
const EVENTS = 'events.jsonl';
const SERVER_LOG = 'server.log';
const NOTES_TEXT = 'term notes\n';
const EVENTS_TEXT = `${JSON.stringify({ at: '2026-11-01 08:00:00', actor: OWNER, what: 'opened' })}\n`;
const SERVER_LOG_TEXT = `2026-11-01 08:00:00 ${OWNER} opened\n`;

// Every file's bytes, read and replaced, which on main reaches a log as it
// reaches any text file; and on each log type the grants the gate refuses,
// beside JSONLFile's own `record`.
const RULES = [
  {
    targetType: FILE_DEF,
    grants: [{ operation: 'readSource' }, { operation: 'update' }],
  },
  {
    targetType: JSONL_FILE,
    grants: [
      { operation: 'update' },
      { operation: 'readSource' },
      { operation: 'record' },
    ],
  },
  {
    targetType: LOG_FILE,
    grants: [{ operation: 'readSource' }, { operation: 'update' }],
  },
];

function policyCard() {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules: RULES },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

module(basename(import.meta.filename), function (hooks) {
  let logs: Realm;
  let plain: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let permissions: RealmPermissions = {
      [OWNER]: ['read', 'write', 'realm-owner'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
    };
    let files = {
      [NOTES]: NOTES_TEXT,
      [EVENTS]: EVENTS_TEXT,
      [SERVER_LOG]: SERVER_LOG_TEXT,
    };
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(LOGS),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Logs',
              policy: `${ORG}policies/logs`,
            }),
            ...files,
          },
          permissions: { ...permissions },
        },
        {
          realmURL: new URL(PLAIN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Plain' }),
            ...files,
          },
          permissions: { ...permissions },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/logs.json': policyCard(),
          },
          permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    let realm = (url: string) =>
      result.realms.find((candidate) => candidate.url === url)!;
    logs = realm(LOGS);
    plain = realm(PLAIN);
    org = realm(ORG);
  }

  async function stop() {
    for (let realm of [logs, plain, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: stop,
  });

  const PERMISSIONS: RealmPermissions = {
    [OWNER]: ['read', 'write', 'realm-owner'],
    [WRITER]: ['read', 'write'],
    [READER]: ['read'],
    [STRANGER]: [],
  };

  function auth(realm: Realm, user: string) {
    return `Bearer ${createJWT(realm, user, PERMISSIONS[user])}`;
  }

  // Collect the raw bytes rather than letting supertest pick a text or JSON
  // parser from the content type.
  function binaryParser(
    res: unknown,
    callback: (err: Error | null, body: Buffer) => void,
  ) {
    let stream = res as NodeJS.ReadableStream;
    let chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => callback(null, Buffer.concat(chunks)));
  }

  function getSource(
    realmURL: string,
    realm: Realm,
    localPath: string,
    user: string,
  ) {
    return request
      .get(`${new URL(realmURL).pathname}${localPath}`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth(realm, user))
      .buffer(true)
      .parse(binaryParser);
  }

  function writeSource(
    realmURL: string,
    realm: Realm,
    localPath: string,
    user: string,
    text: string,
  ) {
    return request
      .post(`${new URL(realmURL).pathname}${localPath}`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth(realm, user))
      .send(text);
  }

  function textOf(response: Response) {
    return Buffer.isBuffer(response.body) ? response.body.toString() : '';
  }

  function status(response: Response) {
    return `${response.status} ${textOf(response).slice(0, 300) || response.text?.slice(0, 300)}`;
  }

  async function stored(realm: Realm, localPath: string) {
    return await realm.operationCore.readFileAsText(localPath as LocalPath);
  }

  // A stored-bytes read as a caller the realm ACL declined, which is the one
  // case the policy decides, with the refusal as the gate gives it rather
  // than as a route tells a caller who may not read the realm.
  async function readSourceRefusal(localPath: string) {
    try {
      await runOperation(logs.operationCore, {
        target: { kind: 'instance' as const, url: `${LOGS}${localPath}` },
        name: 'readSource',
        actor: STRANGER,
        clientRequestId: 'log-files-test',
        coarseDeclined: true,
      });
      return 'served';
    } catch (e: unknown) {
      return isOperationFailure(e) ? e.error.code : String(e);
    }
  }

  test('compiling records a grant of update or readSource on a log type, and leaves it out', async function (assert) {
    let compiled = await logs.getCompiledPolicy();
    assert.deepEqual(
      compiled?.issues
        .filter(({ code }) => code === 'grants-log-bytes')
        .map(({ code, path }) => ({ code, path })),
      [
        { code: 'grants-log-bytes', path: 'rules[1].grants[0].operation' },
        { code: 'grants-log-bytes', path: 'rules[1].grants[1].operation' },
        { code: 'grants-log-bytes', path: 'rules[2].grants[0].operation' },
        { code: 'grants-log-bytes', path: 'rules[2].grants[1].operation' },
      ],
      'update and readSource on JSONLFile and on LogFile',
    );
    let message = compiled?.issues.find(
      ({ code }) => code === 'grants-log-bytes',
    )?.message;
    assert.ok(
      message?.includes('only `record` is granted on a log'),
      `the issue says what is grantable: ${message}`,
    );
    assert.deepEqual(
      compiled?.rules.map((rule) =>
        rule.grants.map((grant) => grant.operation),
      ),
      [['readSource', 'update'], ['record'], []],
      "FileDef's grants and JSONLFile's record are kept",
    );
  });

  test('a readSource grant reaches a text file and no log', async function (assert) {
    assert.strictEqual(
      await readSourceRefusal(NOTES),
      'served',
      'the FileDef grant serves a text file',
    );
    assert.strictEqual(
      await readSourceRefusal(EVENTS),
      'operation-not-permitted',
      'a .jsonl is refused',
    );
    assert.strictEqual(
      await readSourceRefusal(SERVER_LOG),
      'operation-not-permitted',
      'a .log is refused',
    );

    let notes = await getSource(LOGS, logs, NOTES, STRANGER);
    assert.strictEqual(notes.status, 200, status(notes));
    assert.strictEqual(textOf(notes), NOTES_TEXT);
    for (let localPath of [EVENTS, SERVER_LOG]) {
      let response = await getSource(LOGS, logs, localPath, STRANGER);
      assert.strictEqual(
        response.status,
        404,
        `${localPath}: a caller who may not read the realm is told it is not there: ${status(response)}`,
      );
      assert.false(
        textOf(response).includes(OWNER),
        `${localPath}: no line is served`,
      );
    }
  });

  test('an update grant replaces a text file and no log', async function (assert) {
    let notes = await writeSource(LOGS, logs, NOTES, STRANGER, 'rewritten\n');
    assert.strictEqual(notes.status, 204, status(notes));
    assert.strictEqual(await stored(logs, NOTES), 'rewritten\n');

    let forged = `${JSON.stringify({ at: '2026-11-01 08:00:00', actor: READER, what: 'forged' })}\n`;
    let stranger = await writeSource(LOGS, logs, EVENTS, STRANGER, forged);
    assert.strictEqual(
      stranger.status,
      404,
      `a caller who may not read the realm is told the log is not there: ${status(stranger)}`,
    );
    let reader = await writeSource(LOGS, logs, EVENTS, READER, forged);
    assert.strictEqual(
      reader.status,
      403,
      `a reader is told the write is not permitted: ${status(reader)}`,
    );
    let serverLog = await writeSource(
      LOGS,
      logs,
      SERVER_LOG,
      STRANGER,
      `2026-11-01 08:00:00 ${READER} forged\n`,
    );
    assert.strictEqual(serverLog.status, 404, status(serverLog));
    assert.strictEqual(
      await stored(logs, EVENTS),
      EVENTS_TEXT,
      'the .jsonl is as it was',
    );
    assert.strictEqual(
      await stored(logs, SERVER_LOG),
      SERVER_LOG_TEXT,
      'the .log is as it was',
    );
  });

  test('record is the write a grant reaches on a log, and the realm stamps who wrote the line', async function (assert) {
    let response = await request
      .post(`${new URL(LOGS).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth(logs, STRANGER))
      .send(
        JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': 'record',
              href: `${LOGS}${EVENTS}`,
              data: { what: 'arrived' },
            },
          ],
        }),
      );
    assert.strictEqual(response.status, 200, response.text);
    let lines = (await stored(logs, EVENTS))!
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      lines.map(({ actor, what }) => [actor, what]),
      [
        [OWNER, 'opened'],
        [STRANGER, 'arrived'],
      ],
    );
  });

  test('the realm’s own permissions are not the policy’s: a reader reads a log, a writer rewrites one', async function (assert) {
    for (let localPath of [EVENTS, SERVER_LOG]) {
      let read = await getSource(LOGS, logs, localPath, READER);
      assert.strictEqual(read.status, 200, `${localPath}: ${status(read)}`);
      assert.true(
        textOf(read).includes(OWNER),
        `${localPath}: a reader reads its lines`,
      );
    }
    let rewritten = `${JSON.stringify({ at: '2026-11-02 08:00:00', actor: WRITER, what: 'rewritten' })}\n`;
    let written = await writeSource(LOGS, logs, EVENTS, WRITER, rewritten);
    assert.strictEqual(written.status, 204, status(written));
    assert.strictEqual(await stored(logs, EVENTS), rewritten);
    let read = await getSource(LOGS, logs, EVENTS, WRITER);
    assert.strictEqual(read.status, 200, status(read));
    assert.strictEqual(textOf(read), rewritten);
  });

  test('a realm with no policy is unaffected: a writer reads and rewrites its logs', async function (assert) {
    for (let [localPath, text] of [
      [EVENTS, EVENTS_TEXT],
      [SERVER_LOG, SERVER_LOG_TEXT],
    ]) {
      let read = await getSource(PLAIN, plain, localPath, WRITER);
      assert.strictEqual(read.status, 200, `${localPath}: ${status(read)}`);
      assert.strictEqual(textOf(read), text);
    }
    let rewritten = `2026-11-02 08:00:00 ${WRITER} rewritten\n`;
    let written = await writeSource(
      PLAIN,
      plain,
      SERVER_LOG,
      WRITER,
      rewritten,
    );
    assert.strictEqual(written.status, 204, status(written));
    assert.strictEqual(await stored(plain, SERVER_LOG), rewritten);
    let read = await getSource(PLAIN, plain, SERVER_LOG, WRITER);
    assert.strictEqual(textOf(read), rewritten);
  });
});
