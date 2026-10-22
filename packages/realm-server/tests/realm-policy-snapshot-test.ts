import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  CapabilityAnswer,
  PolicyExplanation,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  dischargePendingDecision,
  newOperationScope,
  pendingWriteFor,
  resolveGatedOperation,
  scopeCallerFor,
  setPolicySnapshotReadSink,
  type PolicySnapshotReadEvent,
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
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A grant whose predicate reads a computed value or a linked card's field,
// annotated `snapshot: true`, and judged against the card's index row.
//
// The worked example's topology: the Education realm holds the cards, and its
// policy card lives in an Org realm. A teacher holds no permission on the
// Education realm, so every request of theirs reaches the policy gate. A
// reader may read the realm and not write it. An IT admin reads both realms,
// so they may ask the policy what it decides.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const IT_ADMIN = '@it-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const OFFICE = { module: `${EDUCATION}office`, name: 'Office' };

const TEACHER_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Teacher extends CardDef {
    @field handle = contains(StringField);
  }
`;

// A classroom's head teacher is the first id on its roster, computed, so only
// the index holds it. Its lead is a linked teacher, whose handle only the
// index holds too, since the link is marked `searchable`.
const CLASSROOM_MODULE = `
  import { contains, containsMany, field, linksTo, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";
  import { Teacher } from "./teacher";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field headTeacher = contains(StringField, {
      computeVia: function (this: Classroom) {
        return this.teacherIds?.[0];
      },
    });
    @field lead = linksTo(() => Teacher, { searchable: true });

    @operation static rename = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };
  }
`;

const BULLETIN_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
    @field authorIds = containsMany(StringField);
  }
`;

// An office's desk is a contained value, whose nameplate is computed from its
// occupant.
const OFFICE_MODULE = `
  import { contains, field, CardDef, FieldDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Desk extends FieldDef {
    @field occupant = contains(StringField);
    @field nameplate = contains(StringField, {
      computeVia: function (this: Desk) {
        return this.occupant;
      },
    });
  }
  export class Office extends CardDef {
    @field desk = contains(Desk);
  }
`;

const HEADS = { bxl: '.headTeacher == actor()', snapshot: true };
const LEADS = { bxl: '.lead.handle == actor()', snapshot: true };
const AUTHORS = '.authorIds | any(. == actor())';

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// A classroom is read by its head teacher, or by the teacher it links to as
// its lead, and renamed by its head teacher: each judged against the
// snapshot. Its create grant is judged against the snapshot too, which a
// create cannot be. A bulletin is read and deleted by its authors, judged
// against its stored source. An office is read by whoever its desk's
// nameplate names.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: HEADS },
      { operation: 'read', where: LEADS },
      { operation: 'rename', where: HEADS },
      { operation: 'create', where: HEADS },
    ],
  },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'read', where: AUTHORS },
      { operation: 'delete', where: AUTHORS },
    ],
  },
  {
    targetType: OFFICE,
    grants: [
      {
        operation: 'read',
        where: { bxl: '.desk.nameplate == actor()', snapshot: true },
      },
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

function card(
  module: string,
  name: string,
  attributes: Record<string, unknown>,
  relationships: Record<string, unknown> = {},
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      relationships,
      meta: { adoptsFrom: { module, name } },
    },
  });
}

function classroom(title: string, teacherIds: string[], lead?: string) {
  return card(
    '../classroom',
    'Classroom',
    { title, teacherIds },
    lead ? { lead: { links: { self: `../teachers/${lead}` } } } : {},
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

// Room 1's head teacher is the teacher, and its lead someone else. Room 2's
// lead is the teacher, and its head teacher a colleague. Room 3 is the
// colleague's alone.
const ROOM_1 = `${EDUCATION}classrooms/room-1`;
const ROOM_2 = `${EDUCATION}classrooms/room-2`;
const ROOM_3 = `${EDUCATION}classrooms/room-3`;
const ROOM_999 = `${EDUCATION}classrooms/room-999`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let db: PgAdapter;
  let request: SuperTest<Test>;
  let server: Server;
  let reads: PolicySnapshotReadEvent[];

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
            'teacher.gts': TEACHER_MODULE,
            'classroom.gts': CLASSROOM_MODULE,
            'bulletin.gts': BULLETIN_MODULE,
            'office.gts': OFFICE_MODULE,
            'offices/o1.json': card('../office', 'Office', {
              desk: { occupant: TEACHER },
            }),
            'offices/o2.json': card('../office', 'Office', {
              desk: { occupant: COLLEAGUE },
            }),
            'teachers/ada.json': card('../teacher', 'Teacher', {
              handle: '@ada:localhost',
            }),
            'teachers/tess.json': card('../teacher', 'Teacher', {
              handle: TEACHER,
            }),
            'classrooms/room-1.json': classroom('Room 1', [TEACHER], 'ada'),
            'classrooms/room-2.json': classroom('Room 2', [COLLEAGUE], 'tess'),
            'classrooms/room-3.json': classroom('Room 3', [COLLEAGUE]),
            'bulletins/b1.json': card('../bulletin', 'Bulletin', {
              body: 'Picture day is Friday',
              authorIds: [TEACHER],
            }),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read'],
            [READER]: ['read'],
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
            [IT_ADMIN]: ['read'],
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

  async function stop() {
    setPolicySnapshotReadSink(undefined);
    for (let realm of [education, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
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
      reads = [];
      setPolicySnapshotReadSink((event) => reads.push(event));
    },
    afterEach: stop,
  });

  function bearer(
    realm: Realm,
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(realm, user, permissions)}`;
  }

  const AUTH = {
    teacher: () => bearer(education, TEACHER),
    colleague: () => bearer(education, COLLEAGUE),
    reader: () => bearer(education, READER, ['read']),
    admin: () => bearer(education, ADMIN, ['read', 'write', 'realm-owner']),
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

  function operations(
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

  async function capabilities(
    auth: string,
    checks: {
      target: string | { module: string; name: string };
      operation: string;
    }[],
  ): Promise<CapabilityAnswer[]> {
    let response = await request
      .post(`${path(EDUCATION)}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('Authorization', auth)
      .send({ checks });
    if (response.status !== 200) {
      throw new Error(`_capabilities answered ${response.status}`);
    }
    return (response.body as { checks: CapabilityAnswer[] }).checks;
  }

  async function explain(
    actor: string,
    target: string,
    operation: string,
  ): Promise<PolicyExplanation> {
    let response = await operations(
      ORG,
      bearer(org, IT_ADMIN, ['read']),
      'query',
      invoke('explain', {
        href: POLICY_CARD,
        data: { actor, target, operation },
      }),
    );
    if (response.status !== 200) {
      throw new Error(`explain answered ${response.status}: ${response.text}`);
    }
    return (response.body as { 'atomic:results': PolicyExplanation[] })[
      'atomic:results'
    ][0];
  }

  function errorOf(response: Response) {
    return (
      JSON.parse(response.text) as {
        errors: { status: number; code: string; detail: string }[];
      }
    ).errors[0];
  }

  async function titleOf(url: string) {
    let response = await getCard(url, AUTH.admin());
    return (response.body as { data: { attributes: { title?: string } } }).data
      .attributes.title;
  }

  // Sets the head teacher the index holds for a classroom, and nothing else:
  // the classroom's stored source still names its own roster. That is what a
  // row that has not caught up to the latest write looks like.
  async function indexHeadTeacher(url: string, headTeacher: string) {
    await db.execute(
      `UPDATE boxel_index
       SET pristine_doc = jsonb_set(pristine_doc, '{attributes,headTeacher}', '${JSON.stringify(headTeacher)}'::jsonb)
       WHERE file_alias = '${url}' AND type = 'instance'`,
    );
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  test('an annotated predicate compiles and is judged against the snapshot', async function (assert) {
    let policy = await education.getCompiledPolicy();
    // A classroom links to a teacher, which nothing here grants, and that is
    // recorded against each read as a warning that keeps it.
    let issues = (policy?.issues ?? []).filter(
      ({ code }) =>
        code !== 'grant-reaches-ungranted-type' &&
        code !== 'render-reaches-ungranted-type',
    );
    assert.deepEqual(
      issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'unsnapshotted-policy-read', path: 'rules[0].grants[3].where' }],
      'the create grant judged against the snapshot is recorded, since the card a create mints has no index row',
    );
    assert.true(
      /a card being created isn't in the index until it's saved/i.test(
        issues[0]?.message ?? '',
      ),
      `the issue says why: ${issues[0]?.message}`,
    );
    assert.deepEqual(
      policy?.rules.map((rule) =>
        rule.grants.map(({ operation, where }) => [operation, where?.snapshot]),
      ),
      [
        [
          ['read', true],
          ['read', true],
          ['rename', true],
        ],
        [
          ['read', false],
          ['delete', false],
        ],
        [['read', true]],
      ],
      'every other grant compiles',
    );
  });

  test('a computed value inside a contained value is read from the index row', async function (assert) {
    assert.strictEqual(
      (await getCard(`${EDUCATION}offices/o1`, AUTH.teacher())).status,
      200,
      'the teacher reads the office whose desk the index says bears their nameplate',
    );
    assert.strictEqual(
      (await getCard(`${EDUCATION}offices/o2`, AUTH.teacher())).status,
      404,
      'and not the colleague’s',
    );
  });

  test('a row that expanded a card the link no longer names says nothing about the card it names now', async function (assert) {
    assert.strictEqual(
      (await getCard(ROOM_2, AUTH.teacher())).status,
      200,
      'the teacher reads room 2 as the lead the row expanded',
    );
    // Room 2's row keeps the teacher's handle, but as the expansion of a
    // different card than the one its stored link names.
    await db.execute(
      `UPDATE boxel_index
       SET search_doc = jsonb_set(search_doc, '{lead,id}', '${JSON.stringify(`${EDUCATION}teachers/ada`)}'::jsonb)
       WHERE file_alias = '${ROOM_2}' AND type = 'instance'`,
    );
    assert.strictEqual(
      (await getCard(ROOM_2, AUTH.teacher())).status,
      404,
      'the handle is not read as the linked card’s',
    );
  });

  test('a computed value is the index row’s to answer, whatever the stored source holds under its key', async function (assert) {
    // A hand-written `.json` that holds a value under the computed key. The
    // serializer never writes one, so only a raw write can.
    await education.write(
      'classrooms/room-3.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Room 3',
            teacherIds: [COLLEAGUE],
            headTeacher: TEACHER,
          },
          meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
        },
      }),
    );
    await education.indexing();
    assert.strictEqual(
      (await getCard(ROOM_3, AUTH.teacher())).status,
      404,
      'the stored key does not admit the teacher',
    );
    assert.strictEqual(
      (await getCard(ROOM_3, AUTH.colleague())).status,
      200,
      'the head teacher the index computed is admitted',
    );
  });

  test('under the write lock, a card with no index row has no snapshot, and the grant does not hold', async function (assert) {
    let core = education.operationCore;
    let scope = newOperationScope(core, {
      caller: scopeCallerFor(TEACHER),
      coarseDeclined: 'all',
    });
    let target = { kind: 'instance' as const, url: ROOM_1 };
    let { decision } = await resolveGatedOperation(
      core,
      target,
      'rename',
      scope,
    );
    assert.strictEqual(
      decision.kind,
      'pending',
      'the rename rests on its predicate',
    );
    let pending = pendingWriteFor(target, 'rename', decision, scope);
    if (!pending) {
      throw new Error('expected the gate to leave the rename to the lock');
    }
    // The row goes between the gate's decision and the lock's.
    await db.execute(
      `UPDATE boxel_index SET is_deleted = TRUE
       WHERE file_alias = '${ROOM_1}' AND type = 'instance'`,
    );
    await assert.rejects(
      dischargePendingDecision(core, pending, {
        id: ROOM_1,
        source: classroom('Room 1', [TEACHER], 'ada'),
      }),
      (e: any) => e.error?.code === 'operation-not-permitted',
      'the lock refuses the write',
    );
    assert.deepEqual(
      reads.map(({ grant, outcome, decidedAt, indexed }) => ({
        grant,
        outcome,
        decidedAt,
        indexed,
      })),
      [
        {
          grant: 'rules[0].grants[2]',
          outcome: 'did-not-hold',
          decidedAt: 'lock',
          indexed: false,
        },
      ],
      'and records a snapshot read of a card that had no row',
    );
  });

  test('an annotated read grant admits a caller whose indexed computed value, or linked card’s value, satisfies it', async function (assert) {
    assert.strictEqual(
      (await getCard(ROOM_1, AUTH.teacher())).status,
      200,
      'the head teacher reads room 1 on the value the index computed',
    );
    assert.strictEqual(
      (await getCard(ROOM_2, AUTH.teacher())).status,
      200,
      'the lead reads room 2 on the linked card the index expanded',
    );
    let room3 = await getCard(ROOM_3, AUTH.teacher());
    let missing = await getCard(ROOM_999, AUTH.teacher());
    assert.strictEqual(room3.status, 404, 'room 3 is refused');
    assert.strictEqual(
      room3.text.replaceAll('room-3', 'room-999'),
      missing.text,
      'as a room that is not there is',
    );
    assert.deepEqual(
      reads.map(({ grant, outcome, decidedAt, indexed, hypothetical }) => ({
        grant,
        outcome,
        decidedAt,
        indexed,
        hypothetical,
      })),
      [
        // Room 1
        {
          grant: 'rules[0].grants[0]',
          outcome: 'held',
          decidedAt: 'gate',
          indexed: true,
          hypothetical: false,
        },
        // Room 2
        {
          grant: 'rules[0].grants[0]',
          outcome: 'did-not-hold',
          decidedAt: 'gate',
          indexed: true,
          hypothetical: false,
        },
        {
          grant: 'rules[0].grants[1]',
          outcome: 'held',
          decidedAt: 'gate',
          indexed: true,
          hypothetical: false,
        },
        // Room 3
        {
          grant: 'rules[0].grants[0]',
          outcome: 'did-not-hold',
          decidedAt: 'gate',
          indexed: true,
          hypothetical: false,
        },
        {
          grant: 'rules[0].grants[1]',
          outcome: 'did-not-hold',
          decidedAt: 'gate',
          indexed: true,
          hypothetical: false,
        },
      ],
      'each evaluation that decided a read is recorded as a snapshot read',
    );
    assert.deepEqual(
      {
        ...reads[0],
        grant: undefined,
        outcome: undefined,
        decidedAt: undefined,
        indexed: undefined,
        hypothetical: undefined,
      },
      {
        kind: 'policy-snapshot-read',
        realmURL: EDUCATION,
        actor: TEACHER,
        operation: 'read',
        targetType: { module: rri(CLASSROOM.module), name: 'Classroom' },
        grant: undefined,
        outcome: undefined,
        decidedAt: undefined,
        indexed: undefined,
        hypothetical: undefined,
      },
      'naming the caller, the operation and the rule’s type, and no card',
    );

    // An envelope entry is resolved when the envelope is read and again when
    // it runs, and each resolution is a decision at the gate.
    let before = reads.length;
    assert.strictEqual(
      (
        await operations(
          EDUCATION,
          AUTH.teacher(),
          'post',
          invoke('read', { href: ROOM_1 }),
        )
      ).status,
      200,
      'an envelope read is admitted alike',
    );
    let envelopeReads = reads.slice(before);
    assert.notStrictEqual(envelopeReads.length, 0, 'and is recorded');
    assert.deepEqual(
      [
        ...new Set(
          envelopeReads.map(
            ({ grant, outcome, decidedAt }) =>
              `${grant} ${outcome} at the ${decidedAt}`,
          ),
        ),
      ],
      ['rules[0].grants[0] held at the gate'],
      'as the head teacher’s grant holding at the gate',
    );
  });

  test('a snapshot grant decides on the index row, which can lag the card’s stored source', async function (assert) {
    // Room 3's roster names the colleague, and its row says the teacher heads
    // it: the row of a card whose latest write the index has not caught up
    // to.
    await indexHeadTeacher(ROOM_3, TEACHER);
    assert.strictEqual(
      (await getCard(ROOM_3, AUTH.teacher())).status,
      200,
      'the teacher is admitted on what the row holds',
    );
    assert.strictEqual(
      (await getCard(ROOM_3, AUTH.colleague())).status,
      404,
      'and the colleague the stored roster names is not, until the card is indexed again',
    );
  });

  test('the write lock judges an annotated write grant against the index row', async function (assert) {
    let before = gateStats();
    let renamed = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_1, data: { title: 'Room 1A' } }),
    );
    assert.strictEqual(
      renamed.status,
      200,
      `the head teacher renames room 1: ${renamed.text}`,
    );
    assert.strictEqual(await titleOf(ROOM_1), 'Room 1A');
    let after = gateStats();
    assert.strictEqual(
      after.pendingDischarges - before.pendingDischarges,
      1,
      'the write was decided under the lock',
    );
    assert.deepEqual(
      reads.map(({ grant, outcome, decidedAt }) => ({
        grant,
        outcome,
        decidedAt,
      })),
      [{ grant: 'rules[0].grants[2]', outcome: 'held', decidedAt: 'lock' }],
      'and its predicate read the snapshot there',
    );

    let refused = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_3, data: { title: 'Room 3A' } }),
    );
    assert.strictEqual(refused.status, 404, 'room 3 is refused to the teacher');
    assert.strictEqual(await titleOf(ROOM_3), 'Room 3', 'and left as it was');

    // The row says the teacher heads room 3, while its stored roster names
    // the colleague. The lock follows the row.
    await indexHeadTeacher(ROOM_3, TEACHER);
    let lagging = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_3, data: { title: 'Room 3B' } }),
    );
    assert.strictEqual(
      lagging.status,
      200,
      'the lock admits the write on what the row holds',
    );
    assert.strictEqual(await titleOf(ROOM_3), 'Room 3B');
  });

  test('a capability check, a refused caller’s answer and an explain each give the answer the gate or the lock gives', async function (assert) {
    let given = await capabilities(AUTH.teacher(), [
      { target: ROOM_1, operation: 'read' },
      { target: ROOM_2, operation: 'read' },
      { target: ROOM_3, operation: 'read' },
      { target: ROOM_1, operation: 'rename' },
      { target: ROOM_3, operation: 'rename' },
    ]);
    assert.deepEqual(
      given.map(({ allowed, conditional }) => ({ allowed, conditional })),
      [
        { allowed: true, conditional: undefined },
        { allowed: true, conditional: undefined },
        { allowed: false, conditional: undefined },
        { allowed: true, conditional: undefined },
        { allowed: false, conditional: undefined },
      ],
      'the capability check answers each pair as its invocation is answered',
    );
    assert.deepEqual(
      reads,
      [],
      'and records no snapshot read, deciding nothing',
    );
    for (let [target, allowed] of [
      [ROOM_1, true],
      [ROOM_2, true],
      [ROOM_3, false],
    ] as const) {
      assert.strictEqual(
        (await getCard(target, AUTH.teacher())).status === 200,
        allowed,
        `${target}: the read agrees`,
      );
    }

    // A batch that fails past a write the lock would admit tells the caller
    // why. One that fails past a write the lock would refuse is answered as a
    // card that is not there.
    let admitted = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_1 }),
    );
    assert.strictEqual(
      admitted.status,
      400,
      'the head teacher is told the rename is missing its param',
    );
    assert.strictEqual(errorOf(admitted).code, 'invalid-params');
    let withheld = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_3 }),
    );
    let missing = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_999 }),
    );
    assert.strictEqual(withheld.status, 404, 'room 3 is answered as not there');
    assert.strictEqual(
      withheld.text,
      missing.text,
      'byte for byte as a room that is not there',
    );

    let heads = await explain(TEACHER, ROOM_1, 'read');
    assert.strictEqual(heads.decision, 'allowed');
    assert.deepEqual(heads.admittedBy, { rule: 0, grant: 0 });
    assert.deepEqual(
      heads.rules[0].grants.map(({ tier, outcome }) => ({ tier, outcome })),
      [
        { tier: 'snapshot', outcome: 'held' },
        { tier: 'snapshot', outcome: 'not-evaluated' },
      ],
    );
    let refusedRead = await explain(TEACHER, ROOM_3, 'read');
    assert.strictEqual(refusedRead.decision, 'denied');
    assert.strictEqual(refusedRead.reason, 'predicate-false');
    assert.deepEqual(
      refusedRead.rules[0].grants.map(({ tier, outcome }) => ({
        tier,
        outcome,
      })),
      [
        { tier: 'snapshot', outcome: 'did-not-hold' },
        { tier: 'snapshot', outcome: 'did-not-hold' },
      ],
    );
    let rename = await explain(TEACHER, ROOM_1, 'rename');
    assert.strictEqual(rename.decision, 'allowed');
    assert.deepEqual(
      rename.rules[0].grants.map(({ tier, outcome }) => ({ tier, outcome })),
      [{ tier: 'snapshot', outcome: 'held' }],
    );
    let hypothetical = reads.filter((read) => read.hypothetical);
    assert.deepEqual(
      hypothetical.map(({ grant, outcome, decidedAt }) => ({
        grant,
        outcome,
        decidedAt,
      })),
      [
        { grant: 'rules[0].grants[0]', outcome: 'held', decidedAt: 'gate' },
        {
          grant: 'rules[0].grants[0]',
          outcome: 'did-not-hold',
          decidedAt: 'gate',
        },
        {
          grant: 'rules[0].grants[1]',
          outcome: 'did-not-hold',
          decidedAt: 'gate',
        },
      ],
      'an explain’s evaluations at the gate are recorded as hypothetical, and a prediction of the lock’s answer is not recorded at all',
    );
  });

  test('a snapshot grant never admits a create against a type', async function (assert) {
    let [answer] = await capabilities(AUTH.reader(), [
      {
        target: { module: rri(CLASSROOM.module), name: 'Classroom' },
        operation: 'create',
      },
    ]);
    assert.deepEqual(
      answer,
      {
        allowed: false,
        reason: 'operation-not-permitted',
        operation: 'create',
        target: { module: rri(CLASSROOM.module), name: 'Classroom' },
      },
      'the capability check refuses it outright rather than leaving it to a predicate',
    );
    let created = await operations(EDUCATION, AUTH.reader(), 'post', {
      op: 'invoke',
      'boxel:name': 'create',
      data: {
        type: 'card',
        attributes: { title: 'Room 4', teacherIds: [READER] },
        meta: {
          adoptsFrom: { module: rri(CLASSROOM.module), name: 'Classroom' },
        },
      },
    });
    assert.strictEqual(created.status, 403, 'and so does the create');
    assert.strictEqual(errorOf(created).code, 'operation-not-permitted');
  });

  test('a predicate that reads the stored source reads no index row, at the gate or under the lock', async function (assert) {
    assert.strictEqual(
      (await getCard(BULLETIN_1, AUTH.teacher())).status,
      200,
      'an author reads the bulletin',
    );
    let deleted = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('delete', { href: BULLETIN_1 }),
    );
    assert.strictEqual(deleted.status, 200, `and deletes it: ${deleted.text}`);
    let stats = gateStats();
    assert.true(
      stats.predicateEvaluations >= 2,
      'both predicates were evaluated',
    );
    assert.strictEqual(stats.snapshotReads, 0, 'and neither read an index row');
    assert.deepEqual(reads, [], 'nor recorded a snapshot read');
  });
});
