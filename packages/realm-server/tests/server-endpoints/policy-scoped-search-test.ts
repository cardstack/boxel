import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { dirSync } from 'tmp';
import {
  applyServerSearchPageBound,
  archiveRealm,
  composePolicyScopedFilter,
  DURING_PRERENDER_HEADER,
  insertPermissions,
  parseSearchEntryQueryFromPayload,
  rri,
  unarchiveRealm,
  SupportedMimeType,
  type Filter,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import { resolveNamedQuery } from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import { LIVE_SEARCH_CACHE_HEADER } from '../../handlers/handle-search.ts';
import { insertSourceRealmInRegistry } from '../../lib/realm-registry-writes.ts';
import type { RealmServer, RealmHttpServer as Server } from '../../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  indexReads,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  waitUntil,
} from '../helpers/index.ts';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';

// ============================================================================
// A search a realm's policy scopes: the grants a `query` policy compiled to
// filters, composed into the query a realm runs for a caller its ACL declined.
//
// Twelve realms on one server, one per answer a realm can give a caller it does
// not let read outright. The types live in a public library realm so every
// other realm can hold cards of them.
//
// - Grants: its policy admits a provider's own schedules to two named
//   queries, and also carries a query grant that does not compile to a filter.
// - Coarse: both providers may read it, so no policy is ever consulted.
// - Denies: its policy lets anyone read a schedule they were handed, and
//   grants no query at all.
// - Unfilterable: its only query grant does not compile to a filter.
// - Private: it names no policy, and neither provider may read it.
// - Enumerable: its policy grants `query` itself, the ad-hoc search, over
//   every open schedule and every posted notice. It grants a read of a
//   provider's own schedules only, and no read of a notice, so what a caller
//   may find and what they may read differ in both directions.
// - Missing: its `realm.json` names a policy card the realm does not hold.
// - Withheld: its policy grants `query` over every open schedule, and a test
//   withholds the latest index visit of its policy card.
// - Borrowed: the same, with its policy card stored in the library realm, as
//   a school's policy lives in its organization's realm.
// - Subtypes: its policy admits a provider's own classrooms, and it holds
//   classrooms of types descending from the rule's, one of which computes the
//   owner its cards are indexed under.
// - Rosters: its policy admits a teacher to a query over the classrooms whose
//   `teacherIds` hold them, and it holds a classroom two teachers share.
//
// Every card a provider could be admitted to in one realm has a twin in the
// realms that must not admit it, so a filter applied to the wrong realm's
// rows would show up as a row that should not be there.
// ============================================================================

const LIB = 'http://127.0.0.1:4444/lib/';
const GRANTS = 'http://127.0.0.1:4444/grants/';
const COARSE = 'http://127.0.0.1:4444/coarse/';
const DENIES = 'http://127.0.0.1:4444/denies/';
const UNFILTERABLE = 'http://127.0.0.1:4444/unfilterable/';
const PRIVATE = 'http://127.0.0.1:4444/private/';
const ENUMERABLE = 'http://127.0.0.1:4444/enumerable/';
const MISSING = 'http://127.0.0.1:4444/missing/';
const WITHHELD = 'http://127.0.0.1:4444/withheld/';
const BORROWED = 'http://127.0.0.1:4444/borrowed/';
const SUBTYPES = 'http://127.0.0.1:4444/subtypes/';
const ROSTERS = 'http://127.0.0.1:4444/rosters/';

const OWNER = '@owner:localhost';
const PROVIDER_A = '@provider-a:localhost';
const PROVIDER_B = '@provider-b:localhost';
// Holds a grant in the Grants realm, and no schedule it admits.
const PROVIDER_C = '@provider-c:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const SCHEDULE = { module: `${LIB}schedule`, name: 'ServicePlanSchedule' };
const NOTICE = { module: `${LIB}notice`, name: 'Notice' };
const CLASSROOM = { module: `${LIB}classroom`, name: 'Classroom' };
const ASSIGNED = { module: `${LIB}classroom`, name: 'AssignedClassroom' };

// `listOpen` does not compare against the caller, so two callers asking it
// of the same realms send the same request: whatever tells their answers
// apart is the policy's doing alone.
const SCHEDULE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { operation } from "@cardstack/base/operations";

  export class ServicePlanSchedule extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);
    @field status = contains(StringField);
    @field rank = contains(NumberField);

    @operation static listOpen = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
        sort: [{ on: () => ServicePlanSchedule, by: 'rank', direction: 'asc' }],
      },
    };

    @operation static listOpenInGrants = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
        realms: ['${GRANTS}'],
      },
    };

    @operation static listAll = {
      base: 'query',
      query: {
        filter: { type: () => ServicePlanSchedule },
        sort: [{ on: () => ServicePlanSchedule, by: 'rank', direction: 'asc' }],
      },
    };
  }
`;

// A type unrelated to the schedule type, so a search over both types has two
// types' rules to consult.
const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Notice extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);
    @field status = contains(StringField);
  }
`;

// Two types descending from `Classroom`. `AssignedClassroom` computes the
// owner a card of it is indexed under, so the index holds provider A's id for
// every one of them while their stored source holds none. `ReassignedClassroom`
// does the same, and the realm starts with no card of it.
// `ElectiveClassroom` adds a field and declares the owner as `Classroom` does.
const CLASSROOM_MODULE = `
  import {
    contains,
    containsMany,
    field,
    CardDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { operation } from "@cardstack/base/operations";

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field ownerId = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field visibility = contains(StringField);
    @field rank = contains(NumberField);

    @operation static listClassrooms = {
      base: 'query',
      query: {
        filter: { type: () => Classroom },
        sort: [{ on: () => Classroom, by: 'rank', direction: 'asc' }],
      },
    };

    @operation static listVisibleClassrooms = {
      base: 'query',
      query: {
        filter: { type: () => Classroom },
        sort: [{ on: () => Classroom, by: 'rank', direction: 'asc' }],
      },
    };
  }

  export class AssignedClassroom extends Classroom {
    @field ownerId = contains(StringField, {
      computeVia: function () {
        return '${PROVIDER_A}';
      },
    });
  }

  export class ReassignedClassroom extends Classroom {
    @field ownerId = contains(StringField, {
      computeVia: function () {
        return '${PROVIDER_A}';
      },
    });
  }

  export class ElectiveClassroom extends Classroom {
    @field elective = contains(StringField);
  }
`;

const OWN = '.providerId == actor()';
const OWN_CLASSROOM = '.ownerId == actor()';
const OWN_OR_PUBLIC_CLASSROOM = `${OWN_CLASSROOM} or .visibility == "public"`;
const TEACHES_CLASSROOM = '.teacherIds | any(. == actor())';
const OPEN = '.status == "open"';
const POSTED = '.status == "posted"';
// Refused by the `predicate` profile, so its grant compiles no filter. It
// holds for every card whose title reads as a positive number, which is every
// one of provider B's schedules in the Grants realm: a search that let it
// through would return them.
const UNFILTERABLE_WHERE = '(.title | tonumber) > 0';

type Grant = { operation: string; where?: string };

function policyCard(grants: Grant[]): string {
  return policyRules([{ targetType: SCHEDULE, grants }]);
}

function policyRules(
  rules: { targetType: { module: string; name: string }; grants: Grant[] }[],
): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function notice(attributes: {
  title: string;
  providerId: string;
  status: string;
}) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: { module: rri(NOTICE.module), name: NOTICE.name },
      },
    },
  });
}

function schedule(attributes: {
  title: string;
  providerId: string;
  status: string;
  rank: number;
}) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: { module: rri(SCHEDULE.module), name: SCHEDULE.name },
      },
    },
  });
}

// Provider A's and provider B's open schedules, interleaved in rank order so
// that a page of the unscoped query holds some of each. A page of A's filled
// by filtering after the fact would come back with half its rows missing.
const GRANTS_SCHEDULES: Record<string, string> = {
  ...Object.fromEntries(
    [1, 3, 5, 7, 9].map((rank) => [
      `schedules/a-open-${rank}.json`,
      schedule({
        title: `A open ${rank}`,
        providerId: PROVIDER_A,
        status: 'open',
        rank,
      }),
    ]),
  ),
  ...Object.fromEntries(
    [2, 4, 6, 8, 10].map((rank) => [
      `schedules/b-open-${rank}.json`,
      schedule({
        title: String(rank),
        providerId: PROVIDER_B,
        status: 'open',
        rank,
      }),
    ]),
  ),
  'schedules/a-closed-11.json': schedule({
    title: 'A closed 11',
    providerId: PROVIDER_A,
    status: 'closed',
    rank: 11,
  }),
};

const A_OPEN_IN_GRANTS = [1, 3, 5, 7, 9].map(
  (rank) => `${GRANTS}schedules/a-open-${rank}`,
);
const B_OPEN_IN_GRANTS = [2, 4, 6, 8, 10].map(
  (rank) => `${GRANTS}schedules/b-open-${rank}`,
);

// Each provider's schedules and notices, for a realm that grants a query on
// both types. Every card a query grant admits sits beside one it does not: a
// closed schedule, and a notice that is not posted. Provider A may read their
// closed schedule and may not find it, and may find provider B's open one and
// may not read it.
const ENUMERABLE_CARDS: Record<string, string> = {
  'schedules/a-open.json': schedule({
    title: 'A open',
    providerId: PROVIDER_A,
    status: 'open',
    rank: 1,
  }),
  'schedules/a-closed.json': schedule({
    title: 'A closed',
    providerId: PROVIDER_A,
    status: 'closed',
    rank: 2,
  }),
  'schedules/b-open.json': schedule({
    title: 'B open',
    providerId: PROVIDER_B,
    status: 'open',
    rank: 3,
  }),
  'notices/a-posted.json': notice({
    title: 'A posted',
    providerId: PROVIDER_A,
    status: 'posted',
  }),
  'notices/a-draft.json': notice({
    title: 'A draft',
    providerId: PROVIDER_A,
    status: 'draft',
  }),
  'notices/b-posted.json': notice({
    title: 'B posted',
    providerId: PROVIDER_B,
    status: 'posted',
  }),
};

function classroom(
  name: string,
  attributes: {
    title: string;
    rank: number;
    ownerId?: string;
    visibility?: string;
    teacherIds?: string[];
  },
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(CLASSROOM.module), name } },
    },
  });
}

// In rank order, provider A's own classrooms sit between cards of the type
// that computes its owner, so a page filtered after the fact would come back
// short.
const SUBTYPE_CLASSROOMS: Record<string, string> = {
  'classrooms/a-1.json': classroom('Classroom', {
    title: 'A 1',
    rank: 1,
    ownerId: PROVIDER_A,
  }),
  'classrooms/assigned-2.json': classroom('AssignedClassroom', {
    title: 'Assigned 2',
    rank: 2,
  }),
  'classrooms/elective-3.json': classroom('ElectiveClassroom', {
    title: 'Elective 3',
    rank: 3,
    ownerId: PROVIDER_A,
  }),
  'classrooms/assigned-4.json': classroom('AssignedClassroom', {
    title: 'Assigned 4',
    rank: 4,
    visibility: 'public',
  }),
  'classrooms/b-5.json': classroom('Classroom', {
    title: 'B 5',
    rank: 5,
    ownerId: PROVIDER_B,
  }),
  'classrooms/a-6.json': classroom('Classroom', {
    title: 'A 6',
    rank: 6,
    ownerId: PROVIDER_A,
  }),
};

const A_OWN_CLASSROOMS = ['a-1', 'elective-3', 'a-6'].map(
  (name) => `${SUBTYPES}classrooms/${name}`,
);

// A classroom provider A teaches alone, and one A and B share.
const ROSTER_CLASSROOMS: Record<string, string> = {
  'classrooms/a-only.json': classroom('Classroom', {
    title: 'A only',
    rank: 1,
    teacherIds: [PROVIDER_A],
  }),
  'classrooms/shared.json': classroom('Classroom', {
    title: 'Shared',
    rank: 2,
    teacherIds: [PROVIDER_A, PROVIDER_B],
  }),
};

// One of provider A's schedules, for a realm that must not admit it.
function aOpen(title = 'A open') {
  return {
    'schedules/a-open.json': schedule({
      title,
      providerId: PROVIDER_A,
      status: 'open',
      rank: 1,
    }),
  };
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('composing a policy into a filter', function () {
    const ON = { module: rri(SCHEDULE.module), name: SCHEDULE.name };
    const CALLER: Filter = { on: ON, eq: { status: 'open' } };
    const GRANT_A: Filter = { on: ON, eq: { providerId: PROVIDER_A } };
    const GRANT_B: Filter = { on: ON, eq: { providerId: PROVIDER_B } };

    test('a realm contributing no filter leaves the caller filter as it was', function (assert) {
      assert.strictEqual(
        composePolicyScopedFilter(CALLER, []),
        CALLER,
        'the very filter the caller sent, with no wrapper around it',
      );
      assert.strictEqual(
        composePolicyScopedFilter(undefined, []),
        undefined,
        'and no filter where the caller sent none',
      );
    });

    test('the grants are composed with the caller filter, and both must hold', function (assert) {
      assert.deepEqual(composePolicyScopedFilter(CALLER, [GRANT_A, GRANT_B]), {
        every: [CALLER, { any: [GRANT_A, GRANT_B] }],
      });
    });

    test('with no caller filter, the grants alone decide the rows', function (assert) {
      assert.deepEqual(composePolicyScopedFilter(undefined, [GRANT_A]), {
        any: [GRANT_A],
      });
    });
  });

  module('a search a policy scopes', function (hooks) {
    let realms: Record<string, Realm> = {};
    let request: SuperTest<Test>;
    let realmServer: RealmServer;
    let server: Server;
    let db: PgAdapter;

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
      let owner: RealmPermissions = {
        [OWNER]: ['read', 'write', 'realm-owner'],
      };
      let withPolicy = (name: string, url: string) =>
        realmConfigCardJSON({ name, policy: `${url}policies/policy` });
      let result = await runTestRealmServerWithRealms({
        virtualNetwork: createVirtualNetwork(),
        realmsRootPath: join(dirSync().name, 'realm_server_1'),
        realms: [
          {
            realmURL: new URL(LIB),
            fileSystem: {
              'schedule.gts': SCHEDULE_MODULE,
              'notice.gts': NOTICE_MODULE,
              'policies/borrowed.json': policyCard([
                { operation: 'query', where: OPEN },
              ]),
              'classroom.gts': CLASSROOM_MODULE,
            },
            permissions: { ...owner, '*': ['read'] },
          },
          {
            realmURL: new URL(GRANTS),
            fileSystem: {
              'realm.json': withPolicy('Grants', GRANTS),
              'policies/policy.json': policyCard([
                { operation: 'listOpen', where: OWN },
                { operation: 'listOpen', where: UNFILTERABLE_WHERE },
                { operation: 'listAll', where: OWN },
                { operation: 'read', where: OWN },
              ]),
              ...GRANTS_SCHEDULES,
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(COARSE),
            fileSystem: {
              ...aOpen(),
              'schedules/b-open.json': schedule({
                title: 'B open',
                providerId: PROVIDER_B,
                status: 'open',
                rank: 2,
              }),
            },
            permissions: {
              ...owner,
              [PROVIDER_A]: ['read'],
              [PROVIDER_B]: ['read'],
            },
          },
          {
            realmURL: new URL(DENIES),
            fileSystem: {
              'realm.json': withPolicy('Denies', DENIES),
              'policies/policy.json': policyCard([{ operation: 'read' }]),
              ...aOpen(),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(UNFILTERABLE),
            fileSystem: {
              'realm.json': withPolicy('Unfilterable', UNFILTERABLE),
              'policies/policy.json': policyCard([
                { operation: 'listOpen', where: UNFILTERABLE_WHERE },
              ]),
              ...aOpen('1'),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(PRIVATE),
            fileSystem: aOpen(),
            permissions: { ...owner },
          },
          {
            realmURL: new URL(ENUMERABLE),
            fileSystem: {
              'realm.json': withPolicy('Enumerable', ENUMERABLE),
              'policies/policy.json': policyRules([
                {
                  targetType: SCHEDULE,
                  grants: [
                    { operation: 'query', where: OPEN },
                    { operation: 'read', where: OWN },
                  ],
                },
                {
                  targetType: NOTICE,
                  grants: [{ operation: 'query', where: POSTED }],
                },
              ]),
              ...ENUMERABLE_CARDS,
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(MISSING),
            fileSystem: {
              'realm.json': withPolicy('Missing', MISSING),
              ...aOpen(),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(WITHHELD),
            fileSystem: {
              'realm.json': withPolicy('Withheld', WITHHELD),
              'policies/policy.json': policyCard([
                { operation: 'query', where: OPEN },
              ]),
              ...aOpen(),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(BORROWED),
            fileSystem: {
              'realm.json': realmConfigCardJSON({
                name: 'Borrowed',
                policy: `${LIB}policies/borrowed`,
              }),
              ...aOpen(),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(SUBTYPES),
            fileSystem: {
              'realm.json': withPolicy('Subtypes', SUBTYPES),
              'policies/policy.json': policyRules([
                {
                  targetType: CLASSROOM,
                  grants: [
                    { operation: 'listClassrooms', where: OWN_CLASSROOM },
                    { operation: 'query', where: OWN_CLASSROOM },
                    { operation: 'read', where: OWN_CLASSROOM },
                    {
                      operation: 'listVisibleClassrooms',
                      where: OWN_OR_PUBLIC_CLASSROOM,
                    },
                  ],
                },
              ]),
              ...SUBTYPE_CLASSROOMS,
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(ROSTERS),
            fileSystem: {
              'realm.json': withPolicy('Rosters', ROSTERS),
              'policies/policy.json': policyRules([
                {
                  targetType: CLASSROOM,
                  grants: [{ operation: 'query', where: TEACHES_CLASSROOM }],
                },
              ]),
              ...ROSTER_CLASSROOMS,
            },
            permissions: { ...owner },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      realmServer = result.testRealmServer;
      server = result.testRealmHttpServer;
      request = supertest(server);
      for (let realm of result.realms) {
        realms[realm.url] = realm;
      }
    }

    setupCatalogTestSubset(hooks);

    // One server for the whole module, since every test but the archived one
    // only reads, and that one puts back what it changes. Booting it indexes
    // every realm, which runs inside the first test's budget, so that budget
    // is extended past the per-test timeout.
    hooks.before(function (assert) {
      assert.timeout(300_000);
    });

    setupDB(hooks, {
      before: async (dbAdapter, publisher, runner) => {
        await start({ dbAdapter, publisher, runner });
      },
      after: async () => {
        // Guarded, so a boot that failed partway still closes what it opened.
        for (let realm of Object.values(realms)) {
          realm?.unsubscribe();
        }
        if (server) {
          await closeServer(server);
        }
        resetCatalogRealms();
      },
    });

    // `duringRender` sends the request as a realm's own render sends it: on
    // the realm-authority session it renders under, from a tab that marks it.
    function federatedSearch(
      body: object,
      user?: string,
      { duringRender = false }: { duringRender?: boolean } = {},
    ) {
      let req = request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY');
      if (duringRender) {
        req = req.set(DURING_PRERENDER_HEADER, 'true');
      }
      if (user) {
        req = req.set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            {
              user,
              sessionRoom: `session-room-${user}`,
              ...(duringRender ? { realmAuthority: true as const } : {}),
            },
            realmSecretSeed,
          )}`,
        );
      }
      return req.send(body);
    }

    // `permissions` are the ones the caller holds in the realm, which the
    // realm's token must claim.
    function realmSearch(
      realmURL: string,
      body: object,
      user: string,
      permissions: RealmPermissions['user'] = [],
    ) {
      return request
        .post(`${new URL(realmURL).pathname}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set(
          'Authorization',
          `Bearer ${createJWT(realms[realmURL], user, permissions)}`,
        )
        .send(body);
    }

    function listOpen(realmURLs: string[], page?: object) {
      return {
        operation: 'listOpen',
        on: SCHEDULE,
        realms: realmURLs,
        ...(page ? { page } : {}),
      };
    }

    function ids(response: { body: { data: { id: string }[] } }): string[] {
      return response.body.data.map((entry) => entry.id);
    }

    function inRealm(
      realmURL: string,
      response: { body: { data: { id: string }[] } },
    ) {
      return ids(response).filter((id) => id.startsWith(realmURL));
    }

    module('a realm the caller reaches through its policy', function () {
      test('a named query is answered with the rows the grant admits, composed with its own filter', async function (assert) {
        let response = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          A_OPEN_IN_GRANTS,
          "provider A's open schedules, in the declaration's order: not B's, and not A's closed one",
        );
      });

      test('a declaration that names only the type is narrowed by the grant alone', async function (assert) {
        let response = await federatedSearch(
          { operation: 'listAll', on: SCHEDULE, realms: [GRANTS] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [...A_OPEN_IN_GRANTS, `${GRANTS}schedules/a-closed-11`],
          'every schedule of provider A, open and closed, and none of B',
        );
      });

      test("each caller is answered with their own grant's rows", async function (assert) {
        // Two callers, one request body: `listOpen` does not read the actor,
        // so nothing in what they send tells them apart. Sent back to back,
        // inside the live search cache's retention window, so an answer keyed
        // on the request alone would hand B the body computed for A.
        let a = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
        let again = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
        let b = await federatedSearch(listOpen([GRANTS]), PROVIDER_B);

        assert.strictEqual(
          again.headers[LIVE_SEARCH_CACHE_HEADER],
          'hit',
          "A's own repeat is served from the cache, so the cache is holding A's body while B asks",
        );
        assert.deepEqual(ids(a), A_OPEN_IN_GRANTS, "A's rows");
        assert.deepEqual(ids(b), B_OPEN_IN_GRANTS, "B's rows, not A's");
        assert.strictEqual(
          b.headers[LIVE_SEARCH_CACHE_HEADER],
          'miss',
          "B's answer is computed for B",
        );
      });

      test('a policy-filtered page is full, not sparse, across several pages', async function (assert) {
        let pages: string[][] = [];
        let totals: number[] = [];
        for (let number = 0; number < 3; number++) {
          let response = await federatedSearch(
            listOpen([GRANTS], { number, size: 2 }),
            PROVIDER_A,
          );
          assert.strictEqual(response.status, 200, `page ${number}: HTTP 200`);
          pages.push(ids(response));
          totals.push(response.body.meta.page.total);
        }

        assert.deepEqual(
          pages,
          [
            A_OPEN_IN_GRANTS.slice(0, 2),
            A_OPEN_IN_GRANTS.slice(2, 4),
            A_OPEN_IN_GRANTS.slice(4),
          ],
          'every page but the last is full of rows the grant admits, and the last holds the remainder',
        );
        assert.deepEqual(
          totals,
          [5, 5, 5],
          'the total counts the rows the grant admits, not the rows the declaration matches',
        );
      });

      test("the realm's own search answers as the federated one does", async function (assert) {
        let response = await realmSearch(
          GRANTS,
          { operation: 'listOpen', on: SCHEDULE },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), A_OPEN_IN_GRANTS);
      });

      test('a grant whose predicate compiles no filter contributes nothing, and widens nothing', async function (assert) {
        let policy = await realms[GRANTS].getCompiledPolicy();
        assert.deepEqual(
          policy?.issues.map((issue) => issue.code),
          ['policy-not-filterable'],
          'the grant is recorded as one that cannot gate a search',
        );

        let beside = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
        assert.deepEqual(
          ids(beside),
          A_OPEN_IN_GRANTS,
          "beside a grant that compiled, none of B's schedules, which its predicate would admit",
        );

        let alone = await federatedSearch(listOpen([UNFILTERABLE]), PROVIDER_A);
        assert.strictEqual(alone.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(alone),
          [],
          'as the only grant, no rows, though its predicate holds for the one there',
        );
      });

      test('a `read` grant contributes nothing to a query', async function (assert) {
        let card = await request
          .get(`${new URL(DENIES).pathname}schedules/a-open`)
          .set('Accept', SupportedMimeType.CardJson)
          .set(
            'Authorization',
            `Bearer ${createJWT(realms[DENIES], PROVIDER_A)}`,
          );
        assert.strictEqual(
          card.status,
          200,
          'the caller may read the schedule when handed its id',
        );

        let response = await federatedSearch(listOpen([DENIES]), PROVIDER_A);
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [],
          'and may not enumerate the type to find it',
        );
      });
    });

    module('an ad-hoc search', function () {
      function adHoc(realmURLs: string[], filter?: Record<string, unknown>) {
        return { ...(filter ? { filter } : {}), realms: realmURLs };
      }

      const SCHEDULES = { 'item.on': SCHEDULE };
      const NOTICES = { 'item.on': NOTICE };

      test('is authorized as `query` on the type its filter targets', async function (assert) {
        let response = await federatedSearch(
          adHoc([ENUMERABLE], SCHEDULES),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response).sort(),
          [`${ENUMERABLE}schedules/a-open`, `${ENUMERABLE}schedules/b-open`],
          'every open schedule, and not the closed one',
        );

        let composed = await federatedSearch(
          adHoc([ENUMERABLE], {
            ...SCHEDULES,
            eq: { 'item.providerId': PROVIDER_A },
          }),
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(composed),
          [`${ENUMERABLE}schedules/a-open`],
          "composed with the caller's own filter: A's open schedule, and neither B's nor A's closed one",
        );
      });

      test("the realm's own search answers as the federated one does", async function (assert) {
        let response = await realmSearch(
          ENUMERABLE,
          { filter: SCHEDULES },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response).sort(), [
          `${ENUMERABLE}schedules/a-open`,
          `${ENUMERABLE}schedules/b-open`,
        ]);
      });

      test('a type whose only grant is `read` returns nothing to one, though the caller may read the card it would find', async function (assert) {
        let card = await request
          .get(`${new URL(DENIES).pathname}schedules/a-open`)
          .set('Accept', SupportedMimeType.CardJson)
          .set(
            'Authorization',
            `Bearer ${createJWT(realms[DENIES], PROVIDER_A)}`,
          );
        assert.strictEqual(card.status, 200, 'the card is readable by id');

        let federated = await federatedSearch(
          adHoc([DENIES], SCHEDULES),
          PROVIDER_A,
        );
        assert.strictEqual(federated.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(federated), [], 'and the type is not enumerable');

        let own = await realmSearch(DENIES, { filter: SCHEDULES }, PROVIDER_A);
        assert.strictEqual(own.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(own), [], "nor through the realm's own search");
      });

      test('a `query` grant admits no read of the cards it finds', async function (assert) {
        let response = await federatedSearch(
          adHoc([ENUMERABLE], NOTICES),
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(response).sort(),
          [`${ENUMERABLE}notices/a-posted`, `${ENUMERABLE}notices/b-posted`],
          'every posted notice, whoever posted it, and not the draft',
        );

        let getAsA = (path: string) =>
          request
            .get(`${new URL(ENUMERABLE).pathname}${path}`)
            .set('Accept', SupportedMimeType.CardJson)
            .set(
              'Authorization',
              `Bearer ${createJWT(realms[ENUMERABLE], PROVIDER_A)}`,
            );
        assert.strictEqual(
          (await getAsA('notices/a-posted')).status,
          404,
          'no grant admits a read of a notice, so one the search found is not readable by id',
        );
        assert.strictEqual(
          (await getAsA('schedules/b-open')).status,
          404,
          "nor is B's open schedule, which the query grant admits and the read grant does not",
        );
      });

      test('a caller granted a named query cannot write its filter by hand', async function (assert) {
        let named = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
        assert.deepEqual(
          ids(named),
          A_OPEN_IN_GRANTS,
          'the saved search serves its rows',
        );

        let handWritten = await federatedSearch(
          adHoc([GRANTS], { ...SCHEDULES, eq: { 'item.status': 'open' } }),
          PROVIDER_A,
        );
        assert.strictEqual(handWritten.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(handWritten),
          [],
          'the same filter, sent as an ad-hoc search, is authorized as `query`, which the policy does not grant',
        );

        let ownRows = await federatedSearch(
          adHoc([GRANTS], {
            ...SCHEDULES,
            eq: { 'item.status': 'open', 'item.providerId': PROVIDER_A },
          }),
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(ownRows),
          [],
          'even narrowed to the very rows the grant would admit',
        );
      });

      test('a filter with no type anchor reaches no grant, and a caller the realm reads is served it', async function (assert) {
        for (let [label, filter] of [
          ['no filter at all', undefined],
          ['a filter anchoring no type', { eq: { 'item.title': 'A open' } }],
          ['a negated anchor', { not: SCHEDULES }],
          [
            'an anchor on a type the realm does not resolve',
            { 'item.on': { module: `${LIB}nowhere`, name: 'Nowhere' } },
          ],
        ] as [string, Record<string, unknown> | undefined][]) {
          let federated = await federatedSearch(
            adHoc([ENUMERABLE], filter),
            PROVIDER_A,
          );
          assert.strictEqual(
            federated.status,
            200,
            `${label}: HTTP 200 status`,
          );
          assert.deepEqual(ids(federated), [], `${label}: no rows`);

          let own = await realmSearch(
            ENUMERABLE,
            filter ? { filter } : {},
            PROVIDER_A,
          );
          assert.strictEqual(own.status, 200, `${label}: HTTP 200 status`);
          assert.deepEqual(
            ids(own),
            [],
            `${label}: no rows from the realm's own search`,
          );
        }

        let coarse = await federatedSearch(
          { ...adHoc([COARSE]), scope: 'cards' },
          PROVIDER_A,
        );
        assert.strictEqual(coarse.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(coarse).sort(),
          [`${COARSE}schedules/a-open`, `${COARSE}schedules/b-open`],
          'a realm the caller reads outright serves every row, as it always has',
        );
      });

      test('a filter over several types admits each type through its own grants', async function (assert) {
        let response = await federatedSearch(
          adHoc([ENUMERABLE], { any: [SCHEDULES, NOTICES] }),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response).sort(),
          [
            `${ENUMERABLE}notices/a-posted`,
            `${ENUMERABLE}notices/b-posted`,
            `${ENUMERABLE}schedules/a-open`,
            `${ENUMERABLE}schedules/b-open`,
          ],
          'every open schedule and every posted notice: neither the closed schedule nor the draft notice',
        );

        let withUngranted = await federatedSearch(
          adHoc([DENIES], { any: [SCHEDULES, NOTICES] }),
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(withUngranted),
          [],
          'and in a realm granting a query on neither, nothing',
        );
      });
    });

    module('a type descending from the rule type', function () {
      const CLASSROOMS = { 'item.on': CLASSROOM };

      function listClassrooms(page?: object) {
        return {
          operation: 'listClassrooms',
          on: CLASSROOM,
          realms: [SUBTYPES],
          ...(page ? { page } : {}),
        };
      }

      function getAs(user: string, path: string) {
        return request
          .get(`${new URL(SUBTYPES).pathname}${path}`)
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', `Bearer ${createJWT(realms[SUBTYPES], user)}`);
      }

      test("a card whose type computes the field a grant's filter reads is not found through the grant, just as it is not readable through it", async function (assert) {
        assert.strictEqual(
          (await getAs(PROVIDER_A, 'classrooms/assigned-2')).status,
          404,
          'its stored source holds no owner, so the read grant refuses it',
        );
        assert.strictEqual(
          (await getAs(PROVIDER_A, 'classrooms/a-1')).status,
          200,
          'while a plain classroom of their own is readable',
        );
        assert.strictEqual(
          (await getAs(PROVIDER_A, 'classrooms/elective-3')).status,
          200,
          'and so is one of a descendant declaring the owner as `Classroom` does',
        );

        let named = await federatedSearch(listClassrooms(), PROVIDER_A);
        assert.strictEqual(named.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(named),
          A_OWN_CLASSROOMS,
          'the named query finds their own classrooms, the elective among them, and neither assigned one, though the index holds their id as its owner',
        );

        let adHoc = await federatedSearch(
          { filter: CLASSROOMS, realms: [SUBTYPES] },
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(adHoc).sort(),
          [...A_OWN_CLASSROOMS].sort(),
          'and so does an ad-hoc search',
        );

        let own = await realmSearch(
          SUBTYPES,
          { filter: CLASSROOMS },
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(own).sort(),
          [...A_OWN_CLASSROOMS].sort(),
          "and the realm's own search",
        );

        let onSubtype = await federatedSearch(
          { filter: { 'item.on': ASSIGNED }, realms: [SUBTYPES] },
          PROVIDER_A,
        );
        assert.deepEqual(
          ids(onSubtype),
          [],
          'and a search anchored on the descendant itself finds none of its cards',
        );

        let owner = await federatedSearch(
          { filter: CLASSROOMS, realms: [SUBTYPES] },
          OWNER,
        );
        assert.deepEqual(
          ids(owner).sort(),
          Object.keys(SUBTYPE_CLASSROOMS)
            .map((path) => `${SUBTYPES}${path.replace(/\.json$/, '')}`)
            .sort(),
          'a caller who reads the realm outright still finds every classroom',
        );
      });

      test('a page of what the grant finds is full, not short by the cards it leaves out', async function (assert) {
        let pages: string[][] = [];
        let totals: number[] = [];
        for (let number = 0; number < 2; number++) {
          let response = await federatedSearch(
            listClassrooms({ number, size: 2 }),
            PROVIDER_A,
          );
          assert.strictEqual(response.status, 200, `page ${number}: HTTP 200`);
          pages.push(ids(response));
          totals.push(response.body.meta.page.total);
        }
        assert.deepEqual(pages, [
          A_OWN_CLASSROOMS.slice(0, 2),
          A_OWN_CLASSROOMS.slice(2),
        ]);
        assert.deepEqual(totals, [3, 3]);
      });

      test("a grant records as misreading a path the realm's own descendants that declare it differently, and a rule type with none composes as it did", async function (assert) {
        let policy = await realms[SUBTYPES].getCompiledPolicy();
        assert.deepEqual(policy?.issues, [], 'every grant compiles');
        let assigned = [{ type: { name: 'AssignedClassroom' } }];
        assert.deepEqual(
          policy?.rules[0].grants.map((grant) => ({
            operation: grant.operation,
            misread: grant.misreadingTypes?.map(({ path, types }) => ({
              path,
              types: types.map(({ type }) => ({
                type: { name: 'name' in type ? type.name : undefined },
              })),
            })),
          })),
          [
            {
              operation: 'listClassrooms',
              misread: [{ path: 'ownerId', types: assigned }],
            },
            {
              operation: 'query',
              misread: [{ path: 'ownerId', types: assigned }],
            },
            { operation: 'read', misread: undefined },
            {
              operation: 'listVisibleClassrooms',
              misread: [{ path: 'ownerId', types: assigned }],
            },
          ],
          'each query grant records the one descendant the realm holds cards of that computes the owner, against the owner alone, and a read grant carries no filter to record anything against',
        );

        let grants = await realms[GRANTS].getCompiledPolicy();
        assert.true(
          grants?.rules
            .flatMap((rule) => rule.grants)
            .every((grant) => !('misreadingTypes' in grant)),
          'a policy whose rule type has no descendant in its realm records nothing on any grant',
        );
      });

      test("a card whose type misreads one branch of a grant's predicate is still found through a branch it reads alike", async function (assert) {
        let asA = await federatedSearch(
          {
            operation: 'listVisibleClassrooms',
            on: CLASSROOM,
            realms: [SUBTYPES],
          },
          PROVIDER_A,
        );
        assert.strictEqual(asA.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(asA),
          ['a-1', 'elective-3', 'assigned-4', 'a-6'].map(
            (name) => `${SUBTYPES}classrooms/${name}`,
          ),
          'their own classrooms, and the public assigned one, found through `visibility`; not the assigned one that is not public, which only the owner branch could admit',
        );

        let asB = await federatedSearch(
          {
            operation: 'listVisibleClassrooms',
            on: CLASSROOM,
            realms: [SUBTYPES],
          },
          PROVIDER_B,
        );
        assert.deepEqual(
          ids(asB),
          ['assigned-4', 'b-5'].map((name) => `${SUBTYPES}classrooms/${name}`),
          'another caller finds the public assigned classroom too, and their own',
        );
      });

      test('a card of a descendant the realm held none of is left out once it is written', async function (assert) {
        let path = 'classrooms/reassigned-7.json';
        let id = `${SUBTYPES}classrooms/reassigned-7`;
        await realms[SUBTYPES].write(
          path,
          classroom('ReassignedClassroom', { title: 'Reassigned 7', rank: 7 }),
        );
        try {
          let owner = await federatedSearch(
            { filter: CLASSROOMS, realms: [SUBTYPES] },
            OWNER,
          );
          assert.true(ids(owner).includes(id), 'the card is indexed');

          let named = await federatedSearch(listClassrooms(), PROVIDER_A);
          assert.deepEqual(
            ids(named),
            A_OWN_CLASSROOMS,
            'the named query does not find it, though the index holds their id as its owner',
          );
          let adHoc = await federatedSearch(
            { filter: CLASSROOMS, realms: [SUBTYPES] },
            PROVIDER_A,
          );
          assert.false(ids(adHoc).includes(id), 'nor does an ad-hoc search');
        } finally {
          await realms[SUBTYPES].delete(path);
        }
      });
    });

    module('a caller filter and a grant on the same list', function () {
      // A plural path is reached through one table-valued alias per path, so
      // two conditions on `teacherIds` test the same element of it, and their
      // `every` needs one element equal to both. This pins that documented
      // limit: changing it is a change to the query engine, not to policy.
      function teaching(teacher: string) {
        return {
          filter: { 'item.on': CLASSROOM, eq: { 'item.teacherIds': teacher } },
          realms: [ROSTERS],
        };
      }
      const SHARED = `${ROSTERS}classrooms/shared`;
      const A_ONLY = `${ROSTERS}classrooms/a-only`;

      test("a filter testing the caller's own id in the list finds every classroom the grant admits", async function (assert) {
        let response = await federatedSearch(teaching(PROVIDER_A), PROVIDER_A);
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response).sort(), [A_ONLY, SHARED]);
      });

      test('a filter testing a colleague in the list finds no classroom, not even one listing them both', async function (assert) {
        let owner = await federatedSearch(teaching(PROVIDER_B), OWNER);
        assert.deepEqual(
          ids(owner),
          [SHARED],
          'a caller who reads the realm outright finds the classroom B teaches',
        );

        let teacher = await federatedSearch(teaching(PROVIDER_B), PROVIDER_A);
        assert.strictEqual(teacher.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(teacher),
          [],
          "A's grant admits the shared classroom, and still no element of its `teacherIds` is both A and B",
        );

        let own = await realmSearch(
          ROSTERS,
          { filter: teaching(PROVIDER_B).filter },
          PROVIDER_A,
        );
        assert.deepEqual(ids(own), [], "nor through the realm's own search");
      });

      test('the same classroom is found by a filter on another field', async function (assert) {
        let response = await federatedSearch(
          {
            filter: { 'item.on': CLASSROOM, eq: { 'item.title': 'Shared' } },
            realms: [ROSTERS],
          },
          PROVIDER_A,
        );
        assert.deepEqual(ids(response), [SHARED]);
      });
    });

    module('a batch target found by query', function () {
      function invokeRead(target: Record<string, unknown>) {
        return {
          'boxel:operations': [
            { op: 'invoke', 'boxel:name': 'read', 'boxel:target': target },
          ],
        };
      }

      function operations(realmURL: string, body: object, user: string) {
        return request
          .post(`${new URL(realmURL).pathname}_operations`)
          .set('Accept', SupportedMimeType.BoxelOperations)
          .set('Content-Type', SupportedMimeType.BoxelOperations)
          .set('Authorization', `Bearer ${createJWT(realms[realmURL], user)}`)
          .send(JSON.stringify(body));
      }

      function titled(
        type: { module: string; name: string },
        title: string,
        expect?: 'one' | 'many',
      ) {
        return {
          query: { 'item.on': type, eq: { 'item.title': title } },
          ...(expect ? { expect } : {}),
        };
      }

      const SCHEDULES_FILTER = { 'item.on': SCHEDULE };

      function errorOf(response: { text: string }) {
        return (
          JSON.parse(response.text) as {
            errors: { code: string; detail: string }[];
          }
        ).errors[0];
      }

      test('an entry whose query and operation are both granted runs against the card it finds', async function (assert) {
        let response = await operations(
          ENUMERABLE,
          invokeRead(titled(SCHEDULE, 'A open')),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let [result] = JSON.parse(response.text)['atomic:results'];
        assert.strictEqual(result.data.id, `${ENUMERABLE}schedules/a-open`);
      });

      test('a query finds only the cards its grant admits, whatever the caller may read', async function (assert) {
        let card = await request
          .get(`${new URL(ENUMERABLE).pathname}schedules/a-closed`)
          .set('Accept', SupportedMimeType.CardJson)
          .set(
            'Authorization',
            `Bearer ${createJWT(realms[ENUMERABLE], PROVIDER_A)}`,
          );
        assert.strictEqual(
          card.status,
          200,
          'A may read their own closed schedule by id',
        );

        let unfound = await operations(
          ENUMERABLE,
          invokeRead(titled(SCHEDULE, 'A closed')),
          PROVIDER_A,
        );
        let noCard = await operations(
          ENUMERABLE,
          invokeRead(titled(SCHEDULE, 'Nobody')),
          PROVIDER_A,
        );
        assert.strictEqual(unfound.status, 400, 'HTTP 400 status');
        assert.strictEqual(
          errorOf(unfound).code,
          'invalid-params',
          'and a query for it, which the query grant does not admit, matches no card',
        );
        assert.strictEqual(
          unfound.text,
          noCard.text,
          'a card the query grant does not admit answers as a card that does not exist',
        );
      });

      test('each card a query finds is gated, and a refusal names none of them', async function (assert) {
        let response = await operations(
          ENUMERABLE,
          invokeRead({ query: SCHEDULES_FILTER, expect: 'many' }),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
        let error = JSON.parse(response.text).errors[0];
        assert.deepEqual(
          { ...error, meta: undefined },
          {
            status: 404,
            code: 'target-not-found',
            title: 'Not found',
            detail: 'no such target',
            meta: undefined,
          },
          "the query found A's open schedule and B's, the read of B's was refused, and the refusal carries no id",
        );
        assert.true(
          /^\[0\]\.boxel:target\[[01]\]$/.test(error.meta?.entry),
          `it names the found entry by position alone: ${error.meta?.entry}`,
        );
        assert.false(
          response.text.includes('b-open'),
          'nothing in the answer names the card',
        );
      });

      test('an entry whose operation is granted and whose query is not is refused', async function (assert) {
        let refused = await operations(
          DENIES,
          invokeRead(titled(SCHEDULE, 'A open')),
          PROVIDER_A,
        );
        let matchingNothing = await operations(
          DENIES,
          invokeRead(titled(SCHEDULE, 'Nobody')),
          PROVIDER_A,
        );

        assert.strictEqual(refused.status, 400, 'HTTP 400 status');
        assert.true(
          errorOf(refused).detail.includes('matched no card'),
          `the query finds nothing: ${errorOf(refused).detail}`,
        );
        assert.strictEqual(
          refused.text,
          matchingNothing.text,
          'the answer a query matching no card gets, so the card it would have found is not disclosed',
        );

        let many = await operations(
          DENIES,
          invokeRead(titled(SCHEDULE, 'A open', 'many')),
          PROVIDER_A,
        );
        assert.strictEqual(many.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          JSON.parse(many.text)['atomic:results'],
          [[]],
          'expecting many, the entry runs against nothing',
        );
      });

      test('an entry whose query is granted and whose operation is not is refused', async function (assert) {
        let refused = await operations(
          ENUMERABLE,
          invokeRead(titled(NOTICE, 'A posted')),
          PROVIDER_A,
        );

        assert.strictEqual(refused.status, 404, 'HTTP 404 status');
        assert.deepEqual(
          (({ code, detail }) => ({ code, detail }))(errorOf(refused)),
          { code: 'target-not-found', detail: 'no such target' },
          'the query found the notice, and the gate refused the read of it',
        );
      });
    });

    // A realm that names a policy it cannot read as one. What such a policy
    // would grant is unknown, which is not the same as nothing, so the realm
    // answers as one that failed, as the gate answers such a caller with a
    // 500.
    module('a realm whose policy does not compile', function () {
      const SCHEDULES = { 'item.on': SCHEDULE };

      // What the index writer leaves when a visit fails for a reason outside
      // the card: the row keeps the earlier visit's document and reads as
      // healthy, and the verdict is recorded in its diagnostics.
      async function withholdLatestVisit(card: string) {
        await db.execute(
          `UPDATE boxel_index
           SET diagnostics = jsonb_set(
             COALESCE(diagnostics, '{}'::jsonb),
             '{gatewayFailure}',
             '["instance"]'::jsonb
           )
           WHERE url = $1 AND type = 'instance'`,
          { bind: [`${card}.json`] },
        );
      }

      test('one whose policy card is missing is counted as failed, not as granting nothing', async function (assert) {
        let response = await federatedSearch(
          { filter: SCHEDULES, realms: [ENUMERABLE, MISSING] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(inRealm(MISSING, response), [], 'none from it');
        assert.deepEqual(
          inRealm(ENUMERABLE, response).sort(),
          [`${ENUMERABLE}schedules/a-open`, `${ENUMERABLE}schedules/b-open`],
          'and the realm beside it answers under its own policy',
        );
        assert.true(
          response.body.meta.incomplete,
          'the result says it is missing a realm, rather than passing that realm off as holding nothing',
        );
      });

      test('its own search is refused as a read of one of its cards is', async function (assert) {
        let card = await request
          .get(`${new URL(MISSING).pathname}schedules/a-open`)
          .set('Accept', SupportedMimeType.CardJson)
          .set(
            'Authorization',
            `Bearer ${createJWT(realms[MISSING], PROVIDER_A)}`,
          );
        assert.strictEqual(card.status, 500, 'the read is refused');

        let own = await realmSearch(MISSING, { filter: SCHEDULES }, PROVIDER_A);
        assert.strictEqual(own.status, 500, 'and so is the search');
        assert.strictEqual(
          own.body.errors?.[0]?.title,
          'Policy unavailable',
          'with the refusal the gate gives',
        );
      });

      // A search of `realm`, whose policy card is `card`, after that card's
      // latest index visit is withheld: counted as failed, and answering
      // again once the visit the search asked for lands, with no edit to the
      // card.
      async function withheldUntilVisited(
        assert: Assert,
        realm: string,
        card: string,
      ) {
        await withholdLatestVisit(card);
        // Dropped without a refresh, so the search below is the read that
        // finds the row withheld.
        realms[realm].__testOnlyClearCaches();

        let response = await federatedSearch(
          { filter: SCHEDULES, realms: [ENUMERABLE, realm] },
          PROVIDER_A,
        );
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(inRealm(realm, response), [], 'none from it');
        assert.deepEqual(
          inRealm(ENUMERABLE, response).sort(),
          [`${ENUMERABLE}schedules/a-open`, `${ENUMERABLE}schedules/b-open`],
          'and the realm beside it answers under its own policy',
        );
        assert.true(
          response.body.meta.incomplete,
          'the result says it is missing a realm, rather than passing an earlier visit of the policy off as the policy',
        );

        let healed = await waitUntil(
          async () => {
            let next = await federatedSearch(
              { filter: SCHEDULES, realms: [realm] },
              PROVIDER_A,
            );
            return next.body.meta?.incomplete ? undefined : next;
          },
          {
            timeout: 30_000,
            timeoutMessage: 'the visit of the policy card lands',
          },
        );
        assert.deepEqual(
          ids(healed!),
          [`${realm}schedules/a-open`],
          'the realm answers with the rows its policy admits',
        );
        assert.strictEqual(
          realms[realm].__testOnlyPolicyCacheStats().revisits,
          1,
          'one visit was asked for, however many searches found the card withheld',
        );
      }

      test('one whose policy card’s latest visit was withheld is counted as failed, until the card is visited again', async function (assert) {
        await withheldUntilVisited(
          assert,
          WITHHELD,
          `${WITHHELD}policies/policy`,
        );
      });

      test('the same, for a policy card stored in another realm, which is the realm visited', async function (assert) {
        await withheldUntilVisited(assert, BORROWED, `${LIB}policies/borrowed`);
      });
    });

    module('federation', function () {
      test('each realm answers for itself, under its own policy', async function (assert) {
        let response = await federatedSearch(
          listOpen([GRANTS, COARSE, DENIES]),
          PROVIDER_A,
        );

        assert.strictEqual(
          response.status,
          200,
          'a realm that grants nothing does not refuse the realms beside it',
        );
        assert.deepEqual(
          inRealm(GRANTS, response),
          A_OPEN_IN_GRANTS,
          "the granting realm: provider A's own rows",
        );
        assert.deepEqual(
          inRealm(COARSE, response).sort(),
          [`${COARSE}schedules/a-open`, `${COARSE}schedules/b-open`],
          "the realm A reads outright: every matching row, B's included, since no policy was consulted",
        );
        assert.deepEqual(
          inRealm(DENIES, response),
          [],
          "the denying realm: nothing, though the granting realm's filter would admit its row",
        );
        assert.strictEqual(
          response.body.meta.page.total,
          7,
          'the total is the rows the realms admitted, all of them',
        );
      });

      test('a realm the caller may not read, with no policy, contributes no rows and refuses nothing', async function (assert) {
        let response = await federatedSearch(
          listOpen([COARSE, PRIVATE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(inRealm(PRIVATE, response), [], 'none from it');
        assert.strictEqual(
          inRealm(COARSE, response).length,
          2,
          'and the realm the caller reads answers with its matching rows',
        );
      });

      test('a search every realm declines is answered with no rows', async function (assert) {
        let response = await federatedSearch(
          listOpen([DENIES, PRIVATE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), []);
        assert.strictEqual(response.body.meta.page.total, 0);
      });

      test('a realm that grants the caller nothing answers exactly as one whose grant matches nothing', async function (assert) {
        // Provider C holds a grant in the Grants realm that matches none of its
        // schedules. Provider A holds no query grant in the Denies realm.
        let matchesNothing = await federatedSearch(
          listOpen([GRANTS]),
          PROVIDER_C,
        );
        let grantsNothing = await federatedSearch(
          listOpen([DENIES]),
          PROVIDER_A,
        );
        assert.strictEqual(matchesNothing.status, 200);
        assert.strictEqual(grantsNothing.status, 200);
        let withRealmsElided = (body: {
          meta: {
            realmTotals?: Record<string, number>;
            policyScopedRealms?: string[];
          };
        }) => ({
          ...body,
          meta: {
            ...body.meta,
            realmTotals: Object.values(body.meta.realmTotals ?? {}),
            policyScopedRealms: body.meta.policyScopedRealms?.length,
          },
        });
        assert.deepEqual(
          withRealmsElided(grantsNothing.body),
          withRealmsElided(matchesNothing.body),
          'the federated answers differ only in which realm they name',
        );
        assert.deepEqual(
          grantsNothing.body.meta.realmTotals,
          { [DENIES]: 0 },
          'the realm is counted among those that answered, with nothing',
        );
        assert.deepEqual(
          [
            grantsNothing.body.meta.policyScopedRealms,
            matchesNothing.body.meta.policyScopedRealms,
          ],
          [[DENIES], [GRANTS]],
          'and each marks its realm policy-scoped alike',
        );

        let ownMatchesNothing = await realmSearch(
          GRANTS,
          { operation: 'listOpen', on: SCHEDULE },
          PROVIDER_C,
        );
        let ownGrantsNothing = await realmSearch(
          DENIES,
          { operation: 'listOpen', on: SCHEDULE },
          PROVIDER_A,
        );
        assert.strictEqual(ownMatchesNothing.status, 200);
        assert.strictEqual(
          ownGrantsNothing.text.replaceAll(DENIES, '<realm>'),
          ownMatchesNothing.text.replaceAll(GRANTS, '<realm>'),
          "a realm's own search answers the two byte for byte alike, but for the realm each names",
        );
      });

      test('a named query searches each realm once, whatever the request repeats', async function (assert) {
        let response = await federatedSearch(
          listOpen([COARSE, COARSE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response).sort(),
          [`${COARSE}schedules/a-open`, `${COARSE}schedules/b-open`],
          'each row once',
        );
        assert.strictEqual(response.body.meta.page.total, 2);
      });

      test('a named query naming only archived realms is answered with no rows', async function (assert) {
        await archiveRealm(db, new URL(GRANTS));
        try {
          let response = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
          assert.strictEqual(
            response.status,
            200,
            'there is nothing to search, which is not an error',
          );
          assert.deepEqual(ids(response), []);
          assert.deepEqual(
            response.body.meta.realmTotals,
            { [GRANTS]: 0 },
            'answered as a realm that holds nothing for the caller',
          );
        } finally {
          await unarchiveRealm(db, new URL(GRANTS));
        }
      });

      test('a named query naming only realms that name no policy is answered with no rows, and its declaration is not read', async function (assert) {
        let response = await federatedSearch(listOpen([PRIVATE]), PROVIDER_A);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), []);
        assert.deepEqual(
          response.body.meta.realmTotals,
          { [PRIVATE]: 0 },
          'answered as a realm that holds nothing for the caller',
        );

        let undeclared = await federatedSearch(
          { operation: 'everything', on: SCHEDULE, realms: [PRIVATE] },
          PROVIDER_A,
        );
        assert.strictEqual(
          undeclared.status,
          200,
          'an operation the type does not declare is not refused, since no realm named could answer it a row either way',
        );
        assert.strictEqual(
          undeclared.text,
          response.text,
          'and it is answered byte for byte as the declared one is',
        );
      });

      test('a named query naming a realm whose policy could admit the caller is refused as its declaration refuses it', async function (assert) {
        let response = await federatedSearch(
          { operation: 'everything', on: SCHEDULE, realms: [PRIVATE, DENIES] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
        assert.strictEqual(response.body.errors[0].code, 'unknown-operation');
      });

      test("a named query a realm's own render is waiting on reads no declaration through a realm only a policy reaches, since no policy admits a render", async function (assert) {
        let granted = await federatedSearch(listOpen([GRANTS]), PROVIDER_A, {
          duringRender: true,
        });
        assert.strictEqual(granted.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(granted),
          [],
          "none of provider A's own rows, which their grant admits outside a render",
        );

        let undeclared = await federatedSearch(
          { operation: 'everything', on: SCHEDULE, realms: [GRANTS] },
          PROVIDER_A,
          { duringRender: true },
        );
        assert.strictEqual(
          undeclared.status,
          200,
          'an operation the type does not declare is not refused, since no realm named could answer it a row either way',
        );
        assert.deepEqual(ids(undeclared), []);
      });

      test('a request that authenticates nobody is still told to', async function (assert) {
        let response = await federatedSearch(listOpen([COARSE, GRANTS]));

        assert.strictEqual(
          response.status,
          401,
          'no policy grants to nobody, so a request naming a realm it cannot read is asked who it is',
        );
      });

      test('an archived realm contributes no rows, whatever its policy grants', async function (assert) {
        await archiveRealm(db, new URL(GRANTS));
        try {
          let response = await federatedSearch(
            listOpen([GRANTS, COARSE]),
            PROVIDER_A,
          );
          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(inRealm(GRANTS, response), [], 'none from it');
          assert.strictEqual(inRealm(COARSE, response).length, 2);
        } finally {
          await unarchiveRealm(db, new URL(GRANTS));
        }
      });
    });

    module('the policy-scoped mark', function () {
      // An ad-hoc search, which no policy here grants: a realm the caller
      // does not read contributes no rows to it.
      const OPEN = { 'item.on': SCHEDULE, eq: { 'item.status': 'open' } };

      function openSchedules(realmURLs: string[]) {
        return { filter: OPEN, realms: realmURLs };
      }

      test('a search marks each realm the caller does not read, whatever it contributed, and no realm they read', async function (assert) {
        let response = await federatedSearch(
          openSchedules([COARSE, GRANTS, DENIES, PRIVATE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          inRealm(COARSE, response).length,
          2,
          'the realm the caller reads answers with its matching rows',
        );
        assert.deepEqual(
          response.body.meta.policyScopedRealms,
          [GRANTS, DENIES, PRIVATE],
          'the realm with a grant, the realm with none and the realm with no policy are marked alike, in the order the search names them',
        );
      });

      test('a search of realms the caller reads carries no mark', async function (assert) {
        let response = await federatedSearch(
          openSchedules([COARSE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(inRealm(COARSE, response).length, 2);
        assert.false(
          'policyScopedRealms' in response.body.meta,
          'the answer is the one it would be with no policy anywhere',
        );
      });

      test('a declared query marks every realm the request named, the ones the caller reads included', async function (assert) {
        let response = await federatedSearch(
          listOpen([GRANTS, COARSE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body.meta.policyScopedRealms,
          [GRANTS, COARSE],
          "the server resolved the declaration, so no realm's rows are the caller's filter to decide",
        );
      });

      test('a declared query marks the realms the request named, not the ones its declaration searched', async function (assert) {
        let response = await federatedSearch(
          {
            operation: 'listOpenInGrants',
            on: SCHEDULE,
            realms: [COARSE, GRANTS],
          },
          OWNER,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          Object.keys(response.body.meta.realmTotals),
          [GRANTS],
          'the declaration searched only the realm it scopes itself to',
        );
        assert.deepEqual(
          response.body.meta.policyScopedRealms,
          [COARSE, GRANTS],
          'and the mark names both realms the request named',
        );
      });

      test('a declared query is not served the answer to the ad-hoc query it resolves to', async function (assert) {
        // A page no other test asks for, so neither answer is an earlier
        // test's cache entry.
        let declared = { ...listOpen([COARSE]), page: { number: 0, size: 3 } };
        let { query: resolved } = await resolveNamedQuery(
          realms[COARSE].operationCore,
          declared,
          { principal: { kind: 'user', user: PROVIDER_A }, realms: [COARSE] },
        );
        let adHoc = await federatedSearch(resolved, PROVIDER_A);
        let again = await federatedSearch(resolved, PROVIDER_A);
        assert.strictEqual(
          again.headers[LIVE_SEARCH_CACHE_HEADER],
          'hit',
          'the cache is holding the ad-hoc answer',
        );
        assert.false(
          'policyScopedRealms' in adHoc.body.meta,
          'which is not marked',
        );

        let response = await federatedSearch(declared, PROVIDER_A);
        assert.deepEqual(
          ids(response),
          ids(adHoc),
          'the declared query matches the same rows',
        );
        assert.deepEqual(
          response.body.meta.policyScopedRealms,
          [COARSE],
          'and its answer is marked, not the cached one',
        );
      });

      test('the mark names realms, and says nothing of why', async function (assert) {
        let scoped = await federatedSearch(listOpen([GRANTS]), PROVIDER_A);
        let unscoped = await federatedSearch(
          openSchedules([COARSE]),
          PROVIDER_A,
        );

        assert.deepEqual(ids(scoped), A_OPEN_IN_GRANTS, "the grant's rows");
        assert.deepEqual(
          Object.keys(scoped.body.meta).sort(),
          [...Object.keys(unscoped.body.meta), 'policyScopedRealms'].sort(),
          'the mark is the only thing a scoped answer says about itself that an unscoped one does not',
        );
        assert.deepEqual(scoped.body.meta.policyScopedRealms, [GRANTS]);
        let meta = JSON.stringify(scoped.body.meta);
        assert.false(
          meta.includes('providerId'),
          'no field the grant filters on',
        );
        assert.false(meta.includes(PROVIDER_A), 'and no value it binds');
      });

      test("a realm's own search marks itself as the federated one does", async function (assert) {
        let declared = await realmSearch(
          GRANTS,
          { operation: 'listOpen', on: SCHEDULE },
          PROVIDER_A,
        );
        let refused = await realmSearch(GRANTS, { filter: OPEN }, PROVIDER_A);
        let read = await realmSearch(COARSE, { filter: OPEN }, PROVIDER_A, [
          'read',
        ]);

        assert.deepEqual(
          [declared.status, refused.status, read.status],
          [200, 200, 200],
        );
        assert.deepEqual(
          declared.body.meta.policyScopedRealms,
          [GRANTS],
          'a declared query, answered with the rows the grant admits',
        );
        assert.deepEqual(
          refused.body.meta.policyScopedRealms,
          [GRANTS],
          'an ad-hoc search by a caller the realm does not let read',
        );
        assert.false(
          'policyScopedRealms' in read.body.meta,
          'and no mark on an ad-hoc search by a caller who reads the realm',
        );
      });
    });

    module('the query', function () {
      // Every statement issued against the index while `fn` runs, with its
      // bindings, in a canonical order. A search issues its page and count
      // statements concurrently, and each is compiled through card-definition
      // lookups that are database reads of their own, so which of the two
      // reaches the database first is a race rather than a property of the
      // query. Sorted, two searches compare equal exactly when they ran the
      // same statements.
      //
      // `trace` is every statement in the order it was issued, definition
      // lookups included, each with its offset from the start. It is for a
      // failed comparison to report the interleaving the sort hides, and the
      // definitions each search looked up while resolving and compiling its
      // query. A federated request also reads what the endpoint itself needs,
      // the caller's session and permissions and the realm registry, which a
      // direct search never reads. And it starts a type-key warm-up that
      // nothing awaits, which looks up the query's type definition when its
      // cached keys are cold and can land in either window. None of those is
      // an index read, and none is a sign of a divergence.
      async function indexQueriesDuring(fn: () => Promise<unknown>) {
        let statements: { sql: string; bind: unknown }[] = [];
        let trace: { atMs: number; sql: string; bind: unknown }[] = [];
        let start = performance.now();
        let execute = db.execute;
        db.execute = function (this: PgAdapter, ...args) {
          statements.push({ sql: args[0], bind: args[1]?.bind });
          trace.push({
            atMs: Math.round((performance.now() - start) * 10) / 10,
            sql: args[0].slice(0, 120),
            bind: args[1]?.bind,
          });
          return execute.apply(this, args);
        };
        try {
          await fn();
        } finally {
          db.execute = execute;
        }
        let key = (statement: { sql: string; bind: unknown }) =>
          JSON.stringify(statement);
        let reads = indexReads(statements).sort((a, b) =>
          key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
        );
        return { reads, trace };
      }

      test('a realm contributing no fragment runs the query a direct search of it runs', async function (assert) {
        // A caller the realm reads outright, asking a question no other test
        // asks, so the answer is computed here rather than served from an
        // earlier test's cache entry.
        let body = {
          operation: 'listAll',
          on: SCHEDULE,
          realms: [COARSE],
          page: { number: 0, size: 4 },
        };
        let served = await indexQueriesDuring(() =>
          federatedSearch(body, PROVIDER_A),
        );
        assert.true(served.reads.length > 0, 'the search read the index');

        // The same search run straight through the realm, with no policy in
        // the path: the declaration resolved, the server's page bound applied,
        // and nothing else. Resolving is inside the window, as it is inside the
        // federated request, so both traces carry its definition lookups.
        let direct = await indexQueriesDuring(async () => {
          let { query: resolved } = await resolveNamedQuery(
            realms[COARSE].operationCore,
            body,
            { principal: { kind: 'user', user: PROVIDER_A }, realms: [COARSE] },
          );
          let query = parseSearchEntryQueryFromPayload(resolved);
          query.itemQuery = applyServerSearchPageBound(query.itemQuery);
          return realms[COARSE].searchEntries(query);
        });

        if (!QUnit.equiv(served.reads, direct.reads)) {
          for (let [label, { trace }] of [
            ['served', served],
            ['direct', direct],
          ] as const) {
            console.log(
              `[policy-scoped-search-diag] ${label} trace=${JSON.stringify(trace)}`,
            );
          }
        }
        assert.deepEqual(
          served.reads,
          direct.reads,
          'the same statements, byte for byte, with the same bindings',
        );
      });

      test('a policy-scoped search reads the index as many times as an unscoped one', async function (assert) {
        // The grant is composed into the query rather than checked row by
        // row, so scoping a search adds no statement to it.
        let body = {
          operation: 'listAll',
          on: SCHEDULE,
          realms: [GRANTS],
          page: { number: 0, size: 3 },
        };
        // The compiled policy is revalidated on its first read once a few
        // seconds have passed since it was last validated, and that
        // revalidation is an index read of its own rather than the search's.
        // Read it here, outside the window measured, so what is counted below
        // is the search's statements alone.
        await realms[GRANTS].getCompiledPolicy();
        let { reads: scoped } = await indexQueriesDuring(() =>
          federatedSearch(body, PROVIDER_A),
        );
        let { reads: unscoped } = await indexQueriesDuring(() =>
          federatedSearch(body, OWNER),
        );

        assert.true(unscoped.length > 0, 'the unscoped search read the index');
        assert.strictEqual(
          scoped.length,
          unscoped.length,
          `one query plan either way (${unscoped.length} index read${unscoped.length === 1 ? '' : 's'})`,
        );
        assert.true(
          scoped.some(({ bind }) => JSON.stringify(bind).includes(PROVIDER_A)),
          "and the scoped one carries the grant's filter, bound to the caller",
        );
      });
    });

    module('a realm this process has not mounted', function (hooks) {
      // Each is staged the way a realm nothing on this process has touched
      // since it started is: its files on disk and its row in the registry,
      // and no mount. Neither provider may read any of them.
      const UNMOUNTED_PRIVATE = 'http://127.0.0.1:4444/unmounted-private/';
      const UNMOUNTED_ENUMERABLE =
        'http://127.0.0.1:4444/unmounted-enumerable/';
      // Its policy admits a provider's own schedules to the `listOpen` named
      // query.
      const UNMOUNTED_GRANTS = 'http://127.0.0.1:4444/unmounted-grants/';
      // Its `realm.json` points at a policy with a relative reference, which
      // the realm drops as malformed, so it has no policy.
      const UNMOUNTED_MALFORMED = 'http://127.0.0.1:4444/unmounted-malformed/';
      // Staged as `UNMOUNTED_GRANTS` is, apart from it, so a request can find
      // it unmounted whichever of this module's tests have run.
      const UNMOUNTED_FALLBACK = 'http://127.0.0.1:4444/unmounted-fallback/';
      // Registered with a `disk_id` outside the realms root, so there is no
      // directory to read its `realm.json` from and none to mount it from.
      const UNRESOLVABLE = 'http://127.0.0.1:4444/unresolvable/';
      // Registered the same way, and readable by provider A.
      const UNRESOLVABLE_READABLE =
        'http://127.0.0.1:4444/unresolvable-readable/';
      const SCHEDULES = { 'item.on': SCHEDULE };

      async function stage(
        realmURL: string,
        diskId: string,
        files: Record<string, string>,
        permissions: RealmPermissions = {},
      ) {
        let dir = join(realmServer.testingOnlyRealmsRootPath, diskId);
        for (let [path, content] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), content);
        }
        await insertSourceRealmInRegistry(db, {
          url: realmURL,
          diskId,
          ownerUsername: 'owner',
        });
        await insertPermissions(db, new URL(realmURL), {
          [OWNER]: ['read', 'write', 'realm-owner'],
          ...permissions,
        });
      }

      function isMounted(realmURL: string) {
        let reconciler = realmServer.testingOnlyReconciler;
        return (
          reconciler.mounted.has(realmURL) ||
          reconciler.pendingMounts.has(realmURL) ||
          realmServer.testingOnlyRealms.some((realm) => realm.url === realmURL)
        );
      }

      hooks.before(async function () {
        await stage(UNMOUNTED_PRIVATE, 'unmounted-private', {
          'realm.json': realmConfigCardJSON({ name: 'Unmounted private' }),
          ...aOpen(),
        });
        await stage(UNMOUNTED_ENUMERABLE, 'unmounted-enumerable', {
          'realm.json': realmConfigCardJSON({
            name: 'Unmounted enumerable',
            policy: `${UNMOUNTED_ENUMERABLE}policies/policy`,
          }),
          'policies/policy.json': policyCard([
            { operation: 'query', where: OPEN },
          ]),
          ...aOpen(),
          'schedules/a-closed.json': schedule({
            title: 'A closed',
            providerId: PROVIDER_A,
            status: 'closed',
            rank: 2,
          }),
        });
        await stage(UNMOUNTED_GRANTS, 'unmounted-grants', {
          'realm.json': realmConfigCardJSON({
            name: 'Unmounted grants',
            policy: `${UNMOUNTED_GRANTS}policies/policy`,
          }),
          'policies/policy.json': policyCard([
            { operation: 'listOpen', where: OWN },
          ]),
          ...aOpen(),
          'schedules/b-open.json': schedule({
            title: 'B open',
            providerId: PROVIDER_B,
            status: 'open',
            rank: 2,
          }),
        });
        await stage(UNMOUNTED_FALLBACK, 'unmounted-fallback', {
          'realm.json': realmConfigCardJSON({
            name: 'Unmounted fallback',
            policy: `${UNMOUNTED_FALLBACK}policies/policy`,
          }),
          'policies/policy.json': policyCard([
            { operation: 'listOpen', where: OWN },
          ]),
          ...aOpen(),
          'schedules/b-open.json': schedule({
            title: 'B open',
            providerId: PROVIDER_B,
            status: 'open',
            rank: 2,
          }),
        });
        await stage(UNMOUNTED_MALFORMED, 'unmounted-malformed', {
          'realm.json': realmConfigCardJSON({
            name: 'Unmounted malformed',
            policy: 'policies/policy',
          }),
          'policies/policy.json': policyCard([
            { operation: 'listOpen', where: OWN },
          ]),
          ...aOpen(),
        });
        await stage(UNRESOLVABLE, '../unresolvable', {
          'realm.json': realmConfigCardJSON({ name: 'Unresolvable' }),
          ...aOpen(),
        });
        await stage(
          UNRESOLVABLE_READABLE,
          '../unresolvable-readable',
          {
            'realm.json': realmConfigCardJSON({
              name: 'Unresolvable readable',
            }),
            ...aOpen(),
          },
          { [PROVIDER_A]: ['read'] },
        );
        // The registry as this process reflects it, which is what the
        // realms are looked up in, brought up to date with the rows just
        // written rather than waiting on the notification they sent.
        await realmServer.testingOnlyReconcile();
      });

      hooks.after(function () {
        for (let url of [
          UNMOUNTED_ENUMERABLE,
          UNMOUNTED_GRANTS,
          UNMOUNTED_FALLBACK,
        ]) {
          realmServer?.testingOnlyReconciler.mounted.get(url)?.unsubscribe();
        }
      });

      test('one whose realm.json names no policy contributes no rows, and is not mounted to say so', async function (assert) {
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'precondition: nothing on this process has mounted it',
        );

        let response = await federatedSearch(
          { filter: SCHEDULES, realms: [ENUMERABLE, UNMOUNTED_PRIVATE] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          inRealm(UNMOUNTED_PRIVATE, response),
          [],
          'none from it',
        );
        assert.deepEqual(
          inRealm(ENUMERABLE, response).sort(),
          [`${ENUMERABLE}schedules/a-open`, `${ENUMERABLE}schedules/b-open`],
          'and the realm beside it answers under its own policy',
        );
        assert.notStrictEqual(
          response.body.meta.incomplete,
          true,
          'it is counted among the realms that answered, not the ones that failed to',
        );
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'and it is still not mounted',
        );
      });

      test('one whose realm.json names a policy is mounted to ask it, and contributes what its grants admit', async function (assert) {
        // Mounting the realm indexes it from scratch.
        assert.timeout(180_000);
        assert.false(
          isMounted(UNMOUNTED_ENUMERABLE),
          'precondition: nothing on this process has mounted it',
        );

        let response = await federatedSearch(
          { filter: SCHEDULES, realms: [UNMOUNTED_ENUMERABLE] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [`${UNMOUNTED_ENUMERABLE}schedules/a-open`],
          'the open schedule its `query` grant admits, and not the closed one',
        );
        assert.true(
          isMounted(UNMOUNTED_ENUMERABLE),
          'the realm was mounted to ask its policy',
        );
      });

      test('a named query naming only one whose realm.json names no policy is answered with no rows, and it is not mounted to read the declaration', async function (assert) {
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'precondition: nothing on this process has mounted it',
        );

        let response = await federatedSearch(
          listOpen([UNMOUNTED_PRIVATE]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), []);
        assert.deepEqual(
          response.body.meta.realmTotals,
          { [UNMOUNTED_PRIVATE]: 0 },
          'it is counted among the realms that answered, with nothing',
        );
        assert.notStrictEqual(
          response.body.meta.incomplete,
          true,
          'and not among the ones that failed to',
        );
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'and it is still not mounted',
        );
      });

      test('a named query naming only one whose realm.json holds a pointer the realm would drop is answered with no rows, and it is not mounted', async function (assert) {
        assert.false(
          isMounted(UNMOUNTED_MALFORMED),
          'precondition: nothing on this process has mounted it',
        );

        let response = await federatedSearch(
          {
            operation: 'everything',
            on: SCHEDULE,
            realms: [UNMOUNTED_MALFORMED],
          },
          PROVIDER_A,
        );

        assert.strictEqual(
          response.status,
          200,
          'answered as the realm, mounted, would have it answered: with no policy, so a request no realm could answer a row is not refused',
        );
        assert.deepEqual(ids(response), []);
        assert.false(
          isMounted(UNMOUNTED_MALFORMED),
          'and it is still not mounted',
        );
      });

      test('a named query naming one with no policy and one with a policy reads the declaration through the one with a policy, and composes its grants', async function (assert) {
        // Mounting the realm indexes it from scratch.
        assert.timeout(180_000);
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'precondition: nothing on this process has mounted the realm with no policy',
        );
        assert.false(
          isMounted(UNMOUNTED_GRANTS),
          'precondition: nor the realm with one',
        );

        let response = await federatedSearch(
          listOpen([UNMOUNTED_PRIVATE, UNMOUNTED_GRANTS]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [`${UNMOUNTED_GRANTS}schedules/a-open`],
          "provider A's own open schedule, which the grant admits, and not provider B's",
        );
        assert.true(
          isMounted(UNMOUNTED_GRANTS),
          'the realm with a policy was mounted to read the declaration and ask its policy',
        );
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'the realm with none, named first, was not',
        );
      });

      test('a named query naming one that will not mount ahead of one with a policy reads the declaration through the second, and composes its grants', async function (assert) {
        // Mounting the realm indexes it from scratch.
        assert.timeout(180_000);
        assert.false(
          isMounted(UNMOUNTED_FALLBACK),
          'precondition: nothing on this process has mounted the realm with a policy',
        );

        let response = await federatedSearch(
          listOpen([UNRESOLVABLE, UNMOUNTED_FALLBACK]),
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [`${UNMOUNTED_FALLBACK}schedules/a-open`],
          "provider A's own open schedule, which the grant admits, and not provider B's",
        );
        assert.true(
          response.body.meta.incomplete,
          'the realm that will not mount is counted among the realms that failed to answer',
        );
        assert.true(
          isMounted(UNMOUNTED_FALLBACK),
          'the realm with a policy was mounted to read the declaration and ask its policy',
        );
        assert.false(
          isMounted(UNRESOLVABLE),
          'the one named ahead of it could not be',
        );
      });

      test('a named query no realm it may be read through will mount is answered with no rows and marked incomplete, not refused', async function (assert) {
        let response = await federatedSearch(
          listOpen([UNRESOLVABLE, UNMOUNTED_PRIVATE]),
          PROVIDER_A,
        );

        assert.strictEqual(
          response.status,
          200,
          'answered as an ad-hoc search naming a realm that will not mount is',
        );
        assert.deepEqual(ids(response), []);
        assert.true(
          response.body.meta.incomplete,
          'the realm that will not mount is counted among the realms that failed to answer',
        );
        assert.deepEqual(
          response.body.meta.realmTotals,
          { [UNMOUNTED_PRIVATE]: 0 },
          'and the one that names no policy among the ones that answered, with nothing',
        );
        assert.false(
          isMounted(UNMOUNTED_PRIVATE),
          'which is still not mounted',
        );
      });

      test('a named query naming a realm the caller reads that will not mount, and one their policy reaches, reads the declaration through the second, and tries the first once', async function (assert) {
        let reconciler = realmServer.testingOnlyReconciler;
        let lookupOrMount = reconciler.lookupOrMount;
        let attempts = 0;
        reconciler.lookupOrMount = function (
          this: typeof reconciler,
          ...args: Parameters<typeof lookupOrMount>
        ) {
          if (args[0] === UNRESOLVABLE_READABLE) {
            attempts++;
          }
          return lookupOrMount.apply(this, args);
        };
        let response;
        try {
          response = await federatedSearch(
            listOpen([UNRESOLVABLE_READABLE, GRANTS]),
            PROVIDER_A,
          );
        } finally {
          reconciler.lookupOrMount = lookupOrMount;
        }

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          A_OPEN_IN_GRANTS,
          "provider A's open schedules, which the policy's grant admits",
        );
        assert.true(
          response.body.meta.incomplete,
          'the realm the caller reads is counted among the realms that failed to answer',
        );
        assert.strictEqual(
          attempts,
          1,
          'and it was tried once, though both reading the declaration and the search itself would mount it',
        );
      });

      test('a named query naming only a realm the caller reads that will not mount is answered with no rows and marked incomplete, not refused', async function (assert) {
        let response = await federatedSearch(listOpen([UNRESOLVABLE]), OWNER);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), []);
        assert.true(
          response.body.meta.incomplete,
          'the realm is counted among the realms that failed to answer, not as one holding nothing',
        );
      });

      test('one whose policy cannot be judged is counted as failed, not as granting nothing', async function (assert) {
        let response = await federatedSearch(
          { filter: SCHEDULES, realms: [ENUMERABLE, UNRESOLVABLE] },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(inRealm(UNRESOLVABLE, response), [], 'none from it');
        assert.deepEqual(
          inRealm(ENUMERABLE, response).sort(),
          [`${ENUMERABLE}schedules/a-open`, `${ENUMERABLE}schedules/b-open`],
          'and the realm beside it answers under its own policy',
        );
        assert.true(
          response.body.meta.incomplete,
          'the result says it is missing a realm, rather than passing that realm off as holding nothing',
        );
        assert.false(isMounted(UNRESOLVABLE), 'it could not be mounted');
      });
    });
  });
});
