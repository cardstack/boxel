import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { existsSync, readFileSync } from 'fs-extra';
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';

import { rri } from '@cardstack/runtime-common';
import {
  commitBatch,
  isOperationFailure,
  type BatchDocument,
  type BatchEntry,
} from '@cardstack/runtime-common/card-operations';
import type {
  DBAdapter,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');
const testRealmHref = testRealm.href;
const PERSON = { module: rri('./person'), name: 'Person' };

// ============================================================================
// The batch coordinator, driven against a real realm.
//
// What is under test is the batch's all-or-nothing property and the things
// that property is observable through: what lands on disk, how many index jobs
// the commit enqueues, how many index events it broadcasts, and what each
// entry's result reports. Those only exist against a real realm — the jobs
// table and the Matrix room are where "one job, one event" is either true or
// not — so the coordinator is called directly with the realm's own batch core
// rather than through a stub.
// ============================================================================

function makeFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        @field friend = linksTo(() => Person, { searchable: true });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1>Embedded Person: <@fields.firstName/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1>Fitted Person: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
    'person-a.json': {
      data: {
        type: 'card',
        attributes: { firstName: 'Original', hourlyRate: 10 },
        meta: { adoptsFrom: PERSON },
      },
    },
    'person-b.json': {
      data: {
        type: 'card',
        attributes: { firstName: 'Original', hourlyRate: 10 },
        meta: { adoptsFrom: PERSON },
      },
    },
    'person-c.json': {
      data: {
        type: 'card',
        attributes: { firstName: 'Doomed', hourlyRate: 1 },
        meta: { adoptsFrom: PERSON },
      },
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;
  let request: RealmRequest;
  let serverRequest: SuperTest<Test>;
  let testRealmHttpServer: Server;
  let dir: DirResult;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    subscribeToRealmEvents: true,
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      testDbAdapter = args.dbAdapter;
      request = withRealmPath(args.request, testRealm);
      serverRequest = args.request;
      testRealmHttpServer = args.testRealmHttpServer;
      dir = args.dir;
    },
  });

  let { getMessagesSince } = setupMatrixRoom(hooks, () => ({
    testRealm: realm,
    testRealmHttpServer,
    request,
    serverRequest,
    dir,
    dbAdapter: testDbAdapter as PgAdapter,
  }));

  function realmFile(localPath: string): string {
    return join(dir.name, 'realm_server_1', 'test', localPath);
  }

  async function indexJobIds(): Promise<number[]> {
    let rows = (await testDbAdapter.execute(
      `select id from jobs where job_type = 'incremental-index'
         and concurrency_group = $1 order by id`,
      { bind: [`indexing:${realm.url}`] },
    )) as { id: number | string }[];
    return rows.map((row) => Number(row.id));
  }

  async function realmEventsSince(since: number) {
    let messages = await getMessagesSince(since);
    return messages.filter(
      (message) => message.type === APP_BOXEL_REALM_EVENT_TYPE,
    );
  }

  async function commit(entries: BatchEntry[], clientRequestId?: string) {
    return await commitBatch(realm.batchCore, entries, {
      clientRequestId: clientRequestId ?? null,
      actor: '@tester:localhost',
    });
  }

  // The `links.self` a stored relationship holds, resolved against the card
  // whose file carries it. Serialization is free to record a link relative to
  // the card that holds it, so the absolute identity is what a test compares.
  function storedLink(localPath: string, field: string): string | undefined {
    let doc = JSON.parse(readFileSync(realmFile(localPath), 'utf8'));
    let self = doc.data?.relationships?.[field]?.links?.self;
    return self == null
      ? undefined
      : new URL(self, `${testRealmHref}${localPath}`).href;
  }

  test('a batch creates several cards and links them by local id', async function (assert) {
    let results = await commit([
      {
        op: 'create',
        lid: 'author',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango', hourlyRate: 100 },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'create',
        lid: 'sidekick',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            relationships: {
              friend: { data: { lid: 'author', type: 'card' } },
            },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);

    assert.strictEqual(results.length, 2, 'one result per entry, in order');
    assert.deepEqual(
      results.map((result) => result && 'lid' in result && result.lid),
      ['author', 'sidekick'],
      'each create echoes the local id the client named it with',
    );
    assert.deepEqual(
      results.map((result) => result?.id),
      [`${testRealmHref}Person/author`, `${testRealmHref}Person/sidekick`],
      'a local id maps to the URL the realm minted for it',
    );
    assert.ok(
      existsSync(realmFile('Person/author.json')),
      'the first card is on disk',
    );
    assert.ok(
      existsSync(realmFile('Person/sidekick.json')),
      'the second card is on disk',
    );
    assert.strictEqual(
      storedLink('Person/sidekick.json', 'friend'),
      `${testRealmHref}Person/author`,
      'the link resolves to the card the other entry in the batch minted',
    );
    for (let result of results) {
      assert.true(
        (result?.meta.version ?? '').length > 0,
        'each result carries the version the file now holds',
      );
    }
  });

  test('a failing entry leaves the whole batch unwritten, unindexed and unannounced', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let failure: unknown;
    try {
      await commit([
        {
          op: 'create',
          lid: 'never-written',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Ghost' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'update',
          href: `${testRealmHref}does-not-exist`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Nope' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      failure = err;
    }

    assert.ok(isOperationFailure(failure), 'the batch is rejected');
    if (isOperationFailure(failure)) {
      assert.strictEqual(failure.error.status, 404, "the entry's own status");
      assert.strictEqual(failure.error.code, 'target-not-found');
      assert.strictEqual(
        failure.error.meta?.entry,
        1,
        'the refusal names the position of the entry that produced it',
      );
    }
    assert.notOk(
      existsSync(realmFile('Person/never-written.json')),
      'the entry ahead of the failure is not written',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'no incremental index job is enqueued',
    );
    assert.deepEqual(
      await realmEventsSince(since),
      [],
      'nothing is announced to the realm',
    );
  });

  test('a batch of one write and one delete commits under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let results = await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}person-a`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Renamed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        { op: 'delete', href: `${testRealmHref}person-c` },
      ],
      'batch-1',
    );

    assert.strictEqual(
      results[1],
      null,
      'a delete has no state left to describe',
    );
    assert.ok(results[0], 'the write reports its identity');
    assert.notOk(
      existsSync(realmFile('person-c.json')),
      'the deleted card is gone from disk',
    );
    assert.true(
      readFileSync(realmFile('person-a.json'), 'utf8').includes('Renamed'),
      'the written card holds the patched value',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the write and the delete share one index job (got ${newJobs.length})`,
    );

    let indexEvents = (await realmEventsSince(since)).filter(
      (event) =>
        (event.content as { eventName?: string; indexType?: string })
          .eventName === 'index' &&
        (event.content as { indexType?: string }).indexType === 'incremental',
    );
    assert.strictEqual(
      indexEvents.length,
      1,
      `the batch broadcasts one index event (got ${indexEvents.length})`,
    );
    assert.strictEqual(
      (indexEvents[0].content as { clientRequestId?: string }).clientRequestId,
      'batch-1',
      "the event carries the batch's own client request id",
    );
  });

  test('a base version is reported as matched or moved against the version the file held', async function (assert) {
    let [first] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}person-a`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'First' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.ok(first, 'the first write reports a version');
    let version = first!.meta.version;
    assert.strictEqual(
      first!.meta.baseMatched,
      undefined,
      'an unconditional write reports no base match',
    );

    let [matched] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}person-a`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Second' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.true(
      matched!.meta.baseMatched,
      'the base the caller named is the one the file held',
    );

    let [moved] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}person-a`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Third' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.false(
      moved!.meta.baseMatched,
      'the file has moved past the base the caller named',
    );
    assert.true(
      readFileSync(realmFile('person-a.json'), 'utf8').includes('Third'),
      'a moved base is reported, not refused — the write still lands',
    );
  });

  test('an update writes the same bytes a PATCH of the same document writes', async function (assert) {
    let patch: BatchDocument = {
      data: {
        type: 'card',
        attributes: { firstName: 'Paparazzi', hourlyRate: 42 },
        meta: { adoptsFrom: PERSON },
      },
    };

    let response = await request
      .patch('/person-a')
      .send(patch)
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(response.status, 200, 'the PATCH is served');

    await commit([
      { op: 'update', href: `${testRealmHref}person-b`, document: patch },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('person-b.json'), 'utf8'),
      readFileSync(realmFile('person-a.json'), 'utf8'),
      'the two files are byte-identical',
    );
  });

  test('a patch that changes nothing leaves the file exactly as it is', async function (assert) {
    let before = readFileSync(realmFile('person-a.json'), 'utf8');
    let jobsBefore = await indexJobIds();

    let [result] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}person-a`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Original' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('person-a.json'), 'utf8'),
      before,
      'the stored bytes are untouched',
    );
    assert.true(
      (result?.meta.version ?? '').length > 0,
      'the result still reports the version the file holds',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'nothing is queued for indexing',
    );
  });

  test('a local id claimed twice, and one nothing creates, are both refused', async function (assert) {
    let duplicate: unknown;
    try {
      await commit([
        {
          op: 'create',
          lid: 'twice',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'One' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'create',
          lid: 'twice',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Two' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      duplicate = err;
    }
    assert.ok(isOperationFailure(duplicate), 'a duplicate local id is refused');
    if (isOperationFailure(duplicate)) {
      assert.strictEqual(duplicate.error.status, 400);
      assert.strictEqual(duplicate.error.code, 'invalid-params');
    }

    let dangling: unknown;
    try {
      await commit([
        {
          op: 'create',
          lid: 'lonely',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Lonely' },
              relationships: {
                friend: { data: { lid: 'nobody', type: 'card' } },
              },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      dangling = err;
    }
    assert.ok(
      isOperationFailure(dangling),
      'a link to a local id no entry creates is refused',
    );
    if (isOperationFailure(dangling)) {
      assert.strictEqual(dangling.error.status, 400);
      assert.strictEqual(
        dangling.error.meta?.entry,
        0,
        'the refusal names the entry that carried the link',
      );
    }
    assert.notOk(
      existsSync(realmFile('Person/lonely.json')),
      'nothing is written for a refused batch',
    );
  });

  test('a delete of a card that is not there refuses without touching the realm', async function (assert) {
    let jobsBefore = await indexJobIds();
    let failure: unknown;
    try {
      await commit([{ op: 'delete', href: `${testRealmHref}not-a-card` }]);
    } catch (err: unknown) {
      failure = err;
    }
    assert.ok(isOperationFailure(failure), 'the delete is refused');
    if (isOperationFailure(failure)) {
      assert.strictEqual(failure.error.status, 404);
      assert.strictEqual(failure.error.code, 'target-not-found');
    }
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'no index job is enqueued',
    );
  });

  test('two entries changing one card are refused rather than silently ordered', async function (assert) {
    let failure: unknown;
    try {
      await commit([
        {
          op: 'update',
          href: `${testRealmHref}person-a`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Left' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'update',
          href: `${testRealmHref}person-a`,
          document: {
            data: {
              type: 'card',
              attributes: { hourlyRate: 99 },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      failure = err;
    }
    assert.ok(isOperationFailure(failure), 'the batch is refused');
    if (isOperationFailure(failure)) {
      assert.strictEqual(failure.error.code, 'invalid-params');
      assert.strictEqual(failure.error.meta?.conflictsWith, 0);
    }
    assert.true(
      readFileSync(realmFile('person-a.json'), 'utf8').includes('Original'),
      'the card is left as it was',
    );
  });

  test('a batch cannot change a card to another type', async function (assert) {
    let failure: unknown;
    try {
      await commit([
        {
          op: 'update',
          href: `${testRealmHref}person-a`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Shapeshifter' },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/card-api'),
                  name: 'CardDef',
                },
              },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      failure = err;
    }
    assert.ok(isOperationFailure(failure), 'the type change is refused');
    if (isOperationFailure(failure)) {
      assert.strictEqual(failure.error.status, 400);
    }
  });

  test('a base version on anything but an update is refused', async function (assert) {
    let failure: unknown;
    try {
      await commit([
        { op: 'delete', href: `${testRealmHref}person-c`, baseVersion: 'abc' },
      ]);
    } catch (err: unknown) {
      failure = err;
    }
    assert.ok(isOperationFailure(failure), 'the base version is refused');
    assert.ok(
      existsSync(realmFile('person-c.json')),
      'the card is left in place',
    );
  });
});
