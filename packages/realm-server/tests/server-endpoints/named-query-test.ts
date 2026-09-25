import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  baseCardRef,
  DURING_PRERENDER_HEADER,
  rri,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQueryOperation } from '@cardstack/runtime-common/card-operations';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';

// ============================================================================
// A named query: a search request that names a declared query operation, the
// type it is invoked on and its params, and is answered with the realm's own
// resolution of that declaration.
//
// Two realms on one server. The School realm holds the type and most of its
// cards; the Other realm holds one more card of the same type, so a query's
// realm scope is observable in which rows come back.
// ============================================================================

const SCHOOL = 'http://127.0.0.1:4444/school/';
const OTHER = 'http://127.0.0.1:4444/other/';
const OWNER = '@owner:localhost';
const PROVIDER_A = '@provider-a:localhost';
const PROVIDER_B = '@provider-b:localhost';

const SCHEDULE = { module: `${SCHOOL}schedule`, name: 'ServicePlanSchedule' };
const DRIFTING: ResolvedCodeRef = {
  module: rri(`${SCHOOL}drifting`),
  name: 'Drifting',
};

const SCHEDULE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";
  import { operation, actor, params } from "@cardstack/base/operations";

  export class ServicePlanSchedule extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);
    @field status = contains(StringField);
    @field rank = contains(NumberField);

    @operation static listMySchedules = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { providerId: actor() } },
      },
    };

    @operation static byStatus = {
      base: 'query',
      params: { status: StringField },
      query: {
        filter: {
          on: () => ServicePlanSchedule,
          eq: { status: params('status') },
        },
      },
    };

    @operation static openByRank = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
        sort: [{ on: () => ServicePlanSchedule, by: 'rank', direction: 'asc' }],
      },
    };

    @operation static firstTwoOpen = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
        sort: [{ on: () => ServicePlanSchedule, by: 'rank', direction: 'asc' }],
        page: { size: 2, number: 0 },
      },
    };

    @operation static openInSchool = {
      base: 'query',
      query: {
        filter: { on: () => ServicePlanSchedule, eq: { status: 'open' } },
        realms: ['${SCHOOL}'],
      },
    };

    @operation static retitle = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };
  }
`;

// A type whose declaration the stale-lowering test rewrites, kept apart from
// the one every other test reads.
function driftingModule(status: string) {
  return `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation } from "@cardstack/base/operations";

    export class Drifting extends CardDef {
      @field status = contains(StringField);

      @operation static current = {
        base: 'query',
        query: { filter: { on: () => Drifting, eq: { status: '${status}' } } },
      };
    }
  `;
}

function schedule(
  module: string,
  attributes: {
    title: string;
    providerId: string;
    status: string;
    rank: number;
  },
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(module), name: SCHEDULE.name } },
    },
  });
}

function drifting(status: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { status },
      meta: { adoptsFrom: { module: rri('../drifting'), name: DRIFTING.name } },
    },
  });
}

module(`server-endpoints/${basename(import.meta.filename)}`, function (hooks) {
  let school: Realm;
  let other: Realm;
  let request: SuperTest<Test>;
  let server: Server;

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
            'schedule.gts': SCHEDULE_MODULE,
            'drifting.gts': driftingModule('open'),
            'schedules/a-open-1.json': schedule('../schedule', {
              title: 'A open 1',
              providerId: PROVIDER_A,
              status: 'open',
              rank: 3,
            }),
            'schedules/a-open-2.json': schedule('../schedule', {
              title: 'A open 2',
              providerId: PROVIDER_A,
              status: 'open',
              rank: 1,
            }),
            'schedules/b-open.json': schedule('../schedule', {
              title: 'B open',
              providerId: PROVIDER_B,
              status: 'open',
              rank: 2,
            }),
            'schedules/a-closed.json': schedule('../schedule', {
              title: 'A closed',
              providerId: PROVIDER_A,
              status: 'closed',
              rank: 4,
            }),
            'drifting/open.json': drifting('open'),
            'drifting/closed.json': drifting('closed'),
          },
          // Readable by anyone, so a request that authenticates nobody
          // reaches the query rather than being turned away at the door.
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
            '*': ['read'],
          },
        },
        {
          realmURL: new URL(OTHER),
          fileSystem: {
            'schedules/other-open.json': schedule(`${SCHOOL}schedule`, {
              title: 'Other open',
              providerId: PROVIDER_A,
              status: 'open',
              rank: 5,
            }),
          },
          permissions: {
            [OWNER]: ['read', 'write', 'realm-owner'],
            [PROVIDER_A]: ['read'],
            [PROVIDER_B]: ['read'],
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
    other = result.realms.find((realm) => realm.url === OTHER)!;
  }

  // One server for the whole file, since every test but the stale-lowering one
  // only reads. Booting it indexes both realms, which runs inside the first
  // test's budget, so that budget is extended past the per-test timeout.
  hooks.before(function (assert) {
    assert.timeout(300_000);
  });

  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    after: async () => {
      // Guarded, so a boot that failed partway still closes what it opened.
      for (let realm of [school, other]) {
        realm?.unsubscribe();
      }
      if (server) {
        await closeServer(server);
      }
      resetCatalogRealms();
    },
  });

  function federatedSearch(
    body: Record<string, unknown>,
    user?: string,
    headers: Record<string, string> = {},
  ) {
    let req = request
      .post('/_federated-search')
      .set('Accept', 'application/vnd.card+json')
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(headers);
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

  function realmSearch(
    realm: Realm,
    body: Record<string, unknown>,
    user: string,
    headers: Record<string, string> = {},
  ) {
    return request
      .post(`${new URL(realm.url).pathname}_search`)
      .set('Accept', 'application/vnd.card+json')
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(headers)
      .set('Authorization', `Bearer ${createJWT(realm, user, ['read'])}`)
      .send(body);
  }

  function ids(response: { body: { data: { id: string }[] } }): string[] {
    return response.body.data.map((entry) => entry.id);
  }

  function sortedIds(response: { body: { data: { id: string }[] } }) {
    return ids(response).sort();
  }

  // A filter that matches every card in a realm, standing in for what a
  // caller would put on the wire to enumerate the type.
  const EVERYTHING = { 'item.on': baseCardRef };

  const SCHOOL_OPEN = [
    `${SCHOOL}schedules/a-open-1`,
    `${SCHOOL}schedules/a-open-2`,
    `${SCHOOL}schedules/b-open`,
  ];

  module('the filter', function () {
    test('a named query is served its declaration, not the filter the request carries', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'byStatus',
          on: SCHEDULE,
          params: { status: 'open' },
          filter: EVERYTHING,
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        sortedIds(response),
        SCHOOL_OPEN,
        'the rows the declaration matches, and none of the others the forged filter would have',
      );
    });

    test('the rendering a caller binds in its filter still applies', async function (assert) {
      let htmlQuery = { eq: { format: 'embedded' } };
      let response = await federatedSearch(
        {
          operation: 'byStatus',
          on: SCHEDULE,
          params: { status: 'open' },
          filter: { eq: { htmlQuery } },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        response.body.meta.htmlQuery,
        htmlQuery,
        'the binding chooses how rows render, so it survives the filter being replaced',
      );
      assert.deepEqual(sortedIds(response), SCHOOL_OPEN);
    });

    test('the ad-hoc form is answered with the filter the caller wrote', async function (assert) {
      let response = await federatedSearch(
        {
          filter: { 'item.on': SCHEDULE, eq: { 'item.status': 'closed' } },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(sortedIds(response), [`${SCHOOL}schedules/a-closed`]);
    });

    test('a query the client lowered from a stale definition is not the one served', async function (assert) {
      // What a client holding the definition as it stands now would lower the
      // declaration to, before the module changes under it.
      let staleDefinition =
        await school.operationCore.definitionLookup.lookupDefinition(DRIFTING);
      let stale = lowerQueryOperation(staleDefinition!.operations!.current, {
        realms: [SCHOOL],
      });
      assert.deepEqual(
        stale.filter?.eq,
        { 'item.status': 'open' },
        'the stale lowering asks for the open card',
      );

      await school.write('drifting.gts', driftingModule('closed'));
      await school.indexing();

      let response = await federatedSearch(
        { ...stale, operation: 'current', on: DRIFTING },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        sortedIds(response),
        [`${SCHOOL}drifting/closed`],
        'the realm served the declaration as it now reads',
      );
    });
  });

  module('the operation', function () {
    test('an operation the type does not declare is refused', async function (assert) {
      let response = await federatedSearch(
        { operation: 'listEverything', on: SCHEDULE, realms: [SCHOOL] },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
      assert.strictEqual(response.body.errors[0].code, 'unknown-operation');
    });

    test('an operation that is not a query is refused', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'retitle',
          on: SCHEDULE,
          params: { title: 'x' },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(response.body.errors[0].code, 'invalid-params');
      assert.true(
        /declares no query/.test(response.body.errors[0].detail),
        `detail says why: ${response.body.errors[0].detail}`,
      );
    });

    test('the bare base name is not a query of its own', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'query',
          on: SCHEDULE,
          filter: EVERYTHING,
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(
        response.status,
        400,
        'a named query is a declared one, so naming the base carries no query to run',
      );
    });

    test('a type that does not resolve is refused', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'byStatus',
          on: { module: `${SCHOOL}nonexistent`, name: 'Nothing' },
          params: { status: 'open' },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });

    test('a malformed named query is refused for what it got wrong', async function (assert) {
      let noType = await federatedSearch(
        { operation: 'byStatus', params: { status: 'open' }, realms: [SCHOOL] },
        PROVIDER_A,
      );
      assert.strictEqual(noType.status, 400, 'no type to resolve it on');
      assert.true(/"on"/.test(noType.body.errors[0].detail));

      let scalarParams = await federatedSearch(
        {
          operation: 'byStatus',
          on: SCHEDULE,
          params: 'open',
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );
      assert.strictEqual(
        scalarParams.status,
        400,
        'params that are not an object',
      );
      assert.true(/"params"/.test(scalarParams.body.errors[0].detail));

      let missingParam = await federatedSearch(
        { operation: 'byStatus', on: SCHEDULE, realms: [SCHOOL] },
        PROVIDER_A,
      );
      assert.strictEqual(missingParam.status, 400, 'a declared param left out');
      assert.true(
        /requires a value for params\("status"\)/.test(
          missingParam.body.errors[0].detail,
        ),
      );
    });
  });

  module('inside a render', function () {
    test('a render has no actor, so a declaration that compares against one is refused', async function (assert) {
      let request = {
        operation: 'listMySchedules',
        on: SCHEDULE,
        realms: [SCHOOL],
      };

      let inRender = await federatedSearch(request, PROVIDER_A, {
        [DURING_PRERENDER_HEADER]: 'true',
      });
      assert.strictEqual(
        inRender.status,
        401,
        'what a render produces is served to every viewer, so it never resolves against the identity it rendered as',
      );
      assert.strictEqual(inRender.body.errors[0].code, 'actor-required');

      let live = await federatedSearch(request, PROVIDER_A);
      assert.strictEqual(
        live.status,
        200,
        'and the same request outside a render resolves against its user',
      );
    });
  });

  module('the actor', function () {
    test('actor() is the authenticated user, whatever the request claims', async function (assert) {
      let forged = {
        operation: 'listMySchedules',
        on: SCHEDULE,
        params: { actor: PROVIDER_B, providerId: PROVIDER_B },
        filter: { 'item.on': SCHEDULE, eq: { 'item.providerId': PROVIDER_B } },
        realms: [SCHOOL],
      };

      let asA = await federatedSearch(forged, PROVIDER_A);
      assert.strictEqual(asA.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        sortedIds(asA),
        [
          `${SCHOOL}schedules/a-closed`,
          `${SCHOOL}schedules/a-open-1`,
          `${SCHOOL}schedules/a-open-2`,
        ],
        'the rows of the user the token names, not of the one the payload names',
      );

      let asB = await federatedSearch(forged, PROVIDER_B);
      assert.deepEqual(
        sortedIds(asB),
        [`${SCHOOL}schedules/b-open`],
        'and the same request from the other user answers with theirs',
      );
    });

    test('a request that authenticates nobody has no actor to compare against', async function (assert) {
      let response = await federatedSearch({
        operation: 'listMySchedules',
        on: SCHEDULE,
        params: { actor: PROVIDER_A },
        realms: [SCHOOL],
      });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.strictEqual(response.body.errors[0].code, 'actor-required');
    });
  });

  module('sort and page', function () {
    test('a declared sort stands over the caller’s', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'openByRank',
          on: SCHEDULE,
          sort: [{ by: 'item.rank', 'item.on': SCHEDULE, direction: 'desc' }],
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(ids(response), [
        `${SCHOOL}schedules/a-open-2`,
        `${SCHOOL}schedules/b-open`,
        `${SCHOOL}schedules/a-open-1`,
      ]);
    });

    test('a declaration that names no sort takes the caller’s', async function (assert) {
      let sorted = (direction: string) =>
        federatedSearch(
          {
            operation: 'byStatus',
            on: SCHEDULE,
            params: { status: 'open' },
            sort: [{ by: 'item.rank', 'item.on': SCHEDULE, direction }],
            realms: [SCHOOL],
          },
          PROVIDER_A,
        );

      assert.deepEqual(ids(await sorted('desc')), [
        `${SCHOOL}schedules/a-open-1`,
        `${SCHOOL}schedules/b-open`,
        `${SCHOOL}schedules/a-open-2`,
      ]);
      assert.deepEqual(ids(await sorted('asc')), [
        `${SCHOOL}schedules/a-open-2`,
        `${SCHOOL}schedules/b-open`,
        `${SCHOOL}schedules/a-open-1`,
      ]);
    });

    test('a named query pages with the caller’s page when the declaration names none', async function (assert) {
      let page = (number: number) =>
        federatedSearch(
          {
            operation: 'openByRank',
            on: SCHEDULE,
            page: { size: 2, number },
            realms: [SCHOOL],
          },
          PROVIDER_A,
        );

      let first = await page(0);
      let second = await page(1);
      assert.deepEqual(ids(first), [
        `${SCHOOL}schedules/a-open-2`,
        `${SCHOOL}schedules/b-open`,
      ]);
      assert.deepEqual(ids(second), [`${SCHOOL}schedules/a-open-1`]);
      assert.strictEqual(
        first.body.meta.page.total,
        3,
        'the total is the whole match',
      );
    });

    test('a declared page stands over the caller’s', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'firstTwoOpen',
          on: SCHEDULE,
          page: { size: 1, number: 2 },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.deepEqual(ids(response), [
        `${SCHOOL}schedules/a-open-2`,
        `${SCHOOL}schedules/b-open`,
      ]);
    });

    test('the ad-hoc form pages as it always has', async function (assert) {
      let response = await federatedSearch(
        {
          filter: { 'item.on': SCHEDULE, eq: { 'item.status': 'open' } },
          sort: [{ by: 'item.rank', 'item.on': SCHEDULE, direction: 'asc' }],
          page: { size: 2, number: 1 },
          realms: [SCHOOL],
        },
        PROVIDER_A,
      );

      assert.deepEqual(ids(response), [`${SCHOOL}schedules/a-open-1`]);
      assert.strictEqual(response.body.meta.page.total, 3);
    });
  });

  module('realms', function () {
    test('a declaration that names no realms searches the ones the request names', async function (assert) {
      let response = await federatedSearch(
        {
          operation: 'byStatus',
          on: SCHEDULE,
          params: { status: 'open' },
          realms: [SCHOOL, OTHER],
        },
        PROVIDER_A,
      );

      assert.deepEqual(sortedIds(response), [
        `${OTHER}schedules/other-open`,
        ...SCHOOL_OPEN,
      ]);
    });

    test('a declaration’s own realms are searched, narrowed to the ones the request names', async function (assert) {
      let both = await federatedSearch(
        { operation: 'openInSchool', on: SCHEDULE, realms: [SCHOOL, OTHER] },
        PROVIDER_A,
      );
      assert.strictEqual(both.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        sortedIds(both),
        SCHOOL_OPEN,
        'the realm the declaration does not name is not searched, though the request named it',
      );

      let outside = await federatedSearch(
        { operation: 'openInSchool', on: SCHEDULE, realms: [OTHER] },
        PROVIDER_A,
      );
      assert.strictEqual(
        outside.status,
        400,
        'a request naming none of the declaration’s realms has nothing to search',
      );
      assert.true(
        /may search none of them/.test(outside.body.errors[0].detail),
        `detail says why: ${outside.body.errors[0].detail}`,
      );
    });

    test('a named query naming no realms is turned away before it resolves', async function (assert) {
      let response = await federatedSearch(
        { operation: 'byStatus', on: SCHEDULE, params: { status: 'open' } },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.true(
        /realms must be supplied/.test(response.text),
        `the federated endpoint's own refusal of a request that names no realm: ${response.text}`,
      );
    });
  });

  module('a realm’s own _search', function () {
    test('a named query is served its declaration, with the realm-authenticated user as the actor', async function (assert) {
      let response = await realmSearch(
        school,
        {
          operation: 'listMySchedules',
          on: SCHEDULE,
          params: { actor: PROVIDER_B },
          filter: EVERYTHING,
        },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(sortedIds(response), [
        `${SCHOOL}schedules/a-closed`,
        `${SCHOOL}schedules/a-open-1`,
        `${SCHOOL}schedules/a-open-2`,
      ]);
    });

    test('a named query searches the realm it was sent to', async function (assert) {
      let response = await realmSearch(
        other,
        { operation: 'byStatus', on: SCHEDULE, params: { status: 'open' } },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(sortedIds(response), [`${OTHER}schedules/other-open`]);
    });

    test('a declaration scoped to other realms is refused here', async function (assert) {
      let response = await realmSearch(
        other,
        { operation: 'openInSchool', on: SCHEDULE },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(response.body.errors[0].code, 'invalid-params');
    });

    test('a render has no actor here either', async function (assert) {
      let response = await realmSearch(
        school,
        { operation: 'listMySchedules', on: SCHEDULE },
        PROVIDER_A,
        { [DURING_PRERENDER_HEADER]: 'true' },
      );

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.strictEqual(response.body.errors[0].code, 'actor-required');
    });

    test('an unknown operation is refused', async function (assert) {
      let response = await realmSearch(
        school,
        { operation: 'listEverything', on: SCHEDULE },
        PROVIDER_A,
      );

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
      assert.strictEqual(response.body.errors[0].code, 'unknown-operation');
    });
  });
});
