import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  setCapabilityCheckSink,
  setPolicyCompileSink,
  setPolicyDecisionSink,
  setPolicySearchScopeSink,
  setPolicySnapshotReadSink,
  type CapabilityCheckEvent,
  type PolicyCompileEvent,
  type PolicyDecisionEvent,
  type PolicySearchScopeEvent,
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
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// The records the policy writes on `boxel:operations`: one per gate decision,
// one per realm a search consults through its policy, and one per compile of
// a realm's policy.
//
// The Education realm holds the cards and its policy card lives in the Org
// realm. A teacher holds no permission on Education, so every request of
// theirs reaches the policy. A reader may read Education and not write it. An
// IT admin reads both realms, so they may ask the policy what it decides. The
// Org realm names a policy too, which grants nothing a search asks for, and
// the Annex realm names one that is not there.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const ANNEX = 'http://127.0.0.1:4444/annex/';
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
const NOTICE = { module: `${EDUCATION}notice`, name: 'Notice' };

// A classroom's head teacher is the first id on its roster, computed, so only
// the index holds it.
const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field headTeacher = contains(StringField, {
      computeVia: function (this: Classroom) {
        return this.teacherIds?.[0];
      },
    });

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
  import { operation } from "@cardstack/base/operations";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
    @field authorIds = containsMany(StringField);

    @operation static mine = {
      base: 'query',
      query: { filter: { type: () => Bulletin } },
    };
  }
`;

const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Notice extends CardDef {
    @field body = contains(StringField);
  }
`;

const HEADS = { bxl: '.headTeacher == actor()', snapshot: true };
const AUTHORS = '.authorIds | any(. == actor())';
// Throws for a notice whose body is not a number.
const NUMERIC_BODY = '(.body | tonumber) > 0';

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// A classroom is read and renamed by its head teacher, judged against the
// snapshot. A bulletin is read, deleted, read as stored bytes and found by a
// search by its authors, judged against its stored source. A notice is read
// by a predicate that throws for every notice here.
const RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: HEADS },
      { operation: 'rename', where: HEADS },
    ],
  },
  {
    targetType: BULLETIN,
    grants: [
      { operation: 'read', where: AUTHORS },
      { operation: 'delete', where: AUTHORS },
      { operation: 'readSource', where: AUTHORS },
      { operation: 'mine', where: AUTHORS },
    ],
  },
  {
    targetType: NOTICE,
    grants: [{ operation: 'read', where: NUMERIC_BODY }],
  },
];

// The Org realm's own policy grants a read of a bulletin and no search.
const ORG_RULES: Rule[] = [
  { targetType: BULLETIN, grants: [{ operation: 'read' }] },
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

function card(module: string, name: string, attributes: object) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom: { module, name } } },
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

// Room 1's head teacher is the teacher. Room 3's is a colleague.
const ROOM_1 = `${EDUCATION}classrooms/room-1`;
const ROOM_3 = `${EDUCATION}classrooms/room-3`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;
const NOTICE_1 = `${EDUCATION}notices/n1`;

// Card content and predicate source, none of which any record may carry.
const NEVER_RECORDED = [
  'Picture day',
  'Room 1',
  'Room 3',
  'Fire drill',
  'actor()',
  'tonumber',
  'headTeacher',
  'authorIds',
];

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let annex: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let decisions: PolicyDecisionEvent[];
  let searches: PolicySearchScopeEvent[];
  let compiles: PolicyCompileEvent[];
  let checks: CapabilityCheckEvent[];
  let snapshotReads: PolicySnapshotReadEvent[];

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
            'notice.gts': NOTICE_MODULE,
            'classrooms/room-1.json': card('../classroom', 'Classroom', {
              title: 'Room 1',
              teacherIds: [TEACHER],
            }),
            'classrooms/room-3.json': card('../classroom', 'Classroom', {
              title: 'Room 3',
              teacherIds: [COLLEAGUE],
            }),
            'bulletins/b1.json': card('../bulletin', 'Bulletin', {
              body: 'Picture day is Friday',
              authorIds: [TEACHER],
            }),
            'notices/n1.json': card('../notice', 'Notice', {
              body: 'Fire drill',
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
            'realm.json': realmConfigCardJSON({
              name: 'Org',
              policy: `${ORG}policies/org`,
            }),
            'policies/education.json': policyCard(RULES),
            'policies/org.json': policyCard(ORG_RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(ANNEX),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Annex',
              policy: `${ORG}policies/missing`,
            }),
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    let realmAt = (url: string) =>
      result.realms.find((realm) => realm.url === url)!;
    education = realmAt(EDUCATION);
    org = realmAt(ORG);
    annex = realmAt(ANNEX);
  }

  function clearSinks() {
    setPolicyDecisionSink(undefined);
    setPolicySearchScopeSink(undefined);
    setPolicyCompileSink(undefined);
    setCapabilityCheckSink(undefined);
    setPolicySnapshotReadSink(undefined);
  }

  async function stop() {
    clearSinks();
    for (let realm of [education, org, annex]) {
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
      decisions = [];
      searches = [];
      compiles = [];
      checks = [];
      snapshotReads = [];
      setPolicyDecisionSink((event) => decisions.push(event));
      setPolicySearchScopeSink((event) => searches.push(event));
      setPolicyCompileSink((event) => compiles.push(event));
      setCapabilityCheckSink((event) => checks.push(event));
      setPolicySnapshotReadSink((event) => snapshotReads.push(event));
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

  function federatedSearch(user: string, realms: string[]) {
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
      .send({
        operation: 'mine',
        on: BULLETIN,
        realms,
        fields: { entry: ['item'] },
      });
  }

  // The fields a test pins, leaving out the ones that vary run to run.
  function settled(event: PolicyDecisionEvent) {
    let { evaluationMs: _e, predicateMs: _p, ...rest } = event;
    return rest;
  }

  function assertNothingRecordedFromContent(assert: Assert) {
    let recorded = JSON.stringify([
      ...decisions,
      ...searches,
      ...compiles,
      ...checks,
      ...snapshotReads,
    ]);
    for (let text of NEVER_RECORDED) {
      assert.notOk(recorded.includes(text), `no record carries "${text}"`);
    }
  }

  test('a denial names the rules and grants it was judged by', async function (assert) {
    let response = await getCard(ROOM_3, AUTH.teacher());
    assert.strictEqual(response.status, 404, 'a non-reader is told not found');
    assert.strictEqual(decisions.length, 1, 'one record for one read');
    assert.deepEqual(settled(decisions[0]), {
      kind: 'policy-decision',
      realmURL: EDUCATION,
      actor: TEACHER,
      operation: 'read',
      base: 'read',
      targetType: decisions[0].targetType,
      transport: 'card-json',
      route: 'GET',
      coarseDeclined: 'all',
      decidedAt: 'gate',
      outcome: 'deny',
      reason: 'predicate',
      rule: null,
      grant: null,
      rules: 'rules[0]',
      grants: 'rules[0].grants[0]',
      tier: 'snapshot',
      predicates: 1,
      hypothetical: false,
    });
    assert.ok(
      decisions[0].targetType?.endsWith('classroom/Classroom'),
      `the type it was matched on: ${decisions[0].targetType}`,
    );
    assert.ok(decisions[0].evaluationMs >= decisions[0].predicateMs);
    assertNothingRecordedFromContent(assert);
  });

  test('an allow names the rule and grant that admitted it', async function (assert) {
    let response = await getCard(BULLETIN_1, AUTH.teacher());
    assert.strictEqual(response.status, 200);
    assert.strictEqual(decisions.length, 1);
    let [decision] = decisions;
    assert.strictEqual(decision.outcome, 'allow');
    assert.strictEqual(decision.reason, 'granted');
    assert.strictEqual(decision.rule, 'rules[1]');
    assert.strictEqual(decision.grant, 'rules[1].grants[0]');
    assert.strictEqual(decision.tier, 'stored');
    assert.strictEqual(decision.predicates, 1);
    assert.false(decision.hypothetical);
    assertNothingRecordedFromContent(assert);
  });

  test('a grant judged against the snapshot is recorded as a snapshot read and a snapshot-tier decision', async function (assert) {
    let response = await getCard(ROOM_1, AUTH.teacher());
    assert.strictEqual(response.status, 200);
    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].outcome, 'allow');
    assert.strictEqual(decisions[0].grant, 'rules[0].grants[0]');
    assert.strictEqual(decisions[0].tier, 'snapshot');
    assert.deepEqual(
      snapshotReads.map(({ grant, decidedAt, outcome, hypothetical }) => ({
        grant,
        decidedAt,
        outcome,
        hypothetical,
      })),
      [
        {
          grant: 'rules[0].grants[0]',
          decidedAt: 'gate',
          outcome: 'held',
          hypothetical: false,
        },
      ],
    );
  });

  test('a predicate fault is recorded as an error although a non-reader is told 404', async function (assert) {
    let response = await getCard(NOTICE_1, AUTH.teacher());
    assert.strictEqual(response.status, 404);
    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].outcome, 'error');
    assert.strictEqual(decisions[0].reason, 'predicate-threw');
    assert.strictEqual(decisions[0].grants, 'rules[2].grants[0]');
    assertNothingRecordedFromContent(assert);
  });

  test('a caller the realm ACL allowed records no decision', async function (assert) {
    assert.strictEqual((await getCard(BULLETIN_1, AUTH.admin())).status, 200);
    assert.strictEqual((await getCard(ROOM_3, AUTH.reader())).status, 200);
    assert.strictEqual(
      (
        await operations(
          EDUCATION,
          AUTH.admin(),
          'post',
          invoke('rename', { href: ROOM_3, data: { title: 'Room 3b' } }),
        )
      ).status,
      200,
    );
    assert.deepEqual(decisions, [], 'the gate never ran');
  });

  test('an envelope read is decided and recorded once', async function (assert) {
    let response = await operations(
      EDUCATION,
      AUTH.teacher(),
      'query',
      invoke('read', { href: BULLETIN_1 }),
    );
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      decisions.map(({ transport, route, outcome, grant }) => ({
        transport,
        route,
        outcome,
        grant,
      })),
      [
        {
          transport: 'envelope',
          route: '_operations',
          outcome: 'allow',
          grant: 'rules[1].grants[0]',
        },
      ],
    );
    assert.strictEqual(
      education.__testOnlyPolicyGateStats().predicateEvaluations,
      1,
      'its predicate ran once',
    );
  });

  test('a read of stored bytes names the byte route', async function (assert) {
    let response = await request
      .get(`${path(BULLETIN_1)}.json`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', AUTH.teacher());
    assert.strictEqual(response.status, 200);
    assert.deepEqual(
      decisions.map(({ transport, route, base, outcome, grant }) => ({
        transport,
        route,
        base,
        outcome,
        grant,
      })),
      [
        {
          transport: 'byte-route',
          route: 'source',
          base: 'readSource',
          outcome: 'allow',
          grant: 'rules[1].grants[2]',
        },
      ],
    );
  });

  test('a write left to the lock is recorded pending at the gate and decided under the lock', async function (assert) {
    let response = await request
      .delete(path(BULLETIN_1))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', AUTH.teacher());
    assert.ok(response.status < 300, `the delete answered ${response.status}`);
    assert.deepEqual(
      decisions.map(
        ({ transport, route, decidedAt, outcome, base, grant, grants }) => ({
          transport,
          route,
          decidedAt,
          outcome,
          base,
          grant,
          grants,
        }),
      ),
      [
        {
          transport: 'card-json',
          route: 'DELETE',
          decidedAt: 'gate',
          outcome: 'pending',
          base: 'delete',
          grant: null,
          grants: 'rules[1].grants[1]',
        },
        {
          transport: 'card-json',
          route: 'DELETE',
          decidedAt: 'lock',
          outcome: 'allow',
          base: 'delete',
          grant: 'rules[1].grants[1]',
          grants: 'rules[1].grants[1]',
        },
      ],
    );

    decisions.length = 0;
    response = await operations(
      EDUCATION,
      AUTH.teacher(),
      'post',
      invoke('rename', { href: ROOM_3, data: { title: 'Room 3c' } }),
    );
    assert.notStrictEqual(response.status, 200, 'not the head teacher');
    assert.deepEqual(
      decisions.map(({ transport, decidedAt, outcome, reason, tier }) => ({
        transport,
        decidedAt,
        outcome,
        reason,
        tier,
      })),
      [
        {
          transport: 'envelope',
          decidedAt: 'gate',
          outcome: 'pending',
          reason: 'pending',
          tier: 'none',
        },
        {
          transport: 'envelope',
          decidedAt: 'lock',
          outcome: 'deny',
          reason: 'predicate',
          tier: 'snapshot',
        },
      ],
    );
    assertNothingRecordedFromContent(assert);
  });

  test('a capability check records its own line and no decision', async function (assert) {
    let response = await request
      .post(`${path(EDUCATION)}_capabilities`)
      .set('Accept', SupportedMimeType.JSON)
      .set('Content-Type', SupportedMimeType.JSON)
      .set('Authorization', AUTH.teacher())
      .send({
        checks: [
          { target: ROOM_1, operation: 'read' },
          { target: ROOM_3, operation: 'read' },
          { target: BULLETIN, operation: 'mine' },
        ],
      });
    assert.strictEqual(response.status, 200);
    assert.deepEqual(decisions, [], 'no decision record');
    assert.deepEqual(searches, [], 'no search-lane record');
    assert.deepEqual(snapshotReads, [], 'no snapshot read');
    assert.deepEqual(
      checks.map(({ kind, pairs }) => ({ kind, pairs })),
      [{ kind: 'capability-check', pairs: 3 }],
    );
  });

  test('an explain records only hypothetical decisions', async function (assert) {
    let response = await operations(
      ORG,
      bearer(org, IT_ADMIN, ['read']),
      'query',
      invoke('explain', {
        href: POLICY_CARD,
        data: { actor: TEACHER, target: ROOM_3, operation: 'read' },
      }),
    );
    assert.strictEqual(response.status, 200, response.text);
    assert.ok(decisions.length > 0, 'the explain ran the gate');
    assert.deepEqual(
      decisions.map(({ hypothetical, transport, actor }) => ({
        hypothetical,
        transport,
        actor,
      })),
      decisions.map(() => ({
        hypothetical: true,
        transport: 'explain',
        actor: TEACHER,
      })),
    );
    assert.ok(
      snapshotReads.every(({ hypothetical }) => hypothetical),
      'its snapshot reads are hypothetical too',
    );
  });

  test('a federated search records one search-lane line per realm it consults through a policy', async function (assert) {
    let response = await federatedSearch(TEACHER, [EDUCATION, ORG, ANNEX]);
    assert.strictEqual(response.status, 200, response.text);
    let byRealm = Object.fromEntries(
      searches.map(({ realmURL, ...rest }) => [realmURL, rest]),
    );
    assert.deepEqual(Object.keys(byRealm).sort(), [ANNEX, EDUCATION, ORG]);
    assert.deepEqual(
      {
        outcome: byRealm[EDUCATION].outcome,
        rules: byRealm[EDUCATION].rules,
        grants: byRealm[EDUCATION].grants,
      },
      { outcome: 'scoped', rules: 'rules[1]', grants: 'rules[1].grants[3]' },
    );
    assert.strictEqual(byRealm[ORG].outcome, 'none');
    assert.strictEqual(byRealm[ORG].grants, '');
    assert.strictEqual(byRealm[ANNEX].outcome, 'failed');
    for (let event of searches) {
      assert.strictEqual(event.transport, 'federated-search');
      assert.strictEqual(event.operation, 'mine');
      assert.strictEqual(event.actor, TEACHER);
      assert.false(event.hypothetical);
      assert.ok(event.types.endsWith('bulletin/Bulletin'), event.types);
    }
    assert.deepEqual(decisions, [], 'a search passes no gate');
    assertNothingRecordedFromContent(assert);
  });

  test("a realm's search records its search-lane line", async function (assert) {
    let response = await request
      .post(`${path(EDUCATION)}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Authorization', AUTH.teacher())
      .send({ operation: 'mine', on: BULLETIN, fields: { entry: ['item'] } });
    assert.strictEqual(response.status, 200, response.text);
    assert.deepEqual(
      searches.map(({ realmURL, transport, outcome, grants }) => ({
        realmURL,
        transport,
        outcome,
        grants,
      })),
      [
        {
          realmURL: EDUCATION,
          transport: 'search',
          outcome: 'scoped',
          grants: 'rules[1].grants[3]',
        },
      ],
    );
  });

  test('a policy that did not compile is recorded as it compiles and as it refuses', async function (assert) {
    let response = await request
      .get(`${path(ANNEX)}anything`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', bearer(annex, TEACHER));
    assert.strictEqual(response.status, 500);
    assert.deepEqual(
      compiles
        .filter(({ realmURL }) => realmURL === ANNEX)
        .map(({ outcome, uncompilable, rules }) => ({
          outcome,
          uncompilable,
          rules,
        })),
      [{ outcome: 'compiled', uncompilable: true, rules: 0 }],
    );
    assert.deepEqual(
      decisions.map(({ realmURL, outcome, reason, base }) => ({
        realmURL,
        outcome,
        reason,
        base,
      })),
      [
        {
          realmURL: ANNEX,
          outcome: 'error',
          reason: 'policy-unavailable',
          base: null,
        },
      ],
    );

    await getCard(BULLETIN_1, AUTH.teacher());
    let [compiled] = compiles.filter(({ realmURL }) => realmURL === EDUCATION);
    assert.deepEqual(
      {
        card: compiled.card,
        outcome: compiled.outcome,
        uncompilable: compiled.uncompilable,
        rules: compiled.rules,
        grants: compiled.grants,
      },
      {
        card: POLICY_CARD,
        outcome: 'compiled',
        uncompilable: false,
        rules: 3,
        grants: 7,
      },
    );
    assert.ok(compiled.durationMs >= 0);
  });
});
