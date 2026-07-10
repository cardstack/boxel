import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';
import RealmService from '@cardstack/host/services/realm';
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

// Lets microtasks drain so the render-cycle barrier (a 2-microtask
// Promise) has had time to resolve and its `finally` has run before
// we observe the next read.
async function flushMicrotasks(turns = 5) {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

module(`Integration | query field render-cycle barrier`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let storeService: StoreService;
  let cardApi: typeof import('@cardstack/base/card-api');
  let string: typeof import('@cardstack/base/string');

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
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { contains, field, CardDef, linksToMany, createFromSerialized } =
      cardApi;
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

    // Cache the constructor + serializer on the test context so the
    // test body doesn't have to re-import them.
    (this as any).cardApi = cardApi;
    (this as any).Parent = Parent;
    (this as any).createFromSerialized = createFromSerialized;
  });

  test('re-reading a linksToMany query field does not register a new trackLoad each time', async function (this: RenderingTestContext, assert) {
    let { createFromSerialized } = (this as any).cardApi;
    let resource = {
      attributes: { cardTitle: 'Anchor' },
      meta: {
        adoptsFrom: { module: testRRI('test-cards'), name: 'Parent' },
      },
    };
    let parent: any = await createFromSerialized(
      resource as any,
      { data: resource } as any,
      undefined,
    );

    // First read fires the create path inside `ensureQueryFieldSearchResource`:
    //   - it registers one render-cycle barrier with `store.trackLoad`
    //   - the SearchResource's own `modify()` then registers the real
    //     search promise with `store.trackLoad` as well
    // Let those two registrations settle before we start counting.
    void parent.items;
    await flushMicrotasks(10);

    // Now hook the store's trackLoad to count any further registrations.
    // The bug we're guarding against: every re-read of a query field
    // synthesized a fresh 2-microtask barrier and registered it as a
    // tracked load, creating a feedback loop that pegged the JS thread.
    // Post-fix the reuse path must not register anything new.
    let trackLoadCount = 0;
    let originalTrackLoad = storeService.trackLoad.bind(storeService);
    (storeService as any).trackLoad = (load: Promise<void>) => {
      trackLoadCount++;
      originalTrackLoad(load);
    };

    try {
      // Three re-reads with microtask hops between them. With the bug
      // present, each read would re-arm the barrier and bump the count.
      void parent.items;
      await flushMicrotasks(10);
      void parent.items;
      await flushMicrotasks(10);
      void parent.items;
      await flushMicrotasks(10);

      assert.strictEqual(
        trackLoadCount,
        0,
        'reusing the query field across reads does not register new trackLoad calls',
      );
    } finally {
      (storeService as any).trackLoad = originalTrackLoad;
    }
  });
});
