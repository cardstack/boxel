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

function classroomModule(rosterField: string) {
  return `
    import { containsMany, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    export class Classroom extends CardDef {
      @field ${rosterField} = containsMany(StringField);
    }
  `;
}

type Grant = { operation: string; where?: unknown };

function policyCard(grants: Grant[], adoptsFrom: object = REALM_POLICY) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [
          {
            targetType: { module: `${EDUCATION}classroom`, name: 'Classroom' },
            grants,
          },
        ],
      },
      meta: { adoptsFrom },
    },
  });
}

const GRANTS: Grant[] = [
  { operation: 'read', where: '.teacherIds | contains(actor())' },
  {
    operation: 'appendActivity',
    where: { bxl: 'actor() in .teacherIds', snapshot: true },
  },
  { operation: 'approve', where: '.teacherIds[0] == realmConfig("approver")' },
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
              policy: { card: POLICY_CARD },
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
        policy: card === null ? null : { card },
      }),
    );
  }

  function compiles() {
    return education.__testOnlyPolicyCacheStats().compiles;
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
          grants: [
            {
              operation: 'read',
              where: {
                source: '.teacherIds | contains(actor())',
                canonical: '.teacherIds | contains(actor())',
                snapshot: false,
              },
            },
            {
              operation: 'appendActivity',
              where: {
                source: 'actor() in .teacherIds',
                canonical: '(actor() | IN(.teacherIds))',
                snapshot: true,
              },
            },
            {
              operation: 'approve',
              where: {
                source: '.teacherIds[0] == realmConfig("approver")',
                canonical: '.teacherIds[0] == realmConfig("approver")',
                snapshot: false,
              },
            },
            { operation: 'readSource' },
          ],
        },
      ],
      'every grant compiles, each `where` canonicalized under the policy profile, and a grant with no `where` carries none',
    );
  });

  test('a policy is compiled once, however often it is read', async function (assert) {
    let first = await compiled();
    let concurrent = await Promise.all([compiled(), compiled(), compiled()]);
    let later = await compiled();
    assert.strictEqual(compiles(), 1, 'one compile across five reads');
    for (let policy of [...concurrent, later]) {
      assert.strictEqual(policy, first, 'every read is answered by it');
    }
  });

  test('editing the policy card recompiles it', async function (assert) {
    let before = await compiled();
    assert.strictEqual(before?.rules[0].grants.length, 4);

    await writeTo(
      org,
      'policies/education.json',
      policyCard([{ operation: 'read', where: '.teacherIds | length > 0' }]),
    );
    let after = await compiled();
    assert.strictEqual(compiles(), 2, 'the edit compiled once more');
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
    await writeTo(education, 'note.json', note('An edited education note'));
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
    await compiled();
    assert.strictEqual(
      compiles(),
      2,
      "the type's changed definition compiled the policy again",
    );
  });

  test('a predicate that reads params(), does not parse, or is empty is refused, and the rest of the policy compiles', async function (assert) {
    await writeTo(
      org,
      'policies/education.json',
      policyCard([
        { operation: 'read', where: '.teacherIds | contains(actor())' },
        { operation: 'update', where: 'params("teacher") == actor()' },
        { operation: 'delete', where: '.teacherIds ==' },
        { operation: 'archive', where: '   ' },
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
    assert.strictEqual(before?.rules[0].grants.length, 4);

    await writeTo(org, 'org-policy.gts', subtype('CardDef'));
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
    policy = await compiled();
    assert.deepEqual(policy?.issues, [], 'the card compiles once it exists');
    assert.strictEqual(policy?.rules[0].grants.length, 4);
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
});
