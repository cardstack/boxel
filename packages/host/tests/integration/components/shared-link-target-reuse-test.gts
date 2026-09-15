import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type LooseSingleCardDocument,
  type Permissions,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type CardStore from '@cardstack/host/lib/gc-card-store';
import type StoreService from '@cardstack/host/services/store';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  linksTo,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const testRealm2URL = 'http://test-realm/test2/';

// Enough parents to tell "once" from "once per parent" without the count being
// mistakable for an off-by-one.
const PARENT_COUNT = 5;

const LOCAL_PET = `${testRealmURL}Pet/mango`;
const FOREIGN_PET = `${testRealm2URL}Pet/ghost`;
// Lives in the second realm and is read directly, which is what puts that
// realm under a subscription.
const FOREIGN_NEIGHBOR = `${testRealm2URL}Pet/ghost-neighbor`;

let loader: Loader;
let storeService: StoreService;
let cardStore: CardStore;

// A parent whose link carries only its target's location, the way a realm
// serving links-only live reads answers: the target is named, never inlined,
// so each parent has to resolve it for itself.
function ownerDoc(name: string, petId: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { firstName: name },
      relationships: { pet: { links: { self: petId } } },
      meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Owner' } },
    },
  };
}

function petDoc(name: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { firstName: name },
      meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' } },
    },
  };
}

function ownerIds(prefix: string): string[] {
  return Array.from(
    { length: PARENT_COUNT },
    (_, i) => `${testRealmURL}Owner/${prefix}${i}`,
  );
}

function ownerContents(prefix: string, petId: string) {
  return Object.fromEntries(
    Array.from({ length: PARENT_COUNT }, (_, i) => [
      `Owner/${prefix}${i}.json`,
      ownerDoc(`${prefix}${i}`, petId) as SingleCardDocument,
    ]),
  );
}

module('Integration | shared link target reuse', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
    autostart: true,
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  hooks.beforeEach(async function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
    storeService = getService('store');
    cardStore = (storeService as any).store as CardStore;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
    }
    class Owner extends CardDef {
      static displayName = 'Owner';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      liveReadsResolveLinksOnly: true,
      contents: {
        'test-cards.gts': { Owner, Pet },
        'Pet/mango.json': petDoc('Mango') as SingleCardDocument,
        ...ownerContents('local', LOCAL_PET),
        ...ownerContents('foreign', FOREIGN_PET),
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      liveReadsResolveLinksOnly: true,
      contents: {
        'Pet/ghost.json': petDoc('Ghost') as SingleCardDocument,
        'Pet/ghost-neighbor.json': petDoc(
          'Ghost Neighbor',
        ) as SingleCardDocument,
      },
    });
    await getService('realm').login(testRealmURL);
    await getService('realm').login(testRealm2URL);
  });

  // Every card document the link loader asks the store for, in order. A reused
  // instance never reaches the store, so this is the per-edge cost the reuse
  // removes — and counting calls rather than network requests keeps the
  // per-URL in-flight map, which only collapses edges asking at the same
  // moment, from standing in for reuse across time.
  function trackCardDocLoads(): { urls: () => string[]; restore: () => void } {
    let urls: string[] = [];
    let original = cardStore.loadCardDocument;
    (cardStore as any).loadCardDocument = function (url: string, opts: any) {
      urls.push(url);
      return original.call(cardStore, url, opts);
    };
    return {
      urls: () => urls,
      restore: () => {
        (cardStore as any).loadCardDocument = original;
      },
    };
  }

  async function read(id: string): Promise<CardDefType> {
    storeService.addReference(id);
    await storeService.flush();
    return storeService.peek(id) as CardDefType;
  }

  // One parent at a time, each fully settled before the next is read, so
  // nothing here overlaps and every load after the first is one reuse could
  // have avoided.
  async function renderEachOwner(ids: string[]) {
    for (let id of ids) {
      let owner = await read(id);
      await renderCard(loader, owner, 'isolated');
      // The link the rendered template reads, read here as well so the edge is
      // driven whatever the default template chooses to show.
      (owner as any).pet;
      await settled();
      await storeService.flush();
    }
  }

  function countFor(urls: string[], target: string): number {
    return urls.filter((url) => url.startsWith(target)).length;
  }

  test('a target shared by many parents loads once, not once per parent', async function (assert) {
    let tracker = trackCardDocLoads();
    try {
      await renderEachOwner(ownerIds('local'));
      let urls = tracker.urls();
      assert.strictEqual(
        countFor(urls, LOCAL_PET),
        1,
        `the shared target loaded once across ${PARENT_COUNT} parents`,
      );
      // The guardrail figure: loads per distinct card loaded. At 1 every card
      // the page needed was paid for once; at the parent count the same cards
      // are being rebuilt per edge.
      let distinct = new Set(urls).size;
      assert.strictEqual(
        urls.length,
        distinct,
        `${urls.length} card-document loads over ${distinct} distinct cards`,
      );
    } finally {
      tracker.restore();
    }
  });

  test('a target in a realm nothing else references loads once per parent', async function (assert) {
    let tracker = trackCardDocLoads();
    try {
      await renderEachOwner(ownerIds('foreign'));
      assert.strictEqual(
        countFor(tracker.urls(), FOREIGN_PET),
        PARENT_COUNT,
        'a target whose realm sends this store no index events is never reused',
      );
    } finally {
      tracker.restore();
    }
  });

  test('a target in a second realm the page also reads loads once', async function (assert) {
    // Reading any card in that realm is what subscribes this store to its
    // index events, which is the whole of what the target has to be covered by.
    await read(FOREIGN_NEIGHBOR);
    let tracker = trackCardDocLoads();
    try {
      await renderEachOwner(ownerIds('foreign'));
      assert.strictEqual(
        countFor(tracker.urls(), FOREIGN_PET),
        1,
        'the subscription, not the realm boundary, is what qualifies a target',
      );
    } finally {
      tracker.restore();
    }
  });
});
