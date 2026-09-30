import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { baseRRI, rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
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
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// ============================================================================
// What a search finds of a realm's authorization infrastructure for a caller
// the realm reaches only through its policy.
//
// The gate refuses a grant-reached caller every operation on the realm's
// config card, on the card its policy key names, and on any policy card. A
// search never passes the gate: it is authorized on the search engine, which
// composes each matching `query` grant's filter into the query. A grant on a
// catch-all type such as `CardDef` compiles to a filter every card row
// matches, these cards included, so the search excludes them itself.
//
// The School realm governs itself: its policy card is stored in it, and the
// policy grants an ad-hoc query over every card. It also stores a draft policy
// card no key names, and the policy card the District realm's key names. The
// teacher holds no permission on School at all, so every row they are served
// is one that grant admits. The School admin reads the realm outright, so no
// policy is consulted for them.
// ============================================================================

const SCHOOL = 'http://127.0.0.1:4444/school/';
const DISTRICT = 'http://127.0.0.1:4444/district/';
const ADMIN = '@school-admin:localhost';
const DISTRICT_ADMIN = '@district-admin:localhost';
const TEACHER = '@teacher:localhost';

const CARD_DEF = { module: baseRRI('card-api'), name: 'CardDef' };
const REALM_CONFIG = { module: baseRRI('realm-config'), name: 'RealmConfig' };
const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Notice extends CardDef {
    @field title = contains(StringField);
  }
`;

function policyCard(
  rules: {
    targetType: { module: string; name: string };
    grants: { operation: string }[];
  }[],
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function notice(title: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
      meta: { adoptsFrom: { module: '../notice', name: 'Notice' } },
    },
  });
}

const CONFIG_CARD = `${SCHOOL}realm`;
const POLICY_CARD = `${SCHOOL}policies/policy`;
const DRAFT_POLICY_CARD = `${SCHOOL}policies/draft`;
const DISTRICT_POLICY_CARD = `${SCHOOL}policies/district`;
const WELCOME = `${SCHOOL}notices/welcome`;

const INFRASTRUCTURE = [
  CONFIG_CARD,
  DISTRICT_POLICY_CARD,
  DRAFT_POLICY_CARD,
  POLICY_CARD,
];

module(basename(import.meta.filename), function (hooks) {
  let school: Realm;
  let district: Realm;
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
            'notice.gts': NOTICE_MODULE,
            'notices/welcome.json': notice('Welcome'),
            'policies/policy.json': policyCard([
              { targetType: CARD_DEF, grants: [{ operation: 'query' }] },
            ]),
            'policies/draft.json': policyCard([]),
            'policies/district.json': policyCard([]),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(DISTRICT),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'District',
              policy: DISTRICT_POLICY_CARD,
            }),
          },
          permissions: {
            [DISTRICT_ADMIN]: ['read', 'write', 'realm-owner'],
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
    district = result.realms.find((realm) => realm.url === DISTRICT)!;
  }

  // One server for the whole module, since every test only reads. Booting it
  // indexes both realms, which runs inside the first test's budget, so that
  // budget is extended past the per-test timeout.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    after: async () => {
      // Guarded, so a boot that failed partway still closes what it opened.
      for (let realm of [school, district]) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  type Caller = 'admin' | 'teacher';
  const USERS: Record<Caller, string> = { admin: ADMIN, teacher: TEACHER };
  const PERMISSIONS: Record<Caller, RealmPermissions['user']> = {
    admin: ['read', 'write', 'realm-owner'],
    teacher: [],
  };

  function federatedSearch(caller: Caller, payload: object) {
    return request
      .post('/_federated-search')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: USERS[caller], sessionRoom: `session-room-${caller}` },
          realmSecretSeed,
        )}`,
      )
      .send(payload);
  }

  function realmSearch(caller: Caller, payload: object) {
    return request
      .post(`${new URL(SCHOOL).pathname}_search`)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(
        'Authorization',
        `Bearer ${createJWT(school, USERS[caller], PERMISSIONS[caller])}`,
      )
      .send(payload);
  }

  const ENDPOINTS = [
    ['a federated search', federatedSearch],
    ["the realm's own search", realmSearch],
  ] as const;

  function adHoc(on: { module: string; name: string }) {
    return { filter: { 'item.on': on }, realms: [SCHOOL] };
  }

  type SearchBody = {
    data: { id: string }[];
    meta?: { policyScopedRealms?: string[] };
  };

  async function ids(
    send: (caller: Caller, payload: object) => Test,
    caller: Caller,
    on: { module: string; name: string },
  ): Promise<{ ids: string[]; body: SearchBody }> {
    let response = await send(caller, adHoc(on));
    if (response.status !== 200) {
      throw new Error(`search answered ${response.status}: ${response.text}`);
    }
    let body = response.body as SearchBody;
    return { ids: body.data.map((entry) => entry.id).sort(), body };
  }

  for (let [label, send] of ENDPOINTS) {
    module(label, function () {
      test('a query grant on CardDef lists every card but the config card and the policy cards', async function (assert) {
        let found = await ids(send, 'teacher', CARD_DEF);
        assert.deepEqual(
          found.ids,
          [WELCOME],
          'the notice the grant admits, and none of the cards that hold the realm’s authorization',
        );
      });

      test('a search on RealmPolicy finds no policy card, whichever realm’s key names it', async function (assert) {
        let found = await ids(send, 'teacher', REALM_POLICY);
        assert.deepEqual(
          found.ids,
          [],
          'not the card this realm’s key names, not a draft no key names, and not the one another realm’s key names',
        );
        assert.deepEqual(
          found.body.meta?.policyScopedRealms,
          [SCHOOL],
          'marked policy-scoped, as a search the grant admits rows to is',
        );
      });

      test('a search on RealmConfig finds no config card', async function (assert) {
        let found = await ids(send, 'teacher', REALM_CONFIG);
        assert.deepEqual(found.ids, []);
      });

      test('a caller the realm ACL admits still finds every one of them', async function (assert) {
        let found = await ids(send, 'admin', CARD_DEF);
        assert.deepEqual(
          found.ids,
          [...INFRASTRUCTURE, WELCOME].sort(),
          'the config card, every policy card, and the notice',
        );
        assert.deepEqual(
          (await ids(send, 'admin', REALM_POLICY)).ids,
          [DISTRICT_POLICY_CARD, DRAFT_POLICY_CARD, POLICY_CARD],
          'and a search on RealmPolicy finds every policy card',
        );
        assert.strictEqual(
          found.body.meta?.policyScopedRealms,
          undefined,
          'with no policy-scoped mark',
        );
      });
    });
  }
});
