import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync } = fsExtra;
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
import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  waitUntil,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');
const testRealmHref = testRealm.href;
// The module named absolutely rather than relative to the realm root: a create
// lands under its type's directory, one level deep, so a root-relative
// spelling would resolve against that directory instead of the realm.
const PERSON = { module: rri(`${testRealmHref}person`), name: 'Person' };

// ============================================================================
// The batch coordinator, driven against a real realm.
//
// What is under test is what only exists against a real realm: the bytes that
// land on disk, how many index jobs the commit enqueues, how many index events
// it broadcasts, and byte-for-byte agreement with the `PATCH` handler. The
// coordinator is called directly with the realm's own batch core rather than
// through a stub, since a stub is exactly what those properties are not
// observable through. Everything a batch decides before it commits — which
// files it would write, where a local id resolves, whether it commits at all —
// is checked against a stub instead, where "nothing is committed" is the
// property itself rather than a proxy for it.
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
    ...Object.fromEntries(
      [
        // A card per test that mutates one, so the file's tests do not have to
        // be ordered against each other.
        'commit-write',
        'commit-delete',
        'version-target',
        'patch-over-http',
        'patch-over-batch',
        'unchanged',
        'legacy-version',
      ].map((name) => [
        `${name}.json`,
        {
          data: {
            type: 'card',
            attributes: { firstName: 'Original', hourlyRate: 10 },
            meta: { adoptsFrom: PERSON },
          },
        },
      ]),
    ),
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
    mode: 'before',
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
    return messages
      .filter((message) => message.type === APP_BOXEL_REALM_EVENT_TYPE)
      .map((message) => message.content as RealmEventContent);
  }

  async function incrementalIndexEventsSince(
    since: number,
  ): Promise<IncrementalIndexEventContent[]> {
    return (await realmEventsSince(since)).filter(
      (event): event is IncrementalIndexEventContent =>
        event.eventName === 'index' && event.indexType === 'incremental',
    );
  }

  // The realm events a batch is answerable for: the incremental index event it
  // broadcasts, and the file-change event naming a path it touched. Filtering
  // by path rather than counting everything keeps the assertion about this
  // batch — a realm serving a suite broadcasts for its own reasons too.
  function eventsNaming(events: RealmEventContent[], localPath: string) {
    let instanceURL = `${testRealmHref}${localPath.replace(/\.json$/, '')}`;
    return events.filter((event) => {
      if (event.eventName === 'update') {
        return [
          ...(event.added ?? []),
          ...(event.updated ?? []),
          ...(event.removed ?? []),
        ].includes(localPath);
      }
      if (event.eventName === 'index' && event.indexType === 'incremental') {
        return event.invalidations.includes(instanceURL);
      }
      return false;
    });
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
      eventsNaming(await realmEventsSince(since), 'Person/never-written.json'),
      [],
      'nothing about the abandoned batch is announced to the realm',
    );
  });

  test('a batch of one write and one delete commits under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let results = await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}commit-write`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Renamed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        { op: 'delete', href: `${testRealmHref}commit-delete` },
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
      existsSync(realmFile('commit-delete.json')),
      'the deleted card is gone from disk',
    );
    assert.true(
      readFileSync(realmFile('commit-write.json'), 'utf8').includes('Renamed'),
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

    // The realm broadcasts into the Matrix room out of band from the commit,
    // so wait for the batch's own event to arrive before counting.
    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'batch-1');
    });
    // Filtered to the paths this batch touched rather than counted over the
    // window: the realm is shared across this file's tests and broadcasts are
    // fire-and-forget, so a straggler from an earlier test can land inside it.
    let indexEvents = (await incrementalIndexEventsSince(since)).filter(
      (event) =>
        event.invalidations.includes(`${testRealmHref}commit-write`) ||
        event.invalidations.includes(`${testRealmHref}commit-delete`),
    );
    assert.strictEqual(
      indexEvents.length,
      1,
      `the batch broadcasts one index event (got ${indexEvents.length})`,
    );
    assert.strictEqual(
      indexEvents[0].clientRequestId,
      'batch-1',
      "the event carries the batch's own client request id",
    );
    assert.deepEqual(
      [...indexEvents[0].invalidations].sort(),
      [`${testRealmHref}commit-write`, `${testRealmHref}commit-delete`].sort(),
      'the one event covers both the write and the removal',
    );
  });

  test('a base version is reported as matched or moved against the version the file held', async function (assert) {
    let [first] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}version-target`,
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
        href: `${testRealmHref}version-target`,
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
        href: `${testRealmHref}version-target`,
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
      readFileSync(realmFile('version-target.json'), 'utf8').includes('Third'),
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
      .patch('/patch-over-http')
      .send(patch)
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(response.status, 200, 'the PATCH is served');

    await commit([
      {
        op: 'update',
        href: `${testRealmHref}patch-over-batch`,
        document: patch,
      },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('patch-over-batch.json'), 'utf8'),
      readFileSync(realmFile('patch-over-http.json'), 'utf8'),
      'the two files are byte-identical',
    );
  });

  test('a version reported for an unchanged file is one a later write can name as its base', async function (assert) {
    // A file written before the realm recorded content hashes carries none on
    // its row. Blanking the row is how that state is reached here.
    await testDbAdapter.execute(
      `update realm_file_meta set content_hash = null
         where realm_url = $1 and file_path = $2`,
      { bind: [realm.url, 'legacy-version.json'] },
    );

    let [unchanged] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}legacy-version`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Original' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    let version = unchanged!.meta.version;
    assert.true(version.length > 0, 'the no-op write still reports a version');

    let [next] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}legacy-version`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Moved on' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.true(
      next!.meta.baseMatched,
      'the version the no-op reported is the one the file is recorded at',
    );
  });

  test('a patch that changes nothing leaves the file exactly as it is', async function (assert) {
    let before = readFileSync(realmFile('unchanged.json'), 'utf8');
    let jobsBefore = await indexJobIds();

    let [result] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}unchanged`,
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
      readFileSync(realmFile('unchanged.json'), 'utf8'),
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
});
