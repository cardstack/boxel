import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  DURING_PRERENDER_HEADER,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmAdapter,
} from '@cardstack/runtime-common';
import {
  CAPABILITY_CHECK_CAP,
  setCapabilityCheckSink,
  setOperationPerfSink,
  type CapabilityAnswer,
  type CapabilityCheckEvent,
  type OperationPerfEvent,
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
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// The capability check: `POST {realm}/_capabilities`, which answers what the
// policy gate would decide for a bounded list of `{ target, operation }` pairs
// so a view can hide the controls its caller may not use.
//
// The topology is the gate's own worked example. The Education realm holds the
// cards a policy governs and its policy card lives in an Org realm nobody the
// Education realm serves can read. A teacher holds no permission on the
// Education realm at all, a reader may read it but not write it, and the admin
// may do both — so one fixture covers every relation a caller can stand in to
// the ACL, which is what decides how much of an answer they are given.

const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
// Anyone may read it and only its librarian may write it, and its policy lets
// anyone signed in delete from it. So one realm shows both ways a write the ACL
// refuses can go: to the policy, or refused before it is routed.
const LIBRARY = 'http://127.0.0.1:4444/library/';
const LIBRARIAN = '@librarian:localhost';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };

// Is the caller one of the classroom's teachers. Written with `any` and `==`
// because that is exact: BXL's `contains` matches substrings.
const TEACHES = '.teacherIds | any(. == actor())';

const STUDENT_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Student extends CardDef {
    @field name = contains(StringField);
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
    @field students = linksToMany(() => Student);

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

    @operation static listByLead = {
      base: 'query',
      query: { filter: { type: () => Classroom } },
    };

    @operation static listAll = {
      base: 'query',
      query: { filter: { type: () => Classroom } },
    };

    @operation static listAudited = {
      base: 'query',
      nonGrantable: true,
      query: { filter: { type: () => Classroom } },
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

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// `Classroom` grants a read and a delete on a predicate, and `rename` and
// `appendActivity` outright; `create` on it rests on a predicate, which is what
// a type target cannot decide here, and `archive` on one that throws for a
// title that is not a number, which no classroom's is. `Bulletin` takes its
// writes and its creates outright, so a type target for one is decided
// outright too.
//
// Of the classroom queries, `listMine` and the ad-hoc `query` are granted on a
// predicate that compiles to a search filter. `listByLead`'s predicate reads a
// list by position, which a filter cannot say, and `listAudited` is declared
// non-grantable. `listAll` is granted by no rule.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: TEACHES },
      { operation: 'rename' },
      { operation: 'appendActivity' },
      { operation: 'delete', where: TEACHES },
      { operation: 'create', where: TEACHES },
      { operation: 'archive', where: '(.title | tonumber) > 0' },
      { operation: 'listMine', where: TEACHES },
      { operation: 'query', where: TEACHES },
      { operation: 'listByLead', where: '.teacherIds[0] == actor()' },
      { operation: 'listAudited', where: TEACHES },
    ],
  },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'read' },
      { operation: 'delete' },
      { operation: 'create' },
    ],
  },
];

// Anyone signed in may delete a card from the Library, whatever its type.
const LIBRARY_RULES: Rule[] = [
  {
    targetType: { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
    grants: [{ operation: 'delete' }],
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

function classroom(title: string, teacherIds: string[], name = 'Classroom') {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, teacherIds },
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

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_207 = `${EDUCATION}classrooms/room-207`;
const LIBRARY_NOTE = `${LIBRARY}note`;
const HOMEROOM = `${EDUCATION}classrooms/homeroom-1`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;
const BULLETIN_2 = `${EDUCATION}bulletins/b2`;
const NOTE = `${EDUCATION}note`;
const ABSENT = `${EDUCATION}classrooms/room-999`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let educationAdapter: RealmAdapter;
  let org: Realm;
  let library: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;
  // Every realm event the Education realm broadcast, counted by wrapping the
  // adapter the realm publishes through. A check must produce none, and the
  // counter is shown to move for a real invocation in the same test, so the
  // zero is an observation rather than an instrument that was never wired.
  let broadcasts: string[];

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
            'student.gts': STUDENT_MODULE,
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'classrooms/room-207.json': classroom('Room 207', [READER]),
            'classrooms/homeroom-1.json': classroom(
              'Homeroom 1',
              [TEACHER],
              'Homeroom',
            ),
            'bulletins/b1.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'Picture day is Friday' },
            ),
            'bulletins/b2.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'Book fair is Monday' },
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
            'policies/library.json': policyCard(LIBRARY_RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(LIBRARY),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Library',
              policy: `${ORG}policies/library`,
            }),
            'note.json': note('A library note'),
          },
          permissions: {
            '*': ['read'],
            [LIBRARIAN]: ['read', 'write', 'realm-owner'],
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
    db = dbAdapter;
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
    library = result.realms.find((realm) => realm.url === LIBRARY)!;
    educationAdapter = result.realmAdapters[0];
    broadcasts = [];
    let broadcast = educationAdapter.broadcastRealmEvent.bind(educationAdapter);
    educationAdapter.broadcastRealmEvent = (event, ...rest) => {
      broadcasts.push(event.eventName);
      return broadcast(event, ...rest);
    };
  }

  async function stop() {
    setCapabilityCheckSink(undefined);
    setOperationPerfSink(undefined);
    for (let realm of [education, org, library]) {
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
    reader: () => bearer(READER, ['read']),
    teacher: () => bearer(TEACHER),
    // The session a realm renders its own cards under, reading as the
    // teacher.
    teacherRealmRender: () =>
      `Bearer ${education.createJWT(
        {
          user: TEACHER,
          realm: education.url,
          permissions: [],
          sessionRoom: `test-session-room-for-${TEACHER}`,
          realmServerURL: education.realmServerURL,
          realmAuthority: true,
        },
        '7d',
      )}`,
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  type Pair = {
    target: string | { module: string; name: string };
    operation: string;
  };

  function check(auth: string, checks: Pair[]) {
    let req = request
      .post(`${path(EDUCATION)}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON);
    return auth
      ? req.set('Authorization', auth).send({ checks })
      : req.send({ checks });
  }

  async function answers(auth: string, checks: Pair[]) {
    let response = await check(auth, checks);
    if (response.status !== 200) {
      throw new Error(
        `capability check answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { checks: CapabilityAnswer[] }).checks;
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  // The same question, asked by carrying the operation out. A read is the
  // card+json `GET` a view would make; everything else travels in the
  // envelope, which is where a write and a create are invoked from.
  async function invocation(auth: string | undefined, pair: Pair) {
    let withAuth = (req: Test) => (auth ? req.set('Authorization', auth) : req);
    let realm =
      typeof pair.target === 'string' && pair.target.startsWith(LIBRARY)
        ? LIBRARY
        : EDUCATION;
    if (typeof pair.target !== 'string') {
      return await withAuth(
        request
          .post(`${path(realm)}_operations`)
          .set('Accept', SupportedMimeType.BoxelOperations)
          .set('Content-Type', SupportedMimeType.BoxelOperations),
      ).send(
        JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': pair.operation,
              data: {
                type: 'card',
                attributes: { title: 'A new one', body: 'A new one' },
                meta: {
                  adoptsFrom: {
                    module: rri(pair.target.module),
                    name: pair.target.name,
                  },
                },
              },
            },
          ],
        }),
      );
    }
    if (pair.operation === 'read') {
      return await withAuth(
        request
          .get(path(pair.target))
          .set('Accept', SupportedMimeType.CardJson),
      );
    }
    return await withAuth(
      request
        .post(`${path(realm)}_operations`)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations),
    ).send(
      JSON.stringify({
        'boxel:operations': [
          {
            op: 'invoke',
            'boxel:name': pair.operation,
            href: pair.target,
            ...(pair.operation === 'rename'
              ? { data: { title: 'Renamed' } }
              : {}),
            ...(pair.operation === 'appendActivity'
              ? { data: { note: 'A note' } }
              : {}),
          },
        ],
      }),
    );
  }

  async function invoke(
    auth: string | undefined,
    pair: Pair,
  ): Promise<boolean> {
    return (await invocation(auth, pair)).status === 200;
  }

  module('ordering', function () {
    test('a caller the realm ACL allows is answered without the policy', async function (assert) {
      let given = await answers(AUTH.admin(), [
        { target: ROOM_205, operation: 'read' },
        { target: ROOM_205, operation: 'rename' },
        { target: NOTE, operation: 'delete' },
        { target: BULLETIN, operation: 'create' },
      ]);
      assert.deepEqual(
        given.map((answer) => answer.allowed),
        [true, true, true, true],
        'the ACL allows the admin every one of them',
      );
      assert.notOk(
        given.some((answer) => answer.conditional),
        'and none of them is left to a predicate',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 0,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
          snapshotReads: 0,
          ancestorDefinitionReads: 0,
          lockedTypeReads: 0,
        },
        'the gate did nothing for any of them',
      );
      assert.strictEqual(
        education.__testOnlyPolicyCacheStats().compiles,
        0,
        'and the policy was never compiled',
      );
    });

    test('a reader is answered from the ACL for a read and from the policy for a write', async function (assert) {
      // The reader may read the realm and not write it. `rename` is granted on
      // Classroom outright, `update` is granted on it by no rule, so the ACL
      // alone would refuse both and only the policy can tell them apart.
      let given = await answers(AUTH.reader(), [
        { target: ROOM_205, operation: 'read' },
        { target: ROOM_205, operation: 'rename' },
        { target: ROOM_205, operation: 'update' },
      ]);
      assert.deepEqual(
        given.map((answer) => answer.allowed),
        [true, true, false],
        'the reader may read the classroom, rename it by grant, and not update it',
      );
      assert.strictEqual(
        given[2].reason,
        'operation-not-permitted',
        'the update was refused by the gate',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 2,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
          snapshotReads: 0,
          ancestorDefinitionReads: 2,
          lockedTypeReads: 0,
        },
        'each write reached the policy once and the read never did',
      );
    });
  });

  module('a realm anyone may read', function () {
    function checkLibrary(auth: string | undefined, checks: Pair[]) {
      let req = request
        .post(`${path(LIBRARY)}_capabilities`)
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON);
      return (auth ? req.set('Authorization', auth) : req).send({ checks });
    }

    const PAIRS: Pair[] = [
      { target: `${LIBRARY}note`, operation: 'read' },
      { target: `${LIBRARY}note`, operation: 'delete' },
    ];

    test('its writer is told they may write, though the request was judged as a read', async function (assert) {
      // A read of a world-readable realm is answered from `*` alone, which
      // would leave the check nothing to tell a writer from anyone else by.
      let response = await checkLibrary(
        `Bearer ${createJWT(library, LIBRARIAN, ['read', 'write', 'realm-owner'])}`,
        PAIRS,
      );
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        (response.body as { checks: CapabilityAnswer[] }).checks.map(
          (answer) => answer.allowed,
        ),
        [true, true],
        'the librarian may read the note and delete it',
      );
    });

    test('anyone else may read and not write', async function (assert) {
      let response = await checkLibrary(undefined, PAIRS);
      assert.strictEqual(
        response.status,
        200,
        'the check is askable anonymously',
      );
      assert.deepEqual(
        (response.body as { checks: CapabilityAnswer[] }).checks.map(
          (answer) => answer.allowed,
        ),
        [true, false],
        'the ACL lets anyone read the note and nobody but its writer delete it',
      );
    });
  });

  module('a realm anyone may read, with a policy', function () {
    function checkLibrary(auth: string | undefined, checks: Pair[]) {
      let req = request
        .post(`${path(LIBRARY)}_capabilities`)
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON);
      return (auth ? req.set('Authorization', auth) : req).send({ checks });
    }

    test('a write is answered as its invocation is, signed in or not', async function (assert) {
      // The Library's policy lets anyone signed in delete its cards. A caller
      // who authenticated nobody may read the realm, and their write is
      // refused before it is routed, so no policy ever judges it.
      let pair = { target: LIBRARY_NOTE, operation: 'delete' };

      let anonymous = await checkLibrary(undefined, [pair]);
      assert.deepEqual(
        (anonymous.body as { checks: CapabilityAnswer[] }).checks,
        [{ ...pair, allowed: false, reason: 'actor-required' }],
        'the anonymous caller is refused the delete',
      );
      assert.false(
        await invoke(undefined, pair),
        'as the anonymous delete itself is refused',
      );

      // A session's token carries the caller's effective permissions, which on
      // a realm anyone may read include that read.
      let stranger = `Bearer ${createJWT(library, COLLEAGUE, ['read'])}`;
      let signedIn = await checkLibrary(stranger, [pair]);
      assert.deepEqual(
        (signedIn.body as { checks: CapabilityAnswer[] }).checks,
        [{ ...pair, allowed: true }],
        'a signed-in caller the ACL declines is admitted by the policy',
      );
      assert.true(
        await invoke(stranger, pair),
        'as their delete itself is admitted',
      );
    });
  });

  module('pair for pair', function () {
    // Checked in one request, then carried out one at a time, and compared.
    // The writes name targets no other pair reads, and the one that removes a
    // card comes last, so carrying out a pair cannot change what a later one
    // is answered. Each list holds pairs the gate admits and pairs it refuses,
    // since a list where every answer is the same would agree with a check
    // that always answered that.
    async function assertPairForPair(
      assert: Assert,
      auth: string,
      pairs: Pair[],
    ) {
      let given = await answers(auth, pairs);
      assert.notOk(
        given.some((answer) => answer.conditional),
        'every pair names a stored card or a type granted outright, so none is left to a predicate',
      );
      // Both lists are built before either is compared, so a disagreement
      // reports which pair disagreed rather than stopping at the first.
      let carried: boolean[] = [];
      for (let pair of pairs) {
        carried.push(await invoke(auth, pair));
      }
      assert.deepEqual(
        given.map((answer, index) => ({
          pair: label(pairs[index]),
          allowed: answer.allowed,
        })),
        pairs.map((pair, index) => ({
          pair: label(pair),
          allowed: carried[index],
        })),
        'the check and the invocation agree, pair for pair',
      );
      assert.true(
        given.some((answer) => answer.allowed),
        'and the list covers a pair the gate admits',
      );
      assert.true(
        given.some((answer) => !answer.allowed),
        'and one it refuses',
      );
    }

    test('for a caller who may not read the realm', async function (assert) {
      await assertPairForPair(assert, AUTH.teacher(), [
        { target: ROOM_204, operation: 'read' },
        { target: ROOM_205, operation: 'read' },
        { target: NOTE, operation: 'read' },
        { target: ABSENT, operation: 'read' },
        { target: BULLETIN_1, operation: 'read' },
        { target: ROOM_204, operation: 'update' },
        { target: HOMEROOM, operation: 'rename' },
        { target: ROOM_204, operation: 'appendActivity' },
        { target: BULLETIN_1, operation: 'delete' },
        { target: BULLETIN, operation: 'create' },
        // Writes whose grant rests on a predicate over the card, which the
        // check judges against the card as stored and the invocation under
        // the write lock.
        { target: ROOM_205, operation: 'delete' },
        { target: ROOM_204, operation: 'delete' },
      ]);
    });

    test('for a caller who may read the realm and not write it', async function (assert) {
      // No absent card here: a reader may read the realm, so a read of a card
      // that is not there is one the ACL admits, and it fails for want of the
      // card rather than of permission.
      await assertPairForPair(assert, AUTH.reader(), [
        { target: ROOM_205, operation: 'read' },
        { target: NOTE, operation: 'read' },
        { target: ROOM_204, operation: 'update' },
        { target: HOMEROOM, operation: 'rename' },
        { target: ROOM_204, operation: 'appendActivity' },
        { target: BULLETIN_1, operation: 'delete' },
        { target: BULLETIN, operation: 'create' },
        { target: ROOM_205, operation: 'delete' },
        { target: ROOM_207, operation: 'delete' },
      ]);
    });

    test('a write whose grant rests on a predicate is judged against the card as stored', async function (assert) {
      let [taught, untaught] = await answers(AUTH.reader(), [
        { target: ROOM_207, operation: 'delete' },
        { target: ROOM_205, operation: 'delete' },
      ]);
      assert.deepEqual(
        { ...taught, target: '<target>' },
        { operation: 'delete', target: '<target>', allowed: true },
        'the reader teaches room 207, so its delete is admitted outright',
      );
      assert.deepEqual(
        { ...untaught, target: '<target>' },
        {
          operation: 'delete',
          target: '<target>',
          allowed: false,
          reason: 'operation-not-permitted',
        },
        'and does not teach room 205, so its delete is refused as the gate refuses it',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 2,
          predicateEvaluations: 2,
          pendingDischarges: 0,
          definitionLookups: 0,
          snapshotReads: 0,
          ancestorDefinitionReads: 4,
          lockedTypeReads: 4,
        },
        'each predicate was evaluated once, and neither by the path that holds the write lock',
      );
    });

    test('a write whose predicate throws is answered as the fault its invocation is', async function (assert) {
      let pair = { target: ROOM_207, operation: 'archive' };
      let [given] = await answers(AUTH.reader(), [pair]);
      assert.deepEqual(
        { ...given, target: '<target>' },
        {
          operation: 'archive',
          target: '<target>',
          allowed: false,
          reason: 'policy-predicate-failed',
        },
        'a reader is told the predicate failed, not that the gate refused them',
      );
      let response = await invocation(AUTH.reader(), pair);
      let [error] = (response.body as { errors: { code: string }[] }).errors;
      assert.deepEqual(
        { status: response.status, code: error.code },
        { status: 500, code: 'policy-predicate-failed' },
        'which is the code the archive itself answers',
      );
      let [denied, absent] = await answers(AUTH.teacher(), [
        { target: ROOM_204, operation: 'archive' },
        { target: ABSENT, operation: 'archive' },
      ]);
      assert.deepEqual(
        denied,
        { operation: 'archive', target: ROOM_204, allowed: false },
        'a caller who may not read the realm is told a bare boolean',
      );
      assert.deepEqual(
        { ...denied, target: '<target>' },
        { ...absent, target: '<target>' },
        'the same one they are told for a card that is not there',
      );
    });
  });

  module('a caller the realm ACL would not let read the realm', function () {
    test('a denied card and an absent one are answered the same', async function (assert) {
      let [denied, absent] = await answers(AUTH.teacher(), [
        { target: ROOM_205, operation: 'read' },
        { target: ABSENT, operation: 'read' },
      ]);
      assert.deepEqual(
        { ...denied, target: '<target>' },
        { ...absent, target: '<target>' },
        'the two answers differ only in the target the caller named',
      );
      assert.deepEqual(
        denied,
        { operation: 'read', target: ROOM_205, allowed: false },
        'and each is a bare boolean: no reason, no rule, nothing else',
      );
    });

    test('a write its predicate refuses answers the same as a card that is not there', async function (assert) {
      let [untaught, absent, taught] = await answers(AUTH.teacher(), [
        { target: ROOM_205, operation: 'delete' },
        { target: ABSENT, operation: 'delete' },
        { target: ROOM_204, operation: 'delete' },
      ]);
      assert.deepEqual(
        { ...untaught, target: '<target>' },
        { ...absent, target: '<target>' },
        'a classroom they do not teach and a card that does not exist differ only in the target they named',
      );
      assert.deepEqual(
        { ...taught, target: '<target>' },
        { operation: 'delete', target: '<target>', allowed: true },
        'and a classroom they teach is admitted with a bare boolean, never marked conditional',
      );
    });

    test('a caller who may read the realm is told why', async function (assert) {
      let [given] = await answers(AUTH.reader(), [
        { target: ABSENT, operation: 'rename' },
      ]);
      assert.false(given.allowed, 'the rename is refused');
      assert.ok(
        given.reason,
        'a reader can list the realm anyway, so a reason tells them nothing new',
      );
    });
  });

  module('a type target', function () {
    test('a grant with no predicate answers outright', async function (assert) {
      let [given] = await answers(AUTH.teacher(), [
        { target: BULLETIN, operation: 'create' },
      ]);
      assert.deepEqual(
        { allowed: given.allowed, conditional: given.conditional },
        { allowed: true, conditional: undefined },
        'nothing further decides a create of a Bulletin',
      );
    });

    test('a grant whose predicate reads the proposed document answers conditional', async function (assert) {
      let [reader] = await answers(AUTH.reader(), [
        { target: CLASSROOM, operation: 'create' },
      ]);
      assert.deepEqual(
        { allowed: reader.allowed, conditional: reader.conditional },
        { allowed: true, conditional: true },
        'the grant matched, and its predicate runs against whatever is submitted',
      );
      let [teacher] = await answers(AUTH.teacher(), [
        { target: CLASSROOM, operation: 'create' },
      ]);
      assert.deepEqual(
        { ...teacher, target: '<type>' },
        { operation: 'create', target: '<type>', allowed: true },
        'a caller who may not read the realm is told it bare: the control is worth showing, and it names no card',
      );
    });

    test('a type no rule names is denied', async function (assert) {
      let [given] = await answers(AUTH.teacher(), [
        {
          target: { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
          operation: 'create',
        },
      ]);
      assert.false(given.allowed, 'no rule names CardDef');
    });
  });

  module('a query', function () {
    // A query is not decided by the gate, which refuses every one: the search
    // that runs it authorizes it, by composing the caller's grants on it into
    // the query. So a query pair is compared with that search rather than with
    // an invocation, and "the check says true" is set beside "the search
    // composed a grant", which a search shows here as the classrooms the
    // teacher teaches and nothing else.
    const MINE = [HOMEROOM, ROOM_204];

    function federatedSearch(user: string, payload: object) {
      return request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user, sessionRoom: `session-room-${user}` },
            realmSecretSeed,
          )}`,
        )
        .send({ ...payload, realms: [EDUCATION] });
    }

    function realmSearch(auth: string, payload: object) {
      return request
        .post(`${path(EDUCATION)}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', auth)
        .send(payload);
    }

    // The search a pair asks about: a named query by its name and type, and
    // the ad-hoc `query` as a filter on the type.
    function searchFor(pair: Pair) {
      let on = pair.target as { module: string; name: string };
      return pair.operation === 'query'
        ? { filter: { 'item.on': on } }
        : { operation: pair.operation, on };
    }

    function ids(response: { status: number; text: string; body: unknown }) {
      if (response.status !== 200) {
        throw new Error(`search answered ${response.status}: ${response.text}`);
      }
      return (response.body as { data: { id: string }[] }).data
        .map((entry) => new URL(entry.id, EDUCATION).href)
        .sort();
    }

    test('a caller who may not read the realm is answered as the search would authorize them', async function (assert) {
      let pairs: Pair[] = [
        { target: CLASSROOM, operation: 'listMine' },
        { target: CLASSROOM, operation: 'query' },
        { target: CLASSROOM, operation: 'listAll' },
        { target: CLASSROOM, operation: 'listByLead' },
        { target: CLASSROOM, operation: 'listAudited' },
        { target: BULLETIN, operation: 'query' },
      ];
      let given = await answers(AUTH.teacher(), pairs);
      assert.deepEqual<unknown[]>(
        given,
        [
          { ...pairs[0], allowed: true },
          { ...pairs[1], allowed: true },
          { ...pairs[2], allowed: false },
          { ...pairs[3], allowed: false },
          { ...pairs[4], allowed: false },
          { ...pairs[5], allowed: false },
        ],
        'a query granted on a filter is allowed, and one no rule grants, one whose grant compiled no filter, one declared non-grantable and one on a type granted only a read are not, each as a bare boolean',
      );

      let searched: { pair: string; rows: string[] }[] = [];
      for (let pair of pairs) {
        searched.push({
          pair: label(pair),
          rows: ids(await federatedSearch(TEACHER, searchFor(pair))),
        });
      }
      assert.deepEqual(
        searched,
        pairs.map((pair, index) => ({
          pair: label(pair),
          rows: given[index].allowed ? MINE : [],
        })),
        "the federated search composes the teacher's grant exactly where the check says true, and contributes no rows where it says false",
      );
    });

    test('a caller who may read the realm is answered from the ACL, without the policy', async function (assert) {
      let given = await answers(AUTH.reader(), [
        { target: CLASSROOM, operation: 'listMine' },
        { target: CLASSROOM, operation: 'listAll' },
        { target: CLASSROOM, operation: 'query' },
      ]);
      assert.deepEqual(
        given.map((answer) => answer.allowed),
        [true, true, true],
        'the reader runs every query unscoped',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 0,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
          snapshotReads: 0,
          ancestorDefinitionReads: 0,
          lockedTypeReads: 0,
        },
        'the gate did nothing for any of them',
      );
      assert.strictEqual(
        education.__testOnlyPolicyCacheStats().compiles,
        0,
        'and the policy was never compiled',
      );
      assert.true(
        ids(
          await federatedSearch(READER, {
            operation: 'listAll',
            on: CLASSROOM,
          }),
        ).includes(ROOM_205),
        'as their search returns a classroom they do not teach',
      );
    });

    test('a card target is refused as invoking the query on the card is', async function (assert) {
      let pair = { target: ROOM_204, operation: 'listMine' };
      let [reader] = await answers(AUTH.reader(), [pair]);
      assert.deepEqual(
        reader,
        { ...pair, allowed: false, reason: 'wrong-entry-point' },
        'a reader is told a query is not invoked on a card',
      );
      let response = await invocation(AUTH.reader(), pair);
      let [error] = (response.body as { errors: { code: string }[] }).errors;
      assert.deepEqual(
        { status: response.status, code: error.code },
        { status: 400, code: 'wrong-entry-point' },
        'which is what invoking it on the card answers',
      );

      let [teacher, absent] = await answers(AUTH.teacher(), [
        pair,
        { target: ABSENT, operation: 'listMine' },
      ]);
      assert.deepEqual(
        teacher,
        { ...pair, allowed: false },
        'a caller who may not read the realm is told a bare false, though a grant on the query applies to them',
      );
      assert.deepEqual(
        { ...teacher, target: '<target>' },
        { ...absent, target: '<target>' },
        'the same one they are told for a card that is not there',
      );
      assert.false(
        await invoke(AUTH.teacher(), pair),
        'as invoking it on the card is refused',
      );
    });

    test('a request a render sends is judged as the search it sends is', async function (assert) {
      let pair = { target: CLASSROOM, operation: 'listMine' };
      let rendering = await check(AUTH.teacherRealmRender(), [pair]).set(
        DURING_PRERENDER_HEADER,
        'true',
      );
      assert.deepEqual<unknown[]>(
        (rendering.body as { checks: CapabilityAnswer[] }).checks,
        [{ ...pair, allowed: false }],
        "a realm's own render runs under the realm's own authority, which no policy grants anything",
      );
      assert.deepEqual(
        ids(
          await realmSearch(AUTH.teacherRealmRender(), searchFor(pair)).set(
            DURING_PRERENDER_HEADER,
            'true',
          ),
        ),
        [],
        'as the search it sends is served no rows',
      );
      let askedFor = await check(AUTH.teacher(), [pair]).set(
        DURING_PRERENDER_HEADER,
        'true',
      );
      assert.deepEqual<unknown[]>(
        (askedFor.body as { checks: CapabilityAnswer[] }).checks,
        [{ ...pair, allowed: true }],
        "a render a user asks for runs on that user's own session, and is judged as them",
      );
      assert.deepEqual(
        ids(
          await realmSearch(AUTH.teacher(), searchFor(pair)).set(
            DURING_PRERENDER_HEADER,
            'true',
          ),
        ),
        MINE,
        'as the search it sends is served their classrooms',
      );
      assert.deepEqual(
        (await answers(AUTH.teacher(), [pair])).map((a) => a.allowed),
        [true],
        'and so is the same session outside a render',
      );
      assert.deepEqual(
        ids(await realmSearch(AUTH.teacher(), searchFor(pair))),
        MINE,
        'and its search is served the classrooms it teaches',
      );
    });
  });

  module('the cap', function () {
    test('a request at the cap is answered and one over it is refused', async function (assert) {
      let at = Array.from({ length: CAPABILITY_CHECK_CAP }, () => ({
        target: ROOM_204,
        operation: 'read',
      }));
      assert.strictEqual(
        (await answers(AUTH.teacher(), at)).length,
        CAPABILITY_CHECK_CAP,
        'every pair at the cap is answered',
      );
      let over = await check(AUTH.teacher(), [
        ...at,
        { target: ROOM_204, operation: 'read' },
      ]);
      assert.strictEqual(
        over.status,
        400,
        'one pair past it refuses the request',
      );
      assert.true(
        over.text.includes(`at most ${CAPABILITY_CHECK_CAP} pairs`),
        'and says what the cap is, since it is part of the contract',
      );
    });

    test('the cap counts the pairs sent, so a repeat cannot get past it', async function (assert) {
      // Every pair here is the same question, which the check decides once. The
      // cap is on what the request carries regardless, because a list that is
      // cheap to answer is still a list, and counting distinct pairs would let
      // a caller send any number of them.
      let repeated = Array.from({ length: CAPABILITY_CHECK_CAP + 1 }, () => ({
        target: ROOM_204,
        operation: 'read',
      }));
      let response = await check(AUTH.teacher(), repeated);
      assert.strictEqual(response.status, 400, 'refused');
    });

    test('a body that is not a list of pairs is refused whole', async function (assert) {
      for (let body of [
        {},
        { checks: 'read' },
        { checks: [{ target: ROOM_204 }] },
      ]) {
        let response = await request
          .post(`${path(EDUCATION)}_capabilities`)
          .set('Accept', SupportedMimeType.JSON)
          .set('Content-Type', SupportedMimeType.JSON)
          .set('Authorization', AUTH.teacher())
          .send(body);
        assert.strictEqual(
          response.status,
          400,
          `refused: ${JSON.stringify(body)}`,
        );
      }
    });
  });

  module('a check decides and does nothing else', function () {
    async function indexJobCount() {
      let rows = (await db.execute(
        `select count(*) as count from jobs
           where concurrency_group = $1 or lane_family = $1`,
        { bind: [`indexing:${EDUCATION}`] },
      )) as { count: number | string }[];
      return Number(rows[0].count);
    }

    async function bytesOf(url: string) {
      let response = await request
        .get(`${path(url)}.json`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', AUTH.admin());
      return response.text;
    }

    test('nothing is staged, no index job is enqueued and no realm event is broadcast', async function (assert) {
      let watched = [ROOM_204, HOMEROOM, BULLETIN_1, BULLETIN_2];
      let before = await Promise.all(watched.map(bytesOf));
      let jobsBefore = await indexJobCount();
      broadcasts.length = 0;

      // Every lane a check can reach, including the ones it answers yes to:
      // a pair answered `true` is the one that would have written if anything
      // here could.
      await answers(AUTH.teacher(), [
        { target: ROOM_204, operation: 'read' },
        { target: HOMEROOM, operation: 'rename' },
        { target: ROOM_204, operation: 'appendActivity' },
        { target: BULLETIN_1, operation: 'delete' },
        { target: ROOM_204, operation: 'delete' },
        { target: BULLETIN, operation: 'create' },
        { target: CLASSROOM, operation: 'create' },
      ]);

      assert.deepEqual(
        await Promise.all(watched.map(bytesOf)),
        before,
        'every card it was asked about is byte-for-byte what it was',
      );
      assert.strictEqual(
        await indexJobCount(),
        jobsBefore,
        'no index job was enqueued',
      );
      assert.deepEqual(broadcasts, [], 'and no realm event was broadcast');
      assert.strictEqual(
        gateStats().pendingDischarges,
        0,
        'and the delete it judged against its predicate never reached the write lock',
      );

      // The positive control. The same operations, carried out, move all three
      // — so the zeros above are an observation rather than an instrument that
      // was never connected.
      assert.true(
        await invoke(AUTH.teacher(), {
          target: HOMEROOM,
          operation: 'rename',
        }),
        'the rename the check answered yes to does land when it is invoked',
      );
      await education.indexing();
      assert.notStrictEqual(
        await bytesOf(HOMEROOM),
        before[1],
        'the invocation changed the card the check left alone',
      );
      assert.true(
        (await indexJobCount()) > jobsBefore,
        'the invocation enqueued an index job the check did not',
      );
      assert.true(
        broadcasts.length > 0,
        'and broadcast a realm event the check did not',
      );
      assert.true(
        await invoke(AUTH.teacher(), {
          target: ROOM_204,
          operation: 'delete',
        }),
        'the delete the check judged is admitted when it is invoked',
      );
      assert.strictEqual(
        gateStats().pendingDischarges,
        1,
        'by the write lock deciding its predicate, which the check never did',
      );
    });
  });

  module('telemetry', function () {
    test('a check is recorded distinctly from an execution', async function (assert) {
      let checks: CapabilityCheckEvent[] = [];
      let executions: OperationPerfEvent[] = [];
      setCapabilityCheckSink((event) => checks.push(event));
      setOperationPerfSink((event) => executions.push(event));

      await answers(AUTH.teacher(), [
        { target: ROOM_204, operation: 'read' },
        { target: ROOM_205, operation: 'read' },
        { target: ROOM_204, operation: 'delete' },
      ]);

      assert.strictEqual(
        checks.length,
        1,
        'one line per request, not per pair',
      );
      assert.deepEqual(
        {
          kind: checks[0].kind,
          realmURL: checks[0].realmURL,
          actor: checks[0].actor,
          coarseDeclined: checks[0].coarseDeclined,
          pairs: checks[0].pairs,
          allowed: checks[0].allowed,
          conditional: checks[0].conditional,
          denied: checks[0].denied,
        },
        {
          kind: 'capability-check',
          realmURL: EDUCATION,
          actor: TEACHER,
          coarseDeclined: 'all',
          pairs: 3,
          allowed: 2,
          conditional: 0,
          denied: 1,
        },
        'the counts describe the request, and nothing names which cards it asked about',
      );
      assert.notOk(
        JSON.stringify(checks[0]).includes('room-204'),
        'a line naming the cards would put back on the record what the bare ' +
          'boolean keeps off the wire',
      );
      assert.deepEqual(
        executions,
        [],
        'and no execution was recorded, so the gate-reach panel sees nothing',
      );

      // The tag is what separates them, so an execution is shown to carry a
      // different one rather than assumed to.
      await invoke(AUTH.teacher(), { target: HOMEROOM, operation: 'rename' });
      assert.true(executions.length > 0, 'an invocation records an execution');
      assert.notOk(
        (executions[0] as unknown as { kind?: string }).kind,
        'which carries no `kind`, so filtering on it excludes checks alone',
      );
    });
  });
});

function label(pair: {
  target: string | { module: string; name: string };
  operation: string;
}) {
  return typeof pair.target === 'string'
    ? `${pair.operation} ${pair.target}`
    : `${pair.operation} ${pair.target.name}`;
}
