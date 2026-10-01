import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  PolicyExplanation,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  newOperationScope,
  resolveGatedOperation,
  scopeCallerFor,
  type CompiledRealmPolicy,
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
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A policy judges an operation by every type the target's adoption chain
// records, and the chain records each type by its key. Here the types a rule
// names descend from ones whose keys are spelled like the keys of classes a
// module does not export: a type exported from a module under a `fields/`
// directory, and a type exported from a module named `fields`. Beside them is
// a type that does descend from a class its module does not export.
const REALM_URL = 'http://127.0.0.1:4444/chain-types/';
const POLICY_CARD = `${REALM_URL}policies/policy`;
const ADMIN = '@testRealm-admin:localhost';
const READER = '@reader:localhost';
const STRANGER = '@stranger:localhost';

const RATED = { module: `${REALM_URL}fields/rating/rated`, name: 'Rated' };
const RATED_PLAN = { module: `${REALM_URL}rated-plan`, name: 'RatedPlan' };
const TIER = { module: `${REALM_URL}plan/fields`, name: 'Tier' };
const TIER_PLAN = { module: `${REALM_URL}tier-plan`, name: 'TierPlan' };
const LOCAL = { module: `${REALM_URL}local`, name: 'Local' };

const RATED_PLAN_1 = `${REALM_URL}rated-plans/p1`;
const TIER_PLAN_1 = `${REALM_URL}tier-plans/t1`;

// `seal` is kept out of every policy's reach where it is declared, and the
// subclass redeclares it without the flag. `annotate` is an ordinary
// operation.
const RATED_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Rated extends CardDef {
    @field status = contains(StringField);
    @field note = contains(StringField);

    @operation static seal = {
      base: 'transform',
      set: { status: 'sealed' },
      nonGrantable: true,
    };

    @operation static annotate = {
      base: 'transform',
      params: { note: StringField },
      set: { note: params('note') },
    };
  }
`;

const RATED_PLAN_MODULE = `
  import { operation } from "@cardstack/base/operations";
  import { Rated } from "./fields/rating/rated";

  export class RatedPlan extends Rated {
    @operation static seal = {
      base: 'transform',
      set: { status: 'sealed' },
    };
  }
`;

const TIER_MODULE = `
  import { CardDef } from "@cardstack/base/card-api";

  export class Tier extends CardDef {}
`;

const TIER_PLAN_MODULE = `
  import { Tier } from "./plan/fields";

  export class TierPlan extends Tier {}
`;

// The class `Local` extends is not exported, so it has no definition entry,
// and what it declares reaches `Local` all the same.
const LOCAL_MODULE = `
  import { CardDef } from "@cardstack/base/card-api";

  class Hidden extends CardDef {}

  export class Local extends Hidden {}
`;

type Rule = {
  targetType: { module: string; name: string };
  grants: { operation: string }[];
};

const RULES: Rule[] = [
  {
    targetType: RATED_PLAN,
    grants: ['read', 'annotate', 'seal'].map((operation) => ({ operation })),
  },
  { targetType: TIER_PLAN, grants: [{ operation: 'read' }] },
  {
    targetType: LOCAL,
    grants: [{ operation: 'read' }, { operation: 'create' }],
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
  let testRealm: Realm;
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
          realmURL: new URL(REALM_URL),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Chain Types',
              policy: POLICY_CARD,
            }),
            'fields/rating/rated.gts': RATED_MODULE,
            'rated-plan.gts': RATED_PLAN_MODULE,
            'plan/fields.gts': TIER_MODULE,
            'tier-plan.gts': TIER_PLAN_MODULE,
            'local.gts': LOCAL_MODULE,
            'rated-plans/p1.json': card(
              { module: '../rated-plan', name: 'RatedPlan' },
              { status: 'open', note: 'first' },
            ),
            'tier-plans/t1.json': card(
              { module: '../tier-plan', name: 'TierPlan' },
              {},
            ),
            'policies/policy.json': card(
              {
                module: rri('@cardstack/catalog/realm-policy/realm-policy'),
                name: 'RealmPolicy',
              },
              { rules: RULES },
            ),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
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
    testRealm = result.realms.find((realm) => realm.url === REALM_URL)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      testRealm.__testOnlyClearCaches();
      testRealm.unsubscribe();
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(testRealm, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(READER, ['read']),
    stranger: () => bearer(STRANGER),
  };

  function operations(
    auth: string,
    method: 'post' | 'query',
    ...entries: unknown[]
  ) {
    let req = request.post(`${new URL(REALM_URL).pathname}_operations`);
    if (method === 'query') {
      req = req.set('X-HTTP-Method-Override', 'QUERY');
    }
    return req
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function readAs(auth: string, url: string) {
    return request
      .get(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  async function explain(
    actor: string,
    target: string,
    operation: string,
  ): Promise<PolicyExplanation> {
    let response = await operations(
      AUTH.admin(),
      'query',
      invoke('explain', {
        href: POLICY_CARD,
        data: { actor, target, operation },
      }),
    );
    if (response.status !== 200) {
      throw new Error(
        `explain(${actor}, ${target}, ${operation}) answered ${response.status}: ${response.text}`,
      );
    }
    return (response.body as { 'atomic:results': PolicyExplanation[] })[
      'atomic:results'
    ][0];
  }

  // The rules and grants an explanation reports, by position in the policy.
  function matched(explanation: PolicyExplanation) {
    return explanation.rules.map(({ path, grants }) => ({
      path,
      grants: grants.map(({ path, outcome }) => ({ path, outcome })),
    }));
  }

  function assertNotPermitted(
    assert: Assert,
    response: Response,
    label: string,
  ) {
    assert.strictEqual(response.status, 403, `${label}: status`);
    assert.true(
      /is not permitted on/.test(response.text),
      `${label}: the gate's refusal`,
    );
  }

  // The chain each type's definition entry records beside it.
  async function chainOf(ref: { module: string; name: string }) {
    let entry =
      await testRealm.operationCore.definitionLookup.lookupDefinitionEntry({
        module: rri(ref.module),
        name: ref.name,
      });
    return entry?.types ?? [];
  }

  test('the chains are spelled as the tests need them', async function (assert) {
    let [rated, tier, local] = await Promise.all([
      chainOf(RATED_PLAN),
      chainOf(TIER_PLAN),
      chainOf(LOCAL),
    ]);
    assert.strictEqual(
      rated[1],
      `${RATED.module}/${RATED.name}`,
      'the type under a `fields/` directory',
    );
    assert.strictEqual(
      tier[1],
      `${TIER.module}/${TIER.name}`,
      'the type in a `fields` module, spelled as a field type’s key',
    );
    assert.strictEqual(
      local[1],
      `${LOCAL.module}/${LOCAL.name}/ancestor`,
      'the class its module does not export',
    );
  });

  test('a grant on a type descending from one in a `fields/` directory admits the caller it reaches', async function (assert) {
    let read = await readAs(AUTH.stranger(), RATED_PLAN_1);
    assert.strictEqual(read.status, 200, 'the grant admits a read');

    let annotated = await operations(
      AUTH.reader(),
      'post',
      invoke('annotate', { href: RATED_PLAN_1, data: { note: 'checked' } }),
    );
    assert.strictEqual(annotated.status, 200, 'and a named operation');

    let explanation = await explain(STRANGER, RATED_PLAN_1, 'read');
    assert.strictEqual(explanation.decision, 'allowed');
    assert.strictEqual(explanation.reason, 'granted');
    assert.deepEqual(
      matched(explanation),
      [
        {
          path: 'rules[0]',
          grants: [{ path: 'rules[0].grants[0]', outcome: 'unconditional' }],
        },
      ],
      'explain reports the grant that matched',
    );
    assert.deepEqual(explanation.admittedBy, { rule: 0, grant: 0 });
  });

  test('a grant on a type descending from one in a `fields` module admits the caller it reaches', async function (assert) {
    let read = await readAs(AUTH.stranger(), TIER_PLAN_1);
    assert.strictEqual(read.status, 200);
  });

  test('compiling records what the gate refuses, and keeps what it admits', async function (assert) {
    let compiled = await testRealm.getCompiledPolicy();
    assert.deepEqual(
      compiled?.issues.map(({ code, path }) => ({ code, path })),
      [
        {
          code: 'grants-authorization-infrastructure',
          path: 'rules[0].grants[2].operation',
        },
        { code: 'unresolved-type', path: 'rules[2].grants[0].operation' },
        { code: 'unresolved-type', path: 'rules[2].grants[1].operation' },
      ],
      'the flag the `fields/` type declares, and the class with no definition',
    );
    assert.true(
      compiled?.issues[0].message.includes('marked non-grantable on Rated,'),
      `the flag is reported on the type that declares it: ${compiled?.issues[0].message}`,
    );
    assert.true(
      compiled?.issues[1].message.includes(
        `${LOCAL.module}/${LOCAL.name}/ancestor`,
      ),
      `the class with no definition is named by its key: ${compiled?.issues[1].message}`,
    );
    assert.deepEqual(
      compiled?.rules.map((rule) =>
        rule.grants.map((grant) => grant.operation),
      ),
      [['read', 'annotate'], ['read'], []],
    );
  });

  test('the gate refuses what compiling recorded, though a compiled policy carries it', async function (assert) {
    let sealed = await operations(
      AUTH.reader(),
      'post',
      invoke('seal', { href: RATED_PLAN_1 }),
    );
    assertNotPermitted(assert, sealed, 'the flag the `fields/` type declares');

    // A create is judged on the chain the definition cache records beside the
    // type it mints, which names the class `Local` extends.
    let core = testRealm.operationCore;
    let ruleOn = (
      type: { module: string; name: string },
      index: number,
      operations: string[],
    ) => ({
      targetType: { module: rri(type.module), name: type.name },
      path: `rules[${index}]`,
      grants: operations.map((operation, grant) => ({
        operation,
        path: `rules[${index}].grants[${grant}]`,
      })),
    });
    let policy: CompiledRealmPolicy = {
      card: POLICY_CARD,
      version: undefined,
      rules: [
        ruleOn(RATED_PLAN, 0, ['seal', 'annotate']),
        ruleOn(TIER_PLAN, 1, ['create']),
        ruleOn(LOCAL, 2, ['create']),
      ],
      issues: [],
    };
    let carried = {
      ...core,
      policy: { ...core.policy!, compiledPolicy: async () => policy },
    };
    let resolve = (
      target: Parameters<typeof resolveGatedOperation>[1],
      name: string,
    ) =>
      resolveGatedOperation(
        carried,
        target,
        name,
        newOperationScope(carried, {
          caller: scopeCallerFor(READER),
          coarseDeclined: 'writes',
        }),
      );
    let instance = (url: string) => ({ kind: 'instance' as const, url });
    let type = (ref: { module: string; name: string }) => ({
      kind: 'type' as const,
      codeRef: { module: rri(ref.module), name: ref.name },
      realm: REALM_URL,
    });
    assert.strictEqual(
      (await resolve(instance(RATED_PLAN_1), 'annotate')).definition.base,
      'transform',
      'the carried policy admits annotate',
    );
    await assert.rejects(
      resolve(instance(RATED_PLAN_1), 'seal'),
      /operation-not-permitted/,
      'and refuses seal, which it grants',
    );
    assert.strictEqual(
      (await resolve(type(TIER_PLAN), 'create')).definition.base,
      'create',
      'it admits a create of a type whose chain it can read',
    );
    await assert.rejects(
      resolve(type(LOCAL), 'create'),
      /operation-not-permitted/,
      'and refuses a create of the type descending from a class with no definition',
    );
  });
});
