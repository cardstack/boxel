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
  resolveGatedOperation,
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
// An operation whose declaration is `nonGrantable`, and any operation on the
// realm's config card, on the card the realm's `policy` key names, or on a
// policy card at all, are invocable only by a caller the realm's own ACL
// allows. The policy here grants every built-in write and every read on every
// card, which is the broadest grant there is, and each named operation the
// tests invoke on the type that declares it. A reader of the realm holds no
// write permission, so each of their writes reaches the gate. A stranger holds
// no permission at all, so each of their reads reaches it too.
//
// The school realm also stores the policy card the Education realm's `policy`
// key names, a card the school realm's own key does not name.
const SCHOOL = 'http://127.0.0.1:4444/school/';
const EDUCATION = 'http://127.0.0.1:4444/education/';
const POLICY_CARD = `${SCHOOL}policies/school`;
const DRAFT_POLICY = `${SCHOOL}policies/draft`;
const PLAIN_POLICY = `${SCHOOL}policies/plain`;
const EDUCATION_POLICY = `${SCHOOL}policies/education`;
const ADMIN = '@school-admin:localhost';
const READER = '@reader:localhost';
const STRANGER = '@stranger:localhost';

const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };
const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const LEDGER = { module: `${SCHOOL}ledger`, name: 'Ledger' };
const OPEN_LEDGER = { module: `${SCHOOL}ledger`, name: 'OpenLedger' };
const SCHOOL_POLICY = {
  module: `${SCHOOL}school-policy`,
  name: 'SchoolPolicy',
};
const DRAFTER = { module: `${SCHOOL}drafter`, name: 'Drafter' };

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

// A type with two named creates: one mints a policy card of `RealmPolicy`
// itself, and one mints an ordinary card.
const DRAFTER_MODULE = `
  import { CardDef } from "@cardstack/base/card-api";
  import { operation } from "@cardstack/base/operations";
  import { RealmPolicy } from "@cardstack/catalog/realm-policy/realm-policy";
  import { Ledger } from "./ledger";

  export class Drafter extends CardDef {
    @operation static draftPolicy = { base: 'create', of: RealmPolicy };
    @operation static draftLedger = { base: 'create', of: Ledger };
  }
`;

type Rule = {
  targetType: { module: string; name: string };
  grants: { operation: string }[];
};

// The built-in writes, each granted realm-wide. A named operation is granted
// on the type that declares it, since that is the only type it names.
const CARD_DEF_GRANTS = [
  'create',
  'update',
  'delete',
  'transform',
  'appendContainsMany',
];

const RULES: Rule[] = [
  {
    targetType: CARD_DEF,
    grants: CARD_DEF_GRANTS.map((operation) => ({ operation })),
  },
  // The kept operations granted on the type that declares them, as a policy
  // author might write them, beside an ordinary one. Compiling records each
  // kept one and leaves it out, and the gate refuses it whatever a compiled
  // policy holds.
  {
    targetType: LEDGER,
    grants: ['update', 'seal', 'annotate'].map((operation) => ({ operation })),
  },
  // The named creates granted on the type that declares them.
  {
    targetType: DRAFTER,
    grants: [{ operation: 'draftPolicy' }, { operation: 'draftLedger' }],
  },
  // A named write on a policy type, which compiling records and leaves out
  // too.
  { targetType: SCHOOL_POLICY, grants: [{ operation: 'setMotto' }] },
  // Every read of every card: its assembled document, and its stored source.
  {
    targetType: CARD_DEF,
    grants: [{ operation: 'read' }, { operation: 'readSource' }],
  },
];

// What the Education realm's policy grants, which is only read.
const EDUCATION_RULES: Rule[] = [
  { targetType: CARD_DEF, grants: [{ operation: 'read' }] },
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
  let education: Realm;
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
            'drafter.gts': DRAFTER_MODULE,
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
            'policies/plain.json': card(REALM_POLICY, { rules: [] }),
            'policies/education.json': card(REALM_POLICY, {
              rules: EDUCATION_RULES,
            }),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
          },
        },
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: EDUCATION_POLICY,
            }),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
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
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      for (let realm of [school, education]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
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
    stranger: () => bearer(STRANGER),
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

  // Resolves invocations on `url` for the reader, whom the realm ACL lets read
  // and not write, against a compiled policy holding `rules`, as the policy
  // would be had compiling let them through. It shows what the gate refuses of
  // a grant that reached a compiled policy however it came to be there.
  //
  // It resolves through the gated entry and keeps only the definition, so it
  // refuses only what the gate refuses: a write the gate admits resolves,
  // though the write lock would still judge its stored card. The plain
  // resolution refuses every write it would leave to the lock, which is every
  // write to a stored card, so through it an admitted write would be refused
  // too, and a refusal would say nothing about the gate.
  function carrying(
    rules: CompiledRealmPolicy['rules'],
    url: string,
  ): (name: string) => ReturnType<typeof resolveOperation> {
    let core = school.operationCore;
    let policy: CompiledRealmPolicy = {
      card: POLICY_CARD,
      version: undefined,
      rules,
      issues: [],
    };
    let carried = {
      ...core,
      policy: { ...core.policy!, compiledPolicy: async () => policy },
    };
    return async (name) =>
      (
        await resolveGatedOperation(
          carried,
          { kind: 'instance', url },
          name,
          newOperationScope(carried, {
            caller: scopeCallerFor(READER),
            coarseDeclined: 'writes',
          }),
        )
      ).definition;
  }

  // What each way of reading a card answers: its assembled document over the
  // operations envelope and the card+json read, and its stored source over the
  // card+source read and the realm's file serve, which answers an `Accept` no
  // route claims. The envelope sends a stored-bytes read to those two routes.
  async function readStatuses(auth: string, url: string) {
    let source = `${url}.json`;
    let get = (target: string, accept: string) =>
      request
        .get(new URL(target).pathname)
        .set('Accept', accept)
        .set('Authorization', auth);
    return {
      read: (await operations(auth, invoke('read', { href: url }))).status,
      cardJson: (await get(url, SupportedMimeType.CardJson)).status,
      cardSource: (await get(source, SupportedMimeType.CardSource)).status,
      fileServe: (await get(source, 'image/png')).status,
    };
  }

  function everyRead(status: number) {
    return {
      read: status,
      cardJson: status,
      cardSource: status,
      fileServe: status,
    };
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
            path: 'rules[3].grants[0].operation',
          },
        ],
        'the kept operations, and the named write on the policy type',
      );
      assert.deepEqual(
        compiled?.rules.map((rule) =>
          rule.grants.map((grant) => grant.operation),
        ),
        [
          CARD_DEF_GRANTS,
          ['annotate'],
          ['draftPolicy', 'draftLedger'],
          [],
          ['read', 'readSource'],
        ],
        'the grants beside them compile',
      );
    });

    test('the refusal holds though a compiled policy carries the grant', async function (assert) {
      let ledgerRule = (await school.getCompiledPolicy())!.rules[1];
      let resolve = carrying(
        [
          {
            ...ledgerRule,
            grants: [
              { operation: 'update', path: 'rules[1].grants[0]' },
              { operation: 'seal', path: 'rules[1].grants[1]' },
              ...ledgerRule.grants,
            ],
          },
        ],
        LEDGER_1,
      );
      assert.strictEqual(
        (await resolve('annotate')).base,
        'transform',
        'the carried grant admits annotate',
      );
      // The realm's own policy grants annotate too, so only a carried policy
      // that grants nothing shows the gate consults the carried one.
      await assert.rejects(
        carrying([], LEDGER_1)('annotate'),
        /operation-not-permitted/,
        'the gate consults the carried policy, which grants nothing',
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

  // The card here is a policy card, which the type rule refuses as well, so
  // these are outcomes. That the gate knows the card by its identity, under
  // either spelling of the key, is pinned in the dispatch suite, where the
  // card's type can be kept out of the policy's family.
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
    });

    test('no grant admits a read of it or of its stored source', async function (assert) {
      assert.deepEqual(
        await readStatuses(AUTH.stranger(), NOTE),
        everyRead(200),
        'the grant admits every read of an ordinary card',
      );
      assert.deepEqual(
        await readStatuses(AUTH.stranger(), POLICY_CARD),
        everyRead(404),
        'and none of the card the key names',
      );
      assert.deepEqual(
        await readStatuses(AUTH.reader(), POLICY_CARD),
        everyRead(200),
        'which a realm reader still reads every way',
      );
    });

    test('a pointer that names the card by its stored source still loads the policy', async function (assert) {
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
        'and a write to the card it names is still refused',
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

  module('a policy card', function () {
    function create(
      type: { module: string; name: string },
      attributes: Record<string, unknown> = {},
    ) {
      return invoke('create', {
        data: {
          type: 'card',
          attributes,
          meta: { adoptsFrom: adoptsFrom(type) },
        },
      });
    }

    const DRAFT_POLICY_BY_NAME = invoke('draftPolicy', {
      data: { meta: { adoptsFrom: adoptsFrom(DRAFTER) } },
    });

    function appendRule(url: string) {
      return invoke('appendContainsMany', {
        href: url,
        data: {
          field: 'rules',
          items: [{ targetType: CARD_DEF, grants: [{ operation: 'update' }] }],
        },
      });
    }

    test('RealmPolicy declares each of its writes non-grantable', async function (assert) {
      let core = school.operationCore;
      for (let name of [
        'update',
        'delete',
        'transform',
        'appendContainsMany',
      ]) {
        assert.true(
          (
            await resolveOperation(
              core,
              { kind: 'instance', url: PLAIN_POLICY },
              name,
            )
          ).nonGrantable,
          `${name} is non-grantable`,
        );
      }
    });

    test('no grant admits a write to one, whether or not a key names it', async function (assert) {
      let compiled = await school.getCompiledPolicy();
      assert.deepEqual(
        compiled?.rules
          .find((rule) => rule.targetType.name === 'CardDef')
          ?.grants.map((grant) => grant.operation),
        CARD_DEF_GRANTS,
        'the policy grants each write realm-wide',
      );
      let cards: [string, { module: string; name: string }, string][] = [
        [PLAIN_POLICY, REALM_POLICY, 'a RealmPolicy no key names'],
        [POLICY_CARD, SCHOOL_POLICY, 'the card the realm’s key names'],
      ];
      for (let [url, type, label] of cards) {
        let before = await attributesOf(url);
        assertNotPermitted(
          assert,
          await operations(AUTH.reader(), update(url, type, { rules: RULES })),
          `${label}: an update`,
        );
        assertNotPermitted(
          assert,
          await operations(AUTH.reader(), appendRule(url)),
          `${label}: an append to its rules`,
        );
        assertNotPermitted(
          assert,
          await operations(AUTH.reader(), invoke('transform', { href: url })),
          `${label}: a transform`,
        );
        assertNotPermitted(
          assert,
          await operations(AUTH.reader(), invoke('delete', { href: url })),
          `${label}: a delete`,
        );
        assert.deepEqual(
          await attributesOf(url),
          before,
          `${label}: the card is unchanged`,
        );
      }
    });

    test('no grant admits a read of one, whether or not a key names it', async function (assert) {
      let cards: [string, string][] = [
        [PLAIN_POLICY, 'a RealmPolicy no key names'],
        [DRAFT_POLICY, 'a subtype no key names'],
        [EDUCATION_POLICY, 'the card another realm’s key names'],
      ];
      for (let [url, label] of cards) {
        assert.deepEqual(
          await readStatuses(AUTH.stranger(), url),
          everyRead(404),
          `${label}: no read reaches it`,
        );
        assert.deepEqual(
          await readStatuses(AUTH.reader(), url),
          everyRead(200),
          `${label}: a realm reader still reads it`,
        );
      }
    });

    test('no grant admits a write a subtype declares for itself', async function (assert) {
      await assert.rejects(
        carrying(
          [
            {
              targetType: CARD_DEF,
              path: 'rules[0]',
              grants: [{ operation: 'setMotto', path: 'rules[0].grants[0]' }],
            },
          ],
          DRAFT_POLICY,
        )('setMotto'),
        /operation-not-permitted/,
        'the gate refuses the named write though a compiled policy grants it on every card',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          invoke('setMotto', { href: DRAFT_POLICY, data: { motto: 'Obey' } }),
        ),
        'a named write the subtype declares as grantable',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          update(DRAFT_POLICY, SCHOOL_POLICY, { rules: RULES, motto: 'Obey' }),
        ),
        'an update, which the subtype inherits',
      );
      assert.strictEqual(
        (await attributesOf(DRAFT_POLICY)).motto,
        'Draft',
        'the draft is unchanged',
      );
    });

    test('no grant admits a create that mints one', async function (assert) {
      assertNotPermitted(
        assert,
        await operations(AUTH.reader(), create(REALM_POLICY, { rules: RULES })),
        'a create of RealmPolicy',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          create(SCHOOL_POLICY, { rules: RULES }),
        ),
        'a create of a subtype',
      );
      assertNotPermitted(
        assert,
        await operations(AUTH.reader(), DRAFT_POLICY_BY_NAME),
        'a named create, declared on another type, that mints one',
      );
      let ledger = await operations(
        AUTH.reader(),
        create(LEDGER, { status: 'open' }),
      );
      assert.strictEqual(
        ledger.status,
        200,
        'while the same grant admits a create of an ordinary card',
      );
      let draftedLedger = await operations(
        AUTH.reader(),
        invoke('draftLedger', {
          data: { meta: { adoptsFrom: adoptsFrom(DRAFTER) } },
        }),
      );
      assert.strictEqual(
        draftedLedger.status,
        200,
        'and the rule that grants the named create admits one that mints an ordinary card',
      );
    });

    test('a card another realm’s policy key names is out of reach of this realm’s grants', async function (assert) {
      assert.deepEqual(
        (await education.getCompiledPolicy())?.rules.map((rule) =>
          rule.grants.map((grant) => grant.operation),
        ),
        [['read']],
        'the Education realm compiles the card the school realm stores',
      );
      assertNotPermitted(
        assert,
        await operations(
          AUTH.reader(),
          update(EDUCATION_POLICY, REALM_POLICY, { rules: RULES }),
        ),
        'an update granted by the school realm',
      );
      assertNotPermitted(
        assert,
        await operations(AUTH.reader(), appendRule(EDUCATION_POLICY)),
        'an append to its rules',
      );
      assert.deepEqual(
        (await education.getCompiledPolicy())?.rules.map((rule) =>
          rule.grants.map((grant) => grant.operation),
        ),
        [['read']],
        'and the Education realm’s policy is unchanged',
      );
    });

    test('a realm writer still writes one', async function (assert) {
      let appended = await operations(AUTH.admin(), appendRule(PLAIN_POLICY));
      assert.strictEqual(appended.status, 200, 'the admin appends a rule');
      assert.strictEqual(
        ((await attributesOf(PLAIN_POLICY)).rules as unknown[]).length,
        1,
        'which the card now holds',
      );

      let updated = await operations(
        AUTH.admin(),
        update(PLAIN_POLICY, REALM_POLICY, { rules: [] }),
      );
      assert.strictEqual(updated.status, 200, 'the admin updates it');
      assert.deepEqual((await attributesOf(PLAIN_POLICY)).rules, []);

      let named = await operations(
        AUTH.admin(),
        invoke('setMotto', { href: DRAFT_POLICY, data: { motto: 'Revised' } }),
      );
      assert.strictEqual(
        named.status,
        200,
        'the admin invokes a named write the subtype declares',
      );
      assert.strictEqual((await attributesOf(DRAFT_POLICY)).motto, 'Revised');

      let created = await operations(
        AUTH.admin(),
        create(REALM_POLICY, { rules: [] }),
      );
      assert.strictEqual(created.status, 200, 'the admin creates one');
      let drafted = await operations(AUTH.admin(), DRAFT_POLICY_BY_NAME);
      assert.strictEqual(
        drafted.status,
        200,
        'and mints one through the named create',
      );

      let deleted = await operations(
        AUTH.admin(),
        invoke('delete', { href: PLAIN_POLICY }),
      );
      assert.strictEqual(deleted.status, 200, 'the admin deletes it');
      let gone = await request
        .get(`${new URL(PLAIN_POLICY).pathname}.json`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', AUTH.admin());
      assert.strictEqual(gone.status, 404, 'and it is gone');
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

    test('no grant admits a read of it or of its stored source', async function (assert) {
      assert.deepEqual(
        await readStatuses(AUTH.stranger(), REALM_CONFIG_CARD),
        everyRead(404),
        'a read granted on CardDef reaches none of it',
      );
      assert.deepEqual(
        await readStatuses(AUTH.reader(), REALM_CONFIG_CARD),
        everyRead(200),
        'while a realm reader still reads it every way',
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
