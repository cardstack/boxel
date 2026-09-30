import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  IndexWriter,
  noteRealmIndexMoved,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  PolicyValidation,
  QueuePublisher,
  QueueRunner,
  Realm,
  VirtualNetwork,
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

// What a policy card reports of itself when asked to validate: every issue
// compiling it records, and the rules and grants that compile, which are the
// ones a realm naming it puts in force.
//
// The worked example's topology. The Education realm holds the classrooms and
// bulletins, and names a policy card that lives in an Org realm. An Org reader
// may read the Org realm and nothing more, and an IT admin reads both realms.
// A teacher holds no permission on
// either, and reaches the Org realm's cards only through the Org realm's own
// policy, which grants every card in that realm to every caller.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const DRAFT_CARD = `${ORG}policies/draft`;
const ORG_POLICY_CARD = `${ORG}policies/org`;
const ORG_ADMIN = '@org-admin:localhost';
const ORG_READER = '@org-reader:localhost';
const IT_ADMIN = '@it-admin:localhost';
const EDUCATION_ADMIN = '@education-admin:localhost';
const TEACHER = '@teacher:localhost';

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };
const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };

const TEACHES = '.teacherIds | any(. == actor())';
// Does not parse: the comparison has nothing on its right.
const MISTYPED = `${TEACHES} and .title ==`;
// Parses under the `policy` profile, and the `predicate` profile refuses it,
// so a grant on a query with it compiles no search filter.
const UNFILTERABLE = '(.title | tonumber) > 0';

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
  }
`;

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

// A policy type that declares a validate, as a policy card's type does to
// carry one.
const VALIDATABLE_POLICY_MODULE = `
  import { operation } from "@cardstack/base/operations";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";

  export class ValidatablePolicy extends RealmPolicy {
    @operation static validate = { base: 'validate', nonGrantable: true };
  }
`;

const VALIDATABLE_POLICY = {
  module: `${ORG}validatable-policy`,
  name: 'ValidatablePolicy',
};

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: VALIDATABLE_POLICY },
    },
  });
}

// A teacher reads the classrooms they teach and deletes them, anyone may read
// a bulletin, and every grant compiles.
const CLEAN_RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'read', where: TEACHES },
      { operation: 'delete', where: TEACHES },
    ],
  },
  { targetType: BULLETIN, grants: [{ operation: 'read' }] },
];

// The Org realm's own policy grants every card in that realm to every caller,
// a validate included. That is the widest grant there is, and it must not
// reach a validate.
const ORG_RULES: Rule[] = [
  {
    targetType: CARD_DEF,
    grants: [{ operation: 'read' }, { operation: 'validate' }],
  },
  {
    targetType: VALIDATABLE_POLICY,
    grants: [{ operation: 'validate' }],
  },
];

function card(
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom } },
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

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let db: PgAdapter;
  let virtualNetwork: VirtualNetwork;
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
    db = dbAdapter;
    virtualNetwork = createVirtualNetwork();
    let result = await runTestRealmServerWithRealms({
      virtualNetwork,
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
          },
          permissions: {
            [EDUCATION_ADMIN]: ['read', 'write', 'realm-owner'],
            [IT_ADMIN]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Org',
              policy: ORG_POLICY_CARD,
            }),
            'validatable-policy.gts': VALIDATABLE_POLICY_MODULE,
            'policies/education.json': policyCard(CLEAN_RULES),
            'policies/org.json': policyCard(ORG_RULES),
            'notes/n1.json': card(CARD_DEF, { cardInfo: { name: 'A note' } }),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
            [ORG_READER]: ['read'],
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

  function onOrg(user: string, permissions: Parameters<typeof createJWT>[2]) {
    return `Bearer ${createJWT(org, user, permissions)}`;
  }

  const ASKER = {
    orgAdmin: () => onOrg(ORG_ADMIN, ['read', 'write', 'realm-owner']),
    orgReader: () => onOrg(ORG_READER, ['read']),
    itAdmin: () => onOrg(IT_ADMIN, ['read']),
    teacher: () => onOrg(TEACHER, []),
  };

  async function writeTo(realm: Realm, path: string, contents: string) {
    await realm.write(path, contents);
    await realm.indexing();
  }

  function ask(auth: string, policy = POLICY_CARD) {
    return request
      .post(`${new URL(ORG).pathname}_operations`)
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(invoke('validate', { href: policy })));
  }

  async function validate(policy = POLICY_CARD): Promise<PolicyValidation> {
    let response = await ask(ASKER.itAdmin(), policy);
    if (response.status !== 200) {
      throw new Error(
        `validate(${policy}) answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { 'atomic:results': PolicyValidation[] })[
      'atomic:results'
    ][0];
  }

  function errorOf(response: Response) {
    return (response.body as { errors?: { code?: string }[] }).errors?.[0];
  }

  // What a validation says is in force, as the paths of the rules and grants
  // that compiled.
  function live(validation: PolicyValidation) {
    return validation.rules.map((rule) => [
      rule.path,
      rule.grants.map((grant) => grant.path),
    ]);
  }

  // The grants a validation says are in force and admit nothing, with why.
  function inert(validation: PolicyValidation) {
    return validation.rules.flatMap((rule) =>
      rule.grants.flatMap((grant) =>
        grant.admitsNothing ? [[grant.path, grant.admitsNothing]] : [],
      ),
    );
  }

  // Each issue as the tests compare it: what it is, where it is, and the rule
  // and grant it falls under. The message's wording is the compiler's.
  function issuesOf(validation: PolicyValidation) {
    return validation.issues.map(({ code, path, rule, grant }) => ({
      code,
      path,
      ...(rule !== undefined ? { rule } : {}),
      ...(grant !== undefined ? { grant } : {}),
    }));
  }

  // What the realm naming the card holds in force, in the same terms.
  async function inForce() {
    let compiled = await education.getCompiledPolicy();
    return {
      rules: compiled?.rules.map((rule) => [
        rule.path,
        rule.grants.map((grant) => grant.path),
      ]),
      issues: compiled?.issues,
      uncompilable: compiled?.uncompilable,
    };
  }

  module('what a validation reports', function () {
    test('a policy whose every grant compiles reports no issues, and every grant live', async function (assert) {
      let validation = await validate();
      assert.deepEqual(validation, {
        card: POLICY_CARD,
        version: validation.version,
        issues: [],
        rules: [
          {
            path: 'rules[0]',
            grants: [
              { path: 'rules[0].grants[0]' },
              { path: 'rules[0].grants[1]' },
            ],
          },
          { path: 'rules[1]', grants: [{ path: 'rules[1].grants[0]' }] },
        ],
      });
      assert.strictEqual(
        typeof validation.version,
        'string',
        'the version of the card compiled is reported',
      );
    });

    test('a grant that does not compile is left out of what is in force, and its issue names its rule and grant', async function (assert) {
      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          {
            targetType: CLASSROOM,
            grants: [
              { operation: 'read', where: TEACHES },
              { operation: 'delete', where: MISTYPED },
              { operation: 'update' },
            ],
          },
          { targetType: BULLETIN, grants: [{ operation: 'read' }] },
        ]),
      );
      let validation = await validate();
      assert.deepEqual(
        issuesOf(validation),
        [
          {
            code: 'invalid-predicate',
            path: 'rules[0].grants[1].where',
            rule: 0,
            grant: 1,
          },
        ],
        'the issue is recorded against the rule and grant that caused it',
      );
      assert.true(
        validation.issues[0].message.includes('does not parse'),
        `the message says what is wrong: ${validation.issues[0].message}`,
      );
      assert.deepEqual(
        live(validation),
        [
          ['rules[0]', ['rules[0].grants[0]', 'rules[0].grants[2]']],
          ['rules[1]', ['rules[1].grants[0]']],
        ],
        'the grant that does not compile is inactive, and the rest are live',
      );
      assert.notOk(validation.uncompilable, 'the policy as a whole compiles');

      let held = await inForce();
      assert.deepEqual(
        held.rules,
        live(validation),
        'the realm naming the card holds exactly those grants in force',
      );
      assert.deepEqual(
        held.issues,
        validation.issues.map(
          ({ rule: _rule, grant: _grant, ...issue }) => issue,
        ),
        'and records exactly those issues',
      );
    });

    test('a query grant whose predicate compiles no search filter is kept, and says it admits nothing', async function (assert) {
      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          {
            targetType: CLASSROOM,
            grants: [
              { operation: 'read', where: TEACHES },
              { operation: 'query', where: UNFILTERABLE },
            ],
          },
        ]),
      );
      let validation = await validate();
      assert.deepEqual(issuesOf(validation), [
        {
          code: 'policy-not-filterable',
          path: 'rules[0].grants[1].where',
          rule: 0,
          grant: 1,
        },
      ]);
      assert.deepEqual(
        live(validation),
        [['rules[0]', ['rules[0].grants[0]', 'rules[0].grants[1]']]],
        'the grant is still in force',
      );
      assert.deepEqual(
        inert(validation),
        [['rules[0].grants[1]', 'unfilterable']],
        'and admits nothing, since a query is authorized only through a filter',
      );
    });

    test('a grant whose predicate reads a snapshot admits nothing, except on a query', async function (assert) {
      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          {
            targetType: CLASSROOM,
            grants: [
              { operation: 'read', where: { bxl: TEACHES, snapshot: true } },
              { operation: 'query', where: { bxl: TEACHES, snapshot: true } },
              { operation: 'delete', where: TEACHES },
            ],
          },
        ]),
      );
      let validation = await validate();
      assert.deepEqual(issuesOf(validation), [], 'nothing is wrong with it');
      assert.deepEqual(live(validation), [
        [
          'rules[0]',
          ['rules[0].grants[0]', 'rules[0].grants[1]', 'rules[0].grants[2]'],
        ],
      ]);
      assert.deepEqual(
        inert(validation),
        [['rules[0].grants[0]', 'snapshot']],
        'the gate never evaluates the read, and the query composes its filter into a search',
      );
    });

    test('a rule whose type does not resolve is left out with every grant in it', async function (assert) {
      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          {
            targetType: { module: `${EDUCATION}no-such-module`, name: 'Nope' },
            grants: [{ operation: 'read' }, { operation: 'delete' }],
          },
          { targetType: BULLETIN, grants: [{ operation: 'read' }] },
        ]),
      );
      let validation = await validate();
      assert.deepEqual(issuesOf(validation), [
        { code: 'unresolved-type', path: 'rules[0].targetType', rule: 0 },
      ]);
      assert.deepEqual(
        live(validation),
        [['rules[1]', ['rules[1].grants[0]']]],
        'only the rule that compiled is in force',
      );
    });

    test('a policy that does not compile at all says so, apart from any one grant', async function (assert) {
      // The visit that indexes an edit to the card fails on a gateway error.
      // The index keeps such a failure off the row, so the row reads as
      // healthy and still holds the earlier document, and the card still
      // renders that document.
      let batch = await new IndexWriter(db).createBatch(
        new URL(ORG),
        virtualNetwork,
      );
      await batch.updateEntry(new URL(`${POLICY_CARD}.json`), {
        type: 'instance-error',
        error: { message: 'Bad Gateway', status: 502, additionalErrors: null },
        diagnostics: { gatewayFailure: ['instance'] },
      });
      await batch.done();
      noteRealmIndexMoved(ORG);

      let validation = await validate();
      assert.true(validation.uncompilable, 'the policy does not compile');
      assert.deepEqual(
        issuesOf(validation),
        [{ code: 'policy-card-unloadable', path: '' }],
        'the issue is about the card as a whole, and names no rule or grant',
      );
      assert.deepEqual(validation.rules, [], 'and nothing is in force');
      assert.strictEqual(
        validation.version,
        undefined,
        'what the index holds of the card is an earlier visit, so no version is claimed for it',
      );

      let held = await inForce();
      assert.true(held.uncompilable, 'the realm naming the card agrees');
    });

    test('a fixed grant is live on the next validation, and in force in the realm that names the card', async function (assert) {
      let broken = policyCard([
        {
          targetType: CLASSROOM,
          grants: [{ operation: 'read', where: MISTYPED }],
        },
      ]);
      await writeTo(org, 'policies/education.json', broken);
      assert.deepEqual(
        issuesOf(await validate()).map(({ code }) => code),
        ['invalid-predicate'],
      );
      assert.deepEqual((await inForce()).rules, [['rules[0]', []]]);

      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          {
            targetType: CLASSROOM,
            grants: [{ operation: 'read', where: TEACHES }],
          },
        ]),
      );
      let validation = await validate();
      assert.deepEqual(validation.issues, [], 'the issue is gone');
      assert.deepEqual(live(validation), [
        ['rules[0]', ['rules[0].grants[0]']],
      ]);
      assert.deepEqual(
        await inForce(),
        { rules: live(validation), issues: [], uncompilable: undefined },
        'and the realm naming the card holds the fixed grant in force',
      );
    });

    test('a card no realm names is validated just the same', async function (assert) {
      await writeTo(
        org,
        'policies/draft.json',
        policyCard([
          {
            targetType: CLASSROOM,
            grants: [
              { operation: 'read', where: TEACHES },
              { operation: 'teleport' },
            ],
          },
        ]),
      );
      let validation = await validate(DRAFT_CARD);
      assert.deepEqual(issuesOf(validation), [
        {
          code: 'unknown-operation',
          path: 'rules[0].grants[1].operation',
          rule: 0,
          grant: 1,
        },
      ]);
      assert.deepEqual(live(validation), [
        ['rules[0]', ['rules[0].grants[0]']],
      ]);
    });
  });

  module('who may ask', function () {
    test('a caller is answered only when they can read every realm the policy reaches', async function (assert) {
      let answered = await ask(ASKER.itAdmin());
      assert.strictEqual(
        answered.status,
        200,
        'a reader of both the Org realm and the Education realm its rules name is answered',
      );

      let refused = await ask(ASKER.orgReader());
      assert.strictEqual(
        refused.status,
        403,
        'a reader of the Org realm alone is refused, since the answer describes Education definitions',
      );
      assert.strictEqual(errorOf(refused)?.code, 'operation-not-permitted');

      await writeTo(
        org,
        'policies/draft.json',
        policyCard([{ targetType: CARD_DEF, grants: [{ operation: 'read' }] }]),
      );
      assert.strictEqual(
        (await ask(ASKER.orgReader(), DRAFT_CARD)).status,
        200,
        'and is answered about a policy that reaches only realms they can read',
      );
    });

    test('no grant reaches a validate', async function (assert) {
      let refused = await ask(ASKER.teacher());
      let missing = await ask(ASKER.teacher(), `${ORG}policies/no-such-card`);
      assert.strictEqual(
        refused.status,
        404,
        'a caller the Org realm admits only through its policy is refused, as though the card were not there',
      );
      assert.strictEqual(errorOf(refused)?.code, 'target-not-found');
      assert.deepEqual(
        refused.body,
        missing.body,
        'and is told exactly what a card that does not exist is told',
      );

      let orgPolicy = await validate(ORG_POLICY_CARD);
      assert.deepEqual(
        issuesOf(orgPolicy).map(({ code, path }) => [code, path]),
        [
          ['unknown-operation', 'rules[0].grants[1].operation'],
          [
            'grants-authorization-infrastructure',
            'rules[1].grants[0].operation',
          ],
        ],
        'and the policy records each grant of it as granting nothing',
      );
    });

    test('a policy card whose type declares no validate has none', async function (assert) {
      await writeTo(
        org,
        'policies/plain.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { rules: CLEAN_RULES },
            meta: {
              adoptsFrom: {
                module: rri('@cardstack/catalog/realm-policy/realm-policy'),
                name: 'RealmPolicy',
              },
            },
          },
        }),
      );
      let response = await ask(ASKER.orgAdmin(), `${ORG}policies/plain`);
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual(errorOf(response)?.code, 'unknown-operation');
    });
  });
});
