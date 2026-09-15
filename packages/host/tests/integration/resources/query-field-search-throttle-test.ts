import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  Loader,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  baseRealm,
  Deferred,
  SEARCH_CONCURRENCY_CAP,
} from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';
import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  realmOf(_input: URL | string) {
    return testRealmURL;
  }
}

// A query-backed relationship asks the server who its members are, once per
// field per deserialized card — a fan-out nobody requested card by card, and
// the largest source of concurrent `_federated-search` requests a tab produces.
// It shares the store's concurrency ceiling with the card `@context` surface,
// so the fan-out leaves as a queue rather than as a burst. What it must NOT
// share are the other card caps: clamping the page or the realm list would
// change which cards the field reports as members.
module(`Integration | query field search throttle`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let storeService: StoreService;
  let cardApi: typeof import('@cardstack/base/card-api');
  let string: typeof import('@cardstack/base/string');
  // Counts `_federated-search` calls only, so nothing else the test environment
  // fetches can be mistaken for the field's search going out.
  let fetchCalls: number;
  let restoreFetch: (() => void) | undefined;

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    getOwner(this)!.register('service:realm', StubRealmService);
    loaderService = getService('loader-service');
    loader = loaderService.loader;
    storeService = getService('store');
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });
  setupBaseRealm(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');

    let { contains, field, CardDef, linksToMany } = cardApi;
    let { default: StringField } = string;

    class Target extends CardDef {
      static displayName = 'Target';
      @field name = contains(StringField);
    }

    class Parent extends CardDef {
      static displayName = 'Parent';
      @field cardTitle = contains(StringField);
      @field items = linksToMany(() => Target, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Parent, Target },
        'Target/anchor.json': new Target({ name: 'Anchor' }),
      },
    });

    fetchCalls = 0;
    let realmServer = getService('realm-server') as RealmServerService;
    let original = realmServer.maybeAuthedFetchForRealms.bind(realmServer);
    realmServer.maybeAuthedFetchForRealms = (async (url, ...args) => {
      if (typeof url === 'string' && url.includes('_federated-search')) {
        fetchCalls++;
      }
      return await original(url, ...args);
    }) as RealmServerService['maybeAuthedFetchForRealms'];
    restoreFetch = () => {
      realmServer.maybeAuthedFetchForRealms = original;
    };
  });

  hooks.afterEach(function () {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  test(`a query field's search waits for a slot in the store's concurrency ceiling`, async function (this: RenderingTestContext, assert) {
    // Fill every slot with work that cannot finish until this test says so.
    let gates: Deferred<void>[] = [];
    let occupied = 0;
    let occupying = Array.from({ length: SEARCH_CONCURRENCY_CAP }, () => {
      let gate = new Deferred<void>();
      gates.push(gate);
      return storeService.performThrottledSearch(async () => {
        occupied++;
        await gate.promise;
      });
    });
    await waitUntil(() => occupied >= SEARCH_CONCURRENCY_CAP, {
      timeout: 5_000,
    });
    let releaseGates = () => {
      for (let gate of gates) {
        try {
          gate.fulfill();
        } catch {
          // already settled
        }
      }
    };

    // Separate reaching the throttle from being let through it. The occupying
    // work is already running, so neither counter can see it.
    let enqueued = 0;
    let started = 0;
    let performThrottledSearch =
      storeService.performThrottledSearch.bind(storeService);
    (storeService as any).performThrottledSearch = (
      run: () => Promise<unknown>,
    ) => {
      enqueued++;
      return performThrottledSearch(async () => {
        started++;
        return await run();
      });
    };
    fetchCalls = 0;

    try {
      // Deserialize through the store service, not `createFromSerialized`
      // directly: an instance built without a store gets the fallback one,
      // whose `getSearchResource` hands back a static empty resource that never
      // searches at all.
      let parent: any = await storeService.add(
        {
          data: {
            type: 'card',
            id: `${testRealmURL}Parent/one`,
            attributes: { cardTitle: 'Anchor' },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Parent' },
            },
          },
        } as LooseSingleCardDocument,
        { doNotPersist: true },
      );
      // Either path builds the field's search resource through the same call —
      // eager resolution as the card deserializes, or this read.
      void parent.items;

      await waitUntil(() => enqueued > 0, { timeout: 5_000 });
      assert.strictEqual(
        started,
        0,
        `the field's search is queued behind the full cap`,
      );
      assert.strictEqual(
        fetchCalls,
        0,
        'nothing reached the network while it waited',
      );

      releaseGates();
      await Promise.all(occupying);
      await waitUntil(() => fetchCalls > 0, { timeout: 5_000 });
      assert.ok(started > 0, 'the search ran once a slot freed');
    } finally {
      releaseGates();
      delete (storeService as any).performThrottledSearch;
      await Promise.all(occupying);
    }
  });
});
