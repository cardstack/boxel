import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import fsExtra from 'fs-extra';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import type { SuperTest, Test } from 'supertest';
import {
  rri,
  SupportedMimeType,
  type DefinitionLookup,
  type LooseSingleCardDocument,
  type QueuePublisher,
  type Realm,
  type RealmAdapter,
} from '@cardstack/runtime-common';
import {
  commitBatch,
  setRevisionWriteSink,
  type RevisionWriteEvent,
} from '@cardstack/runtime-common/card-operations';
import {
  HISTORY_COMMIT_MAX_BYTES,
  HISTORY_DIR,
  OPERATION_ID_HEADER,
  REVISION_HEADER,
  type HistoryBackend,
  type HistoryCommitRequest,
  type HistoryCommitResult,
  type HistoryOutcome,
} from '@cardstack/runtime-common/realm-history';
import type { PgAdapter } from '@cardstack/postgres';
import { DeckdHistoryBackend } from '../lib/deckd-client.ts';
import {
  createJWT,
  createRealm,
  createVirtualNetwork,
  setupDB,
  setupPermissionedRealmCached,
  testRealmServerMatrixUserId,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

const { ensureDirSync, existsSync, readFileSync, statSync, writeJSONSync } =
  fsExtra;

// A realm that records history answers every write through the operations
// coordinator with the revision it became, and nothing about the write is
// visible anywhere — on disk, in Postgres, to a realm-event subscriber — until
// that revision exists. These run against a real deckd, the history backend
// realm-server talks to in every environment.
//
// deckd's API reads no revision's contents, so they are read straight out of
// the git store inside the repository deckd keeps (`jj/store/git`), with git.

const ROOT_REVISION = '0'.repeat(40);

const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
  }
`;

function person(firstName: string, lastName: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { firstName, lastName },
      meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
    },
  };
}

// --- deckd ------------------------------------------------------------------

// The deckd binary: `DECKD_BIN`, or `deckd` on PATH. CI provides one, so there
// its absence is a failure; a developer without one skips this module.
function findDeckd(): string | undefined {
  if (process.env.DECKD_BIN) {
    return process.env.DECKD_BIN;
  }
  try {
    return (
      execFileSync('which', ['deckd'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    let server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

async function startDeckd(
  binary: string,
): Promise<{ url: string; process: ChildProcess }> {
  let port = await freePort();
  let child = spawn(binary, [], {
    env: { ...process.env, DECKD_BIND: `127.0.0.1:${port}` },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let url = `http://127.0.0.1:${port}`;
  let deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      let response = await fetch(`${url}/health`);
      if (response.ok) {
        return { url, process: child };
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`deckd at ${binary} did not answer /health within 20s`);
}

// deckd, with the faults a test asks for injected around it.
class FaultyHistory implements HistoryBackend {
  inner: DeckdHistoryBackend;
  // Commit, then lose the response: the commit lands and the caller is told
  // the connection dropped.
  loseNextCommitResponse = false;
  // Called as each commit resolves, so a test can order what an observer saw
  // against the moment the revision existed.
  onCommitted?: (revision: string) => void;
  // Fail the next outcome query, as an unreachable deckd would.
  failNextOutcome = false;

  constructor(inner: DeckdHistoryBackend) {
    this.inner = inner;
  }

  async commit(request: HistoryCommitRequest): Promise<HistoryCommitResult> {
    let result = await this.inner.commit(request);
    this.onCommitted?.(result.revision);
    if (this.loseNextCommitResponse) {
      this.loseNextCommitResponse = false;
      throw new Error('socket hang up');
    }
    return result;
  }

  async outcome(operationId: string): Promise<HistoryOutcome> {
    if (this.failNextOutcome) {
      this.failNextOutcome = false;
      throw new Error('connect ECONNREFUSED');
    }
    return await this.inner.outcome(operationId);
  }

  head(): Promise<string> {
    return this.inner.head();
  }
}

// --- reading a revision -------------------------------------------------------

function git(realmDir: string, ...args: string[]): string {
  return execFileSync('git', [
    '--git-dir',
    join(realmDir, HISTORY_DIR, 'jj', 'store', 'git'),
    ...args,
  ]).toString();
}

interface Revision {
  author: string;
  email: string;
  parents: string[];
  subject: string;
  trailers: Record<string, string>;
  // `A path`, `M path` or `D path`, sorted.
  changes: string[];
}

function readRevision(realmDir: string, revision: string): Revision {
  let raw = git(
    realmDir,
    'show',
    '--no-renames',
    '--name-status',
    '--format=%an%x00%ae%x00%P%x00%B%x00',
    revision,
  );
  let [author, email, parents, body, rest] = raw.split('\0');
  let trailers: Record<string, string> = {};
  for (let line of body.split('\n')) {
    let match = /^([A-Za-z0-9-]+): (.*)$/.exec(line);
    if (match) {
      trailers[match[1]] = match[2];
    }
  }
  return {
    author,
    email,
    parents: parents.trim() ? parents.trim().split(' ') : [],
    subject: body.split('\n')[0],
    trailers,
    changes: rest
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/\t/, ' '))
      .sort(),
  };
}

// Every revision from HEAD back, newest first.
function historyFrom(realmDir: string, head: string): string[] {
  if (head === ROOT_REVISION) {
    return [];
  }
  return git(realmDir, 'rev-list', '--first-parent', head)
    .split('\n')
    .filter(Boolean);
}

const deckdBinary = findDeckd();
if (!deckdBinary && process.env.CI) {
  throw new Error(
    'realm-history-write-test needs deckd: set DECKD_BIN or put deckd on PATH',
  );
}
const recordingTest = deckdBinary ? test : QUnit.skip;

module(basename(import.meta.filename), function (hooks) {
  let deckd: { url: string; process: ChildProcess } | undefined;

  hooks.before(async function () {
    if (deckdBinary) {
      deckd = await startDeckd(deckdBinary);
    }
  });

  hooks.after(function () {
    deckd?.process.kill();
  });

  module('a realm that records history', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4461/recorded/');
    let realm: Realm;
    let realmDir: string;
    let adapter: RealmAdapter;
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let request: RealmRequest;
    let history: FaultyHistory;
    let events: RevisionWriteEvent[];

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
        '*': ['read'],
        john: ['read', 'write'],
      },
      fileSystem: {
        'person.gts': personGts,
        'person-1.json': person('Mango', 'Abdel-Rahman'),
        'person-2.json': person('Van Gogh', 'Abdel-Rahman'),
        'person-3.json': person('Ringo', 'Abdel-Rahman'),
      },
      history: (dir) => {
        history = new FaultyHistory(
          new DeckdHistoryBackend({ deckdURL: deckd!.url, realmDir: dir }),
        );
        return history;
      },
      onRealmSetup(args: {
        testRealm: Realm;
        testRealmPath: string;
        testRealmAdapter: RealmAdapter;
        dbAdapter: PgAdapter;
        publisher: QueuePublisher;
        request: SuperTest<Test>;
      }) {
        realm = args.testRealm;
        publisher = args.publisher;
        realmDir = args.testRealmPath;
        adapter = args.testRealmAdapter;
        dbAdapter = args.dbAdapter;
        request = withRealmPath(args.request, realmURL);
      },
    });

    hooks.beforeEach(function () {
      events = [];
      setRevisionWriteSink((event) => events.push(event));
    });

    hooks.afterEach(function () {
      setRevisionWriteSink(undefined);
      realm?.__testOnlySetHistoryFaults(undefined);
    });

    function asJohn() {
      return `Bearer ${createJWT(realm, 'john', ['read', 'write'])}`;
    }

    function patchPerson(
      path: string,
      lastName: string,
      headers: Record<string, string> = {},
    ) {
      let pending = request
        .patch(path)
        .send({
          data: {
            type: 'card',
            attributes: { lastName },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        })
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', asJohn());
      for (let [name, value] of Object.entries(headers)) {
        pending = pending.set(name, value);
      }
      return pending;
    }

    function update(href: string, lastName: string) {
      return {
        op: 'invoke',
        'boxel:name': 'update',
        href,
        data: {
          type: 'card',
          attributes: { lastName },
          meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
        },
      };
    }

    function stored(path: string): string {
      return readFileSync(join(realmDir, path), 'utf8');
    }

    recordingTest(
      'a PATCH records one revision, attributed to its user',
      async function (assert) {
        let response = await patchPerson('/person-1', 'Patched', {
          [OPERATION_ID_HEADER]: 'patch-1',
          'X-Boxel-Channel': 'host',
          'X-Boxel-Logging-Correlation-Id': 'corr-1',
          // Not a header the realm reads: authorship comes from the session.
          'X-Boxel-Author': '@mallory:localhost',
        });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        let revision = response.get(REVISION_HEADER)!;
        assert.ok(revision, 'the response carries the revision');
        assert.strictEqual(
          response.get(OPERATION_ID_HEADER),
          'patch-1',
          'and the operation id it was recorded under',
        );
        assert.ok(
          response
            .get('Access-Control-Expose-Headers')
            ?.split(',')
            .includes(REVISION_HEADER),
          'the revision header is exposed to a cross-origin caller',
        );
        assert.strictEqual(
          await history.head(),
          revision,
          'the revision is HEAD',
        );
        let recorded = readRevision(realmDir, revision);
        assert.strictEqual(recorded.author, 'john', 'authored by the session');
        // The realm's history begins empty, so a file the realm held before
        // recording began enters history as added, with its first recorded
        // write. The message describes the write, which updated the file.
        assert.deepEqual(recorded.changes, ['A person-1.json']);
        assert.strictEqual(recorded.subject, 'Update person-1.json');
        assert.deepEqual(
          {
            operation: recorded.trailers['Boxel-Operation-Id'],
            channel: recorded.trailers['Boxel-Channel'],
          },
          { operation: 'patch-1', channel: 'host' },
        );
        assert.strictEqual(
          events.at(-1)?.correlationId,
          'corr-1',
          'the revision leads to its logs through its operation id',
        );
        assert.ok(stored('person-1.json').includes('Patched'), 'and on disk');
        assert.strictEqual(
          await realm.history!.materializedRevision(),
          revision,
          'the realm has caught up with its history',
        );
      },
    );

    recordingTest('an assumed user is the author', async function (assert) {
      let response = await patchPerson('/person-1', 'Assumed', {
        'X-Boxel-Assume-User': 'john',
        Authorization: `Bearer ${createJWT(realm, testRealmServerMatrixUserId, ['assume-user'])}`,
      });
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      let recorded = readRevision(realmDir, response.get(REVISION_HEADER)!);
      assert.strictEqual(recorded.author, 'john');
    });

    recordingTest(
      'a card create, a source write and a nested batch each record one revision of exactly their paths',
      async function (assert) {
        let created = await request
          .post('/')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Paper', lastName: 'Created' },
              // By URL: the card lands in a directory of its own, where a
              // relative module would name a different file.
              meta: {
                adoptsFrom: {
                  module: `${realmURL.href}person`,
                  name: 'Person',
                },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', asJohn());
        assert.strictEqual(created.status, 201, JSON.stringify(created.body));
        let createdPath = new URL(created.body.data.id).pathname.replace(
          realmURL.pathname,
          '',
        );
        let afterCreate = readRevision(realmDir, created.get(REVISION_HEADER)!);
        assert.deepEqual(afterCreate.changes, [`A ${createdPath}.json`]);

        let source = await request
          .post('/notes.txt')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', asJohn())
          .send('first notes');
        assert.strictEqual(source.status, 204);
        let afterSource = readRevision(realmDir, source.get(REVISION_HEADER)!);
        assert.deepEqual(afterSource.changes, ['A notes.txt']);
        assert.deepEqual(afterSource.parents, [created.get(REVISION_HEADER)]);

        let batch = await request
          .post('/_operations')
          .set('Accept', SupportedMimeType.BoxelOperations)
          .set('Content-Type', SupportedMimeType.BoxelOperations)
          .set('Authorization', asJohn())
          .send(
            JSON.stringify({
              'boxel:operations': [
                {
                  op: 'parallel',
                  'boxel:operations': [
                    update(`${realmURL.href}person-1`, 'Parallel One'),
                    update(`${realmURL.href}person-2`, 'Parallel Two'),
                  ],
                },
                update(`${realmURL.href}person-3`, 'Serial Three'),
              ],
            }),
          );
        assert.strictEqual(batch.status, 200, JSON.stringify(batch.body));
        let afterBatch = readRevision(realmDir, batch.get(REVISION_HEADER)!);
        // Added to history rather than modified, as in the first test: none
        // of the three had been recorded before.
        assert.deepEqual(afterBatch.changes, [
          'A person-1.json',
          'A person-2.json',
          'A person-3.json',
        ]);
        assert.strictEqual(afterBatch.trailers['Boxel-Channel'], 'operations');
        assert.strictEqual(
          historyFrom(realmDir, batch.get(REVISION_HEADER)!).length,
          3,
          'three requests, three revisions',
        );
      },
    );

    recordingTest(
      'a write that changes nothing records nothing and answers with HEAD',
      async function (assert) {
        let first = await patchPerson('/person-1', 'Once');
        let head = first.get(REVISION_HEADER)!;
        let again = await patchPerson('/person-1', 'Once');
        assert.strictEqual(again.status, 200);
        assert.strictEqual(again.get(REVISION_HEADER), head, 'answers HEAD');
        assert.strictEqual(await history.head(), head, 'HEAD did not move');
        assert.strictEqual(events.at(-1)?.outcome, 'unchanged');
      },
    );

    recordingTest(
      'nothing observes a write before its revision exists',
      async function (assert) {
        let timeline: string[] = [];
        history.onCommitted = () => timeline.push('recorded');
        let notify = dbAdapter.notify.bind(dbAdapter);
        let execute = dbAdapter.execute.bind(dbAdapter);
        let broadcast = adapter.broadcastRealmEvent.bind(adapter);
        let publish = publisher.publish.bind(publisher);
        publisher.publish = async (...args) => {
          timeline.push('index-job');
          return await publish(...args);
        };
        dbAdapter.notify = async (channel, payload) => {
          timeline.push(`notify`);
          return await notify(channel, payload);
        };
        dbAdapter.execute = async (sql, opts) => {
          if (/INSERT INTO realm_file_meta/i.test(sql)) {
            timeline.push('file-meta');
          }
          return await execute(sql, opts);
        };
        adapter.broadcastRealmEvent = async (event, ...rest) => {
          timeline.push(`event:${event.eventName}`);
          return await broadcast(event, ...rest);
        };
        try {
          let response = await patchPerson('/person-2', 'Observed');
          assert.strictEqual(response.status, 200);
        } finally {
          dbAdapter.notify = notify;
          dbAdapter.execute = execute;
          publisher.publish = publish;
          adapter.broadcastRealmEvent = broadcast;
        }
        let recordedAt = timeline.indexOf('recorded');
        assert.true(recordedAt >= 0, `recorded: ${timeline.join(', ')}`);
        for (let observed of [
          'notify',
          'file-meta',
          'index-job',
          'event:update',
        ]) {
          assert.true(
            timeline.includes(observed),
            `${observed} happened: ${timeline.join(', ')}`,
          );
        }
        assert.deepEqual(
          timeline.slice(0, recordedAt),
          [],
          `nothing was observed before the revision existed: ${timeline.join(', ')}`,
        );
      },
    );

    recordingTest(
      'a write that fails before it is recorded writes nothing',
      async function (assert) {
        let before = stored('person-1.json');
        let broadcasts = 0;
        let broadcast = adapter.broadcastRealmEvent.bind(adapter);
        adapter.broadcastRealmEvent = async (...args) => {
          broadcasts++;
          return await broadcast(...args);
        };
        realm.__testOnlySetHistoryFaults({
          afterStage: async () => {
            throw new Error('crash after staging');
          },
        });
        try {
          let response = await patchPerson('/person-1', 'Never');
          assert.strictEqual(
            response.status,
            500,
            JSON.stringify(response.body),
          );
        } finally {
          adapter.broadcastRealmEvent = broadcast;
        }
        assert.strictEqual(stored('person-1.json'), before, 'disk unchanged');
        assert.strictEqual(
          await history.head(),
          ROOT_REVISION,
          'nothing recorded',
        );
        assert.strictEqual(broadcasts, 0, 'nothing broadcast');
        assert.strictEqual(events.at(-1)?.outcome, 'aborted');
        assert.strictEqual(events.at(-1)?.revision, null);
      },
    );

    recordingTest(
      'a write that fails after it is recorded leaves the realm behind its history',
      async function (assert) {
        let first = await patchPerson('/person-1', 'Landed');
        let landed = first.get(REVISION_HEADER)!;
        let before = stored('person-1.json');
        realm.__testOnlySetHistoryFaults({
          afterRecord: async () => {
            throw new Error('crash after recording');
          },
        });
        let response = await patchPerson('/person-1', 'Recorded Only', {
          [OPERATION_ID_HEADER]: 'recorded-only',
        });
        assert.strictEqual(response.status, 500, JSON.stringify(response.body));
        let head = await history.head();
        assert.notStrictEqual(head, landed, 'the revision was recorded');
        assert.strictEqual(
          readRevision(realmDir, head).trailers['Boxel-Operation-Id'],
          'recorded-only',
        );
        assert.strictEqual(stored('person-1.json'), before, 'disk is behind');
        assert.strictEqual(
          await realm.history!.materializedRevision(),
          landed,
          'the realm knows it has materialized only up to the earlier revision',
        );
        assert.strictEqual(events.at(-1)?.outcome, 'failed-after-record');

        realm.__testOnlySetHistoryFaults(undefined);
        let retry = await patchPerson('/person-1', 'Recorded Only', {
          [OPERATION_ID_HEADER]: 'recorded-only',
        });
        assert.strictEqual(
          retry.status,
          503,
          'a retry is told the write is recorded and awaiting recovery',
        );
        assert.strictEqual(await history.head(), head, 'and records nothing');
      },
    );

    recordingTest(
      'a lost response from deckd is resolved by asking, and a retry returns the same revision',
      async function (assert) {
        history.loseNextCommitResponse = true;
        let response = await patchPerson('/person-3', 'Lost Response', {
          [OPERATION_ID_HEADER]: 'lost-response',
        });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        let revision = response.get(REVISION_HEADER)!;
        assert.strictEqual(await history.head(), revision);
        assert.deepEqual(
          events
            .at(-1)
            ?.historyCalls.map(({ endpoint, status }) => [endpoint, status]),
          [
            ['head', 'ok'],
            ['commit', 'transport'],
            ['outcome', 'ok'],
          ],
          'the commit lost its answer, and the outcome query found it',
        );
        let mtime = statSync(join(realmDir, 'person-3.json')).mtimeMs;

        let retry = await patchPerson('/person-3', 'Lost Response', {
          [OPERATION_ID_HEADER]: 'lost-response',
        });
        assert.strictEqual(retry.status, 200, JSON.stringify(retry.body));
        assert.strictEqual(retry.get(REVISION_HEADER), revision);
        assert.strictEqual(await history.head(), revision, 'nothing recorded');
        assert.strictEqual(
          statSync(join(realmDir, 'person-3.json')).mtimeMs,
          mtime,
          'nothing written',
        );
        assert.strictEqual(events.at(-1)?.outcome, 'replayed');
      },
    );

    recordingTest(
      'a different write under an operation id already used is refused',
      async function (assert) {
        let first = await patchPerson('/person-1', 'First Use', {
          [OPERATION_ID_HEADER]: 'reused',
        });
        assert.strictEqual(first.status, 200, JSON.stringify(first.body));
        let revision = first.get(REVISION_HEADER)!;
        let before = stored('person-2.json');

        let reused = await patchPerson('/person-2', 'Second Use', {
          [OPERATION_ID_HEADER]: 'reused',
        });
        assert.strictEqual(reused.status, 409, JSON.stringify(reused.body));
        assert.strictEqual(stored('person-2.json'), before, 'nothing written');
        assert.strictEqual(await history.head(), revision, 'nothing recorded');
      },
    );

    recordingTest(
      'a retry of a source write, an upload or a removal is answered as the write it retries',
      async function (assert) {
        // History starts empty, so the card is written once to give the
        // removal a file in HEAD to remove.
        let written = await patchPerson('/person-2', 'Before Removal');
        assert.strictEqual(written.status, 200, JSON.stringify(written.body));
        let source = () =>
          request
            .post('/retried.txt')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', asJohn())
            .set(OPERATION_ID_HEADER, 'retried-source')
            .send('retried notes');
        let upload = () =>
          request
            .post('/retried.bin')
            .set('Content-Type', 'application/octet-stream')
            .set('Authorization', asJohn())
            .set(OPERATION_ID_HEADER, 'retried-upload')
            .send(Buffer.from([1, 2, 3]));
        let removal = () =>
          request
            .delete('/person-2')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', asJohn())
            .set(OPERATION_ID_HEADER, 'retried-removal');

        for (let [name, send, status] of [
          ['source write', source, 204],
          ['upload', upload, 204],
          ['removal', removal, 204],
        ] as const) {
          let first = await send();
          assert.strictEqual(first.status, status, `${name}: ${first.text}`);
          let revision = first.get(REVISION_HEADER);
          assert.ok(revision, `${name} recorded a revision`);

          let retry = await send();
          assert.strictEqual(retry.status, status, `${name}: ${retry.text}`);
          assert.strictEqual(retry.get(REVISION_HEADER), revision, name);
          assert.strictEqual(
            events.at(-1)?.outcome,
            'replayed',
            `${name}: the retry is matched to its first attempt`,
          );
        }
      },
    );

    recordingTest(
      'a retry that cannot be matched to what its id first asked for is refused',
      async function (assert) {
        let first = await patchPerson('/person-1', 'Unmatched', {
          [OPERATION_ID_HEADER]: 'unmatched',
        });
        assert.strictEqual(first.status, 200, JSON.stringify(first.body));
        let revision = first.get(REVISION_HEADER)!;
        await dbAdapter.execute(
          `UPDATE realm_history_revisions SET fingerprint = NULL WHERE operation_id = 'unmatched'`,
        );

        let retry = await patchPerson('/person-1', 'Unmatched', {
          [OPERATION_ID_HEADER]: 'unmatched',
        });
        assert.strictEqual(retry.status, 409, JSON.stringify(retry.body));
        assert.strictEqual(
          events.at(-1)?.outcome,
          'aborted',
          'refused as a reused id, not answered as the earlier write',
        );
        assert.strictEqual(await history.head(), revision, 'nothing recorded');
      },
    );

    recordingTest(
      'a write whose outcome is unknown is finished by a retry under its id, whatever the retry is correlated with',
      async function (assert) {
        history.loseNextCommitResponse = true;
        history.failNextOutcome = true;
        let before = stored('person-3.json');
        let response = await patchPerson('/person-3', 'Unknown Outcome', {
          [OPERATION_ID_HEADER]: 'unknown-outcome',
          'X-Boxel-Logging-Correlation-Id': 'first-attempt',
        });
        assert.strictEqual(response.status, 503, JSON.stringify(response.body));
        assert.strictEqual(events.at(-1)?.outcome, 'unknown');
        let revision = await history.head();
        assert.notStrictEqual(revision, ROOT_REVISION, 'deckd committed it');
        assert.strictEqual(stored('person-3.json'), before, 'disk is behind');

        let retry = await patchPerson('/person-3', 'Unknown Outcome', {
          [OPERATION_ID_HEADER]: 'unknown-outcome',
          'X-Boxel-Logging-Correlation-Id': 'second-attempt',
        });
        assert.strictEqual(retry.status, 200, JSON.stringify(retry.body));
        assert.strictEqual(
          retry.get(REVISION_HEADER),
          revision,
          'the retry is the revision the first attempt recorded',
        );
        assert.strictEqual(await history.head(), revision, 'nothing new');
        assert.ok(
          stored('person-3.json').includes('Unknown Outcome'),
          'and the retry brought disk up to it',
        );
      },
    );

    recordingTest(
      'a line appended to a file records the file as it now stands',
      async function (assert) {
        let source = await request
          .post('/log.txt')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', asJohn())
          .send('first\n');
        assert.strictEqual(source.status, 204);
        let [result] = await commitBatch(
          realm.batchCore,
          [
            {
              op: 'appendLine',
              href: `${realmURL.href}log.txt`,
              params: { line: 'second' },
            },
          ],
          { recording: { operationId: 'append-1', channel: 'operations' } },
        );
        assert.ok(result, 'the line was appended');
        let head = await history.head();
        assert.deepEqual(readRevision(realmDir, head).changes, ['M log.txt']);
        assert.strictEqual(
          git(realmDir, 'show', `${head}:log.txt`),
          stored('log.txt'),
          'the revision holds what the file holds',
        );
        assert.true(stored('log.txt').startsWith('first\nsecond'));
      },
    );

    recordingTest(
      'a write larger than one revision takes is refused, not retried',
      async function (assert) {
        let source = await request
          .post('/big.txt')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', asJohn())
          .send('x'.repeat(100));
        assert.strictEqual(source.status, 204);
        let head = await history.head();
        realm.history!.maxCommitBytes = 64;
        try {
          let tooBig = await request
            .post('/bigger.txt')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', asJohn())
            .send('y'.repeat(100));
          assert.strictEqual(tooBig.status, 413, JSON.stringify(tooBig.body));
          assert.false(existsSync(join(realmDir, 'bigger.txt')), 'not written');

          let before = stored('big.txt');
          await assert.rejects(
            commitBatch(
              realm.batchCore,
              [
                {
                  op: 'appendLine',
                  href: `${realmURL.href}big.txt`,
                  params: { line: 'more' },
                },
              ],
              {
                recording: { operationId: 'append-big', channel: 'operations' },
              },
            ),
            (err: { error?: { status?: number } }) => err.error?.status === 413,
            'an append to a file already over it is refused',
          );
          assert.strictEqual(stored('big.txt'), before, 'not appended');
        } finally {
          realm.history!.maxCommitBytes = HISTORY_COMMIT_MAX_BYTES;
        }
        assert.strictEqual(await history.head(), head, 'nothing recorded');
      },
    );

    recordingTest(
      'a retry of a write whose answer was not kept is told the write landed',
      async function (assert) {
        let first = await patchPerson('/person-2', 'Answer Lost', {
          [OPERATION_ID_HEADER]: 'answer-lost',
        });
        assert.strictEqual(first.status, 200, JSON.stringify(first.body));
        let revision = first.get(REVISION_HEADER)!;
        await dbAdapter.execute(
          `UPDATE realm_history_revisions SET results = NULL WHERE operation_id = 'answer-lost'`,
        );
        let mtime = statSync(join(realmDir, 'person-2.json')).mtimeMs;

        let retry = await patchPerson('/person-2', 'Answer Lost', {
          [OPERATION_ID_HEADER]: 'answer-lost',
        });
        assert.strictEqual(retry.status, 409, JSON.stringify(retry.body));
        assert.true(
          JSON.stringify(retry.body).includes(revision),
          'and given the revision it landed as',
        );
        assert.strictEqual(
          statSync(join(realmDir, 'person-2.json')).mtimeMs,
          mtime,
          'nothing written',
        );
        assert.strictEqual(await history.head(), revision, 'nothing recorded');
        assert.strictEqual(events.at(-1)?.outcome, 'replayed');
      },
    );

    recordingTest(
      'every recorded write emits its telemetry',
      async function (assert) {
        let response = await patchPerson('/person-2', 'Measured', {
          [OPERATION_ID_HEADER]: 'measured',
        });
        assert.strictEqual(response.status, 200);
        let event = events.find(
          ({ operationId }) => operationId === 'measured',
        );
        assert.ok(event, 'the write emitted a revision-write event');
        assert.strictEqual(event!.realmURL, realmURL.href);
        assert.strictEqual(event!.revision, response.get(REVISION_HEADER));
        assert.strictEqual(event!.writeChannel, 'host');
        assert.strictEqual(event!.outcome, 'committed');
        for (let field of [
          'lockWaitMs',
          'recordMs',
          'historyLockWaitMs',
          'materializeMs',
          'postCommitMs',
          'totalMs',
        ] as const) {
          assert.strictEqual(
            typeof event![field],
            'number',
            `${field} is measured`,
          );
        }
        assert.true(
          event!.historyCalls.some(
            ({ endpoint, status }) => endpoint === 'commit' && status === 'ok',
          ),
          'the commit is timed',
        );
      },
    );

    recordingTest(
      'the history is never served, listed or written through the realm',
      async function (assert) {
        await patchPerson('/person-1', 'Hidden');
        assert.true(existsSync(join(realmDir, HISTORY_DIR)), 'history exists');
        let served = await request
          .get(`/${HISTORY_DIR}/deckd/HEAD`)
          .set('Authorization', asJohn());
        assert.strictEqual(served.status, 404, 'not served');
        let listed = await request
          .get('/')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', asJohn());
        assert.false(
          JSON.stringify(listed.body).includes(HISTORY_DIR),
          'not listed',
        );
        let written = await request
          .post(`/${HISTORY_DIR}/planted.txt`)
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', asJohn())
          .send('planted');
        assert.true(written.status >= 400, `refused: ${written.status}`);
        assert.false(
          existsSync(join(realmDir, HISTORY_DIR, 'planted.txt')),
          'not written',
        );
      },
    );
  });

  module('a realm that records no history', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4462/unrecorded/');
    let realmDir: string;
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: { '*': ['read', 'write'] },
      fileSystem: {
        'person.gts': personGts,
        'person-1.json': person('Mango', 'Abdel-Rahman'),
      },
      onRealmSetup(args: { testRealmPath: string; request: SuperTest<Test> }) {
        realmDir = args.testRealmPath;
        request = withRealmPath(args.request, realmURL);
      },
    });

    test('writes as it always has, with no revision', async function (assert) {
      let response = await request
        .patch('/person-1')
        .send(person('Mango', 'Unrecorded'))
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.get(REVISION_HEADER), undefined);
      assert.strictEqual(response.get(OPERATION_ID_HEADER), undefined);
      assert.false(existsSync(join(realmDir, HISTORY_DIR)));
    });
  });

  // Two realm-server replicas: two realms over one directory and one database,
  // each with its own connection to deckd and so its own idea of HEAD.
  module('two replicas of one realm', function (hooks) {
    let realmURL = 'http://127.0.0.1:4463/replicated/';
    let dbAdapter: PgAdapter;
    let tmpDir: DirResult;
    let realmDir: string;
    let replicas: Realm[];

    setGracefulCleanup();

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher) => {
        if (!deckd) {
          return;
        }
        dbAdapter = _dbAdapter;
        tmpDir = dirSync({ unsafeCleanup: true });
        realmDir = join(tmpDir.name, 'realm');
        ensureDirSync(realmDir);
        writeJSONSync(join(realmDir, 'realm.json'), {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Replicated Realm' } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/realm-config',
                name: 'RealmConfig',
              },
            },
          },
        });
        // Raw source writes resolve no definition, so a lookup that only
        // answers the write path's invalidation is enough.
        let definitionLookup = {
          forRealm() {
            return this;
          },
          async invalidate() {
            return [];
          },
        } as unknown as DefinitionLookup;
        replicas = [];
        for (let i = 0; i < 2; i++) {
          let { realm } = await createRealm({
            dir: realmDir,
            definitionLookup,
            realmURL,
            permissions: { '*': ['read', 'write'] },
            virtualNetwork: createVirtualNetwork(),
            publisher,
            dbAdapter,
            history: (dir) =>
              new DeckdHistoryBackend({ deckdURL: deckd!.url, realmDir: dir }),
          });
          replicas.push(realm);
        }
      },
    });

    function writeSource(replica: Realm, path: string, content: string) {
      return commitBatch(
        replica.batchCore,
        [
          {
            op: 'update',
            href: `${realmURL}${path}`,
            content,
            rawSource: true,
          },
        ],
        {
          waitForIndex: false,
          recording: { operationId: `write-${path}`, channel: 'operations' },
        },
      );
    }

    recordingTest(
      'concurrent writes of different files both commit, one after the other',
      async function (assert) {
        // Each replica records once first, so each has a HEAD cached that the
        // other's next commit makes stale.
        await writeSource(replicas[0], 'warm-0.txt', 'zero');
        await writeSource(replicas[1], 'warm-1.txt', 'one');
        await Promise.all([
          writeSource(replicas[0], 'a.txt', 'from replica 0'),
          writeSource(replicas[1], 'b.txt', 'from replica 1'),
        ]);
        let backend = new DeckdHistoryBackend({
          deckdURL: deckd!.url,
          realmDir,
        });
        let head = await backend.head();
        let revisions = historyFrom(realmDir, head);
        assert.strictEqual(revisions.length, 4, 'four writes, four revisions');
        let changes = revisions.map((revision) => {
          let recorded = readRevision(realmDir, revision);
          assert.true(recorded.parents.length <= 1, 'the history is linear');
          return recorded.changes;
        });
        assert.deepEqual(
          changes.slice(0, 2).flat().sort(),
          ['A a.txt', 'A b.txt'],
          'each concurrent revision holds only its own write',
        );
        assert.strictEqual(
          readFileSync(join(realmDir, 'a.txt'), 'utf8'),
          'from replica 0',
        );
        assert.strictEqual(
          readFileSync(join(realmDir, 'b.txt'), 'utf8'),
          'from replica 1',
        );
        assert.strictEqual(
          await replicas[0].history!.materializedRevision(),
          head,
          'both writes reached disk',
        );
      },
    );
  });
});
