import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { dirSync } from 'tmp';
import jwt from 'jsonwebtoken';
import {
  param,
  query,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { archiveRealm } from '@cardstack/runtime-common/db-queries/realm-metadata-queries';
import { insertPermissions } from '@cardstack/runtime-common/db-queries/realm-permission-queries';
import type {
  PolicyExplanation,
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import { insertSourceRealmInRegistry } from '../lib/realm-registry-writes.ts';
import type { RealmHttpServer as Server, RealmServer } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// The worked example's topology. The Education realm holds the cards a policy
// governs, and its policy card lives in an Org realm. An IT admin reads both
// realms, so they may ask the policy what it decides. An Org reader reads only
// the Org realm. A teacher holds no permission on either, and reaches the Org
// realm's cards only through the Org realm's own policy.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ORG_POLICY_CARD = `${ORG}policies/org`;
const ORG_NOTE = `${ORG}notes/n1`;
const EDUCATION_ADMIN = '@education-admin:localhost';
const IT_ADMIN = '@it-admin:localhost';
const HR_ADMIN = '@hr-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const ORG_READER = '@org-reader:localhost';
const READER = '@reader:localhost';
// May write the Education realm and not read it, a shape the permissions API
// accepts. A write reaches that realm on a request its ACL judges as a write.
const WRITER = '@writer:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };
const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const SEALED_CLASSROOM = {
  module: `${EDUCATION}classroom`,
  name: 'SealedClassroom',
};
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const SYLLABUS = { module: `${EDUCATION}syllabus`, name: 'Syllabus' };

const TEACHES = '.teacherIds | any(. == actor())';
const LEADS = '.leadTeacherIds | any(. == actor())';
const NUMERIC_TITLE = '(.title | tonumber) > 0';
const COURSE_CODE = '.code == "42-101"';

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
    @field leadTeacherIds = containsMany(StringField);

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

    @operation static listMine = {
      base: 'query',
      query: { filter: { type: () => Classroom } },
    };

    @operation static listAudited = {
      base: 'query',
      nonGrantable: true,
      query: { filter: { type: () => Classroom } },
    };
  }

  // Redeclares the query its parent keeps out of every policy's reach, without
  // the flag.
  export class Seminar extends Classroom {
    @operation static listAudited = {
      base: 'query',
      query: { filter: { type: () => Seminar } },
    };
  }

  // Keeps the search its parent declares out of every policy's reach.
  export class SealedClassroom extends Classroom {
    @operation static listMine = {
      base: 'query',
      query: { filter: { type: () => SealedClassroom } },
      nonGrantable: true,
    };
  }
`;

const SALARY_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Salary extends CardDef {
    @field band = contains(StringField);
  }
`;

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

const SYLLABUS_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Syllabus extends CardDef {
    @field title = contains(StringField);
    @field code = contains(StringField, {
      computeVia: function (this: Syllabus) {
        return this.title + '-101';
      },
    });
  }
`;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

type Question = {
  actor: string;
  target: string;
  operation: string;
  [param: string]: unknown;
};
type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Two rules govern `Classroom`, so a read is admitted by either one's grant.
// `rename` and `appendActivity` are granted outright, and a `delete`, the
// `listMine` query and an ad-hoc search of classrooms rest on the same
// predicate a read does. `Bulletin` takes its reads and updates
// outright. A `Syllabus` read rests on a predicate that throws for any title
// that is not a number, or on one annotated as reading a snapshot tier, which
// holds for a course code the index computed as `42-101`.
const EDUCATION_RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: TEACHES },
      { operation: 'rename' },
      { operation: 'appendActivity' },
      { operation: 'delete', where: TEACHES },
      { operation: 'listMine', where: TEACHES },
      { operation: 'query', where: TEACHES },
    ],
  },
  { targetType: CLASSROOM, grants: [{ operation: 'read', where: LEADS }] },
  {
    targetType: BULLETIN,
    grants: [{ operation: 'read' }, { operation: 'update' }],
  },
  {
    targetType: SYLLABUS,
    grants: [
      { operation: 'read', where: NUMERIC_TITLE },
      { operation: 'read', where: { bxl: COURSE_CODE, snapshot: true } },
    ],
  },
];

// The Org realm's own policy grants everything in that realm to every caller,
// explains included. That is the widest grant there is, and it must not reach
// an explain.
const ORG_RULES: Rule[] = [
  {
    targetType: CARD_DEF,
    grants: [{ operation: 'read' }, { operation: 'explain' }],
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
) {
  return card(
    { module: '../classroom', name: 'Classroom' },
    { title, teacherIds, leadTeacherIds },
  );
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

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_206 = `${EDUCATION}classrooms/room-206`;
const ROOM_999 = `${EDUCATION}classrooms/room-999`;
const SEMINAR_1 = `${EDUCATION}classrooms/seminar-1`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;
const ALGEBRA = `${EDUCATION}syllabi/algebra`;
const COURSE_42 = `${EDUCATION}syllabi/course-42`;
const EDUCATION_CONFIG = `${EDUCATION}realm`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let db: PgAdapter;
  let request: SuperTest<Test>;
  let server: Server;
  let realmServer: RealmServer;
  // The current test's boot. The teardown waits for it, so a test that timed
  // out while its boot was still running still closes what that boot opens,
  // rather than leaving the server holding its port for the next test.
  let booting: Promise<void> | undefined;

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
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/seminar-1.json': card(
              { module: '../classroom', name: 'Seminar' },
              { title: 'Seminar 1', teacherIds: [TEACHER] },
            ),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'classrooms/room-206.json': classroom(
              'Room 206',
              [COLLEAGUE],
              [TEACHER],
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
          },
          permissions: {
            [EDUCATION_ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read', 'write'],
            [READER]: ['read'],
            [WRITER]: ['write'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Org',
              policy: ORG_POLICY_CARD,
            }),
            'policies/education.json': policyCard(EDUCATION_RULES),
            'policies/org.json': policyCard(ORG_RULES),
            'notes/n1.json': card(CARD_DEF, { cardInfo: { name: 'A note' } }),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read'],
            [ORG_READER]: ['read'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    realmServer = result.testRealmServer;
    request = supertest(server);
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  // Every test boots both realms in its `beforeEach`, which indexes them and
  // runs inside the test's own budget, so that budget is extended past the
  // per-test timeout.
  hooks.beforeEach(function (assert) {
    assert.timeout(180_000);
  });

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      db = dbAdapter;
      booting = start({ dbAdapter, publisher, runner });
      await booting;
    },
    afterEach: async () => {
      let booted = await booting?.then(
        () => true,
        () => false,
      );
      booting = undefined;
      if (booted) {
        for (let realm of [education, org]) {
          realm.__testOnlyClearCaches();
          realm.unsubscribe();
        }
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  // A session on one realm, carrying exactly the permissions that realm grants
  // the user, which is what a session the realm will accept carries.
  function onOrg(user: string, permissions: Parameters<typeof createJWT>[2]) {
    return `Bearer ${createJWT(org, user, permissions)}`;
  }

  function onEducation(
    user: string,
    permissions: Parameters<typeof createJWT>[2],
  ) {
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  const ASKER = {
    itAdmin: () => onOrg(IT_ADMIN, ['read']),
    orgReader: () => onOrg(ORG_READER, ['read']),
    teacher: () => onOrg(TEACHER, []),
  };

  // How each actor the tests explain signs in to the Education realm, for the
  // invocation an explanation is compared against.
  const EDUCATION_SESSION: Record<string, () => string> = {
    [TEACHER]: () => onEducation(TEACHER, []),
    [READER]: () => onEducation(READER, ['read']),
    [WRITER]: () => onEducation(WRITER, ['write']),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function send(
    realm: string,
    auth: string,
    method: 'post' | 'query',
    ...entries: unknown[]
  ) {
    let req = request.post(`${path(realm)}_operations`);
    if (method === 'query') {
      req = req.set('X-HTTP-Method-Override', 'QUERY');
    }
    return req
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function ask(
    auth: string,
    question: Question,
    { policy = POLICY_CARD }: { policy?: string } = {},
  ) {
    return send(
      ORG,
      auth,
      'query',
      invoke('explain', { href: policy, data: question }),
    );
  }

  async function explain(
    actor: string,
    target: string,
    operation: string,
  ): Promise<PolicyExplanation> {
    let response = await ask(ASKER.itAdmin(), { actor, target, operation });
    if (response.status !== 200) {
      throw new Error(
        `explain(${actor}, ${target}, ${operation}) answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { 'atomic:results': PolicyExplanation[] })[
      'atomic:results'
    ][0];
  }

  // The answer to a question as the IT admin, who reads both realms, is given
  // it: a triple with whatever else the question carries.
  async function answer<T = PolicyExplanation>(question: Question): Promise<T> {
    let response = await ask(ASKER.itAdmin(), question);
    if (response.status !== 200) {
      throw new Error(
        `explain(${JSON.stringify(question)}) answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { 'atomic:results': T[] })['atomic:results'][0];
  }

  function errorOf(response: Response) {
    return (response.body as { errors?: { code?: string }[] }).errors?.[0];
  }

  async function titleOf(url: string) {
    let response = await request
      .get(path(url))
      .set('Accept', SupportedMimeType.CardJson)
      .set(
        'Authorization',
        onEducation(EDUCATION_ADMIN, ['read', 'write', 'realm-owner']),
      );
    return (response.body as { data: { attributes: { title?: string } } }).data
      .attributes.title;
  }

  module('what an explanation reports', function () {
    test('the rules that matched, the grant that admitted, what each predicate said and what it read', async function (assert) {
      let explanation = await explain(TEACHER, ROOM_204, 'read');
      assert.deepEqual(explanation, {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        acl: { read: false, write: false },
        decision: 'allowed',
        reason: 'granted',
        rules: [
          {
            targetType: CLASSROOM,
            path: 'rules[0]',
            grants: [
              {
                path: 'rules[0].grants[0]',
                where: TEACHES,
                tier: 'stored',
                outcome: 'held',
              },
            ],
          },
          {
            targetType: CLASSROOM,
            path: 'rules[1]',
            grants: [
              {
                path: 'rules[1].grants[0]',
                where: LEADS,
                tier: 'stored',
                outcome: 'not-evaluated',
              },
            ],
          },
        ],
        admittedBy: { rule: 0, grant: 0 },
      });

      let viaLead = await explain(TEACHER, ROOM_206, 'read');
      assert.deepEqual(
        viaLead.rules.map(({ grants }) => grants.map((g) => g.outcome)),
        [['did-not-hold'], ['held']],
        'the first rule’s predicate fails and the second rule’s holds',
      );
      assert.deepEqual(viaLead.admittedBy, { rule: 1, grant: 0 });
    });

    test('grants whose predicates all fail, and the refusal as the actor receives it', async function (assert) {
      let explanation = await explain(TEACHER, ROOM_205, 'read');
      assert.strictEqual(explanation.decision, 'denied');
      assert.strictEqual(explanation.reason, 'predicate-false');
      assert.deepEqual(
        explanation.rules.map(({ grants }) => grants.map((g) => g.outcome)),
        [['did-not-hold'], ['did-not-hold']],
      );
      assert.deepEqual(
        explanation.refusal,
        { status: 404, code: 'target-not-found' },
        'the teacher may not read the realm, so they are told the card is not there',
      );
      assert.false('admittedBy' in explanation);
    });

    test('a caller the realm ACL allows is answered by the ACL, and the policy is not consulted', async function (assert) {
      let before = education.__testOnlyPolicyGateStats();
      let explanation = await explain(READER, ROOM_205, 'read');
      assert.deepEqual(explanation, {
        actor: READER,
        target: ROOM_205,
        operation: 'read',
        acl: { read: true, write: false },
        decision: 'allowed',
        reason: 'acl',
        rules: [],
      });
      assert.deepEqual(
        education.__testOnlyPolicyGateStats(),
        before,
        'no policy load and no predicate on the Education realm',
      );
    });

    test('a write the ACL declines, granted outright', async function (assert) {
      let explanation = await explain(READER, BULLETIN_1, 'update');
      assert.strictEqual(explanation.decision, 'allowed');
      assert.strictEqual(explanation.reason, 'granted');
      assert.deepEqual(explanation.rules, [
        {
          targetType: BULLETIN,
          path: 'rules[2]',
          grants: [{ path: 'rules[2].grants[1]', outcome: 'unconditional' }],
        },
      ]);
      assert.deepEqual(explanation.admittedBy, { rule: 0, grant: 0 });
    });

    test('an operation nothing grants still names the rules that govern the type', async function (assert) {
      let explanation = await explain(READER, ROOM_205, 'archive');
      assert.strictEqual(explanation.decision, 'denied');
      assert.strictEqual(explanation.reason, 'no-grant');
      assert.deepEqual(explanation.rules, [
        { targetType: CLASSROOM, path: 'rules[0]', grants: [] },
        { targetType: CLASSROOM, path: 'rules[1]', grants: [] },
      ]);
      assert.deepEqual(
        explanation.refusal,
        { status: 403, code: 'operation-not-permitted' },
        'the reader may read the realm, so they are told the gate refused them',
      );
    });

    test('a snapshot-tier predicate is evaluated against the index, and one that throws fails the decision where none holds', async function (assert) {
      let numeric = await explain(TEACHER, COURSE_42, 'read');
      assert.strictEqual(numeric.decision, 'allowed');
      assert.deepEqual(numeric.rules, [
        {
          targetType: SYLLABUS,
          path: 'rules[3]',
          grants: [
            {
              path: 'rules[3].grants[0]',
              where: NUMERIC_TITLE,
              tier: 'stored',
              outcome: 'held',
            },
            {
              path: 'rules[3].grants[1]',
              where: COURSE_CODE,
              tier: 'snapshot',
              outcome: 'not-evaluated',
            },
          ],
        },
      ]);

      let throwing = await explain(TEACHER, ALGEBRA, 'read');
      assert.strictEqual(throwing.decision, 'failed');
      assert.strictEqual(throwing.reason, 'predicate-threw');
      assert.deepEqual(
        throwing.rules[0].grants.map((grant) => ({
          tier: grant.tier,
          outcome: grant.outcome,
        })),
        [
          { tier: 'stored', outcome: 'threw' },
          { tier: 'snapshot', outcome: 'did-not-hold' },
        ],
      );
      assert.deepEqual(
        throwing.refusal,
        { status: 404, code: 'target-not-found' },
        'the teacher may not read the realm, so they are told the card is not there',
      );
    });

    test('a write resting on a predicate is judged against the card as it is stored', async function (assert) {
      let own = await explain(TEACHER, ROOM_204, 'delete');
      assert.strictEqual(own.decision, 'allowed');
      assert.deepEqual(own.rules[0].grants, [
        {
          path: 'rules[0].grants[3]',
          where: TEACHES,
          tier: 'stored',
          outcome: 'held',
        },
      ]);
      assert.deepEqual(own.admittedBy, { rule: 0, grant: 0 });

      let colleagues = await explain(TEACHER, ROOM_205, 'delete');
      assert.strictEqual(colleagues.decision, 'denied');
      assert.strictEqual(colleagues.reason, 'predicate-false');
      assert.strictEqual(
        await titleOf(ROOM_204),
        'Room 204',
        'explaining a delete removed nothing',
      );
    });

    test('a caller the ACL lets write and not read is judged on the lane the operation travels in', async function (assert) {
      let write = await explain(WRITER, ROOM_205, 'archive');
      assert.deepEqual(write.acl, { read: false, write: true });
      assert.strictEqual(
        write.decision,
        'allowed',
        'a write travels on a request the ACL judges as a write',
      );
      assert.strictEqual(write.reason, 'acl');
      let read = await explain(WRITER, ROOM_205, 'read');
      assert.strictEqual(
        read.reason,
        'predicate-false',
        'a read travels on a request the ACL judges as a read, so the policy decides it',
      );
      assert.deepEqual(read.refusal, { status: 404, code: 'target-not-found' });
    });

    test('an operation the card does not carry, an operation on authorization infrastructure, and a caller with no credentials', async function (assert) {
      let bogusForTeacher = await explain(TEACHER, ROOM_204, 'bogus');
      assert.strictEqual(bogusForTeacher.reason, 'not-resolved');
      assert.deepEqual(
        bogusForTeacher.refusal,
        { status: 404, code: 'target-not-found' },
        'the teacher is told nothing about what the type declares',
      );
      let bogusForReader = await explain(READER, ROOM_204, 'bogus');
      assert.deepEqual(
        bogusForReader.refusal,
        { status: 404, code: 'unknown-operation' },
        'the reader is told why',
      );

      let config = await explain(READER, EDUCATION_CONFIG, 'update');
      assert.strictEqual(config.decision, 'denied');
      assert.strictEqual(config.reason, 'authorization-infrastructure');
      let configRead = await explain(TEACHER, EDUCATION_CONFIG, 'read');
      assert.strictEqual(configRead.decision, 'denied');
      assert.strictEqual(
        configRead.reason,
        'authorization-infrastructure',
        'a read of it is refused as a write is',
      );
      assert.deepEqual(configRead.refusal, {
        status: 404,
        code: 'target-not-found',
      });

      let anonymous = await explain('', ROOM_204, 'read');
      assert.strictEqual(anonymous.actor, null);
      assert.strictEqual(anonymous.reason, 'actor-required');
      assert.deepEqual(anonymous.refusal, {
        status: 401,
        code: 'actor-required',
      });
    });

    test("a query is left to the search it is named in, unless it is kept out of every policy's reach", async function (assert) {
      let granted = await explain(TEACHER, ROOM_204, 'listMine');
      assert.deepEqual(
        {
          decision: granted.decision,
          reason: granted.reason,
          refusal: granted.refusal,
          rules: granted.rules,
        },
        {
          decision: 'denied',
          reason: 'query-lane',
          refusal: { status: 404, code: 'target-not-found' },
          rules: [],
        },
        'a query the teacher holds a grant on is not called non-grantable: invoking it on the card is refused as it is, and no rule is judged here',
      );
      let adHoc = await explain(TEACHER, ROOM_204, 'query');
      assert.strictEqual(
        adHoc.reason,
        'query-lane',
        'and so is the ad-hoc query, which a search runs under the base name',
      );
      let audited = await explain(TEACHER, ROOM_204, 'listAudited');
      assert.strictEqual(
        audited.reason,
        'non-grantable',
        'a query declared non-grantable is one no grant reaches, on the search engine as anywhere',
      );
      let redeclared = await explain(TEACHER, SEMINAR_1, 'listAudited');
      assert.strictEqual(
        redeclared.reason,
        'non-grantable',
        'and so is one a subclass redeclares without the flag, since the type it extends kept it out of reach',
      );
      let seminarsOwn = await explain(TEACHER, SEMINAR_1, 'listMine');
      assert.strictEqual(
        seminarsOwn.reason,
        'query-lane',
        'while a query nothing in its chain flags is still left to the search',
      );
      let reader = await explain(READER, ROOM_204, 'listMine');
      assert.deepEqual(
        { decision: reader.decision, reason: reader.reason },
        { decision: 'allowed', reason: 'acl' },
        "a reader runs the query unscoped, on the realm's own permissions",
      );
    });
  });

  module('agreement with the gate', function () {
    test('an explanation’s decision is what the invocation does, triple by triple', async function (assert) {
      type Triple = {
        actor: string;
        target: string;
        operation: string;
        data?: Record<string, unknown>;
      };
      let triples: Triple[] = [
        { actor: TEACHER, target: ROOM_204, operation: 'read' },
        { actor: TEACHER, target: ROOM_205, operation: 'read' },
        { actor: TEACHER, target: ROOM_206, operation: 'read' },
        { actor: READER, target: ROOM_205, operation: 'read' },
        { actor: TEACHER, target: ALGEBRA, operation: 'read' },
        { actor: TEACHER, target: ROOM_205, operation: 'archive' },
        { actor: READER, target: ROOM_205, operation: 'archive' },
        { actor: TEACHER, target: ROOM_205, operation: 'delete' },
        {
          actor: TEACHER,
          target: ROOM_204,
          operation: 'rename',
          data: { title: 'Room 204B' },
        },
        {
          actor: TEACHER,
          target: ROOM_204,
          operation: 'appendActivity',
          data: { note: 'Field trip' },
        },
        { actor: TEACHER, target: ROOM_204, operation: 'delete' },
        { actor: WRITER, target: ROOM_205, operation: 'read' },
        { actor: WRITER, target: ROOM_205, operation: 'archive' },
      ];
      for (let { actor, target, operation, data } of triples) {
        let label = `${actor} ${operation} ${target}`;
        let explanation = await explain(actor, target, operation);
        let session = EDUCATION_SESSION[actor]();
        let response =
          operation === 'read'
            ? await request
                .get(path(target))
                .set('Accept', SupportedMimeType.CardJson)
                .set('Authorization', session)
            : await send(
                EDUCATION,
                session,
                'post',
                invoke(operation, { href: target, ...(data ? { data } : {}) }),
              );
        if (explanation.decision === 'allowed') {
          assert.strictEqual(
            Math.floor(response.status / 100),
            2,
            `${label}: explained as allowed, and the invocation ran (${response.status})`,
          );
          continue;
        }
        assert.strictEqual(
          response.status,
          explanation.refusal?.status,
          `${label}: explained as ${explanation.reason}, refused with the status the explanation named`,
        );
        if (operation !== 'read') {
          assert.strictEqual(
            errorOf(response)?.code,
            explanation.refusal?.code,
            `${label}: and the code`,
          );
        }
      }
    });
  });

  module('who may ask', function () {
    test('a caller who cannot read the target’s realm is told what a missing target is told', async function (assert) {
      let asked = { actor: TEACHER, operation: 'read' };
      let unreadable = await ask(ASKER.orgReader(), {
        ...asked,
        target: ROOM_204,
      });
      let missing = await ask(ASKER.itAdmin(), { ...asked, target: ROOM_999 });
      let missingUnreadable = await ask(ASKER.orgReader(), {
        ...asked,
        target: ROOM_999,
      });
      let elsewhere = await ask(ASKER.itAdmin(), {
        ...asked,
        target: 'http://127.0.0.1:4444/elsewhere/room-204',
      });
      // The Education policy grants every caller a read of a bulletin, so the
      // Org reader reaches this card. Reaching it is not reading the realm.
      let granted = await request
        .get(path(BULLETIN_1))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', onEducation(ORG_READER, []));
      assert.strictEqual(
        granted.status,
        200,
        'a grant admits the Org reader to the bulletin',
      );
      let reachable = await ask(ASKER.orgReader(), {
        ...asked,
        target: BULLETIN_1,
      });
      // A session delegated to the Org realm, for a user who reads both
      // realms. It is bound to the realm it was minted for.
      let delegated = await ask(
        `Bearer ${jwt.sign(
          {
            user: IT_ADMIN,
            realm: ORG,
            permissions: ['read'],
            realmServerURL: org.realmServerURL,
            delegated: true,
          },
          realmSecretSeed,
          { expiresIn: '30m' },
        )}`,
        { ...asked, target: ROOM_204 },
      );
      let answered = await ask(ASKER.itAdmin(), { ...asked, target: ROOM_204 });
      assert.strictEqual(
        answered.status,
        200,
        'the IT admin, who reads both realms, is answered',
      );
      for (let [label, response] of [
        ['an Org reader asking about a card they cannot read', unreadable],
        [
          'an Org reader asking about a card that is not there',
          missingUnreadable,
        ],
        [
          'an Org reader asking about a card a grant lets them reach',
          reachable,
        ],
        ['a session delegated to the Org realm alone', delegated],
        ['a realm this server does not serve', elsewhere],
      ] as const) {
        assert.strictEqual(response.status, missing.status, `${label}: status`);
        assert.strictEqual(
          response.text,
          missing.text,
          `${label}: the body is the one a missing target gets, byte for byte`,
        );
      }
      assert.strictEqual(missing.status, 404);
      assert.strictEqual(errorOf(missing)?.code, 'target-not-found');

      // An archived realm refuses everything, so it has nothing to explain.
      await archiveRealm(db, new URL(EDUCATION));
      let archived = await ask(ASKER.itAdmin(), { ...asked, target: ROOM_204 });
      assert.strictEqual(
        archived.text,
        missing.text,
        'an archived realm’s card is told of as a missing one, byte for byte',
      );
    });

    test('a session the target realm would not accept asks as nobody, on a policy realm anyone may read', async function (assert) {
      // With the Org realm readable by everyone, a request to it takes the
      // path that verifies a token without checking its session further.
      await insertPermissions(db, new URL(ORG), { '*': ['read'] });
      let session = ASKER.itAdmin();
      let question = { actor: TEACHER, target: ROOM_204, operation: 'read' };
      let missing = await ask(session, { ...question, target: ROOM_999 });
      assert.strictEqual(
        (await ask(session, question)).status,
        200,
        'the IT admin’s own session is answered',
      );
      // Every session the IT admin holds is revoked from a moment after this
      // one was issued.
      await query(db, [
        'INSERT INTO users (matrix_user_id, sessions_revoked_at) VALUES (',
        param(IT_ADMIN),
        ',',
        param(Math.floor(Date.now() / 1000) + 60),
        ') ON CONFLICT (matrix_user_id) DO UPDATE SET sessions_revoked_at = EXCLUDED.sessions_revoked_at',
      ]);
      let revoked = await ask(session, question);
      assert.strictEqual(revoked.status, missing.status);
      assert.strictEqual(
        revoked.text,
        missing.text,
        'a revoked session is told what a missing target is told, byte for byte',
      );
    });

    test('a caller reaching the policy’s realm only through a grant is refused', async function (assert) {
      let readAsTeacher = (url: string) =>
        request
          .get(path(url))
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', ASKER.teacher());
      assert.strictEqual(
        (await readAsTeacher(ORG_NOTE)).status,
        200,
        'the Org policy grants the teacher a read of a card there',
      );
      assert.strictEqual(
        (await readAsTeacher(POLICY_CARD)).status,
        404,
        'though not of the policy card, which no grant reads',
      );
      let explained = await ask(ASKER.teacher(), {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
      });
      assert.strictEqual(
        explained.status,
        404,
        "the same policy's grant of explain admits nothing, and the teacher, who may not read the Org realm, is told the card is not there",
      );
      assert.strictEqual(errorOf(explained)?.code, 'target-not-found');
    });

    test('a policy card the target’s realm does not name explains nothing there', async function (assert) {
      let response = await ask(
        ASKER.itAdmin(),
        { actor: TEACHER, target: ROOM_204, operation: 'read' },
        { policy: ORG_POLICY_CARD },
      );
      assert.strictEqual(response.status, 422);
      assert.strictEqual(errorOf(response)?.code, 'policy-not-in-force');
    });

    test('explaining a write writes nothing', async function (assert) {
      let explanation = await explain(TEACHER, ROOM_204, 'rename');
      assert.strictEqual(explanation.decision, 'allowed');
      assert.strictEqual(
        await titleOf(ROOM_204),
        'Room 204',
        'the classroom keeps its title',
      );
    });

    module('a realm this server has not mounted', function (hooks) {
      // Each is staged the way a realm nothing on this process has touched
      // since it started is: its files on disk and its row in the registry,
      // and no mount. Each names the Education policy card as its policy and
      // holds a classroom the teacher teaches.
      const ANNEX = 'http://127.0.0.1:4444/annex/';
      const PRIVATE_ANNEX = 'http://127.0.0.1:4444/private-annex/';
      const ARCHIVED_ANNEX = 'http://127.0.0.1:4444/archived-annex/';
      const ROOM_301 = 'classrooms/room-301';

      async function stage(realmURL: string, permissions: RealmPermissions) {
        let diskId = new URL(realmURL).pathname.replace(/\//g, '');
        let dir = join(realmServer.testingOnlyRealmsRootPath, diskId);
        let files: Record<string, string> = {
          'realm.json': realmConfigCardJSON({
            name: diskId,
            policy: POLICY_CARD,
          }),
          [`${ROOM_301}.json`]: card(CLASSROOM, {
            title: 'Room 301',
            teacherIds: [TEACHER],
            leadTeacherIds: [],
          }),
        };
        for (let [path, content] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), content);
        }
        await insertSourceRealmInRegistry(db, {
          url: realmURL,
          diskId,
          ownerUsername: EDUCATION_ADMIN,
        });
        await insertPermissions(db, new URL(realmURL), {
          [EDUCATION_ADMIN]: ['read', 'write', 'realm-owner'],
          ...permissions,
        });
        // The registry as this process reflects it, which is what the realm
        // is looked up in, brought up to date with the row just written
        // rather than waiting on the notification it sent.
        await realmServer.testingOnlyReconcile();
      }

      function isMounted(realmURL: string) {
        let reconciler = realmServer.testingOnlyReconciler;
        return (
          reconciler.mounted.has(realmURL) ||
          reconciler.pendingMounts.has(realmURL) ||
          realmServer.testingOnlyRealms.some((realm) => realm.url === realmURL)
        );
      }

      hooks.afterEach(function () {
        realmServer?.testingOnlyReconciler.mounted.get(ANNEX)?.unsubscribe();
      });

      test('one the caller cannot read, or that is archived, is told of as a missing target is, and is not mounted to say so', async function (assert) {
        await stage(PRIVATE_ANNEX, {});
        await stage(ARCHIVED_ANNEX, { [IT_ADMIN]: ['read'] });
        await archiveRealm(db, new URL(ARCHIVED_ANNEX));
        let asked = { actor: TEACHER, operation: 'read' };
        let missing = await ask(ASKER.itAdmin(), {
          ...asked,
          target: ROOM_999,
        });
        for (let [label, realmURL] of [
          ['a realm the IT admin may not read', PRIVATE_ANNEX],
          ['an archived realm the IT admin may read', ARCHIVED_ANNEX],
        ] as const) {
          assert.false(
            isMounted(realmURL),
            `${label}: precondition: nothing on this process has mounted it`,
          );
          let response = await ask(ASKER.itAdmin(), {
            ...asked,
            target: `${realmURL}${ROOM_301}`,
          });
          assert.strictEqual(
            response.status,
            missing.status,
            `${label}: status`,
          );
          assert.strictEqual(
            response.text,
            missing.text,
            `${label}: the body is the one a missing target gets, byte for byte`,
          );
          assert.false(isMounted(realmURL), `${label}: and it is not mounted`);
        }
        assert.strictEqual(errorOf(missing)?.code, 'target-not-found');
      });

      test('one the caller can read is mounted, and its target is explained as a mounted realm’s is', async function (assert) {
        // Mounting the realm indexes it from scratch.
        assert.timeout(180_000);
        await stage(ANNEX, { [IT_ADMIN]: ['read'] });
        assert.false(
          isMounted(ANNEX),
          'precondition: nothing on this process has mounted it',
        );

        let explanation = await explain(TEACHER, `${ANNEX}${ROOM_301}`, 'read');

        assert.true(isMounted(ANNEX), 'the realm was mounted to explain it');
        assert.deepEqual(
          explanation,
          {
            ...(await explain(TEACHER, ROOM_204, 'read')),
            target: `${ANNEX}${ROOM_301}`,
          },
          'the explanation is the one the same classroom gets in the mounted Education realm',
        );
      });
    });
  });

  // A draft widening the teacher's reach to a read of every classroom,
  // outright. Its type is named relative to the policy card, as the card's
  // own rules name theirs.
  const WIDER_READ = {
    rules: [
      {
        targetType: { module: '../../education/classroom', name: 'Classroom' },
        grants: [{ operation: 'read' }],
      },
    ],
  };

  module('against a draft', function (hooks) {
    // A realm no asker in these tests reads, holding a type a draft can name.
    // Staged by the one test that needs it, so no other test boots it.
    const HR = 'http://127.0.0.1:4444/hr/';

    async function stageHR() {
      let diskId = 'hr';
      let dir = join(realmServer.testingOnlyRealmsRootPath, diskId);
      for (let [path, content] of Object.entries({
        'realm.json': realmConfigCardJSON({ name: 'HR' }),
        'salary.gts': SALARY_MODULE,
      })) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      await insertSourceRealmInRegistry(db, {
        url: HR,
        diskId,
        ownerUsername: HR_ADMIN,
      });
      await insertPermissions(db, new URL(HR), {
        [HR_ADMIN]: ['read', 'write', 'realm-owner'],
      });
      await realmServer.testingOnlyReconcile();
    }

    hooks.afterEach(function () {
      realmServer?.testingOnlyReconciler.mounted.get(HR)?.unsubscribe();
    });

    test('a draft answers what the policy would decide, and the policy in force is untouched', async function (assert) {
      let live = await explain(TEACHER, ROOM_205, 'read');
      assert.strictEqual(live.decision, 'denied', 'the policy in force');
      let compiles = education.__testOnlyPolicyCacheStats().compiles;
      let gate = education.__testOnlyPolicyGateStats();

      let drafted = await answer({
        actor: TEACHER,
        target: ROOM_205,
        operation: 'read',
        draft: WIDER_READ,
      });
      assert.deepEqual(
        drafted,
        {
          actor: TEACHER,
          target: ROOM_205,
          operation: 'read',
          acl: { read: false, write: false },
          decision: 'allowed',
          reason: 'granted',
          rules: [
            {
              targetType: CLASSROOM,
              path: 'rules[0]',
              grants: [
                { path: 'rules[0].grants[0]', outcome: 'unconditional' },
              ],
            },
          ],
          admittedBy: { rule: 0, grant: 0 },
          draft: { issues: [] },
        },
        'the draft’s own rules decide, its relative type resolved against the policy card',
      );
      assert.strictEqual(
        education.__testOnlyPolicyCacheStats().compiles,
        compiles,
        'the realm’s compiled-policy cache compiled nothing for the draft',
      );
      assert.deepEqual(
        education.__testOnlyPolicyGateStats(),
        gate,
        'and the realm’s own gate read nothing for it',
      );

      let after = await explain(TEACHER, ROOM_205, 'read');
      assert.deepEqual(after, live, 'the policy in force answers as before');
      let read = await request
        .get(path(ROOM_205))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', onEducation(TEACHER, []));
      assert.strictEqual(
        read.status,
        404,
        'and the teacher is still refused the card itself',
      );
    });

    test('a draft that does not compile reports its issues rather than throwing', async function (assert) {
      let partly = await answer({
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        draft: {
          rules: [
            {
              targetType: { module: '../no-such-module', name: 'Nothing' },
              grants: [{ operation: 'read' }],
            },
            {
              targetType: {
                module: '../../education/classroom',
                name: 'Classroom',
              },
              grants: [
                { operation: 'teleport' },
                { operation: 'read', where: TEACHES },
              ],
            },
          ],
        },
      });
      assert.strictEqual(
        partly.decision,
        'allowed',
        'the grant that compiled still applies',
      );
      assert.deepEqual(
        partly.draft?.issues.map(({ code, path }) => ({ code, path })),
        [
          { code: 'unresolved-type', path: 'rules[0].targetType' },
          { code: 'unknown-operation', path: 'rules[1].grants[0].operation' },
        ],
      );

      let unreadable = await answer({
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        draft: { rules: 'every classroom' },
      });
      assert.strictEqual(
        unreadable.decision,
        'failed',
        'a draft no rule can be read from fails every decision, as the policy card would',
      );
      assert.strictEqual(unreadable.reason, 'policy-unloadable');
      assert.deepEqual(
        unreadable.draft?.issues.map(({ code, path }) => ({ code, path })),
        [{ code: 'invalid-rule', path: 'rules' }],
      );
      let unreadableSearch = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'listMine',
        search: { on: CLASSROOM },
        draft: { rules: 'every classroom' },
      });
      assert.strictEqual(
        unreadableSearch.decision,
        'failed',
        'and every search, rather than reading as a policy that grants nothing',
      );
      assert.strictEqual(unreadableSearch.reason, 'policy-unloadable');

      let notADocument = await ask(ASKER.itAdmin(), {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        draft: 'every classroom',
      });
      assert.strictEqual(notADocument.status, 400);
      assert.strictEqual(errorOf(notADocument)?.code, 'invalid-params');

      let wholeCard = await ask(ASKER.itAdmin(), {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        draft: { data: { type: 'card', attributes: WIDER_READ } },
      });
      assert.strictEqual(
        wholeCard.status,
        400,
        'a draft with no rules of its own is refused rather than read as a policy granting nothing',
      );
      assert.strictEqual(errorOf(wholeCard)?.code, 'invalid-params');
    });

    test('a draft naming a type in a realm the asker cannot read is refused whole', async function (assert) {
      await stageHR();
      let question = {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        draft: {
          rules: [
            {
              targetType: { module: `${HR}salary`, name: 'Salary' },
              grants: [{ operation: 'query', where: '.band == actor()' }],
            },
          ],
        },
      };
      let refused = await ask(ASKER.itAdmin(), question);
      assert.strictEqual(
        refused.status,
        403,
        'the IT admin reads both the policy’s realm and the target’s, and not the realm the draft’s type is in',
      );
      assert.strictEqual(errorOf(refused)?.code, 'operation-not-permitted');
      assert.false(
        refused.text.includes('band'),
        'nothing compiling recorded about the type reaches them',
      );

      await insertPermissions(db, new URL(HR), { [IT_ADMIN]: ['read'] });
      let answered = await answer(question);
      assert.ok(
        answered.draft,
        'a caller who reads that realm too is answered against the draft',
      );
    });

    test('a draft is refused to a caller missing read on either realm, as the live form is', async function (assert) {
      let question = { actor: TEACHER, operation: 'read', draft: WIDER_READ };
      let missing = await ask(ASKER.itAdmin(), {
        ...question,
        target: ROOM_999,
      });
      assert.strictEqual(missing.status, 404);
      for (let [label, response] of [
        [
          'an Org reader, who cannot read the Education realm',
          await ask(ASKER.orgReader(), { ...question, target: ROOM_204 }),
        ],
        [
          'the teacher, who reaches the Org realm only through a grant',
          await ask(ASKER.teacher(), { ...question, target: ROOM_204 }),
        ],
      ] as const) {
        assert.strictEqual(response.status, missing.status, `${label}: status`);
        assert.strictEqual(
          response.text,
          missing.text,
          `${label}: told what a missing target is told, byte for byte`,
        );
      }
      let elsewhere = await ask(
        ASKER.itAdmin(),
        { ...question, target: ROOM_204 },
        { policy: ORG_POLICY_CARD },
      );
      assert.strictEqual(
        errorOf(elsewhere)?.code,
        'policy-not-in-force',
        'a draft rides only the explain of the card the target’s realm names',
      );
    });
  });

  // What a search answers for a caller, by the ids of its rows.
  async function searchIds(auth: string, payload: object): Promise<string[]> {
    let response = await request
      .post(`${path(EDUCATION)}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', auth)
      .send(payload);
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    return (response.body as { data: { id: string }[] }).data
      .map(({ id }) => id)
      .sort();
  }

  const AS_TEACHER = () => onEducation(TEACHER, []);
  const AS_READER = () => onEducation(READER, ['read']);

  // The rows a search running `filter` scoped by an explained fragment
  // returns, run by a reader of the realm, whom no policy scopes. So it runs
  // exactly the filter the explanation says the search would run.
  async function composedIds(
    filter: unknown,
    fragment: unknown,
  ): Promise<string[]> {
    return await searchIds(AS_READER(), {
      filter: filter ? { every: [filter, fragment] } : fragment,
    });
  }

  module('a search', function () {
    test('a granted named query answers with the fragment the search composes for the actor', async function (assert) {
      let explanation = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'listMine',
        search: { on: CLASSROOM },
      });
      assert.strictEqual(explanation.decision, 'allowed');
      assert.strictEqual(explanation.reason, 'granted');
      assert.strictEqual(explanation.target, EDUCATION);
      assert.false('refusal' in explanation);
      assert.deepEqual(explanation.rules, [
        {
          targetType: CLASSROOM,
          path: 'rules[0]',
          grants: [
            {
              path: 'rules[0].grants[4]',
              where: TEACHES,
              tier: 'stored',
              outcome: 'not-evaluated',
              filterable: true,
            },
          ],
        },
        { targetType: CLASSROOM, path: 'rules[1]', grants: [] },
      ]);
      let { search } = explanation;
      assert.strictEqual(search?.operation, 'listMine');
      assert.deepEqual(search?.types as unknown, [CLASSROOM]);
      assert.ok(search?.fragment, 'the policy composes a fragment');
      assert.true(
        JSON.stringify(search?.fragment).includes(JSON.stringify(TEACHER)),
        'with the actor filled in',
      );

      let searched = await searchIds(AS_TEACHER(), {
        operation: 'listMine',
        on: CLASSROOM,
      });
      assert.deepEqual(
        searched,
        [ROOM_204, SEMINAR_1],
        'the teacher’s own search, a seminar of theirs included',
      );
      assert.deepEqual(
        await composedIds(search?.filter, search?.fragment),
        searched,
        'the explained filter and fragment run to exactly the rows the teacher’s search returns',
      );
    });

    test('an ad-hoc search is explained under `query` on each type its filter anchors to', async function (assert) {
      let classrooms = { 'item.on': CLASSROOM };
      let explanation = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: classrooms },
      });
      assert.strictEqual(explanation.reason, 'granted');
      assert.strictEqual(explanation.search?.operation, 'query');
      assert.deepEqual(explanation.search?.filter as unknown, classrooms);
      assert.deepEqual(
        explanation.rules[0].grants.map(({ path }) => path),
        ['rules[0].grants[5]'],
        'the grant on `query`, and not the one on the named query',
      );
      let searched = await searchIds(AS_TEACHER(), { filter: classrooms });
      assert.deepEqual(searched, [ROOM_204, SEMINAR_1]);
      assert.deepEqual(
        await composedIds(classrooms, explanation.search?.fragment),
        searched,
      );

      let either = {
        any: [{ 'item.on': CLASSROOM }, { 'item.on': BULLETIN }],
      };
      let anchored = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: either },
      });
      assert.deepEqual(anchored.search?.types as unknown, [
        CLASSROOM,
        BULLETIN,
      ]);
      let fragment = JSON.stringify(anchored.search?.fragment);
      assert.true(
        fragment.includes(JSON.stringify(CLASSROOM)),
        'the anchor a grant admits is scoped to its own type',
      );
      assert.false(
        fragment.includes(JSON.stringify(BULLETIN)),
        'and the one no grant admits contributes nothing',
      );
      let searchedEither = await searchIds(AS_TEACHER(), { filter: either });
      assert.deepEqual(searchedEither, [ROOM_204, SEMINAR_1]);
      assert.deepEqual(
        await composedIds(either, anchored.search?.fragment),
        searchedEither,
      );
    });

    test('a search nothing grants has no rows, a reader searches unscoped, and a query kept out of reach is non-grantable', async function (assert) {
      let bulletins = { 'item.on': BULLETIN };
      let ungranted = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: bulletins },
      });
      assert.strictEqual(ungranted.decision, 'denied');
      assert.strictEqual(ungranted.reason, 'no-grant');
      assert.false('refusal' in ungranted, 'a search refuses nobody');
      assert.false('fragment' in (ungranted.search ?? {}));
      assert.deepEqual(ungranted.rules, [
        { targetType: BULLETIN, path: 'rules[2]', grants: [] },
      ]);
      assert.deepEqual(
        await searchIds(AS_TEACHER(), { filter: bulletins }),
        [],
        'the teacher’s search of bulletins has no rows',
      );

      let reader = await answer({
        actor: READER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: bulletins },
      });
      assert.strictEqual(reader.decision, 'allowed');
      assert.strictEqual(reader.reason, 'acl');
      assert.deepEqual(reader.rules, []);
      assert.false('fragment' in (reader.search ?? {}));

      let sealed = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'listMine',
        search: { on: SEALED_CLASSROOM },
      });
      assert.strictEqual(sealed.decision, 'denied');
      assert.strictEqual(
        sealed.reason,
        'non-grantable',
        'the grant on the parent type compiled, and the subtype’s declaration keeps it out',
      );
      assert.true(sealed.rules[0].grants[0].filterable);

      let unknown = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'listNothing',
        search: { on: CLASSROOM },
      });
      assert.strictEqual(unknown.reason, 'not-resolved');
      let refused = await request
        .post(`${path(EDUCATION)}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', AS_TEACHER())
        .send({ operation: 'listNothing', on: CLASSROOM });
      assert.deepEqual(
        unknown.refusal,
        { status: refused.status, code: errorOf(refused)?.code },
        'refused as the search itself refuses',
      );

      let unparsed = { 'item.on': CLASSROOM, nonsense: true };
      let malformed = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: unparsed },
      });
      assert.strictEqual(malformed.reason, 'not-resolved');
      let malformedSearch = await request
        .post(`${path(EDUCATION)}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', AS_TEACHER())
        .send({ filter: unparsed });
      assert.strictEqual(
        malformed.refusal?.status,
        malformedSearch.status,
        'a filter the search refuses to parse is refused with the status the search gives',
      );
    });

    test('a draft answers for the search lane too', async function (assert) {
      let bulletins = { 'item.on': BULLETIN };
      let drafted = await answer({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'query',
        search: { filter: bulletins },
        draft: {
          rules: [
            {
              targetType: {
                module: '../../education/bulletin',
                name: 'Bulletin',
              },
              grants: [{ operation: 'query' }],
            },
          ],
        },
      });
      assert.strictEqual(drafted.decision, 'allowed');
      assert.strictEqual(drafted.reason, 'granted');
      assert.deepEqual(drafted.draft, { issues: [] });
      assert.deepEqual(
        await composedIds(bulletins, drafted.search?.fragment),
        [BULLETIN_1],
        'the fragment the draft would push into search',
      );
      assert.deepEqual(
        await searchIds(AS_TEACHER(), { filter: bulletins }),
        [],
        'while the policy in force still gives the teacher none',
      );
    });

    test('a target that is not the realm, and a search shape that is not a search, are refused', async function (assert) {
      for (let [label, question] of [
        [
          'a card as the target of a search',
          {
            actor: TEACHER,
            target: ROOM_204,
            operation: 'query',
            search: { filter: { 'item.on': CLASSROOM } },
          },
        ],
        [
          'an ad-hoc search with a type',
          {
            actor: TEACHER,
            target: EDUCATION,
            operation: 'query',
            search: { on: CLASSROOM },
          },
        ],
        [
          'a named query with a filter',
          {
            actor: TEACHER,
            target: EDUCATION,
            operation: 'listMine',
            search: { on: CLASSROOM, filter: { 'item.on': CLASSROOM } },
          },
        ],
      ] as const) {
        let response = await ask(ASKER.itAdmin(), question);
        assert.strictEqual(response.status, 400, `${label}: status`);
        assert.strictEqual(
          errorOf(response)?.code,
          'invalid-params',
          `${label}: code`,
        );
      }
    });
  });

  module('how fresh a search is', function () {
    test('a pass the index has yet to take is counted, and the search answers without it while the direct lane does not', async function (assert) {
      let question = {
        actor: TEACHER,
        target: EDUCATION,
        operation: 'listMine',
        search: { on: CLASSROOM },
      };
      let before = (await answer(question)).search!.index;
      assert.deepEqual(before, { pending: 0 }, 'the index has caught up');

      // Work that holds the realm's index lane and never completes: a job a
      // worker has claimed and not finished, which nothing runs. Every pass in
      // the lane queues behind it.
      let [{ id: jobId }] = (await db.execute(
        `INSERT INTO jobs (job_type, concurrency_group, args, status, timeout, initiated_by)
         VALUES ('incremental-index', $1, '{}'::jsonb, 'unfulfilled', 7200, $2)
         RETURNING id`,
        {
          bind: [
            `indexing:${EDUCATION}`,
            JSON.stringify(['@elsewhere:localhost']),
          ],
        },
      )) as unknown as { id: string }[];
      let unwedge = async () => {
        await db.execute('DELETE FROM job_reservations WHERE job_id = $1', {
          bind: [jobId],
        });
        await db.execute('DELETE FROM jobs WHERE id = $1', { bind: [jobId] });
        // Removing a job wakes no worker, so the queue is told there is work,
        // as publishing one tells it.
        await db.execute('NOTIFY jobs');
      };
      try {
        await db.execute(
          `INSERT INTO job_reservations (job_id, worker_id, locked_until)
           VALUES ($1, 'explain-test-worker', NOW() + INTERVAL '7200 seconds')`,
          { bind: [jobId] },
        );
        // The teacher joins room 205. The bytes are stored now, and the pass
        // that indexes them waits behind the held lane.
        await education.write(
          'classrooms/room-205.json',
          classroom('Room 205', [COLLEAGUE, TEACHER]),
          { waitForIndex: false },
        );

        let behind = (await answer(question)).search!.index;
        assert.strictEqual(
          behind.pending,
          2,
          'the held work and the pass carrying the write',
        );
        assert.strictEqual(typeof behind.oldestPendingMs, 'number');
        assert.deepEqual(
          await searchIds(AS_TEACHER(), {
            operation: 'listMine',
            on: CLASSROOM,
          }),
          [ROOM_204, SEMINAR_1],
          'the search answers from the index, which does not have the write',
        );
        assert.strictEqual(
          (await explain(TEACHER, ROOM_205, 'read')).decision,
          'allowed',
          'while the direct lane reads the card as stored, and has it',
        );
      } finally {
        await unwedge();
      }
      await education.incrementalIndexing();

      assert.deepEqual(
        (await answer(question)).search!.index,
        { pending: 0 },
        'the index has caught up again',
      );
      assert.deepEqual(
        await searchIds(AS_TEACHER(), {
          operation: 'listMine',
          on: CLASSROOM,
        }),
        [ROOM_204, ROOM_205, SEMINAR_1],
        'and the search has the write',
      );
    });
  });

  module('a listing', function () {
    test('one page of the realm’s cards, each explained as its own triple', async function (assert) {
      type Listing = {
        explanations: PolicyExplanation[];
        page: { number: number; size: number; total: number };
      };
      let list = (number: number) =>
        answer<Listing>({
          actor: TEACHER,
          target: EDUCATION,
          operation: 'read',
          list: { on: CLASSROOM, page: { number, size: 2 } },
        });
      let first = await list(0);
      assert.deepEqual(first.page, { number: 0, size: 2, total: 4 });
      assert.deepEqual(
        first.explanations.map(({ target, decision }) => [target, decision]),
        [
          [ROOM_204, 'allowed'],
          [ROOM_205, 'denied'],
        ],
      );
      assert.deepEqual(
        first.explanations[0],
        await explain(TEACHER, ROOM_204, 'read'),
        'a listed card is explained as the triple would explain it',
      );
      let second = await list(1);
      assert.deepEqual(
        second.explanations.map(({ target, decision }) => [target, decision]),
        [
          [ROOM_206, 'allowed'],
          [SEMINAR_1, 'allowed'],
        ],
        'the next page holds the rest, a subtype’s card among them',
      );
      assert.deepEqual(second.page, { number: 1, size: 2, total: 4 });

      let drafted = await answer<Listing & { draft?: unknown }>({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'read',
        list: { on: CLASSROOM, page: { number: 0, size: 3 } },
        draft: WIDER_READ,
      });
      assert.deepEqual(
        drafted.explanations.map(({ decision }) => decision),
        ['allowed', 'allowed', 'allowed'],
        'a listing answers against a draft too',
      );
      assert.deepEqual(
        drafted.draft,
        { issues: [] },
        'which it names once, on the listing',
      );
      assert.false(
        drafted.explanations.some((explanation) => 'draft' in explanation),
        'rather than on every card',
      );

      let onCard = await ask(ASKER.itAdmin(), {
        actor: TEACHER,
        target: ROOM_204,
        operation: 'read',
        list: { on: CLASSROOM },
      });
      assert.strictEqual(
        onCard.status,
        400,
        'a listing names the realm it lists, not a card',
      );
    });

    test('a listing is capped, and so is every explain in a batch together', async function (assert) {
      let triple = { actor: TEACHER, target: ROOM_204, operation: 'read' };
      let listing = (size: number) => ({
        actor: TEACHER,
        target: EDUCATION,
        operation: 'read',
        list: { on: CLASSROOM, page: { size } },
      });
      let entry = (question: Question) =>
        invoke('explain', { href: POLICY_CARD, data: question });
      let batch = (...questions: Question[]) =>
        send(ORG, ASKER.itAdmin(), 'query', ...questions.map(entry));

      let over = await ask(ASKER.itAdmin(), listing(101));
      assert.strictEqual(over.status, 400, 'a page over the cap');
      assert.strictEqual(errorOf(over)?.code, 'invalid-params');

      let full = await batch(...Array.from({ length: 100 }, () => triple));
      assert.strictEqual(full.status, 200, 'a batch of a hundred triples');
      for (let [label, response] of [
        [
          'a hundred and one triples',
          await batch(...Array.from({ length: 101 }, () => triple)),
        ],
        [
          'two listings that are within the cap alone',
          await batch(listing(60), listing(60)),
        ],
        ['a full page and one triple', await batch(listing(100), triple)],
      ] as const) {
        assert.strictEqual(response.status, 400, `${label}: status`);
        assert.strictEqual(
          errorOf(response)?.code,
          'invalid-params',
          `${label}: code`,
        );
      }
    });
  });
});
