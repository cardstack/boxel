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
} from '@cardstack/runtime-common';
import {
  newOperationScope,
  resolveGatedOperation,
  resolveOperation,
  scopeCallerFor,
} from '@cardstack/runtime-common/card-operations';
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

// The worked example's topology. The Education realm holds the cards a policy
// governs, and its policy card lives in an Org realm nobody the Education
// realm serves can read. A teacher holds no permission on the Education realm
// at all, and a reader may read it but not write it, so every request either
// of them makes that the realm ACL declines reaches the policy gate.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const INSUFFICIENT = 'Insufficient permissions to perform this action';
const MISSING_AUTH = 'Missing Authorization header';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const SYLLABUS = { module: `${EDUCATION}syllabus`, name: 'Syllabus' };

// A type as a write's document names it.
function adoptsFrom(ref: { module: string; name: string }) {
  return { module: rri(ref.module), name: ref.name };
}

// Is the caller one of the classroom's teachers. Written with `any` and `==`
// because that is exact. BXL's `contains` matches substrings, so
// `contains([actor()])` would also admit a caller whose id is part of a
// listed one, and `contains(actor())` never matches a list at all.
const TEACHES = '.teacherIds | any(. == actor())';
const LEADS = '.leadTeacherIds | any(. == actor())';

const STUDENT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Student extends CardDef {
    @field name = contains(StringField);
    @field standing = contains(StringField);
  }
`;

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, linksToMany, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, actor } from "@cardstack/base/operations";
  import { Student } from "./student";

  export class ClassroomActivity extends CardDef {
    @field note = contains(StringField);
    @field author = contains(StringField);
  }

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field leadTeacherIds = containsMany(StringField);
    @field students = linksToMany(() => Student);
    @field honorRoll = linksToMany(() => Student, {
      query: {
        filter: { eq: { standing: 'honors' } },
        page: { size: 10, number: 0 },
      },
    });

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

  export class Homeroom extends Classroom {}
`;

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

// A module that re-exports a type defined elsewhere. A rule may name the type
// through it, and the index records the type under the module that defines it.
const SCHOOL_MODULE = `
  export { Syllabus } from "./syllabus";
`;

const SYLLABUS_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Syllabus extends CardDef {
    @field title = contains(StringField);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Two rules name `Classroom`, so a grant in either one admits a read. The
// writes on `Classroom` are the named operations `rename` and
// `appendActivity`, granted outright, and a `delete` that rests on a
// predicate. `Bulletin` takes its plain writes outright. A `Syllabus` read
// rests on a predicate that throws for any title that is not a number, or on
// one annotated as reading a snapshot tier, which the gate never evaluates.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: TEACHES },
      { operation: 'rename' },
      { operation: 'appendActivity' },
      { operation: 'delete', where: TEACHES },
    ],
  },
  { targetType: CLASSROOM, grants: [{ operation: 'read', where: LEADS }] },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'read' },
      { operation: 'update' },
      { operation: 'delete' },
    ],
  },
  {
    targetType: SYLLABUS,
    grants: [
      { operation: 'read', where: '(.title | tonumber) > 0' },
      { operation: 'read', where: { bxl: 'true', snapshot: true } },
    ],
  },
  {
    targetType: { module: `${EDUCATION}school`, name: 'Syllabus' },
    grants: [{ operation: 'update' }],
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

function card(
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom } },
  });
}

function classroom(
  title: string,
  teacherIds: string[],
  leadTeacherIds: string[] = [],
  name = 'Classroom',
  students: string[] = [],
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, teacherIds, leadTeacherIds },
      relationships: Object.fromEntries(
        students.map((student, index) => [
          `students.${index}`,
          { links: { self: `../students/${student}` } },
        ]),
      ),
      meta: { adoptsFrom: { module: '../classroom', name } },
    },
  });
}

function note(name: string) {
  return card(
    { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
    { cardInfo: { name } },
  );
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

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_206 = `${EDUCATION}classrooms/room-206`;
const HOMEROOM = `${EDUCATION}classrooms/homeroom-1`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;
const NOTE = `${EDUCATION}note`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
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
            'syllabus.gts': SYLLABUS_MODULE,
            'school.gts': SCHOOL_MODULE,
            'student.gts': STUDENT_MODULE,
            'students/ada.json': card(
              { module: '../student', name: 'Student' },
              { name: 'Ada', standing: 'honors' },
            ),
            'students/ben.json': card(
              { module: '../student', name: 'Student' },
              { name: 'Ben', standing: 'regular' },
            ),
            'classrooms/room-204.json': classroom(
              'Room 204',
              [TEACHER],
              [],
              'Classroom',
              ['ben'],
            ),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'classrooms/room-206.json': classroom(
              'Room 206',
              [COLLEAGUE],
              [TEACHER],
            ),
            'classrooms/homeroom-1.json': classroom(
              'Homeroom 1',
              [TEACHER],
              [],
              'Homeroom',
            ),
            'bulletins/b1.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'Picture day is Friday' },
            ),
            'syllabi/algebra.json': card(
              { module: '../syllabus', name: 'Syllabus' },
              { title: 'Algebra' },
            ),
            'syllabi/course-42.json': card(
              { module: '../syllabus', name: 'Syllabus' },
              { title: '42' },
            ),
            'note.json': note('An education note'),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard(RULES),
            'note.json': note('An org note'),
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
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      for (let realm of [education, org]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
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
    reader: () => bearer(READER, ['read']),
    teacher: () => bearer(TEACHER),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function getCard(url: string, auth?: string) {
    let req = request.get(path(url)).set('Accept', SupportedMimeType.CardJson);
    return auth ? req.set('Authorization', auth) : req;
  }

  function operations(realm: string, auth: string, ...entries: unknown[]) {
    return request
      .post(`${path(realm)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  // The gate's refusal, on either transport: the envelope carries it as the
  // batch's error, and the card+json read as the reason it cannot answer.
  function assertNotPermitted(
    assert: Assert,
    response: Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 403, `${label}: status`);
    assert.true(
      /is not permitted on|running that query is not permitted/.test(
        response.text,
      ),
      `${label}: the gate's refusal`,
    );
  }

  async function titleOf(url: string) {
    let response = await getCard(url, AUTH.admin());
    return response.status === 200
      ? (response.body as { data: { attributes: { title?: string } } }).data
          .attributes.title
      : response.status;
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  async function pointAt(card: string | null) {
    await education.write(
      'realm.json',
      realmConfigCardJSON({ name: 'Education', policy: card }),
    );
    await education.indexing();
  }

  module('ordering', function () {
    test('a caller the realm ACL allows never loads the policy or evaluates a predicate', async function (assert) {
      let etag = (await getCard(ROOM_204, AUTH.admin())).get('etag');
      assert.ok(etag, 'the admin read carries a validator');
      assert.strictEqual(
        (await getCard(ROOM_204, AUTH.admin()).set('If-None-Match', etag!))
          .status,
        304,
        'a conditional read by the admin is answered from the validator',
      );
      assert.strictEqual(
        (await getCard(ROOM_205, AUTH.reader())).status,
        200,
        'a reader reads a classroom they do not teach',
      );
      let batch = await operations(
        EDUCATION,
        AUTH.admin(),
        invoke('read', { href: ROOM_205 }),
        invoke('rename', { href: ROOM_205, data: { title: 'Room 205B' } }),
        invoke('delete', { href: BULLETIN_1 }),
      );
      assert.strictEqual(batch.status, 200, 'the admin batch commits');
      assert.deepEqual(
        gateStats(),
        { policyLoads: 0, predicateEvaluations: 0, pendingDischarges: 0 },
        'the gate did nothing for any of them',
      );
      assert.strictEqual(
        education.__testOnlyPolicyCacheStats().compiles,
        0,
        'and the policy was never compiled',
      );
    });

    test('a caller the realm ACL declines reaches the policy', async function (assert) {
      assert.strictEqual(
        (await getCard(ROOM_204, AUTH.teacher())).status,
        200,
        'the teacher reads their own classroom',
      );
      assert.deepEqual(
        gateStats(),
        { policyLoads: 1, predicateEvaluations: 1, pendingDischarges: 0 },
        'through one policy load and one predicate',
      );
    });
  });

  module('grant semantics', function () {
    test('a grant in any matching rule admits the invocation', async function (assert) {
      let response = await getCard(ROOM_206, AUTH.teacher());
      assert.strictEqual(
        response.status,
        200,
        'the teacher leads the classroom, which the second rule grants',
      );
      assert.strictEqual(
        (response.body as { data: { attributes: { title: string } } }).data
          .attributes.title,
        'Room 206',
      );
    });

    test('a rule on a type applies to the types that descend from it', async function (assert) {
      assert.strictEqual(
        (await getCard(HOMEROOM, AUTH.teacher())).status,
        200,
        'the Classroom rule admits a read of a Homeroom',
      );
    });

    test('a rule for one type never admits another', async function (assert) {
      assertNotPermitted(
        assert,
        await getCard(NOTE, AUTH.teacher()),
        'a read of a card no rule names',
      );
      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.reader(),
          invoke('update', {
            href: NOTE,
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Renamed' } },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/card-api'),
                  name: 'CardDef',
                },
              },
            },
          }),
        ),
        'an update of a card no rule names, though Bulletin grants update',
      );
    });

    test('a refusal says the same thing whether the card exists or not', async function (assert) {
      let denied = await getCard(ROOM_205, AUTH.teacher());
      let missing = await getCard(
        `${EDUCATION}classrooms/room-999`,
        AUTH.teacher(),
      );
      assert.strictEqual(denied.status, 403);
      assert.strictEqual(missing.status, 403);
      assert.strictEqual(
        denied.text.replaceAll('room-205', 'room-999'),
        missing.text,
        'the two bodies differ only in the URL the caller named',
      );
    });

    test('a refusal says nothing about what a card’s type declares', async function (assert) {
      // `archive` is declared on Classroom and granted to nobody. A Note
      // declares no such operation, and room-999 does not exist. Answered as
      // the resolution's own refusals, the three would tell a caller which
      // URLs hold a card whose type declares `archive`.
      let refusals = await Promise.all(
        [ROOM_205, NOTE, `${EDUCATION}classrooms/room-999`].map(
          async (href) => {
            let response = await operations(
              EDUCATION,
              AUTH.teacher(),
              invoke('archive', { href }),
            );
            return {
              status: response.status,
              body: response.text.replaceAll(href, '<href>'),
            };
          },
        ),
      );
      assert.strictEqual(refusals[0].status, 403);
      assert.deepEqual(
        refusals[1],
        refusals[0],
        'a card whose type declares no such operation',
      );
      assert.deepEqual(refusals[2], refusals[0], 'a card that does not exist');
    });

    test('a rule may name its type through a module that re-exports it', async function (assert) {
      let response = await operations(
        EDUCATION,
        AUTH.reader(),
        invoke('update', {
          href: `${EDUCATION}syllabi/algebra`,
          data: {
            type: 'card',
            attributes: { title: 'Algebra II' },
            meta: { adoptsFrom: adoptsFrom(SYLLABUS) },
          },
        }),
      );
      assert.strictEqual(
        response.status,
        200,
        'the rule names Syllabus through the school module',
      );
      assert.strictEqual(
        await titleOf(`${EDUCATION}syllabi/algebra`),
        'Algebra II',
      );
    });
  });

  module('per lane', function () {
    test('read: coarse-allowed, policy-allowed and policy-denied', async function (assert) {
      assert.strictEqual((await getCard(ROOM_205, AUTH.admin())).status, 200);
      let own = await getCard(ROOM_204, AUTH.teacher());
      assert.strictEqual(own.status, 200, 'a teacher reads their classroom');
      assert.strictEqual(
        (own.body as { data: { attributes: { title: string } } }).data
          .attributes.title,
        'Room 204',
      );
      assert.true(
        (own.get('cache-control') ?? '').startsWith('private'),
        'and no shared cache may keep it',
      );
      let denied = await getCard(ROOM_205, AUTH.teacher());
      assert.strictEqual(denied.status, 403, 'but not a colleague’s');
      assert.false(
        denied.text.includes('Room 205'),
        'and the refusal carries nothing of the card',
      );

      let batch = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('read', { href: ROOM_204 }),
      );
      assert.strictEqual(batch.status, 200, 'the envelope admits the read');
      assert.true(batch.text.includes('Room 204'));
      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.teacher(),
          invoke('read', { href: ROOM_205 }),
        ),
        'the envelope refuses a colleague’s classroom',
      );
    });

    test('a conditional read never answers from the validator or another caller’s assembly', async function (assert) {
      let etag = (await getCard(ROOM_205, AUTH.admin())).get('etag');
      assert.ok(etag);
      assert.strictEqual(
        (await getCard(ROOM_205, AUTH.teacher()).set('If-None-Match', etag!))
          .status,
        403,
        'a denied caller holding a current validator is refused, not told it is current',
      );
      let own = (await getCard(ROOM_204, AUTH.admin())).get('etag');
      assert.strictEqual(
        (await getCard(ROOM_204, AUTH.teacher()).set('If-None-Match', own!))
          .status,
        200,
        'an admitted caller is sent the card, since only the read decides',
      );
    });

    test('update and delete: coarse-allowed, policy-allowed and policy-denied', async function (assert) {
      let update = (body: string) =>
        invoke('update', {
          href: BULLETIN_1,
          data: {
            type: 'card',
            attributes: { body },
            meta: { adoptsFrom: adoptsFrom(BULLETIN) },
          },
        });
      assert.strictEqual(
        (await operations(EDUCATION, AUTH.admin(), update('By the admin')))
          .status,
        200,
      );
      let granted = await operations(
        EDUCATION,
        AUTH.reader(),
        update('By a reader'),
      );
      assert.strictEqual(granted.status, 200, 'the grant admits the update');
      let body = await getCard(BULLETIN_1, AUTH.admin());
      assert.strictEqual(
        (body.body as { data: { attributes: { body: string } } }).data
          .attributes.body,
        'By a reader',
      );

      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.teacher(),
          invoke('update', {
            href: ROOM_204,
            data: {
              type: 'card',
              attributes: { title: 'Mine now' },
              meta: { adoptsFrom: adoptsFrom(CLASSROOM) },
            },
          }),
        ),
        'no rule grants update on a classroom',
      );
      assert.strictEqual(await titleOf(ROOM_204), 'Room 204');

      assert.strictEqual(
        (
          await operations(
            EDUCATION,
            AUTH.reader(),
            invoke('delete', { href: BULLETIN_1 }),
          )
        ).status,
        200,
        'the grant admits the delete',
      );
      assert.strictEqual(
        (await getCard(BULLETIN_1, AUTH.admin())).status,
        404,
        'and the bulletin is gone',
      );
      assert.strictEqual(
        (
          await operations(
            EDUCATION,
            AUTH.admin(),
            invoke('delete', { href: ROOM_205 }),
          )
        ).status,
        200,
        'the admin deletes without a grant',
      );
    });

    test('a write whose predicate does not hold is refused before anything is staged', async function (assert) {
      let response = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('rename', { href: HOMEROOM, data: { title: 'Renamed' } }),
        invoke('delete', { href: ROOM_205 }),
      );
      assertNotPermitted(
        assert,
        response,
        'the delete of a classroom not taught',
      );
      assert.strictEqual(
        await titleOf(ROOM_205),
        'Room 205',
        'the classroom is still there',
      );
      assert.strictEqual(
        await titleOf(HOMEROOM),
        'Homeroom 1',
        'and the rename in the same batch did not land',
      );
      assert.strictEqual(
        gateStats().pendingDischarges,
        1,
        'the write’s predicate was decided under the write lock',
      );
    });

    test('the gate records a pending decision for a write that rests on a predicate', async function (assert) {
      let core = education.operationCore;
      let scope = () =>
        newOperationScope(core, {
          caller: scopeCallerFor(TEACHER),
          coarseDeclined: 'all',
        });
      let target = { kind: 'instance' as const, url: ROOM_204 };
      let { definition, decision } = await resolveGatedOperation(
        core,
        target,
        'delete',
        scope(),
      );
      assert.strictEqual(definition.base, 'delete');
      assert.strictEqual(decision.kind, 'pending');
      if (decision.kind === 'pending') {
        assert.deepEqual(
          decision.grants.map(({ rule, grant }) => ({
            type: rule.targetType.name,
            operation: grant.operation,
            where: grant.where?.canonical,
          })),
          [{ type: 'Classroom', operation: 'delete', where: TEACHES }],
          'naming the rule, the grant and the predicate still to run',
        );
      }
      await assert.rejects(
        resolveOperation(core, target, 'delete', scope()),
        /operation-not-permitted/,
        'a caller that carries no pending decision to a lock is refused',
      );
      let read = await resolveGatedOperation(core, target, 'read', scope());
      assert.strictEqual(
        read.decision.kind,
        'granted',
        'a read is decided outright',
      );
    });

    test('transform and a named operation: coarse-allowed, policy-allowed and policy-denied', async function (assert) {
      assert.strictEqual(
        (
          await operations(
            EDUCATION,
            AUTH.admin(),
            invoke('archive', { href: ROOM_205 }),
          )
        ).status,
        200,
      );
      assert.strictEqual(await titleOf(ROOM_205), 'Archived');

      let renamed = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('rename', { href: ROOM_204, data: { title: 'Room 204B' } }),
      );
      assert.strictEqual(renamed.status, 200, 'the grant admits rename');
      assert.strictEqual(await titleOf(ROOM_204), 'Room 204B');

      let appended = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('appendActivity', {
          href: ROOM_204,
          data: { note: 'Field trip' },
        }),
      );
      assert.strictEqual(
        appended.status,
        200,
        'the grant admits appendActivity',
      );
      let activity = (
        JSON.parse(appended.text) as {
          'atomic:results': { data: { id: string } }[];
        }
      )['atomic:results'][0].data.id;
      let created = await getCard(activity, AUTH.admin());
      assert.deepEqual(
        (created.body as { data: { attributes: Record<string, unknown> } }).data
          .attributes.author,
        TEACHER,
        'the activity it creates carries the teacher as its author',
      );

      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.teacher(),
          invoke('archive', { href: ROOM_204 }),
        ),
        'no grant names archive',
      );
      assert.strictEqual(await titleOf(ROOM_204), 'Room 204B');
    });

    test('a grant on a named operation does not grant the base it is built on', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.teacher(),
          invoke('transform', { href: ROOM_204 }),
        ),
        'rename and appendActivity are granted, and a raw transform is not',
      );
    });
  });

  module('fail closed', function () {
    test('a predicate that throws does not hold, and one that reads a snapshot tier is never evaluated', async function (assert) {
      assert.strictEqual(
        (await getCard(`${EDUCATION}syllabi/course-42`, AUTH.teacher())).status,
        200,
        'the predicate holds where it can be evaluated',
      );
      assertNotPermitted(
        assert,
        await getCard(`${EDUCATION}syllabi/algebra`, AUTH.teacher()),
        'and denies where it throws',
      );
      assert.strictEqual(
        gateStats().predicateEvaluations,
        2,
        'the throwing predicate was evaluated for both, and the snapshot one for neither',
      );
    });

    test('a policy card that is missing grants nothing', async function (assert) {
      await pointAt(`${ORG}policies/nowhere`);
      assertNotPermitted(
        assert,
        await getCard(ROOM_204, AUTH.teacher()),
        'the teacher’s own classroom',
      );
      let compiled = await education.getCompiledPolicy();
      assert.deepEqual(
        compiled?.issues.map((issue) => issue.code),
        ['policy-card-missing'],
      );
    });

    test('a target described by a query is refused', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(
          EDUCATION,
          AUTH.teacher(),
          invoke('read', {
            'boxel:target': {
              query: {
                'item.on': CLASSROOM,
                eq: { 'item.title': 'Room 204' },
              },
            },
          }),
        ),
        'a read whose target a search would find',
      );
    });
  });

  module('row reach', function () {
    test('a granted read serves the card’s whole representation, its links and query-backed fields included', async function (assert) {
      // A grant admits the invocation, and the read then assembles the card as
      // it does for anyone. So a grant on Classroom reaches the students the
      // classroom links to, and those its query-backed field finds, though no
      // rule names Student.
      let response = await getCard(ROOM_204, AUTH.teacher());
      assert.strictEqual(response.status, 200);
      let included = (
        (response.body as { included?: { id: string }[] }).included ?? []
      ).map((resource) => resource.id);
      assert.true(
        included.some((id) => id.endsWith('/students/ben')),
        'the student the classroom links to',
      );
      assert.true(
        included.some((id) => id.endsWith('/students/ada')),
        'and the student its query-backed field finds',
      );
      assertNotPermitted(
        assert,
        await getCard(`${EDUCATION}students/ben`, AUTH.teacher()),
        'though no rule admits a read of the student itself',
      );
    });
  });

  module('a caller the ACL lets read', function () {
    test('keeps the ACL’s answer for every read in a batch that writes', async function (assert) {
      let batch = await operations(
        EDUCATION,
        AUTH.reader(),
        invoke('read', { href: ROOM_205 }),
        invoke('update', {
          href: BULLETIN_1,
          data: {
            type: 'card',
            attributes: { body: 'Posted by a reader' },
            meta: { adoptsFrom: adoptsFrom(BULLETIN) },
          },
        }),
      );
      assert.strictEqual(
        batch.status,
        200,
        'the read needs no grant, and the policy grants the update',
      );
      assert.true(batch.text.includes('Room 205'));
      assert.strictEqual(
        gateStats().predicateEvaluations,
        0,
        'and no read predicate was evaluated for the read',
      );
    });
  });

  module('HEAD', function () {
    test('a policy-granted HEAD carries the headers its GET would', async function (assert) {
      let own = await request
        .head(path(ROOM_204))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', AUTH.teacher());
      assert.strictEqual(own.status, 200);
      assert.ok(own.get('etag'), 'the card’s validator');
      assert.true(
        (own.get('content-type') ?? '').startsWith(SupportedMimeType.CardJson),
        'and its media type',
      );
      let denied = await request
        .head(path(ROOM_205))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', AUTH.teacher());
      assert.strictEqual(denied.status, 200, 'a denied HEAD is discovery');
      assert.notOk(denied.get('etag'), 'with no card headers');
    });
  });

  module('what does not change', function () {
    test('a realm with no policy answers every refusal as the realm ACL gave it', async function (assert) {
      await pointAt(null);
      let read = await getCard(ROOM_204, AUTH.teacher());
      assert.strictEqual(read.status, 403);
      assert.strictEqual(read.text, INSUFFICIENT);
      let batch = await operations(
        EDUCATION,
        AUTH.reader(),
        invoke('delete', { href: BULLETIN_1 }),
      );
      assert.strictEqual(batch.status, 403);
      assert.strictEqual(batch.text, INSUFFICIENT);
      let orgRead = await request
        .get(path(`${ORG}note`))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${createJWT(org, TEACHER, [])}`);
      assert.strictEqual(orgRead.status, 403);
      assert.strictEqual(orgRead.text, INSUFFICIENT);
      assert.deepEqual(gateStats(), {
        policyLoads: 0,
        predicateEvaluations: 0,
        pendingDischarges: 0,
      });
    });

    test('a request that authenticated nobody is told to authenticate', async function (assert) {
      let read = await getCard(ROOM_204);
      assert.strictEqual(read.status, 401);
      assert.strictEqual(read.text, MISSING_AUTH);
      assert.strictEqual(gateStats().policyLoads, 0);
    });

    test('a route that does not reach the gate keeps the realm ACL’s refusal', async function (assert) {
      let patch = await request
        .patch(path(BULLETIN_1))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', AUTH.reader())
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { body: 'Patched' },
              meta: { adoptsFrom: adoptsFrom(BULLETIN) },
            },
          }),
        );
      assert.strictEqual(
        patch.status,
        403,
        'a card+json write, though the policy grants update',
      );
      assert.strictEqual(patch.text, INSUFFICIENT);
      let source = await request
        .get(path(`${EDUCATION}classroom.gts`))
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', AUTH.teacher());
      assert.strictEqual(source.status, 403, 'module source');
      assert.strictEqual(source.text, INSUFFICIENT);
      assert.strictEqual(gateStats().policyLoads, 0);
    });
  });
});
