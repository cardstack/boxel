import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  CompiledRealmPolicy,
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
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// ============================================================================
// What a compiled policy tells its author about the cards a grant hands over
// beyond the ones it names.
//
// A grant covers the whole representation of the rows it admits, and under the
// `full` link strategy that is the row's link closure too. So granting `read`
// on `Classroom` hands every caller it admits the students a classroom links
// to, and the guardians those link to. Nothing fails when that reaches further
// than the author meant, so the compile records it as a warning on the grant,
// and the grant stays live.
//
// The Education realm holds the types. The policy card lives in an Org realm,
// and each test writes the rules it needs into it. A teacher holds no
// permission on the Education realm, so each of their requests is judged by
// the policy.
// ============================================================================

const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const type = (module: string, name: string) => ({
  module: `${EDUCATION}${module}`,
  name,
});
const CLASSROOM = type('classroom', 'Classroom');
const IDS_CLASSROOM = type('classroom', 'IdsClassroom');
const HONORS_BOARD = type('classroom', 'HonorsBoard');
const EXCURSION = type('classroom', 'Excursion');
const LEDGER = type('classroom', 'Ledger');
const NOTICEBOARD = type('classroom', 'Noticeboard');
const STUDENT = type('student', 'Student');
const GUARDIAN = type('student', 'Guardian');
// `Student` as a module that re-exports it names it.
const SCHOOL_STUDENT = type('school', 'Student');

const TEACHES = '.teacherIds | any(. == actor())';

function studentModule({ withGuardian }: { withGuardian: boolean }) {
  return `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    export class Guardian extends CardDef {
      @field phone = contains(StringField);
    }
    export class Student extends CardDef {
      @field name = contains(StringField);
      ${withGuardian ? '@field guardian = linksTo(() => Guardian);' : ''}
    }
  `;
}

// `Classroom` links to its students, who link to their guardians. Its two
// named queries differ only in what their `links` declares. `IdsClassroom`
// has the same links, and narrows its own `read`.
//
// `HonorsBoard` reaches students only through a query-backed field, and
// `Excursion` reaches guardians only through a field it contains. `Ledger`
// links to authorization infrastructure: a policy card and a realm config
// card. `Noticeboard` pins a card of any type.
const CLASSROOM_MODULE = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, FieldDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  import { RealmConfig } from "@cardstack/base/realm-config";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";
  import { Guardian, Student } from "./student";

  function allClassrooms() {
    return { filter: { type: () => Classroom } };
  }

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field students = linksToMany(() => Student);

    @operation static listFull = { base: 'query', query: allClassrooms() };
    @operation static listIds = {
      base: 'query',
      query: allClassrooms(),
      links: 'ids',
    };
  }

  export class IdsClassroom extends Classroom {
    @operation static read = { base: 'read', links: 'ids' };
  }

  export class HonorsBoard extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field honorRoll = linksToMany(() => Student, {
      query: {
        filter: { eq: { name: 'Ada' } },
        page: { size: 10, number: 0 },
      },
    });
  }

  export class Contact extends FieldDef {
    @field guardian = linksTo(() => Guardian);
  }

  export class Excursion extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field emergency = contains(Contact);
  }

  export class Ledger extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field policy = linksTo(() => RealmPolicy);
    @field settings = linksTo(() => RealmConfig);
  }

  export class Noticeboard extends CardDef {
    @field teacherIds = containsMany(StringField);
    @field pinned = linksTo(() => CardDef);
  }
`;

const SCHOOL_MODULE = `
  export { Student } from "./student";
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function rule(targetType: Rule['targetType'], ...operations: string[]): Rule {
  return {
    targetType,
    grants: operations.map((operation) => ({ operation, where: TEACHES })),
  };
}

function card(
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: { adoptsFrom },
    },
  });
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ADA = `${EDUCATION}students/ada`;

type Issue = CompiledRealmPolicy['issues'][number];
const REACH_CODES = [
  'grant-reaches-ungranted-type',
  'render-reaches-ungranted-type',
];

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
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
            'student.gts': studentModule({ withGuardian: true }),
            'classroom.gts': CLASSROOM_MODULE,
            'school.gts': SCHOOL_MODULE,
            'students/ada.json': card(
              { module: '../student', name: 'Student' },
              { name: 'Ada' },
            ),
            'classrooms/room-204.json': card(
              { module: '../classroom', name: 'Classroom' },
              { title: 'Room 204', teacherIds: [TEACHER] },
              { 'students.0': { links: { self: '../students/ada' } } },
            ),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard([]),
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

  // Every test boots both realms in its `beforeEach`, which indexes them and
  // runs inside the test's own budget, so that budget is extended past the
  // per-test timeout.
  hooks.beforeEach(function (assert) {
    assert.timeout(180_000);
  });

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
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

  async function writeTo(realm: Realm, path: string, contents: string) {
    await realm.write(path, contents);
    await realm.indexing();
  }

  // The policy these rules compile to.
  async function compile(rules: Rule[]): Promise<CompiledRealmPolicy> {
    await writeTo(org, 'policies/education.json', policyCard(rules));
    let policy = await education.getCompiledPolicy();
    if (!policy) {
      throw new Error('the Education realm names no policy');
    }
    return policy;
  }

  function reachIssues(policy: CompiledRealmPolicy): Issue[] {
    return policy.issues.filter((issue) => REACH_CODES.includes(issue.code));
  }

  // Each reach issue as the code, the grant it is on, and the type it names,
  // which is the last type the message mentions before its fix.
  function reached(policy: CompiledRealmPolicy) {
    return reachIssues(policy).map(({ code, path, message }) => ({
      code,
      path,
      via: /linked through `([^`]+)`/.exec(message)?.[1],
    }));
  }

  test('a read grant whose full closure reaches an ungranted type records it, naming both types and the path between them', async function (assert) {
    let policy = await compile([rule(CLASSROOM, 'read')]);
    assert.deepEqual(
      reached(policy),
      [
        {
          code: 'grant-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students',
        },
        {
          code: 'grant-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students.guardian',
        },
      ],
      'the students it links to, and the guardians they link to, each once',
    );
    let [student, guardian] = reachIssues(policy).map((issue) => issue.message);
    assert.true(
      /`read` on Classroom .* the Student cards linked through `students`, and no rule grants a read of Student/.test(
        student,
      ),
      `the message names the granted type, the reached type and the path: ${student}`,
    );
    assert.true(
      /the Guardian cards linked through `students\.guardian`, and no rule grants a read of Guardian/.test(
        guardian,
      ),
      `a type two links away is named with the whole path: ${guardian}`,
    );
    assert.true(
      student.includes("declare `links: 'ids'` on Classroom's `read`"),
      `the fix is named on the granted type: ${student}`,
    );
    assert.true(
      student.includes('A declaration on Student does not narrow this'),
      `and it says a declaration on the reached type is no fix: ${student}`,
    );
  });

  test('the same grant on a type whose read declares ids records nothing, since nothing is assembled', async function (assert) {
    let policy = await compile([rule(IDS_CLASSROOM, 'read')]);
    assert.deepEqual(reached(policy), []);
    assert.deepEqual(
      policy.rules[0]?.grants.map((grant) => grant.operation),
      ['read'],
      'the grant compiled',
    );
  });

  test('a closure that reaches only granted types records nothing', async function (assert) {
    // Every card links to its theme, and nothing here grants a Theme. That
    // link is on every card whatever the rule names, so it is not a reach
    // this grant's author added.
    let policy = await compile([
      rule(CLASSROOM, 'read'),
      rule(STUDENT, 'read'),
      rule(GUARDIAN, 'read'),
    ]);
    assert.deepEqual(policy.issues, [], 'the policy compiles cleanly');
  });

  test('a reached type is granted by a rule on a type it descends from', async function (assert) {
    let policy = await compile([
      rule(CLASSROOM, 'read'),
      rule(CARD_DEF, 'read'),
    ]);
    assert.deepEqual(reached(policy), []);
  });

  test('a rule that names a type through a module re-exporting it grants it', async function (assert) {
    let policy = await compile([
      rule(CLASSROOM, 'read'),
      rule(SCHOOL_STUDENT, 'read'),
      rule(GUARDIAN, 'read'),
    ]);
    assert.deepEqual(reached(policy), []);
  });

  test('a rule that lets no caller read its type does not grant it', async function (assert) {
    // A delete hands the caller no student to read, so the students the
    // classroom carries are still ones no rule hands over.
    let policy = await compile([
      rule(CLASSROOM, 'read'),
      rule(STUDENT, 'delete'),
      rule(GUARDIAN, 'read'),
    ]);
    assert.deepEqual(reached(policy), [
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'students',
      },
    ]);
  });

  test('a grant that admits nothing neither reaches nor grants', async function (assert) {
    // The gate reads a card's stored source alone, so it never evaluates a
    // predicate annotated as reading a snapshot tier, and a read whose
    // predicate is one admits nothing.
    let snapshotRead = (targetType: Rule['targetType']): Rule => ({
      targetType,
      grants: [{ operation: 'read', where: { bxl: TEACHES, snapshot: true } }],
    });
    let policy = await compile([snapshotRead(CLASSROOM)]);
    assert.deepEqual(
      policy.rules[0]?.grants.map((grant) => grant.operation),
      ['read'],
      'the grant compiles',
    );
    assert.deepEqual(
      reached(policy),
      [],
      'and hands nothing over, so nothing is walked',
    );

    policy = await compile([
      rule(CLASSROOM, 'read'),
      snapshotRead(STUDENT),
      rule(GUARDIAN, 'read'),
    ]);
    assert.deepEqual(
      reached(policy),
      [
        {
          code: 'grant-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students',
        },
      ],
      'nor does it make its type readable',
    );
  });

  test('a link typed as a card of any type is not answered by granting that type', async function (assert) {
    let policy = await compile([rule(NOTICEBOARD, 'read')]);
    assert.deepEqual(reached(policy), [
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'pinned',
      },
    ]);
    let [message] = reachIssues(policy).map((issue) => issue.message);
    assert.true(
      message.includes('a link typed as CardDef can hold a card of any type'),
      message,
    );
    assert.false(
      message.includes('grant a read of CardDef'),
      `it does not suggest granting every card: ${message}`,
    );
  });

  test('a closure that reaches an ungranted type only through a query-backed field records it', async function (assert) {
    let policy = await compile([rule(HONORS_BOARD, 'read')]);
    assert.deepEqual(reached(policy), [
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'honorRoll',
      },
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'honorRoll.guardian',
      },
    ]);
  });

  test('a link held inside a contained field is part of the closure', async function (assert) {
    let policy = await compile([rule(EXCURSION, 'read')]);
    assert.deepEqual(reached(policy), [
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'emergency.guardian',
      },
    ]);
  });

  test("an ad-hoc query grant records it whatever the row type's read declares, and a named query declaring ids does not", async function (assert) {
    let policy = await compile([
      rule(IDS_CLASSROOM, 'query'),
      rule(CLASSROOM, 'listIds'),
    ]);
    let documentReach = reached(policy).filter(
      ({ code }) => code === 'grant-reaches-ungranted-type',
    );
    assert.deepEqual(
      documentReach,
      [
        {
          code: 'grant-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students',
        },
        {
          code: 'grant-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students.guardian',
        },
      ],
      "the ad-hoc query's document reaches the students, and the named query's does not",
    );
    let adHoc = reachIssues(policy)[0]?.message ?? '';
    assert.true(
      adHoc.includes(
        "grant a named query that declares `links: 'ids'` in place of the ad-hoc `query`",
      ),
      `an ad-hoc query's fix is a named query, since nothing narrows it: ${adHoc}`,
    );
  });

  test('a named query declaring full records it, and names the query as the place to narrow it', async function (assert) {
    let policy = await compile([rule(CLASSROOM, 'listFull')]);
    let documentReach = reachIssues(policy).filter(
      ({ code }) => code === 'grant-reaches-ungranted-type',
    );
    assert.deepEqual(
      documentReach.map(({ path }) => path),
      ['rules[0].grants[0]', 'rules[0].grants[0]'],
    );
    assert.true(
      documentReach[0].message.includes(
        "declare `links: 'ids'` on the `listFull` query",
      ),
      documentReach[0].message,
    );
  });

  test("the check flags a query's renders reaching outside the granted type, whatever its links declare", async function (assert) {
    let policy = await compile([rule(CLASSROOM, 'listIds')]);
    assert.deepEqual(
      reached(policy),
      [
        {
          code: 'render-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students',
        },
        {
          code: 'render-reaches-ungranted-type',
          path: 'rules[0].grants[0]',
          via: 'students.guardian',
        },
      ],
      'the query serves ids, and its rows are still rendered with their links drawn',
    );
    let [message] = reachIssues(policy).map((issue) => issue.message);
    assert.true(
      /the prerendered HTML of the Classroom rows `listIds` serves can draw the Student cards linked through `students`/.test(
        message,
      ),
      message,
    );
    assert.true(
      message.includes('narrowing `links` does not keep them out of the HTML'),
      `it says why the declared ids is no fix: ${message}`,
    );

    policy = await compile([rule(CLASSROOM, 'read')]);
    assert.deepEqual(
      reached(policy).filter(
        ({ code }) => code === 'render-reaches-ungranted-type',
      ),
      [],
      'a read serves no rendering, so it records none',
    );
  });

  test('a query grant that compiled no filter admits no search, so it records no reach', async function (assert) {
    let policy = await compile([
      {
        targetType: CLASSROOM,
        grants: [
          {
            operation: 'listFull',
            // A realm setting, which a search does not resolve.
            where: '.title == realmConfig("approver")',
          },
        ],
      },
    ]);
    assert.deepEqual(
      policy.issues.map(({ code, path, severity }) => ({
        code,
        path,
        severity,
      })),
      [
        {
          code: 'policy-not-filterable',
          path: 'rules[0].grants[0].where',
          severity: 'inactive',
        },
      ],
      'and the grant itself admits nothing',
    );
  });

  test('under a CardDef grant, a closure reaching a policy card or a realm config card records it and names what it reached', async function (assert) {
    // The catch-all grants every type by ancestry, `RealmPolicy` and
    // `RealmConfig` among them, and neither counts.
    let policy = await compile([rule(LEDGER, 'read'), rule(CARD_DEF, 'read')]);
    assert.deepEqual(reached(policy), [
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'policy',
      },
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        via: 'settings',
      },
    ]);
    let [policyCardIssue, configIssue] = reachIssues(policy).map(
      (issue) => issue.message,
    );
    assert.true(
      policyCardIssue.includes(
        "RealmPolicy is a policy card type: a policy card's attributes are its whole rule list",
      ),
      `the message names the reached card as a policy card: ${policyCardIssue}`,
    );
    assert.true(
      configIssue.includes('RealmConfig is the realm config card type'),
      `and the config card as a config card: ${configIssue}`,
    );
  });

  test('the issue is a warning: the grant stays live, unlike an invalid grant', async function (assert) {
    let policy = await compile([
      rule(CLASSROOM, 'read'),
      { targetType: CLASSROOM, grants: [{ operation: 'rename' }] },
    ]);
    let issues = policy.issues.map(({ code, path, severity }) => ({
      code,
      path,
      severity,
    }));
    assert.deepEqual(issues, [
      {
        code: 'unknown-operation',
        path: 'rules[1].grants[0].operation',
        severity: 'inactive',
      },
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        severity: 'warning',
      },
      {
        code: 'grant-reaches-ungranted-type',
        path: 'rules[0].grants[0]',
        severity: 'warning',
      },
    ]);
    assert.deepEqual(
      policy.rules.map((compiled) =>
        compiled.grants.map((grant) => grant.operation),
      ),
      [['read'], []],
      'the reaching grant is kept, and the invalid one is left out',
    );

    let response = await request
      .get(new URL(ROOM_204).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', `Bearer ${createJWT(education, TEACHER, [])}`);
    assert.strictEqual(response.status, 200, 'the grant admits the teacher');
    // A served document spells its ids relative to itself.
    let included = (
      (response.body as { included?: { id?: string; type?: string }[] })
        .included ?? []
    )
      .filter((resource) => resource.type === 'card' && resource.id)
      .map((resource) => new URL(resource.id!, ROOM_204).href);
    assert.deepEqual(
      included,
      [ADA],
      'and hands them the student it warned about',
    );
  });

  test('a type the closure crosses is an input: a link removed from it clears the warning it caused', async function (assert) {
    let policy = await compile([rule(CLASSROOM, 'read')]);
    assert.deepEqual(
      reached(policy).map(({ via }) => via),
      ['students', 'students.guardian'],
    );

    await writeTo(
      education,
      'student.gts',
      studentModule({ withGuardian: false }),
    );
    policy = (await education.getCompiledPolicy())!;
    assert.deepEqual(
      reached(policy).map(({ via }) => via),
      ['students'],
      'the policy recompiled when the Student definition changed',
    );
  });
});
