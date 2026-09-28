import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  newOperationScope,
  resolveOperation,
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

// Authorization infrastructure stays outside what a realm's policy can grant.
// An operation whose declaration is `nonGrantable`, and any write to the card
// the realm's `policy` key names, are invocable only by a caller the realm's
// own ACL allows. The policy here grants `update` and the built-in append on
// every card, which are the broadest grants there are, and each named
// operation the tests invoke on the type that declares it. A reader of the
// realm holds no write permission, so each of their writes reaches the gate.
const SCHOOL = 'http://127.0.0.1:4444/school/';
const POLICY_CARD = `${SCHOOL}policies/school`;
const DRAFT_POLICY = `${SCHOOL}policies/draft`;
const ADMIN = '@school-admin:localhost';
const READER = '@reader:localhost';

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };
const LEDGER = { module: `${SCHOOL}ledger`, name: 'Ledger' };
const OPEN_LEDGER = { module: `${SCHOOL}ledger`, name: 'OpenLedger' };
const SCHOOL_POLICY = {
  module: `${SCHOOL}school-policy`,
  name: 'SchoolPolicy',
};

const LEDGER_1 = `${SCHOOL}ledgers/l1`;
const OPEN_LEDGER_1 = `${SCHOOL}ledgers/open-1`;
const JOURNAL_1 = `${SCHOOL}journals/j1`;
const NOTE = `${SCHOOL}note`;

// `update` and `seal` are kept out of every policy's reach. `annotate` is an
// ordinary operation on the same type. `OpenLedger` redeclares both of the
// kept operations without the flag.
const LEDGER_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Ledger extends CardDef {
    @field status = contains(StringField);
    @field note = contains(StringField);

    @operation static update = { base: 'update', nonGrantable: true };

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

  export class OpenLedger extends Ledger {
    @operation static update = { base: 'update' };

    @operation static seal = {
      base: 'transform',
      set: { status: 'sealed' },
    };
  }
`;

// The built-in append, declared under its own name only to keep it out of a
// policy's reach. It still takes its field and items from the invocation.
const JOURNAL_MODULE = `
  import { containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Journal extends CardDef {
    @field entries = containsMany(StringField);

    @operation static appendContainsMany = {
      base: 'appendContainsMany',
      nonGrantable: true,
    };
  }
`;

// A policy type with an ordinary named write of its own, which nothing marks
// non-grantable. The realm's policy card is one of these, and so is a draft
// the realm's pointer does not name.
const SCHOOL_POLICY_MODULE = `
  import { contains, field } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";

  export class SchoolPolicy extends RealmPolicy {
    @field motto = contains(StringField);

    @operation static setMotto = {
      base: 'transform',
      params: { motto: StringField },
      set: { motto: params('motto') },
    };
  }
`;

type Rule = {
  targetType: { module: string; name: string };
  grants: { operation: string }[];
};

const RULES: Rule[] = [
  {
    targetType: CARD_DEF,
    grants: ['update', 'appendContainsMany'].map((operation) => ({
      operation,
    })),
  },
  // The kept operations granted on the type that declares them, as a policy
  // author might write them, beside an ordinary one. Compiling records each
  // kept one and leaves it out, and the gate refuses it whatever a compiled
  // policy holds.
  {
    targetType: LEDGER,
    grants: ['update', 'seal', 'annotate'].map((operation) => ({ operation })),
  },
  // A named write on a policy type, which compiling records and leaves out
  // too.
  { targetType: SCHOOL_POLICY, grants: [{ operation: 'setMotto' }] },
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

// A type as a write's document names it.
function adoptsFrom(ref: { module: string; name: string }) {
  return { module: rri(ref.module), name: ref.name };
}

module(basename(import.meta.filename), function (hooks) {
  let school: Realm;
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
          realmURL: new URL(SCHOOL),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'School',
              policy: POLICY_CARD,
            }),
            'ledger.gts': LEDGER_MODULE,
            'journal.gts': JOURNAL_MODULE,
            'school-policy.gts': SCHOOL_POLICY_MODULE,
            'ledgers/l1.json': card(
              { module: '../ledger', name: 'Ledger' },
              { status: 'open', note: 'first' },
            ),
            'ledgers/open-1.json': card(
              { module: '../ledger', name: 'OpenLedger' },
              { status: 'open', note: 'first' },
            ),
            'journals/j1.json': card(
              { module: '../journal', name: 'Journal' },
              { entries: ['opened'] },
            ),
            'note.json': card(CARD_DEF, { cardInfo: { name: 'A note' } }),
            'policies/school.json': card(
              { module: '../school-policy', name: 'SchoolPolicy' },
              { rules: RULES, motto: 'Learn' },
            ),
            'policies/draft.json': card(
              { module: '../school-policy', name: 'SchoolPolicy' },
              { rules: [], motto: 'Draft' },
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
    school = result.realms.find((realm) => realm.url === SCHOOL)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      school.__testOnlyClearCaches();
      school.unsubscribe();
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(school, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(READER, ['read']),
  };

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${new URL(SCHOOL).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  // What a card's stored source holds, which is what a write changes.
  async function attributesOf(url: string) {
    let response = await request
      .get(`${new URL(url).pathname}.json`)
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', AUTH.admin());
    return (
      JSON.parse(response.text) as {
        data: { attributes: Record<string, unknown> };
      }
    ).data.attributes;
  }

  function update(
    url: string,
    type: { module: string; name: string },
    attributes: Record<string, unknown>,
  ) {
    return invoke('update', {
      href: url,
      data: {
        type: 'card',
        attributes,
        meta: { adoptsFrom: adoptsFrom(type) },
      },
    });
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

  module('a non-grantable operation', function () {
    test('no policy grant admits it, however broad', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(AUTH.reader(), invoke('seal', { href: LEDGER_1 })),
        'a named operation granted on its own type',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          update(LEDGER_1, LEDGER, { note: 'rewritten' }),
        ),
        'an update granted on CardDef and on its own type',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('appendContainsMany', {
            href: JOURNAL_1,
            data: { field: 'entries', items: ['intruded'] },
          }),
        ),
        'the built-in append, granted on CardDef',
      );
      let attributes = await attributesOf(LEDGER_1);
      assert.strictEqual(attributes.status, 'open', 'the ledger is unsealed');
      assert.strictEqual(attributes.note, 'first', 'and unedited');
      assert.deepEqual(
        (await attributesOf(JOURNAL_1)).entries,
        ['opened'],
        'and the journal holds only what it started with',
      );
    });

    test('compiling records a grant of it and leaves the grant out', async function (assert) {
      let compiled = await school.getCompiledPolicy();
      assert.deepEqual(
        compiled?.issues.map(({ code, path }) => ({ code, path })),
        [
          {
            code: 'grants-authorization-infrastructure',
            path: 'rules[1].grants[0].operation',
          },
          {
            code: 'grants-authorization-infrastructure',
            path: 'rules[1].grants[1].operation',
          },
          {
            code: 'grants-authorization-infrastructure',
            path: 'rules[2].grants[0].operation',
          },
        ],
        'the kept operations, and the named write on the policy type',
      );
      assert.deepEqual(
        compiled?.rules.map((rule) =>
          rule.grants.map((grant) => grant.operation),
        ),
        [['update', 'appendContainsMany'], ['annotate'], []],
        'the grants beside them compile',
      );
    });

    test('the refusal holds though a compiled policy carries the grant', async function (assert) {
      let core = school.operationCore;
      let compiled = await school.getCompiledPolicy();
      let ledgerRule = compiled!.rules[1];
      // The policy as it would be had compiling let the kept grants through.
      let carried: CompiledRealmPolicy = {
        ...compiled!,
        rules: [
          {
            ...ledgerRule,
            grants: [
              { operation: 'update', path: 'rules[1].grants[0]' },
              { operation: 'seal', path: 'rules[1].grants[1]' },
              ...ledgerRule.grants,
            ],
          },
        ],
      };
      let carrying = {
        ...core,
        policy: { ...core.policy!, compiledPolicy: async () => carried },
      };
      let resolve = (name: string) =>
        resolveOperation(
          carrying,
          { kind: 'instance', url: LEDGER_1 },
          name,
          newOperationScope(carrying, {
            caller: scopeCallerFor(READER),
            coarseDeclined: 'all',
          }),
        );
      assert.strictEqual(
        (await resolve('annotate')).base,
        'transform',
        'the carried policy is the one the gate consults',
      );
      for (let name of ['seal', 'update']) {
        await assert.rejects(
          resolve(name),
          /operation-not-permitted/,
          `and it refuses ${name}, which it grants`,
        );
      }
    });

    test('an ordinary operation on the same type is granted as before', async function (assert) {
      let response = await operations(
        AUTH.reader(),
        invoke('annotate', { href: LEDGER_1, data: { note: 'checked' } }),
      );
      assert.strictEqual(response.status, 200, 'the grant admits annotate');
      assert.strictEqual((await attributesOf(LEDGER_1)).note, 'checked');
    });

    test('a realm writer still invokes it', async function (assert) {
      let sealed = await operations(
        AUTH.admin(),
        invoke('seal', { href: LEDGER_1 }),
      );
      assert.strictEqual(sealed.status, 200, 'the admin seals the ledger');
      assert.strictEqual((await attributesOf(LEDGER_1)).status, 'sealed');

      let updated = await operations(
        AUTH.admin(),
        update(LEDGER_1, LEDGER, { status: 'sealed', note: 'rewritten' }),
      );
      assert.strictEqual(updated.status, 200, 'the admin updates it');
      assert.strictEqual((await attributesOf(LEDGER_1)).note, 'rewritten');

      let appended = await operations(
        AUTH.admin(),
        invoke('appendContainsMany', {
          href: JOURNAL_1,
          data: { field: 'entries', items: ['reviewed'] },
        }),
      );
      assert.strictEqual(
        appended.status,
        200,
        'the admin appends through the built-in',
      );
      assert.deepEqual(
        (await attributesOf(JOURNAL_1)).entries,
        ['opened', 'reviewed'],
        'which appended the items the invocation named',
      );
    });

    test('a subclass that redeclares it without the flag cannot make it grantable', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('seal', { href: OPEN_LEDGER_1 }),
        ),
        'the redeclared named operation',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          update(OPEN_LEDGER_1, OPEN_LEDGER, { note: 'rewritten' }),
        ),
        'the redeclared update',
      );
      let annotated = await operations(
        AUTH.reader(),
        invoke('annotate', { href: OPEN_LEDGER_1, data: { note: 'checked' } }),
      );
      assert.strictEqual(
        annotated.status,
        200,
        'while the inherited ordinary operation is granted',
      );
    });

    test('an operation is grantable unless its declaration says otherwise', async function (assert) {
      let core = school.operationCore;
      let resolve = (url: string, name: string) =>
        resolveOperation(core, { kind: 'instance', url }, name);
      assert.true(
        (await resolve(LEDGER_1, 'seal')).nonGrantable,
        'a declaration that asks is non-grantable',
      );
      assert.strictEqual(
        (await resolve(LEDGER_1, 'annotate')).nonGrantable,
        undefined,
        'a declaration that does not ask is grantable',
      );
      assert.strictEqual(
        (await resolve(NOTE, 'update')).nonGrantable,
        undefined,
        'and so is a built-in behavior nothing declared',
      );
      let response = await operations(
        AUTH.reader(),
        update(NOTE, CARD_DEF, { cardInfo: { name: 'Renamed' } }),
      );
      assert.strictEqual(
        response.status,
        200,
        'the CardDef grant admits an update of an ordinary card',
      );
    });
  });

  module('the card the realm’s policy key names', function () {
    test('no grant admits a write to it, whatever its type allows', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('setMotto', { href: POLICY_CARD, data: { motto: 'Obey' } }),
        ),
        'a named write its type declares as grantable',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          update(POLICY_CARD, SCHOOL_POLICY, { rules: [], motto: 'Obey' }),
        ),
        'an update',
      );
      assert.strictEqual(
        (await attributesOf(POLICY_CARD)).motto,
        'Learn',
        'the policy card is unchanged',
      );
      let draft = await operations(
        AUTH.reader(),
        update(DRAFT_POLICY, SCHOOL_POLICY, { rules: [], motto: 'Revised' }),
      );
      assert.strictEqual(
        draft.status,
        200,
        'the same grant admits the write to a card of the same type the pointer does not name',
      );
      assert.strictEqual((await attributesOf(DRAFT_POLICY)).motto, 'Revised');
    });

    test('a pointer that names the card by its stored source names the same card', async function (assert) {
      await school.write(
        'realm.json',
        realmConfigCardJSON({ name: 'School', policy: `${POLICY_CARD}.json` }),
      );
      await school.indexing();
      let annotated = await operations(
        AUTH.reader(),
        invoke('annotate', { href: LEDGER_1, data: { note: 'checked' } }),
      );
      assert.strictEqual(annotated.status, 200, 'the policy still applies');
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('setMotto', { href: POLICY_CARD, data: { motto: 'Obey' } }),
        ),
        'and the card it names is still out of its reach',
      );
    });

    test('a realm writer still writes it', async function (assert) {
      let response = await operations(
        AUTH.admin(),
        invoke('setMotto', { href: POLICY_CARD, data: { motto: 'Teach' } }),
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual((await attributesOf(POLICY_CARD)).motto, 'Teach');
    });
  });

  module('the realm’s config card', function () {
    // The card stored at `realm.json`, which holds the policy key. Rewriting
    // it to name a card the caller controls would replace the whole policy.
    const REALM_CONFIG_CARD = `${SCHOOL}realm`;

    function repoint(policy: string) {
      let { data } = JSON.parse(
        realmConfigCardJSON({ name: 'School', policy }),
      ) as { data: Record<string, unknown> };
      return invoke('update', { href: REALM_CONFIG_CARD, data });
    }

    test('no grant admits a write to it', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(AUTH.reader(), repoint(DRAFT_POLICY)),
        'an update granted on CardDef that would repoint the policy',
      );
      assert.strictEqual(
        (await attributesOf(REALM_CONFIG_CARD)).policy,
        POLICY_CARD,
        'the realm still names its policy card',
      );
    });

    test('a realm writer still writes it', async function (assert) {
      let response = await operations(AUTH.admin(), repoint(DRAFT_POLICY));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        (await attributesOf(REALM_CONFIG_CARD)).policy,
        DRAFT_POLICY,
      );
    });
  });
});
