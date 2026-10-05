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
  RealmAdapter,
} from '@cardstack/runtime-common';
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

// A batch is all-or-nothing, and under a realm's policy that holds entry by
// entry: each entry is gated against its own target and its own definition,
// and one refusal anywhere refuses the batch with nothing written, no index job
// enqueued and no realm event sent. A refusal can come from three places, and
// each leaves the same nothing behind: the gate, when no grant matches, before
// anything is staged; the write lock, when a predicate does not hold against
// the card the write changes, before that write stages; and the write lock
// again, when a create against a type is judged by the card it would mint,
// after the create itself has staged.
//
// The topology is the policy gate suite's: an Education realm whose policy
// card lives in an Org realm. A teacher holds no permission on the Education
// realm, so every entry they send reaches the policy. An aide may read the
// realm and not write it, so their reads are the realm ACL's to answer and
// only their writes reach the policy.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';
const AIDE = '@aide:localhost';
const COLLEAGUE = '@colleague:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };

function adoptsFrom(ref: { module: string; name: string }) {
  return { module: rri(ref.module), name: ref.name };
}

// Is the caller one of the classroom's teachers, exactly. BXL's `contains`
// matches substrings, so it is not used for membership.
const TEACHES = '.teacherIds | any(. == actor())';

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, actor } from "@cardstack/base/operations";

  export class ClassroomActivity extends CardDef {
    @field note = contains(StringField);
    @field author = contains(StringField);
  }

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field wing = contains(StringField);
    @field teacherIds = containsMany(StringField);

    @operation static rename = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };

    @operation static appendActivity = {
      base: 'create',
      of: () => ClassroomActivity,
      params: { note: StringField },
      fill: { note: params('note'), author: actor() },
    };
  }
`;

const BULLETIN_MODULE = `
  import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Bulletin extends CardDef {
    @field body = contains(StringField);
    @field audience = contains(StringField);
    @field follows = linksTo(() => Bulletin);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// A classroom's writes rest on a predicate, so they are decided under the write
// lock. A bulletin's `update` is granted outright, its `create` rests on the
// card it would mint, and nothing grants its `delete` or a classroom's, so
// either is refused at the gate. Nothing grants a read of either type.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'rename', where: TEACHES },
      { operation: 'appendActivity', where: TEACHES },
    ],
  },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'update' },
      { operation: 'create', where: '.audience == "staff"' },
    ],
  },
];

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function classroom(title: string, wing: string, teacherIds: string[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, wing, teacherIds },
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  });
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

function invoke(
  name: string,
  rest: {
    href?: string;
    data?: unknown;
    'boxel:target'?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

function parallel(...operations: unknown[]): Record<string, unknown> {
  return { op: 'parallel', 'boxel:operations': operations };
}

function rename(href: string, title: string) {
  return invoke('rename', { href, data: { title } });
}

function createBulletin(attributes: Record<string, unknown>, lid?: string) {
  return invoke('create', {
    data: {
      ...(lid ? { lid } : {}),
      type: 'card',
      attributes,
      meta: { adoptsFrom: adoptsFrom(BULLETIN) },
    },
  });
}

// Room 101 and Room 103 are the east wing, and the teacher and the aide teach
// both. Room 102 is the west wing, and only a colleague teaches it.
const ROOM_101 = `${EDUCATION}classrooms/room-101`;
const ROOM_102 = `${EDUCATION}classrooms/room-102`;
const ROOM_103 = `${EDUCATION}classrooms/room-103`;
const NOTICE = `${EDUCATION}bulletins/notice`;

// Targets an entry describes with a query rather than names, run against every
// card the query finds.
const EVERY_CLASSROOM = {
  query: { 'item.on': CLASSROOM },
  expect: 'many',
};
const EAST_WING = {
  query: { 'item.on': CLASSROOM, eq: { 'item.wing': 'east' } },
  expect: 'many',
};

type EnvelopeError = {
  status: number;
  code: string;
  title: string;
  detail: string;
  id?: string;
  meta?: { entry?: number | string };
};

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let educationAdapter: RealmAdapter;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;

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
    db = dbAdapter;
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'bulletin.gts': BULLETIN_MODULE,
            'classrooms/room-101.json': classroom('Room 101', 'east', [
              TEACHER,
              AIDE,
            ]),
            'classrooms/room-102.json': classroom('Room 102', 'west', [
              COLLEAGUE,
            ]),
            'classrooms/room-103.json': classroom('Room 103', 'east', [
              TEACHER,
              AIDE,
            ]),
            'bulletins/notice.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: { body: 'Posted', audience: 'staff' },
                meta: {
                  adoptsFrom: { module: '../bulletin', name: 'Bulletin' },
                },
              },
            }),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [AIDE]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard(RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    let index = result.realms.findIndex((realm) => realm.url === EDUCATION);
    education = result.realms[index];
    educationAdapter = result.realmAdapters[index];
  }

  async function stop() {
    education.__testOnlyClearCaches();
    education.unsubscribe();
    await closeServer(server);
    resetCatalogRealms();
  }

  // Every realm `start` brings up is indexed once, into a template database
  // each test starts from, rather than from scratch before each test.
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

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    aide: () => bearer(AIDE, ['read']),
    teacher: () => bearer(TEACHER),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${path(EDUCATION)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function errorOf(response: Response): EnvelopeError {
    return (response.body as { errors: EnvelopeError[] }).errors[0];
  }

  function resultsOf(response: Response) {
    return (
      response.body as {
        'atomic:results': unknown[];
      }
    )['atomic:results'];
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  // The refusal each caller is told for an entry the policy refuses: the aide
  // may read the realm and is told the gate refused, and the teacher may not
  // and is told nothing is there. Both are told which entry it was.
  function assertRefusedAt(
    assert: Assert,
    response: Response,
    caller: 'aide' | 'teacher',
    entry: number | string,
    label: string,
  ) {
    let error = errorOf(response);
    if (caller === 'aide') {
      assert.strictEqual(response.status, 403, `${label}: status`);
      assert.strictEqual(
        error.code,
        'operation-not-permitted',
        `${label}: the gate's refusal`,
      );
    } else {
      assert.strictEqual(response.status, 404, `${label}: status`);
      assert.deepEqual(
        { code: error.code, detail: error.detail },
        { code: 'target-not-found', detail: 'no such target' },
        `${label}: the refusal a card that is not there gets`,
      );
    }
    assert.strictEqual(error.meta?.entry, entry, `${label}: names the entry`);
  }

  // Every file the Education realm holds, with its bytes, read off disk. A
  // refused batch must leave this exactly as it found it.
  async function realmFiles() {
    let files: Record<string, string | undefined> = {};
    let walk = async (dir: string) => {
      for await (let entry of educationAdapter.readdir(dir as LocalPath)) {
        if (entry.kind === 'directory') {
          await walk(entry.path);
        } else {
          files[entry.path] = await education.operationCore.readFileAsText(
            entry.path,
          );
        }
      }
    };
    await walk('');
    return files;
  }

  async function stored(url: string) {
    let content = await education.operationCore.readFileAsText(
      `${path(url).slice(path(EDUCATION).length)}.json` as LocalPath,
    );
    return content === undefined
      ? undefined
      : (
          JSON.parse(content) as {
            data: {
              attributes: Record<string, unknown>;
            };
          }
        ).data.attributes;
  }

  async function indexJobCount() {
    let rows = (await db.execute(
      `select count(*)::int as n from jobs
         where job_type = 'incremental-index'
           and (concurrency_group = $1 or lane_family = $1)`,
      { bind: [`indexing:${education.url}`] },
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  // Every realm event the Education realm sends, Matrix-bound or otherwise,
  // passes through its adapter. A write announces itself there before the
  // write itself, so a batch that wrote anything would have been counted by
  // the time its response arrives.
  function countRealmEvents() {
    let original = educationAdapter.broadcastRealmEvent.bind(educationAdapter);
    let count = { sent: 0 };
    educationAdapter.broadcastRealmEvent = async (...args) => {
      count.sent++;
      return await original(...args);
    };
    return count;
  }

  // What the realm holds before a batch, to compare what it holds after one
  // against: its files, its index jobs and the events it has sent since.
  async function beforeBatch() {
    return {
      files: await realmFiles(),
      jobs: await indexJobCount(),
      events: countRealmEvents(),
    };
  }

  async function assertNothingWritten(
    assert: Assert,
    before: Awaited<ReturnType<typeof beforeBatch>>,
    label: string,
  ) {
    assert.deepEqual(
      await realmFiles(),
      before.files,
      `${label}: every file in the realm is as it was`,
    );
    assert.strictEqual(
      await indexJobCount(),
      before.jobs,
      `${label}: no index job was enqueued`,
    );
    assert.strictEqual(
      before.events.sent,
      0,
      `${label}: no realm event was sent`,
    );
  }

  module('one refusal refuses the whole batch', function () {
    test('an entry no grant admits is refused at the gate with nothing staged', async function (assert) {
      for (let caller of ['teacher', 'aide'] as const) {
        let before = await beforeBatch();
        let { pendingDischarges } = gateStats();
        // The caller may rename the classroom, and nothing grants its delete.
        // The rename's grant says nothing about the delete beside it.
        let response = await operations(
          AUTH[caller](),
          rename(ROOM_101, 'Renamed'),
          invoke('delete', { href: ROOM_101 }),
        );
        assertRefusedAt(assert, response, caller, 1, `the ${caller}`);
        await assertNothingWritten(assert, before, `the ${caller}`);
        assert.strictEqual(
          gateStats().pendingDischarges,
          pendingDischarges,
          `the ${caller}: the rename never reached the write lock`,
        );
      }
    });

    test('a write whose predicate does not hold under the lock refuses its batch the same way', async function (assert) {
      for (let caller of ['teacher', 'aide'] as const) {
        let before = await beforeBatch();
        let { pendingDischarges } = gateStats();
        let response = await operations(
          AUTH[caller](),
          rename(ROOM_101, 'Renamed'),
          rename(ROOM_102, 'Renamed'),
        );
        assertRefusedAt(assert, response, caller, 1, `the ${caller}`);
        await assertNothingWritten(assert, before, `the ${caller}`);
        assert.strictEqual(
          gateStats().pendingDischarges - pendingDischarges,
          2,
          `the ${caller}: both renames were decided under the write lock`,
        );
      }
    });

    test('a create refused on the card it would mint leaves what staged before it unwritten', async function (assert) {
      // The create stages before it is judged, since the card it would mint is
      // what its grant rests on, so the rename and the update ahead of it have
      // staged too by the time it is refused.
      for (let caller of ['teacher', 'aide'] as const) {
        let before = await beforeBatch();
        let { pendingDischarges } = gateStats();
        let response = await operations(
          AUTH[caller](),
          rename(ROOM_101, 'Renamed'),
          invoke('update', {
            href: NOTICE,
            data: {
              type: 'card',
              attributes: { body: 'Revised' },
              meta: { adoptsFrom: adoptsFrom(BULLETIN) },
            },
          }),
          createBulletin({ body: 'Field trip', audience: 'students' }),
        );
        assertRefusedAt(assert, response, caller, 2, `the ${caller}`);
        await assertNothingWritten(assert, before, `the ${caller}`);
        // The rename and the create are the batch's two predicates, and the
        // update is granted outright. Both predicates were decided under the
        // lock, so the create was refused there, after the rename staged.
        assert.strictEqual(
          gateStats().pendingDischarges - pendingDischarges,
          2,
          `the ${caller}: the create was judged under the lock`,
        );
      }
    });

    test('a refused member of a parallel group rolls back its siblings', async function (assert) {
      for (let caller of ['teacher', 'aide'] as const) {
        let before = await beforeBatch();
        let { pendingDischarges } = gateStats();
        let underTheLock = await operations(
          AUTH[caller](),
          parallel(
            rename(ROOM_101, 'Renamed'),
            rename(ROOM_102, 'Renamed'),
            rename(ROOM_103, 'Renamed'),
          ),
        );
        assertRefusedAt(
          assert,
          underTheLock,
          caller,
          '[0].boxel:operations[1]',
          `the ${caller}, refused under the lock`,
        );
        await assertNothingWritten(
          assert,
          before,
          `the ${caller}, refused under the lock`,
        );
        assert.strictEqual(
          gateStats().pendingDischarges - pendingDischarges,
          3,
          `the ${caller}: every member was decided under the lock, the siblings admitted`,
        );

        before = await beforeBatch();
        ({ pendingDischarges } = gateStats());
        let atTheGate = await operations(
          AUTH[caller](),
          parallel(
            rename(ROOM_101, 'Renamed'),
            invoke('delete', { href: ROOM_103 }),
          ),
        );
        assertRefusedAt(
          assert,
          atTheGate,
          caller,
          '[0].boxel:operations[1]',
          `the ${caller}, refused at the gate`,
        );
        await assertNothingWritten(
          assert,
          before,
          `the ${caller}, refused at the gate`,
        );
        assert.strictEqual(
          gateStats().pendingDischarges,
          pendingDischarges,
          `the ${caller}: refused at the gate, the rename never reached the lock`,
        );
      }
    });
  });

  module('every entry is gated on its own', function () {
    test('a batch whose every entry a grant admits commits every entry', async function (assert) {
      let before = await beforeBatch();
      let response = await operations(
        AUTH.teacher(),
        rename(ROOM_101, 'Algebra'),
        rename(ROOM_103, 'Geometry'),
        invoke('update', {
          href: NOTICE,
          data: {
            type: 'card',
            attributes: { body: 'Revised' },
            meta: { adoptsFrom: adoptsFrom(BULLETIN) },
          },
        }),
        invoke('appendActivity', {
          href: ROOM_101,
          data: { note: 'Field trip' },
        }),
        createBulletin({ body: 'Picture day', audience: 'staff' }),
      );
      assert.strictEqual(response.status, 200, 'the batch commits');
      assert.strictEqual(
        (await stored(ROOM_101))?.title,
        'Algebra',
        'each rename wrote its own title',
      );
      assert.strictEqual((await stored(ROOM_103))?.title, 'Geometry');
      assert.strictEqual((await stored(NOTICE))?.body, 'Revised');
      let [, , , activity, bulletin] = resultsOf(response) as {
        data: { id: string };
      }[];
      assert.deepEqual(
        await stored(activity.data.id),
        { note: 'Field trip', author: TEACHER },
        'the activity was created',
      );
      assert.deepEqual(
        await stored(bulletin.data.id),
        { body: 'Picture day', audience: 'staff' },
        'and so was the bulletin',
      );
      // What the refusals are measured with sees a batch that commits: the
      // realm's files change, the batch indexes under one job, and it
      // announces itself.
      assert.true(
        'classrooms/room-101.json' in before.files,
        'the realm’s files are read off disk',
      );
      assert.notDeepEqual(
        await realmFiles(),
        before.files,
        'and the batch changed them',
      );
      assert.strictEqual(
        (await indexJobCount()) - before.jobs,
        1,
        'the whole batch indexed under one job',
      );
      assert.true(before.events.sent > 0, 'and sent a realm event');
      assert.strictEqual(
        gateStats().policyLoads,
        5,
        'each entry reached the gate',
      );
    });

    test('an entry a grant admits commits beside one the realm ACL admits', async function (assert) {
      // The aide may read the realm, so reading Room 102 is the realm ACL's to
      // answer, though nothing grants that read and the aide does not teach
      // there. The rename beside it is the policy's.
      let response = await operations(
        AUTH.aide(),
        invoke('read', { href: ROOM_102 }),
        rename(ROOM_101, 'Renamed'),
      );
      assert.strictEqual(response.status, 200, 'the batch commits');
      let [read] = resultsOf(response) as {
        data: { attributes: { title: string } };
      }[];
      assert.strictEqual(
        read.data.attributes.title,
        'Room 102',
        'the read is answered',
      );
      assert.strictEqual(
        (await stored(ROOM_101))?.title,
        'Renamed',
        'and the rename is written',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 1,
          predicateEvaluations: 1,
          pendingDischarges: 1,
          definitionLookups: 0,
          snapshotReads: 0,
        },
        'only the rename reached the policy',
      );

      let teacher = await operations(
        AUTH.teacher(),
        invoke('read', { href: ROOM_102 }),
        rename(ROOM_101, 'Renamed again'),
      );
      assertRefusedAt(
        assert,
        teacher,
        'teacher',
        0,
        'the same read from a caller the realm ACL does not let read',
      );
      assert.strictEqual((await stored(ROOM_101))?.title, 'Renamed');
    });
  });

  module('a target a query finds', function () {
    test('each card an entry expands into is gated and one refused refuses the batch', async function (assert) {
      let before = await beforeBatch();
      let response = await operations(
        AUTH.aide(),
        invoke('rename', {
          'boxel:target': EVERY_CLASSROOM,
          data: { title: 'Renamed' },
        }),
      );
      assertRefusedAt(
        assert,
        response,
        'aide',
        '[0].boxel:target[1]',
        'a rename of every classroom, one of which the aide does not teach',
      );
      assert.strictEqual(
        errorOf(response).id,
        ROOM_102,
        'naming the card it was refused on',
      );
      await assertNothingWritten(assert, before, 'the expansion');
      assert.strictEqual(
        gateStats().policyLoads,
        3,
        'each of the three cards the query found reached the gate',
      );

      let admitted = await operations(
        AUTH.aide(),
        invoke('rename', {
          'boxel:target': EAST_WING,
          data: { title: 'Renamed' },
        }),
      );
      assert.strictEqual(
        admitted.status,
        200,
        'a rename of the classrooms the aide teaches',
      );
      assert.strictEqual((await stored(ROOM_101))?.title, 'Renamed');
      assert.strictEqual((await stored(ROOM_103))?.title, 'Renamed');
      assert.strictEqual((await stored(ROOM_102))?.title, 'Room 102');
    });
  });

  module('what does not change', function () {
    test('a caller the realm ACL allows is never judged by the policy', async function (assert) {
      let response = await operations(
        AUTH.admin(),
        parallel(rename(ROOM_101, 'Renamed'), rename(ROOM_102, 'Renamed')),
        invoke('rename', {
          'boxel:target': EVERY_CLASSROOM,
          data: { title: 'Renamed again' },
        }),
        invoke('delete', { href: NOTICE }),
      );
      assert.strictEqual(response.status, 200, 'the batch commits');
      for (let room of [ROOM_101, ROOM_102, ROOM_103]) {
        assert.strictEqual((await stored(room))?.title, 'Renamed again');
      }
      assert.strictEqual(await stored(NOTICE), undefined, 'the delete landed');
      assert.deepEqual(gateStats(), {
        policyLoads: 0,
        predicateEvaluations: 0,
        pendingDischarges: 0,
        definitionLookups: 0,
        snapshotReads: 0,
      });
    });

    test('a card a batch mints is linked by its local id from a later entry', async function (assert) {
      let response = await operations(
        AUTH.teacher(),
        createBulletin(
          { body: 'Picture day', audience: 'staff' },
          'picture-day',
        ),
        invoke('update', {
          href: NOTICE,
          data: {
            type: 'card',
            relationships: {
              follows: { data: { lid: 'picture-day', type: 'card' } },
            },
            meta: { adoptsFrom: adoptsFrom(BULLETIN) },
          },
        }),
      );
      assert.strictEqual(response.status, 200, 'the batch commits');
      let [minted] = resultsOf(response) as {
        data: { id: string; lid: string };
      }[];
      assert.strictEqual(
        minted.data.lid,
        'picture-day',
        'the create answers with the local id it was sent',
      );
      let notice = JSON.parse(
        (await education.operationCore.readFileAsText(
          'bulletins/notice.json' as LocalPath,
        ))!,
      ) as {
        data: { relationships: { follows: { links: { self: string } } } };
      };
      assert.strictEqual(
        new URL(notice.data.relationships.follows.links.self, `${NOTICE}.json`)
          .href,
        minted.data.id,
        'the update links to the card the create minted',
      );
    });

    test('two members of a parallel group on one card still conflict', async function (assert) {
      let before = await beforeBatch();
      let response = await operations(
        AUTH.teacher(),
        parallel(rename(ROOM_101, 'Algebra'), rename(ROOM_101, 'Geometry')),
      );
      assert.strictEqual(
        errorOf(response).code,
        'conflicting-targets',
        'a caller a grant admits gets the batch’s own error',
      );
      await assertNothingWritten(assert, before, 'the conflict');
    });
  });
});
