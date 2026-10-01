import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
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

// What a realm's config card reports of the policy its pointer names: whether
// it is in force as the realm compiles it, and when it is not, the problem that
// takes it out of force, including the two that are problems with the
// pointer rather than with any policy card.
//
// The worked example's topology. The Education realm names a policy card that
// lives in an Org realm. The Org admin reads both realms. An Education reader
// reads the Education realm and nothing more. A teacher holds no permission on
// the Education realm, and reaches its cards only through its policy.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const CONFIG_CARD = `${EDUCATION}realm`;
const POLICY_CARD = `${ORG}policies/education`;
const MISSING_CARD = `${ORG}policies/no-such-card`;
const UNSERVED_CARD = 'http://127.0.0.1:4444/nowhere/policies/education';
const ORG_NOTE = `${ORG}notes/n1`;
const EDUCATION_NOTE = `${EDUCATION}notes/n1`;
const ORG_ADMIN = '@org-admin:localhost';
const EDUCATION_READER = '@education-reader:localhost';
const TEACHER = '@teacher:localhost';

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };
const REALM_CONFIG = {
  module: rri('@cardstack/base/realm-config'),
  name: 'RealmConfig',
};
const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// Every card in the Education realm is readable by every caller, and so, were
// a grant able to reach it, is the config card's `validatePolicy`.
const POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        { targetType: CARD_DEF, grants: [{ operation: 'read' }] },
        {
          targetType: REALM_CONFIG,
          grants: [{ operation: 'validatePolicy' }],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

function note(name: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { cardInfo: { name } },
      meta: { adoptsFrom: CARD_DEF },
    },
  });
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
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
            'notes/n1.json': note('An Education note'),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
            [EDUCATION_READER]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/education.json': POLICY,
            'notes/n1.json': note('An Org note'),
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

  const ASKER = {
    orgAdmin: () =>
      `Bearer ${createJWT(education, ORG_ADMIN, ['read', 'write', 'realm-owner'])}`,
    educationReader: () =>
      `Bearer ${createJWT(education, EDUCATION_READER, ['read'])}`,
    teacher: () => `Bearer ${createJWT(education, TEACHER, [])}`,
  };

  async function pointAt(policy: unknown) {
    await education.write(
      'realm.json',
      realmConfigCardJSON({ name: 'Education', policy }),
    );
    await education.indexing();
  }

  function ask(auth: string, href = CONFIG_CARD) {
    return request
      .post(`${new URL(EDUCATION).pathname}_operations`)
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope({ op: 'invoke', 'boxel:name': 'validatePolicy', href }));
  }

  async function standing(auth = ASKER.orgAdmin()): Promise<PolicyValidation> {
    let response = await ask(auth);
    if (response.status !== 200) {
      throw new Error(
        `validatePolicy answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { 'atomic:results': PolicyValidation[] })[
      'atomic:results'
    ][0];
  }

  function errorOf(response: Response) {
    return (response.body as { errors?: { code?: string }[] }).errors?.[0];
  }

  function codesOf(validation: PolicyValidation) {
    return validation.issues.map(({ code, path }) => ({ code, path }));
  }

  module('what the config card reports', function () {
    test('a policy that compiles is reported in force, with no issues', async function (assert) {
      let validation = await standing();
      assert.strictEqual(validation.card, POLICY_CARD);
      assert.deepEqual(
        validation.realms,
        [ORG],
        'the realm holding the policy card is the one served realm compiling read',
      );
      assert.notOk(validation.uncompilable, 'the policy is in force');
      assert.deepEqual(
        codesOf(validation),
        [
          {
            code: 'grants-authorization-infrastructure',
            path: 'rules[1].grants[0].operation',
          },
        ],
        'the only issue is the grant of the config card’s own validate, which grants nothing',
      );
      let compiled = await education.getCompiledPolicy();
      assert.deepEqual(
        validation.rules,
        compiled?.rules.map((rule) => ({
          path: rule.path,
          grants: rule.grants.map((grant) => ({ path: grant.path })),
        })),
        'what it reports in force is what the realm holds in force',
      );
    });

    test('a pointer to a card the index does not hold is reported as policy-card-missing', async function (assert) {
      await pointAt(MISSING_CARD);
      let validation = await standing();
      assert.strictEqual(validation.card, MISSING_CARD);
      assert.true(validation.uncompilable, 'the policy is not in force');
      assert.deepEqual(codesOf(validation), [
        { code: 'policy-card-missing', path: '' },
      ]);
      assert.true(
        validation.issues[0].message.includes(MISSING_CARD),
        `the message names the card the pointer names: ${validation.issues[0].message}`,
      );
      assert.deepEqual(validation.rules, [], 'and nothing is in force');
      assert.true(
        (await education.getCompiledPolicy())?.uncompilable,
        'the realm agrees',
      );
    });

    test('a pointer to a card that is not a policy is reported as not-a-policy', async function (assert) {
      await pointAt(ORG_NOTE);
      let validation = await standing();
      assert.strictEqual(validation.card, ORG_NOTE);
      assert.true(validation.uncompilable, 'the policy is not in force');
      assert.deepEqual(codesOf(validation), [
        { code: 'not-a-policy', path: '' },
      ]);
    });

    test('fixing the pointer clears the issue', async function (assert) {
      await pointAt(MISSING_CARD);
      assert.deepEqual(
        codesOf(await standing()).map(({ code }) => code),
        ['policy-card-missing'],
      );

      await pointAt(POLICY_CARD);
      let validation = await standing();
      assert.strictEqual(validation.card, POLICY_CARD);
      assert.notOk(validation.uncompilable, 'the policy is in force again');
      assert.false(
        validation.issues.some(({ path }) => path === ''),
        'and no issue about the card as a whole remains',
      );
    });

    test('a realm that names no policy reports none, however its pointer is left out', async function (assert) {
      for (let pointer of [undefined, '', '   ', null, 'policies/relative']) {
        await pointAt(pointer);
        let validation = await standing();
        assert.deepEqual(
          validation,
          { realms: [], issues: [], rules: [] },
          `a pointer of ${JSON.stringify(pointer)} names no policy`,
        );
      }
    });
  });

  module('who is told', function () {
    test('a reader of the realm is told about a policy card in that realm', async function (assert) {
      await pointAt(EDUCATION_NOTE);
      let validation = await standing(ASKER.educationReader());
      assert.deepEqual(codesOf(validation), [
        { code: 'not-a-policy', path: '' },
      ]);
    });

    test('a reader of the realm who cannot read the policy card’s realm is refused, the same whether or not the card is there', async function (assert) {
      let inForce = await ask(ASKER.educationReader());
      assert.strictEqual(inForce.status, 403, inForce.text);
      assert.strictEqual(errorOf(inForce)?.code, 'operation-not-permitted');

      await pointAt(MISSING_CARD);
      let missing = await ask(ASKER.educationReader());
      await pointAt(ORG_NOTE);
      let notAPolicy = await ask(ASKER.educationReader());
      assert.deepEqual(
        missing.body,
        inForce.body,
        'a missing card is refused in the same bytes as a policy in force',
      );
      assert.deepEqual(
        notAPolicy.body,
        inForce.body,
        'and so is a card that is not a policy',
      );

      let answered = await standing(ASKER.orgAdmin());
      assert.deepEqual(
        codesOf(answered).map(({ code }) => code),
        ['not-a-policy'],
        'while a caller who reads both realms is told why',
      );
    });

    test('a pointer into a realm no realm here serves is refused as one the caller cannot read is', async function (assert) {
      let unreadable = await ask(ASKER.educationReader());
      await pointAt(UNSERVED_CARD);
      let unserved = await ask(ASKER.orgAdmin());
      assert.strictEqual(unserved.status, 403, unserved.text);
      assert.deepEqual(
        unserved.body,
        unreadable.body,
        'whether a realm is served here is not told either',
      );
    });

    test('a caller the realm admits only through grants is refused as a card that is not there is', async function (assert) {
      let refused = await ask(ASKER.teacher());
      let missing = await ask(ASKER.teacher(), `${EDUCATION}no-such-card`);
      assert.strictEqual(
        refused.status,
        404,
        'the realm’s policy grants every card, and the config card’s validate, and still does not reach it',
      );
      assert.strictEqual(errorOf(refused)?.code, 'target-not-found');
      assert.deepEqual(
        refused.body,
        missing.body,
        'and the caller is told exactly what a card that does not exist is told',
      );
    });
  });
});
