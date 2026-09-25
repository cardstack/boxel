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
import {
  dischargePendingDecision,
  newOperationScope,
  resolveOperation,
  scopeCallerFor,
  stageWriteEntry,
  type MatchedGrant,
  type OperationDefinition,
  type OperationTarget,
  type PendingDecision,
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
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A write the realm's policy grants on a predicate is judged against the state
// it is about to change, and only the write lock holds that state still. So the
// gate matches the write's grants and leaves the predicate pending, and the
// batch coordinator decides it under the lock, against the bytes it is about
// to stage from.
//
// The topology is the policy gate suite's: an Education realm whose policy
// card lives in an Org realm nobody the Education realm serves can read. A
// teacher holds no permission on the Education realm, so every write they send
// reaches the policy.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';
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
    @field teacherIds = containsMany(StringField);

    @operation static rename = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };

    @operation static archive = {
      base: 'transform',
      set: { title: 'Archived' },
    };

    @operation static appendActivity = {
      base: 'create',
      of: () => ClassroomActivity,
      params: { note: StringField },
      fill: { note: params('note'), author: actor() },
    };
  }
`;

// `post` is a named create whose `input` stage supplies the audience a caller
// leaves out, so what it would write is not what it was sent.
const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, bxl } from "@cardstack/base/operations";

  export class Bulletin extends CardDef {
    @field body = contains(StringField);
    @field audience = contains(StringField);

    @operation static post = {
      base: 'create',
      of: () => Bulletin,
      params: { body: StringField, audience: StringField },
      input: bxl\`. + {audience: (.audience // "staff")}\`,
      fill: { body: params('body'), audience: params('audience') },
    };
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Every Classroom grant rests on a predicate, so every write on a classroom by
// a teacher is decided under the lock. `archive` rests on a predicate that
// throws for any title that is not a number.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: TEACHES },
      { operation: 'rename', where: TEACHES },
      { operation: 'appendActivity', where: TEACHES },
      { operation: 'update', where: TEACHES },
      { operation: 'delete', where: TEACHES },
      { operation: 'archive', where: '(.title | tonumber) > 0' },
    ],
  },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'post', where: '.audience == "staff"' },
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

function classroom(title: string, teacherIds: string[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, teacherIds },
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  });
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

function invoke(
  name: string,
  rest: { href?: string; data?: unknown } = {},
): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

function parallel(...operations: unknown[]): Record<string, unknown> {
  return { op: 'parallel', 'boxel:operations': operations };
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_207 = `${EDUCATION}classrooms/room-207`;

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
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'classrooms/room-207.json': classroom('Room 207', [TEACHER]),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
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

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      education.__testOnlySetBeforeBatchLock(undefined);
      education.__testOnlyClearCaches();
      education.unsubscribe();
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    teacher: () => bearer(TEACHER),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function getCard(url: string, auth: string) {
    return request
      .get(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${path(EDUCATION)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function assertNotPermitted(
    assert: Assert,
    response: Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 403, `${label}: status`);
    assert.strictEqual(
      (response.body as { errors?: { code?: string }[] }).errors?.[0]?.code,
      'operation-not-permitted',
      `${label}: the gate's refusal`,
    );
  }

  // A card's stored source as the realm holds it on disk, which is what the
  // lock judges and what a refused batch must leave alone.
  async function stored(url: string) {
    let content = await education.operationCore.readFileAsText(
      `${new URL(url).pathname.slice(path(EDUCATION).length)}.json` as LocalPath,
    );
    return content === undefined
      ? undefined
      : (
          JSON.parse(content) as {
            data: {
              attributes: { title?: string; teacherIds?: string[] };
              meta: { adoptsFrom: { name: string } };
            };
          }
        ).data;
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  // Changes what a pending write's predicate reads after the gate has matched
  // the write's grants and before the coordinator takes the write lock.
  function betweenGateAndLock(change: () => Promise<unknown>) {
    education.__testOnlySetBeforeBatchLock(async () => {
      education.__testOnlySetBeforeBatchLock(undefined);
      await change();
    });
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

  module('the state a write is judged against', function () {
    test('a pending write is judged by the card as the lock holds it, not as the gate saw it', async function (assert) {
      betweenGateAndLock(() =>
        education.write(
          'classrooms/room-204.json',
          classroom('Room 204', [COLLEAGUE]),
        ),
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.teacher(),
          invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
        ),
        'a teacher dropped from the classroom after the gate matched the write',
      );
      assert.deepEqual(
        (await stored(ROOM_204))?.attributes,
        { title: 'Room 204', teacherIds: [COLLEAGUE] },
        'the classroom holds what the other writer wrote, and no rename',
      );

      betweenGateAndLock(() =>
        education.write(
          'classrooms/room-205.json',
          classroom('Room 205', [COLLEAGUE, TEACHER]),
        ),
      );
      let admitted = await operations(
        AUTH.teacher(),
        invoke('rename', { href: ROOM_205, data: { title: 'Renamed' } }),
      );
      assert.strictEqual(
        admitted.status,
        200,
        'a teacher added to the classroom after the gate matched the write',
      );
      assert.strictEqual((await stored(ROOM_205))?.attributes.title, 'Renamed');

      assert.deepEqual(
        gateStats(),
        { policyLoads: 2, predicateEvaluations: 2, pendingDischarges: 2 },
        'each write’s predicate was evaluated once, under the lock',
      );
    });

    test('a card stored as another type by the time the lock is taken is not one its grants admit', async function (assert) {
      // The bytes would satisfy the predicate, but the grants were matched on
      // a Classroom and the card is a Bulletin now.
      betweenGateAndLock(() =>
        education.write(
          'classrooms/room-204.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { body: 'Posted', teacherIds: [TEACHER] },
              meta: { adoptsFrom: { module: '../bulletin', name: 'Bulletin' } },
            },
          }),
        ),
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.teacher(),
          invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
        ),
        'a rename granted on a Classroom',
      );
      assert.strictEqual(
        (await stored(ROOM_204))?.meta.adoptsFrom.name,
        'Bulletin',
        'and the card is left as the other writer wrote it',
      );
    });

    test('a write is authorized on the state before it, so it may write the field that authorized it', async function (assert) {
      // The known hole in judging pre-state alone: a caller a field admits can
      // rewrite that field, and leave the card no longer admitting them.
      let update = await operations(
        AUTH.teacher(),
        invoke('update', {
          href: ROOM_204,
          data: {
            type: 'card',
            attributes: { teacherIds: [COLLEAGUE] },
            meta: { adoptsFrom: adoptsFrom(CLASSROOM) },
          },
        }),
      );
      assert.strictEqual(
        update.status,
        200,
        'the teacher was on the classroom when the write was judged',
      );
      assert.deepEqual(
        (await stored(ROOM_204))?.attributes.teacherIds,
        [COLLEAGUE],
        'and the write handed the classroom to someone else',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.teacher(),
          invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
        ),
        'the teacher’s next write',
      );
    });
  });

  module('what a create is judged by', function () {
    test('a named create anchored on a card is judged by that card, which it cannot write', async function (assert) {
      let appended = await operations(
        AUTH.teacher(),
        invoke('appendActivity', {
          href: ROOM_204,
          data: { note: 'Field trip' },
        }),
      );
      assert.strictEqual(
        appended.status,
        200,
        'on a classroom the caller teaches',
      );
      let activity = (
        appended.body as { 'atomic:results': { data: { id: string } }[] }
      )['atomic:results'][0].data.id;
      let created = await getCard(activity, AUTH.admin());
      assert.strictEqual(
        (created.body as { data: { attributes: { author: string } } }).data
          .attributes.author,
        TEACHER,
      );
      assert.deepEqual(
        (await stored(ROOM_204))?.attributes,
        { title: 'Room 204', teacherIds: [TEACHER] },
        'the classroom its grant rests on is untouched',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.teacher(),
          invoke('appendActivity', {
            href: ROOM_205,
            data: { note: 'Field trip' },
          }),
        ),
        'on a classroom the caller does not teach',
      );
      assert.strictEqual(gateStats().pendingDischarges, 2);
    });

    test('a create against a type is judged by the document it would write, a param its input supplied included', async function (assert) {
      // The decision is built the way the gate records one for a pending
      // write: the grants it matched, and the type's definition. What is
      // pinned is what the lock judges such a create by.
      let core = education.operationCore;
      let target: OperationTarget = {
        kind: 'type',
        codeRef: adoptsFrom(BULLETIN),
        realm: EDUCATION,
      };
      let policy = await education.getCompiledPolicy();
      let typeDefinition = await core.definitionLookup.lookupDefinition(
        adoptsFrom(BULLETIN),
      );
      let decisionFor = (operation: string): PendingDecision => ({
        kind: 'pending',
        grants: (policy?.rules ?? [])
          .filter((rule) => rule.targetType.name === 'Bulletin')
          .flatMap((rule) =>
            rule.grants
              .filter((grant) => grant.operation === operation)
              .map((grant): MatchedGrant => ({ rule, grant })),
          ),
        typeDefinition,
      });
      let discharge = async (
        name: string,
        definition: OperationDefinition,
        data: Record<string, unknown>,
      ) => {
        let decision = decisionFor(name);
        let { scope } = await stageWriteEntry(
          {
            entry: { op: 'invoke', position: 0, name, data },
            target,
            definition,
            decision,
            scope: newOperationScope(core, {
              caller: scopeCallerFor(TEACHER),
              coarseDeclined: 'all',
            }),
          },
          {
            name,
            params: data,
            actor: TEACHER,
            realmConfig: async () => ({}),
          },
        );
        return dischargePendingDecision(
          core,
          { target, name, definition, decision, scope },
          undefined,
        );
      };

      let post = await resolveOperation(core, target, 'post');
      assert.strictEqual(
        await discharge('post', post, { body: 'Picture day' }),
        undefined,
        'a post that names no audience is admitted on the one its input supplies',
      );
      await assert.rejects(
        discharge('post', post, { body: 'Picture day', audience: 'students' }),
        /operation-not-permitted/,
        'and one that names another audience is not',
      );

      let create = await resolveOperation(core, target, 'create');
      let resource = (audience: string) => ({
        type: 'card',
        attributes: { body: 'Picture day', audience },
        meta: { adoptsFrom: adoptsFrom(BULLETIN) },
      });
      assert.strictEqual(
        await discharge('create', create, resource('staff')),
        undefined,
        'a plain create is judged by the resource it mints',
      );
      await assert.rejects(
        discharge('create', create, resource('students')),
        /operation-not-permitted/,
      );
      assert.strictEqual(
        gateStats().predicateEvaluations,
        4,
        'each judged by its predicate once',
      );
    });
  });

  module('a refusal under the lock', function () {
    test('a predicate that throws denies, leaving no write, no index job and no event', async function (assert) {
      let jobsBefore = await indexJobCount();
      let events = countRealmEvents();
      let response = await operations(
        AUTH.teacher(),
        invoke('rename', { href: ROOM_207, data: { title: 'Renamed' } }),
        invoke('archive', { href: ROOM_204 }),
      );
      assertNotPermitted(assert, response, 'an archive whose predicate throws');
      assert.strictEqual(
        (response.body as { errors: { meta: { entry: number } }[] }).errors[0]
          .meta.entry,
        1,
        'naming the entry whose predicate threw',
      );
      assert.strictEqual(
        (await stored(ROOM_207))?.attributes.title,
        'Room 207',
        'the rename it was sent beside, admitted under the lock, was not written',
      );
      assert.strictEqual(
        (await stored(ROOM_204))?.attributes.title,
        'Room 204',
      );
      assert.strictEqual(
        await indexJobCount(),
        jobsBefore,
        'no index job was enqueued',
      );
      assert.strictEqual(events.sent, 0, 'and no realm event was sent');
      assert.deepEqual(
        gateStats(),
        { policyLoads: 2, predicateEvaluations: 2, pendingDischarges: 2 },
        'both predicates were evaluated under the lock',
      );
    });

    test('a refused member of a parallel group leaves its siblings unwritten', async function (assert) {
      let jobsBefore = await indexJobCount();
      let response = await operations(
        AUTH.teacher(),
        parallel(
          invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
          invoke('rename', { href: ROOM_205, data: { title: 'Renamed' } }),
        ),
      );
      assertNotPermitted(
        assert,
        response,
        'a rename of a classroom not taught',
      );
      assert.strictEqual(
        (response.body as { errors: { meta: { entry: string } }[] }).errors[0]
          .meta.entry,
        '[0].boxel:operations[1]',
        'naming the member refused',
      );
      assert.strictEqual(
        (await stored(ROOM_204))?.attributes.title,
        'Room 204',
        'its admitted sibling was not written',
      );
      assert.strictEqual(
        (await stored(ROOM_205))?.attributes.title,
        'Room 205',
      );
      assert.strictEqual(await indexJobCount(), jobsBefore);
    });

    test('a batch whose second entry is refused leaves its first unwritten', async function (assert) {
      let response = await operations(
        AUTH.teacher(),
        invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
        invoke('delete', { href: ROOM_205 }),
      );
      assertNotPermitted(
        assert,
        response,
        'a delete of a classroom not taught',
      );
      assert.strictEqual(
        (await stored(ROOM_204))?.attributes.title,
        'Room 204',
        'the first entry was not written',
      );
      assert.ok(await stored(ROOM_205), 'and the second card is still there');
    });
  });

  module('what never reaches the lock', function () {
    test('a read is decided at the gate', async function (assert) {
      assert.strictEqual((await getCard(ROOM_204, AUTH.teacher())).status, 200);
      let batch = await operations(
        AUTH.teacher(),
        invoke('read', { href: ROOM_204 }),
      );
      assert.strictEqual(batch.status, 200);
      assert.true(
        gateStats().predicateEvaluations > 0,
        'both reads were judged by their predicate',
      );
      assert.strictEqual(
        gateStats().pendingDischarges,
        0,
        'at the gate, and neither reached a lock',
      );
      let mixed = await operations(
        AUTH.teacher(),
        invoke('read', { href: ROOM_204 }),
        invoke('rename', { href: ROOM_204, data: { title: 'Renamed' } }),
      );
      assert.strictEqual(mixed.status, 200);
      assert.strictEqual(
        gateStats().pendingDischarges,
        1,
        'in a batch that also writes, only the write reached the lock',
      );
    });

    test('a write the realm ACL allows evaluates no predicate anywhere', async function (assert) {
      let batch = await operations(
        AUTH.admin(),
        invoke('rename', { href: ROOM_205, data: { title: 'Renamed' } }),
        invoke('delete', { href: ROOM_207 }),
      );
      assert.strictEqual(batch.status, 200);
      assert.deepEqual(gateStats(), {
        policyLoads: 0,
        predicateEvaluations: 0,
        pendingDischarges: 0,
      });
    });
  });
});
