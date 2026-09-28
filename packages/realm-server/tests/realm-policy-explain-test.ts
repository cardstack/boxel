import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import jwt from 'jsonwebtoken';
import {
  param,
  query,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { insertPermissions } from '@cardstack/runtime-common/db-queries/realm-permission-queries';
import type {
  PolicyExplanation,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
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
const EDUCATION_ADMIN = '@education-admin:localhost';
const IT_ADMIN = '@it-admin:localhost';
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
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const SYLLABUS = { module: `${EDUCATION}syllabus`, name: 'Syllabus' };

const TEACHES = '.teacherIds | any(. == actor())';
const LEADS = '.leadTeacherIds | any(. == actor())';
const NUMERIC_TITLE = '(.title | tonumber) > 0';

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
  }
`;

// A policy type that declares the explain. Both of the Org realm's policy
// cards are one.
const EXPLAINABLE_POLICY_MODULE = `
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";

  export class ExplainablePolicy extends RealmPolicy {
    @operation static explain = {
      base: 'explain',
      params: {
        actor: StringField,
        target: StringField,
        operation: StringField,
      },
      nonGrantable: true,
    };
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Two rules govern `Classroom`, so a read is admitted by either one's grant.
// `rename` and `appendActivity` are granted outright, and a `delete` rests on
// the same predicate a read does. `Bulletin` takes its reads and updates
// outright. A `Syllabus` read rests on a predicate that throws for any title
// that is not a number, or on one annotated as reading a snapshot tier, which
// the gate never evaluates.
const EDUCATION_RULES: Rule[] = [
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
    grants: [{ operation: 'read' }, { operation: 'update' }],
  },
  {
    targetType: SYLLABUS,
    grants: [
      { operation: 'read', where: NUMERIC_TITLE },
      { operation: 'read', where: { bxl: 'true', snapshot: true } },
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
      meta: {
        adoptsFrom: {
          module: '../explainable-policy',
          name: 'ExplainablePolicy',
        },
      },
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
            'explainable-policy.gts': EXPLAINABLE_POLICY_MODULE,
            'policies/education.json': policyCard(EDUCATION_RULES),
            'policies/org.json': policyCard(ORG_RULES),
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
    request = supertest(server);
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      db = dbAdapter;
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
    question: { actor: string; target: string; operation: string },
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
            grants: [{ where: TEACHES, tier: 'stored', outcome: 'held' }],
          },
          {
            targetType: CLASSROOM,
            grants: [
              { where: LEADS, tier: 'stored', outcome: 'not-evaluated' },
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
        { targetType: BULLETIN, grants: [{ outcome: 'unconditional' }] },
      ]);
      assert.deepEqual(explanation.admittedBy, { rule: 0, grant: 0 });
    });

    test('an operation nothing grants still names the rules that govern the type', async function (assert) {
      let explanation = await explain(READER, ROOM_205, 'archive');
      assert.strictEqual(explanation.decision, 'denied');
      assert.strictEqual(explanation.reason, 'no-grant');
      assert.deepEqual(explanation.rules, [
        { targetType: CLASSROOM, grants: [] },
        { targetType: CLASSROOM, grants: [] },
      ]);
      assert.deepEqual(
        explanation.refusal,
        { status: 403, code: 'operation-not-permitted' },
        'the reader may read the realm, so they are told the gate refused them',
      );
    });

    test('a snapshot-tier predicate is never evaluated, and one that throws fails the decision', async function (assert) {
      let numeric = await explain(TEACHER, COURSE_42, 'read');
      assert.strictEqual(numeric.decision, 'allowed');
      assert.deepEqual(numeric.rules, [
        {
          targetType: SYLLABUS,
          grants: [
            { where: NUMERIC_TITLE, tier: 'stored', outcome: 'held' },
            { where: 'true', tier: 'snapshot', outcome: 'not-evaluated' },
          ],
        },
      ]);

      let throwing = await explain(TEACHER, ALGEBRA, 'read');
      assert.strictEqual(throwing.decision, 'failed');
      assert.strictEqual(throwing.reason, 'predicate-threw');
      assert.deepEqual(
        throwing.rules[0].grants.map((grant) => grant.outcome),
        ['threw', 'not-evaluated'],
      );
      assert.deepEqual(throwing.refusal, {
        status: 500,
        code: 'internal-error',
      });
    });

    test('a write resting on a predicate is judged against the card as it is stored', async function (assert) {
      let own = await explain(TEACHER, ROOM_204, 'delete');
      assert.strictEqual(own.decision, 'allowed');
      assert.deepEqual(own.rules[0].grants, [
        { where: TEACHES, tier: 'stored', outcome: 'held' },
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

    test('an operation the card does not carry, a write to authorization infrastructure, and a caller with no credentials', async function (assert) {
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

      let anonymous = await explain('', ROOM_204, 'read');
      assert.strictEqual(anonymous.actor, null);
      assert.strictEqual(anonymous.reason, 'actor-required');
      assert.deepEqual(anonymous.refusal, {
        status: 401,
        code: 'actor-required',
      });
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
      let read = await request
        .get(path(POLICY_CARD))
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', ASKER.teacher());
      assert.strictEqual(
        read.status,
        200,
        'the Org policy grants the teacher a read of the policy card',
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
  });
});
