import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  applyServerSearchPageBound,
  archiveRealm,
  composePolicyScopedFilter,
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
import type { RealmHttpServer as Server } from '../../server.ts';
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
} from '../helpers/index.ts';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';

// ============================================================================
// A search a realm's policy scopes: the grants a `query` policy compiled to
// filters, composed into the query a realm runs for a caller its ACL declined.
//
// Six realms on one server, one per answer a realm can give a caller it does
// not let read outright. The type lives in a public library realm so every
// other realm can hold cards of it.
//
// - Grants: its policy admits a provider's own schedules to two named
//   queries, and also carries a query grant that does not compile to a filter.
// - Coarse: both providers may read it, so no policy is ever consulted.
// - Denies: its policy lets anyone read a schedule they were handed, and
//   grants no query at all.
// - Unfilterable: its only query grant does not compile to a filter.
// - Private: it names no policy, and neither provider may read it.
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

    @operation static listAll = {
      base: 'query',
      query: {
        filter: { type: () => ServicePlanSchedule },
        sort: [{ on: () => ServicePlanSchedule, by: 'rank', direction: 'asc' }],
      },
    };
  }
`;

const OWN = '.providerId == actor()';
// Refused by the `predicate` profile, so its grant compiles no filter. It
// holds for every card whose title reads as a positive number, which is every
// one of provider B's schedules in the Grants realm: a search that let it
// through would return them.
const UNFILTERABLE_WHERE = '(.title | tonumber) > 0';

function policyCard(grants: { operation: string; where?: string }[]): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [{ targetType: SCHEDULE, grants }],
      },
      meta: { adoptsFrom: REALM_POLICY },
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
            fileSystem: { 'schedule.gts': SCHEDULE_MODULE },
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
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      server = result.testRealmHttpServer;
      request = supertest(server);
      for (let realm of result.realms) {
        realms[realm.url] = realm;
      }
    }

    setupCatalogTestSubset(hooks);

    // One server for the whole module, since every test but the archived one
    // only reads, and that one puts back what it changes. Booting it indexes
    // six realms, which runs inside the first test's budget, so that budget
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

    function federatedSearch(body: Record<string, unknown>, user?: string) {
      let req = request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY');
      if (user) {
        req = req.set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user, sessionRoom: `session-room-${user}` },
            realmSecretSeed,
          )}`,
        );
      }
      return req.send(body);
    }

    function realmSearch(realmURL: string, body: object, user: string) {
      return request
        .post(`${new URL(realmURL).pathname}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${createJWT(realms[realmURL], user)}`)
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

      test('an ad-hoc search reaches no grant', async function (assert) {
        let response = await federatedSearch(
          {
            filter: { 'item.on': SCHEDULE, eq: { 'item.status': 'open' } },
            realms: [GRANTS],
          },
          PROVIDER_A,
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          [],
          'a policy grants a declared query, not the filter a caller writes',
        );
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
          meta: { realmTotals?: Record<string, number> };
        }) => ({
          ...body,
          meta: {
            ...body.meta,
            realmTotals: Object.values(body.meta.realmTotals ?? {}),
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
          ownGrantsNothing.text,
          ownMatchesNothing.text,
          "a realm's own search answers the two byte for byte alike",
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
            { actor: PROVIDER_A, realms: [COARSE] },
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
  });
});
