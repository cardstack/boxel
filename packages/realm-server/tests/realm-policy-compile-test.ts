import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri } from '@cardstack/runtime-common';
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

// The worked example's topology: an Education realm holds the cards a policy
// governs, and the policy card lives in an Org realm. Nobody the Education
// realm acts for can read the Org realm — not a teacher, not the Education
// realm's owner, not the Education realm's own user.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const EDUCATION_ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// `lock` is kept out of every policy's reach. `OpenClassroom` redeclares it
// without the flag, and inherits the rest. The head teacher is computed from
// the roster, so only the index holds it.
function classroomModule(rosterField: string) {
  return `
    import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation } from "@cardstack/base/operations";
    export class Classroom extends CardDef {
      @field ${rosterField} = containsMany(StringField);
      @field status = contains(StringField);
      @field headTeacher = contains(StringField, {
        computeVia: function (this: Classroom) {
          return this.${rosterField}?.[0];
        },
      });

      @operation static appendActivity = {
        base: 'transform',
        set: { status: 'active' },
      };
      @operation static approve = {
        base: 'transform',
        set: { status: 'approved' },
      };
      @operation static rename = {
        base: 'transform',
        set: { status: 'renamed' },
      };
      @operation static lock = {
        base: 'transform',
        set: { status: 'locked' },
        nonGrantable: true,
      };
    }
    export class OpenClassroom extends Classroom {
      @operation static lock = {
        base: 'transform',
        set: { status: 'locked' },
      };
    }
  `;
}

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };

function policyCard(grants: Grant[], adoptsFrom: object = REALM_POLICY) {
  return policyOf([{ targetType: CLASSROOM, grants }], adoptsFrom);
}

function policyOf(rules: Rule[], adoptsFrom: object = REALM_POLICY) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom },
    },
  });
}

const GRANTS: Grant[] = [
  { operation: 'read', where: '.teacherIds | any(. == actor())' },
  {
    operation: 'appendActivity',
    where: { bxl: '.headTeacher == actor()', snapshot: true },
  },
  { operation: 'approve', where: '.teacherIds[0] == realmConfig("approver")' },
  { operation: 'rename', where: 'instance().teacherIds | length > 0' },
  { operation: 'readSource' },
];

function note(name: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { cardInfo: { name } },
      meta: {
        adoptsFrom: {
          module: rri('@cardstack/base/card-api'),
          name: 'CardDef',
        },
      },
    },
  });
}

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
              config: { approver: TEACHER },
              policy: POLICY_CARD,
            }),
            'classroom.gts': classroomModule('teacherIds'),
            'note.json': note('An education note'),
          },
          permissions: {
            [EDUCATION_ADMIN]: ['read', 'write', 'realm-owner'],
            [TEACHER]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': policyCard(GRANTS),
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

  async function writeTo(realm: Realm, path: string, contents: string) {
    await realm.write(path, contents);
    await realm.indexing();
  }

  async function pointAt(card: string | null) {
    await writeTo(
      education,
      'realm.json',
      realmConfigCardJSON({
        name: 'Education',
        config: { approver: TEACHER },
        policy: card,
      }),
    );
  }

  function compiles() {
    return education.__testOnlyPolicyCacheStats().compiles;
  }

  function revalidations() {
    return education.__testOnlyPolicyCacheStats().revalidations;
  }

  // Waits, without reading the policy, for the cache to reach a state. A read
  // would revalidate on its own once the entry is old enough, so a test that
  // means to show an index move reaching the cache has to see the move's
  // background refresh land before it reads anything.
  async function refreshed(done: () => boolean, what: string) {
    let started = Date.now();
    while (!done()) {
      if (Date.now() - started > 30_000) {
        throw new Error(`timed out waiting until ${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  function compiled(): Promise<CompiledRealmPolicy | undefined> {
    return education.getCompiledPolicy();
  }

  test('the policy compiles from a card in a realm that no identity the governed realm acts for can read', async function (assert) {
    for (let user of [TEACHER, EDUCATION_ADMIN]) {
      let response = await request
        .get(new URL(POLICY_CARD).pathname)
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', `Bearer ${createJWT(org, user, [])}`);
      assert.strictEqual(
        response.status,
        403,
        `${user} cannot read the policy card`,
      );
    }
    // The Education realm's own fetch, which carries its user's credentials
    // and assumes its owner. A load that went through a request would go
    // through this.
    let realmFetch = await education.__fetchForTesting(POLICY_CARD, {
      headers: { Accept: 'application/vnd.card+json' },
    });
    assert.false(
      realmFetch.ok,
      `the Education realm itself is refused the policy card (${realmFetch.status})`,
    );

    let policy = await compiled();
    assert.deepEqual(policy?.issues, [], 'the policy compiles cleanly');
    assert.strictEqual(policy?.card, POLICY_CARD, 'the card the pointer names');
    assert.strictEqual(
      typeof policy?.version,
      'string',
      "it records the card's meta.version",
    );
    assert.deepEqual(
      policy?.rules,
      [
        {
          targetType: {
            module: rri(`${EDUCATION}classroom`),
            name: 'Classroom',
          },
          path: 'rules[0]',
          grants: [
            {
              operation: 'read',
              path: 'rules[0].grants[0]',
              where: {
                source: '.teacherIds | any(. == actor())',
                canonical: '.teacherIds | any(. == actor())',
                snapshot: false,
              },
            },
            {
              operation: 'appendActivity',
              path: 'rules[0].grants[1]',
              where: {
                source: '.headTeacher == actor()',
                canonical: '.headTeacher == actor()',
                snapshot: true,
              },
            },
            {
              operation: 'approve',
              path: 'rules[0].grants[2]',
              where: {
                source: '.teacherIds[0] == realmConfig("approver")',
                canonical: '.teacherIds[0] == realmConfig("approver")',
                snapshot: false,
              },
            },
            {
              operation: 'rename',
              path: 'rules[0].grants[3]',
              where: {
                source: 'instance().teacherIds | length > 0',
                canonical: 'instance().teacherIds | length > 0',
                snapshot: false,
              },
            },
            { operation: 'readSource', path: 'rules[0].grants[4]' },
          ],
        },
      ],
      'every grant compiles, each `where` canonicalized under the policy profile, and a grant with no `where` carries none',
    );
  });

  test('a policy is compiled once, however often it is read', async function (assert) {
    let [first, ...concurrent] = await Promise.all([
      compiled(),
      compiled(),
      compiled(),
    ]);
    let later = await compiled();
    assert.strictEqual(
      compiles(),
      1,
      'three reads of a cold cache share one compile, and a later read is answered from memory',
    );
    for (let policy of [...concurrent, later]) {
      assert.strictEqual(policy, first, 'every read is answered by it');
    }
  });

  test('editing the policy card recompiles it', async function (assert) {
    let before = await compiled();
    assert.strictEqual(before?.rules[0].grants.length, 5);

    await writeTo(
      org,
      'policies/education.json',
      policyCard([{ operation: 'read', where: '.teacherIds | length > 0' }]),
    );
    await refreshed(() => compiles() === 2, 'the edit recompiles');
    let after = await compiled();
    assert.strictEqual(
      compiles(),
      2,
      'the index move recompiled the policy before anything read it',
    );
    assert.notStrictEqual(
      after?.version,
      before?.version,
      'at the new meta.version',
    );
    assert.deepEqual(
      after?.rules[0].grants.map((grant) => grant.operation),
      ['read'],
      'what the card says now',
    );
  });

  test('an edit to an unrelated card, in either realm, does not recompile', async function (assert) {
    let before = await compiled();
    await writeTo(org, 'note.json', note('An edited org note'));
    await refreshed(
      () => revalidations() >= 1,
      "the Org realm's move revalidates the policy",
    );
    let afterOrg = revalidations();
    await writeTo(education, 'note.json', note('An edited education note'));
    await refreshed(
      () => revalidations() > afterOrg,
      "the Education realm's move revalidates the policy",
    );
    let after = await compiled();
    assert.strictEqual(compiles(), 1, 'no compile after either edit');
    assert.strictEqual(after, before, 'the same compiled policy answers');
  });

  test('renaming a field in a type a rule names recompiles the policy', async function (assert) {
    await compiled();
    await writeTo(
      education,
      'classroom.gts',
      classroomModule('teacherUserIds'),
    );
    await refreshed(() => compiles() === 2, 'the rename recompiles');
    await compiled();
    assert.strictEqual(
      compiles(),
      2,
      "the type's changed definition compiled the policy again",
    );
  });

  test('a predicate that reads a computed value without the annotation records `unsnapshotted-policy-read`, and the rest of the policy compiles', async function (assert) {
    await writeTo(
      org,
      'policies/education.json',
      policyCard([
        { operation: 'read', where: '.teacherIds | any(. == actor())' },
        { operation: 'approve', where: '.headTeacher == actor()' },
        {
          operation: 'rename',
          where: { bxl: '.headTeacher == actor()', snapshot: true },
        },
        {
          operation: 'appendActivity',
          where: { bxl: '.status == "open"', snapshot: true },
        },
      ]),
    );
    let policy = await compiled();
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      [{ code: 'unsnapshotted-policy-read', path: 'rules[0].grants[1].where' }],
      'the unannotated read of the computed value is recorded against its grant',
    );
    assert.true(
      /`\.headTeacher` is computed/.test(policy?.issues[0]?.message ?? ''),
      `the issue names the computed value: ${policy?.issues[0]?.message}`,
    );
    assert.deepEqual(
      policy?.rules[0].grants.map(({ operation, where }) => [
        operation,
        where?.snapshot,
      ]),
      [
        ['read', false],
        ['rename', true],
        ['appendActivity', false],
      ],
      'the other grants compile: annotated, the computed read is judged against the snapshot, and an annotated read of the stored source is judged against the stored source',
    );
  });

  test('a predicate that reads params(), does not parse, or is empty is refused, and the rest of the policy compiles', async function (assert) {
    await writeTo(
      org,
      'policies/education.json',
      policyCard([
        { operation: 'read', where: '.teacherIds | any(. == actor())' },
        { operation: 'update', where: 'params("teacher") == actor()' },
        { operation: 'delete', where: '.teacherIds ==' },
        { operation: 'transform', where: '   ' },
      ]),
    );
    let policy = await compiled();
    assert.deepEqual(
      policy?.rules[0].grants.map((grant) => grant.operation),
      ['read'],
      'only the grant that compiled is in the policy',
    );
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      [
        { code: 'invalid-predicate', path: 'rules[0].grants[1].where' },
        { code: 'invalid-predicate', path: 'rules[0].grants[2].where' },
        { code: 'invalid-predicate', path: 'rules[0].grants[3].where' },
      ],
      'each refusal is recorded against its grant',
    );
    let [paramsIssue, parseIssue, emptyIssue] = (policy?.issues ?? []).map(
      (issue) => issue.message,
    );
    assert.true(
      /policy-call-banned: .* call params:/.test(String(paramsIssue)),
      `the profile names params(): ${paramsIssue}`,
    );
    assert.true(
      String(parseIssue).includes('does not parse'),
      `a predicate that does not parse says so: ${parseIssue}`,
    );
    assert.true(
      String(emptyIssue).includes('`where` is empty'),
      `an empty predicate is refused rather than read as no condition: ${emptyIssue}`,
    );
  });

  // Each refused predicate calls one builtin that can hold for a value it
  // matches only in part. Each admitted one beside it comes close, and
  // compares exactly or anchors its match at a fixed string.
  test('a predicate that matches a value only in part is refused, whichever builtin it uses, and one that compares exactly compiles', async function (assert) {
    let refused: [string, string][] = [
      ['.teacherIds | contains([actor()])', 'contains'],
      ['.status | inside("approved or pending")', 'inside'],
      ['.teacherIds | any(index(actor()) != null)', 'index'],
      ['.status | rindex("pro") != null', 'rindex'],
      ['.status | indices("pro") | length > 0', 'indices'],
      ['ISNUMBER(FIND("appro", .status))', 'FIND'],
      ['ISNUMBER(SEARCH(actor(), .status))', 'SEARCH'],
      // Anchored, and refused all the same: the rule is the builtin's.
      ['.status | test("^approved$")', 'test'],
      ['(.status | match("appro")) != null', 'match'],
      ['(.status | capture("(?<s>appro)")) != null', 'capture'],
      ['[.status | scan("appro")] | length > 0', 'scan'],
      ['.status like "appro%"', 'like'],
      ['ISNUMBER(MATCH(actor(), .teacherIds))', 'MATCH'],
      ['LOOKUP(actor(), .teacherIds) == actor()', 'LOOKUP'],
      ['VLOOKUP(actor(), .teacherIds, 1) == actor()', 'VLOOKUP'],
      ['HLOOKUP(actor(), .teacherIds, 1) == actor()', 'HLOOKUP'],
      ['XLOOKUP(actor(), .teacherIds, .teacherIds) == actor()', 'XLOOKUP'],
      ['LOOKUP_BY(.teacherIds, "id", actor(), "id") == actor()', 'LOOKUP_BY'],
      ['VLOOKUP_BY(.teacherIds, "id", actor(), "id") == actor()', 'VLOOKUP_BY'],
      // The validators, which load lazily.
      ['matches(.status, actor())', 'matches'],
      ['isIn(actor(), .status)', 'isIn'],
      ['.teacherIds | bsearch(actor()) >= 0', 'bsearch'],
      // Anchored at a value the author did not write.
      ['.teacherIds | any(startswith(actor()))', 'startswith'],
      ['actor() | endswith(.status)', 'endswith'],
      ['(.status | ltrimstr(actor())) != .status', 'ltrimstr'],
      // jq's internal helpers, which the builtins above are built on.
      ['.teacherIds | any(_strindices(actor()) | length > 0)', '_strindices'],
      ['.teacherIds | any(_match_impl(actor(); null; true))', '_match_impl'],
      // Refused wherever it appears, and not only where it reads the caller.
      ['.status == "approved" and (.teacherIds | any(test("^@")))', 'test'],
    ];
    // Anchored at a fixed string, the way a namespace is written.
    let admitted = [
      '.teacherIds | any(. == actor())',
      '.status | startswith("appro")',
      'actor() | endswith(":localhost")',
      '(.status | ltrimstr("un")) == "approved"',
      '.status | split(",") | any(. == "approved")',
      '(.status | ascii_downcase) == "approved"',
      'EXACT(.status, "approved")',
      // Excel's `INDEX` reads a position; jq's `index` finds a substring.
      'INDEX(.teacherIds, 1) == actor()',
    ];
    await writeTo(
      org,
      'policies/education.json',
      policyCard(
        [...refused.map(([where]) => where), ...admitted].map((where) => ({
          operation: 'read',
          where,
        })),
      ),
    );
    let policy = await compiled();
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      refused.map((_, index) => ({
        code: 'partial-match',
        path: `rules[0].grants[${index}].where`,
      })),
      'each refused predicate is recorded against its grant, and nothing else is',
    );
    for (let [index, [where, builtin]] of refused.entries()) {
      let message = String(policy?.issues[index]?.message);
      assert.true(
        message.includes(`\`${builtin}\``),
        `${where}: the issue names \`${builtin}\`: ${message}`,
      );
      assert.true(
        message.includes('.list | any(. == actor())'),
        `${where}: and the exact spelling`,
      );
    }
    assert.deepEqual(
      policy?.rules[0]?.grants.map((grant) => grant.where?.source),
      admitted,
      'every predicate that compares exactly compiles',
    );
  });

  // The card's own bytes never change here, so its `meta.version` does not
  // either. What changes is the definition it adopts from, and with it the
  // adoption chain its row records.
  test('a policy card whose type stops being a RealmPolicy stops granting, though its own bytes are unchanged', async function (assert) {
    let subtype = (base: string) => `
      import { ${base} } from "${base === 'RealmPolicy' ? '@cardstack/catalog/realm-policy/realm-policy' : '@cardstack/base/card-api'}";
      export class OrgPolicy extends ${base} {}
    `;
    await writeTo(org, 'org-policy.gts', subtype('RealmPolicy'));
    await writeTo(
      org,
      'policies/subtyped.json',
      policyCard(GRANTS, { module: rri('../org-policy'), name: 'OrgPolicy' }),
    );
    await pointAt(`${ORG}policies/subtyped`);
    let before = await compiled();
    assert.deepEqual(before?.issues, [], 'a subtype of RealmPolicy compiles');
    assert.strictEqual(before?.rules[0].grants.length, 5);

    await writeTo(org, 'org-policy.gts', subtype('CardDef'));
    await refreshed(
      () => compiles() >= 2,
      'the changed definition recompiles the policy',
    );
    let after = await compiled();
    assert.strictEqual(
      after?.version,
      before?.version,
      "the card's meta.version is unchanged",
    );
    assert.deepEqual(after?.rules, [], 'it grants nothing');
    assert.deepEqual(
      after?.issues.map(({ code }) => code),
      ['not-a-policy'],
      'because it is no longer a RealmPolicy',
    );
  });

  test('a pointer to a card that is not in the index grants nothing, and picks the card up once it is', async function (assert) {
    let missing = `${ORG}policies/not-yet`;
    await pointAt(missing);
    let policy = await compiled();
    assert.deepEqual(policy?.rules, [], 'no rules');
    assert.deepEqual(
      policy?.issues.map(({ code }) => code),
      ['policy-card-missing'],
      'the missing card is recorded',
    );

    await writeTo(org, 'policies/not-yet.json', policyCard(GRANTS));
    await refreshed(() => compiles() === 2, 'the new card compiles');
    policy = await compiled();
    assert.deepEqual(policy?.issues, [], 'the card compiles once it exists');
    assert.strictEqual(policy?.rules[0].grants.length, 5);
  });

  test('a pointer to a card that will not load, or that is not a RealmPolicy, grants nothing', async function (assert) {
    await writeTo(
      org,
      'policies/broken.json',
      policyCard(GRANTS, { module: `${ORG}no-such-module`, name: 'Nothing' }),
    );
    await pointAt(`${ORG}policies/broken`);
    let policy = await compiled();
    assert.deepEqual(policy?.rules, [], 'an unloadable card grants nothing');
    assert.deepEqual(
      policy?.issues.map(({ code }) => code),
      ['policy-card-unloadable'],
    );
    assert.strictEqual(
      policy?.version,
      undefined,
      'and names no version, since nothing was compiled from its bytes',
    );

    await pointAt(`${ORG}note`);
    policy = await compiled();
    assert.deepEqual(
      policy?.rules,
      [],
      'a card of another type grants nothing',
    );
    assert.deepEqual(
      policy?.issues.map(({ code }) => code),
      ['not-a-policy'],
    );
  });

  test('a realm that points at no policy compiles none', async function (assert) {
    assert.ok(await compiled(), 'the policy compiles while the pointer is set');
    await pointAt(null);
    assert.strictEqual(await compiled(), undefined, 'no policy once it is not');
  });

  // Each rule or grant here that is refused earns exactly one issue, and each
  // one beside it that resembles it and earns none compiles.
  test('each problem is recorded against the rule or grant that has it, and the rest of the policy compiles', async function (assert) {
    const TS_FILE_DEF = {
      module: rri('@cardstack/base/ts-file-def'),
      name: 'TsFileDef',
    };
    const GTS_FILE_DEF = {
      module: rri('@cardstack/base/gts-file-def'),
      name: 'GtsFileDef',
    };
    const JSON_FILE_DEF = {
      module: rri('@cardstack/base/json-file-def'),
      name: 'JsonFileDef',
    };
    let grants = (...operations: string[]) =>
      operations.map((operation) => ({ operation }));
    await writeTo(
      org,
      'policies/education.json',
      policyOf([
        {
          targetType: CLASSROOM,
          grants: [
            { operation: 'read', where: '.teacherIds | any(. == actor())' },
            // No such operation on the type, and a built-in behavior only a
            // file carries.
            ...grants('enroll', 'appendLine'),
            // Declared non-grantable on the type.
            ...grants('lock'),
            // A built-in behavior every card carries.
            ...grants('transform', 'query'),
          ],
        },
        {
          targetType: {
            module: `${EDUCATION}classroom`,
            name: 'OpenClassroom',
          },
          // Redeclared without the flag, which does not undo it; and an
          // operation the type inherits.
          grants: grants('lock', 'approve'),
        },
        {
          targetType: REALM_POLICY,
          // A write on a RealmPolicy, two reads of one, and a query, none of
          // which a rule naming a policy type grants.
          grants: grants('read', 'update', 'readSource', 'query'),
        },
        { targetType: TS_FILE_DEF, grants: grants('readSource') },
        { targetType: GTS_FILE_DEF, grants: grants('readSource') },
        // A data file's type, which is grantable.
        { targetType: JSON_FILE_DEF, grants: grants('readSource') },
        {
          targetType: { module: '../no-such-module', name: 'Nothing' },
          grants: grants('read'),
        },
        // An operation a subtype declares, named on a type it descends from,
        // beside a built-in the type carries.
        {
          targetType: {
            module: rri('@cardstack/base/card-api'),
            name: 'CardDef',
          },
          grants: grants('approve', 'update'),
        },
      ]),
    );
    let policy = await compiled();
    assert.deepEqual(
      policy?.issues.map(({ code, path }) => ({ code, path })),
      [
        { code: 'unknown-operation', path: 'rules[0].grants[1].operation' },
        { code: 'unknown-operation', path: 'rules[0].grants[2].operation' },
        {
          code: 'grants-authorization-infrastructure',
          path: 'rules[0].grants[3].operation',
        },
        {
          code: 'grants-authorization-infrastructure',
          path: 'rules[1].grants[0].operation',
        },
        ...[0, 1, 2, 3].map((grant) => ({
          code: 'grants-authorization-infrastructure',
          path: `rules[2].grants[${grant}].operation`,
        })),
        { code: 'grants-module-source', path: 'rules[3].targetType' },
        { code: 'grants-module-source', path: 'rules[4].targetType' },
        { code: 'unresolved-type', path: 'rules[6].targetType' },
        { code: 'unknown-operation', path: 'rules[7].grants[0].operation' },
      ],
      'every refused rule and grant is recorded where it is, and nothing else is',
    );
    assert.true(
      String(policy?.issues[3]?.message).includes('non-grantable on Classroom'),
      `a subclass's grant names the type that keeps the operation out of reach: ${policy?.issues[3]?.message}`,
    );
    assert.deepEqual(
      policy?.rules.map((rule) => ({
        rule: rule.path,
        grants: rule.grants.map(
          ({ operation, path }) => `${path} ${operation}`,
        ),
      })),
      [
        {
          rule: 'rules[0]',
          grants: [
            'rules[0].grants[0] read',
            'rules[0].grants[4] transform',
            'rules[0].grants[5] query',
          ],
        },
        { rule: 'rules[1]', grants: ['rules[1].grants[1] approve'] },
        { rule: 'rules[2]', grants: [] },
        { rule: 'rules[5]', grants: ['rules[5].grants[0] readSource'] },
        { rule: 'rules[7]', grants: ['rules[7].grants[1] update'] },
      ],
      'what is left compiles, at the positions the author wrote it',
    );
    assert.notOk(policy?.uncompilable, 'the policy as a whole compiled');
  });
});
