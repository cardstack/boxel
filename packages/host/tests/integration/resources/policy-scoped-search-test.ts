import type { RenderingTestContext } from '@ember/test-helpers';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  Deferred,
  rri,
  SupportedMimeType,
  type LooseSingleCardDocument,
  type NamedSearchWireQuery,
  type Query,
} from '@cardstack/runtime-common';

import type { Args as SearchResourceArgs } from '@cardstack/host/resources/search';
import { SearchResource } from '@cardstack/host/resources/search';
import type StoreService from '@cardstack/host/services/store';

import {
  realmConfigCardJSON,
  setupAuthEndpoints,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupCatalogTestSubset } from '../../helpers/catalog-test-subset';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  getRealmServerRoute,
  registerDefaultRoutes,
  registerRealmServerRoute,
} from '../../helpers/realm-server-mock/routes';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

// The live search's client-side arm, against a result the realm server scoped
// by policy. The arm merges cards the store holds that match the query into
// the server's rows, so a local create or edit shows up before the realm
// reindexes. Of a realm the result marks policy-scoped it may only drop rows,
// never add them: a matching card of that realm the server did not return may
// be one the caller's policy withheld.
//
// Two realms. The test user reads Coarse outright. Scoped is one they do not
// read: its policy lets them read any schedule they are handed, and grants
// them `listOpen` only over their own. Every card the user could be shown in
// one realm has a twin in the other.

const COARSE = testRealmURL;
const SCOPED = 'http://test-realm/scoped/';
const USER = '@testuser:localhost';
const OWNER = '@owner:localhost';

const SCHEDULE = { module: rri(`${COARSE}schedule`), name: 'Schedule' };

const SCHEDULE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Schedule extends CardDef {
    @field title = contains(StringField);
    @field providerId = contains(StringField);
    @field status = contains(StringField);

    @operation static listOpen = {
      base: 'query',
      query: { filter: { on: () => Schedule, eq: { status: 'open' } } },
    };
  }
`;

const policyRef = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const scopedPolicy: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Scoped' },
      rules: [
        {
          targetType: SCHEDULE,
          grants: [
            { operation: 'read' },
            { operation: 'listOpen', where: '.providerId == actor()' },
          ],
        },
      ],
    },
    meta: { adoptsFrom: policyRef },
  },
};

function schedule(attributes: {
  title: string;
  providerId: string;
  status: string;
}): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: SCHEDULE },
    },
  };
}

const MINE_OPEN = `${SCOPED}schedules/mine-open`;
const MINE_CLOSED = `${SCOPED}schedules/mine-closed`;
const THEIRS_OPEN = `${SCOPED}schedules/theirs-open`;
const COARSE_OPEN = `${COARSE}schedules/open`;

const OPEN: Query = {
  filter: { on: SCHEDULE, eq: { status: 'open' } },
};

// The resource, with the promise its first search settles exposed.
type LiveSearch = Omit<SearchResource, 'loaded'> & { loaded: Promise<void> };

type ScheduleCard = CardDef & {
  title: string;
  providerId: string;
  status: string;
};

module('Integration | policy-scoped search', function (hooks) {
  let storeService: StoreService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: USER,
    activeRealms: [baseRealm.url, COARSE],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    storeService = getService('store');
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: COARSE,
      contents: {
        'schedule.gts': SCHEDULE_MODULE,
        'schedules/open.json': schedule({
          title: 'Coarse open',
          providerId: OWNER,
          status: 'open',
        }),
        'schedules/closed.json': schedule({
          title: 'Coarse closed',
          providerId: OWNER,
          status: 'closed',
        }),
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: SCOPED,
      permissions: {
        [USER]: [],
        [OWNER]: ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'Scoped',
          policy: `${SCOPED}policies/policy`,
        }),
        'policies/policy.json': scopedPolicy,
        'schedules/mine-open.json': schedule({
          title: 'Mine open',
          providerId: USER,
          status: 'open',
        }),
        'schedules/mine-closed.json': schedule({
          title: 'Mine closed',
          providerId: USER,
          status: 'closed',
        }),
        'schedules/theirs-open.json': schedule({
          title: 'Theirs open',
          providerId: OWNER,
          status: 'open',
        }),
      },
    });
  });

  function liveSearch(owner: object, query: Query, realms: string[]) {
    return SearchResource.from(owner, () => ({
      named: {
        query,
        realms,
        isLive: true,
        isAutoSaved: false,
        storeService,
        owner,
      } as SearchResourceArgs['named'],
    })) as unknown as LiveSearch;
  }

  function ids(search: LiveSearch): string[] {
    return search.instances.map((instance) => String(instance.id)).sort();
  }

  // A schedule held in the store and never saved, standing in for a card the
  // user created before the realm has indexed it.
  async function createLocally(realmURL: string, path: string) {
    return (await storeService.add(
      {
        data: {
          type: 'card',
          id: `${realmURL}${path}`,
          attributes: {
            title: `Local ${path}`,
            providerId: USER,
            status: 'open',
          },
          meta: { adoptsFrom: SCHEDULE },
        },
      } as LooseSingleCardDocument,
      { doNotPersist: true },
    )) as ScheduleCard;
  }

  test('a matching card of a policy-scoped realm that the server did not return is not merged into the result', async function (this: RenderingTestContext, assert) {
    // Read through the policy's `read` grant, which lets the user hold a
    // schedule they were handed without letting them enumerate the type.
    let theirs = (await storeService.get(THEIRS_OPEN)) as ScheduleCard;
    assert.strictEqual(
      theirs.status,
      'open',
      'the store holds a card of the scoped realm that matches the query',
    );

    let search = liveSearch(this.owner, OPEN, [SCOPED, COARSE]);
    await search.loaded;
    await settled();

    assert.deepEqual(
      search.meta.policyScopedRealms,
      [SCOPED],
      'the result marks the realm the user does not read, and only it',
    );
    assert.deepEqual(
      ids(search),
      [COARSE_OPEN],
      'the result holds only the rows the server returned',
    );
  });

  test('a local create appears in the realm the result does not scope, and not in the realm it does', async function (this: RenderingTestContext, assert) {
    let search = liveSearch(this.owner, OPEN, [SCOPED, COARSE]);
    await search.loaded;
    await settled();
    assert.deepEqual(ids(search), [COARSE_OPEN]);

    await createLocally(COARSE, 'schedules/local');
    await createLocally(SCOPED, 'schedules/local');
    await settled();

    assert.deepEqual(
      ids(search),
      [`${COARSE}schedules/local`, COARSE_OPEN].sort(),
      'the create in the realm the user reads is merged, the one in the scoped realm is not',
    );
  });

  test('the same local create is merged when the result does not scope its realm', async function (this: RenderingTestContext, assert) {
    // The user now reads the realm outright, so the server consults no policy
    // for it and the result carries no mark.
    setupAuthEndpoints({ [SCOPED]: ['read'] });

    let search = liveSearch(this.owner, OPEN, [SCOPED, COARSE]);
    await search.loaded;
    await settled();
    assert.strictEqual(
      search.meta.policyScopedRealms,
      undefined,
      'the result marks no realm',
    );

    await createLocally(SCOPED, 'schedules/local');
    await settled();

    assert.true(
      ids(search).includes(`${SCOPED}schedules/local`),
      'the create is merged into the result',
    );
  });

  // Until a search answers for a realm, the result holds no mark for it, so
  // the arm widens only into a realm the session already knows it reads.
  test('before the first answer lands, a matching card of a realm the session does not read is not merged', async function (this: RenderingTestContext, assert) {
    await storeService.get(COARSE_OPEN);
    await storeService.get(THEIRS_OPEN);

    let answer = getRealmServerRoute(new URL('http://mock/_federated-search'))!;
    let held = new Deferred<void>();
    registerRealmServerRoute({
      path: '/_federated-search',
      handler: async (req, url, state) => {
        await held.promise;
        return await answer.handler(req, url, state);
      },
    });
    try {
      let search = liveSearch(this.owner, OPEN, [SCOPED, COARSE]);
      await waitUntil(() => ids(search).includes(COARSE_OPEN), {
        timeout: 10_000,
      });
      assert.deepEqual(
        ids(search),
        [COARSE_OPEN],
        'while the search is in flight, the card of the realm the session reads is merged, and the card of the scoped realm is not',
      );

      held.fulfill();
      await search.loaded;
      await settled();
      assert.deepEqual(
        search.meta.policyScopedRealms,
        [SCOPED],
        'the answer marks the scoped realm',
      );
      assert.deepEqual(ids(search), [COARSE_OPEN]);
    } finally {
      registerDefaultRoutes();
    }
  });

  test('after a search fails, a matching card of a realm the session does not read is not merged', async function (this: RenderingTestContext, assert) {
    await storeService.get(COARSE_OPEN);
    await storeService.get(THEIRS_OPEN);

    registerRealmServerRoute({
      path: '/_federated-search',
      handler: async () => new Response('unavailable', { status: 500 }),
    });
    try {
      let search = liveSearch(this.owner, OPEN, [SCOPED, COARSE]);
      await search.loaded;
      await settled();

      assert.strictEqual(search.errors?.length, 1, 'the search failed');
      assert.deepEqual(
        ids(search),
        [COARSE_OPEN],
        'the card of the realm the session reads is merged, and the card of the scoped realm is not',
      );
    } finally {
      registerDefaultRoutes();
    }
  });

  test('a row a policy-scoped result returned still drops out when a local edit stops it matching', async function (this: RenderingTestContext, assert) {
    // A policy composes its grants into a declared query, which this resource
    // does not send, so the answer to one is replayed to it exactly as the
    // realm server produced it.
    let served = await storeService.searchEntries(
      {
        operation: 'listOpen',
        on: SCHEDULE,
        fields: { entry: ['item'] },
      } as NamedSearchWireQuery,
      [SCOPED],
    );
    assert.deepEqual(
      served.data.map((entry) => entry.id),
      [MINE_OPEN],
      "the server answers with the user's own open schedule, which the grant admits",
    );
    assert.deepEqual(served.meta.policyScopedRealms, [SCOPED]);

    registerRealmServerRoute({
      path: '/_federated-search',
      handler: async () =>
        new Response(JSON.stringify(served), {
          status: 200,
          headers: { 'content-type': SupportedMimeType.CardJson },
        }),
    });
    try {
      await storeService.get(THEIRS_OPEN);
      let mineClosed = (await storeService.get(MINE_CLOSED)) as ScheduleCard;
      let search = liveSearch(this.owner, OPEN, [SCOPED]);
      await search.loaded;
      await settled();
      assert.deepEqual(
        ids(search),
        [MINE_OPEN],
        'the returned row is shown, and the matching card the grant withheld is not',
      );

      // Read before the edit's autosave can reach the realm, so what drops
      // the row is the local state alone.
      let mine = storeService.peek(MINE_OPEN) as ScheduleCard;
      mine.status = 'closed';
      assert.deepEqual(ids(search), [], 'the edited row drops out');

      mineClosed.status = 'open';
      assert.deepEqual(
        ids(search),
        [],
        'and a card of the scoped realm that a local edit makes match is not added',
      );
    } finally {
      registerDefaultRoutes();
    }
  });
});
