import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  rri,
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

// The card definitions live in the realm that mounts first, so the other
// realm's cards and the links that cross between them all resolve while it
// indexes. Which realm owns them is immaterial to what is under test.
const CARDS_MODULE = rri(`${testRealm2URL}test-cards`);

// Local paths, each distinct enough that a substring match against a load's url
// picks out one card: a load is asked for under whichever spelling of an id the
// link carried, so matching a whole id would miss its aliases.
const LOCAL_PET_PATH = 'Pet/mango';
const FOREIGN_PET_PATH = 'Pet/ghost';
// Lives in the second realm and is read directly, which is what puts that realm
// under a subscription.
const FOREIGN_NEIGHBOR_PATH = 'Pet/casper';

const LOCAL_PET = `${testRealmURL}${LOCAL_PET_PATH}`;
const FOREIGN_PET = `${testRealm2URL}${FOREIGN_PET_PATH}`;
const FOREIGN_NEIGHBOR = `${testRealm2URL}${FOREIGN_NEIGHBOR_PATH}`;

let loader: Loader;
let storeService: StoreService;
let cardStore: CardStore;

// A parent whose link carries only its target's location, the way a realm
// serving links-only live reads answers: the target is named, never inlined, so
// each parent has to resolve it for itself.
function ownerDoc(name: string, petId: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { firstName: name },
      relationships: { pet: { links: { self: petId } } },
      meta: { adoptsFrom: { module: CARDS_MODULE, name: 'Owner' } },
    },
  };
}

function petDoc(name: string): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: { firstName: name },
      meta: { adoptsFrom: { module: CARDS_MODULE, name: 'Pet' } },
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
      realmURL: testRealm2URL,
      liveReadsResolveLinksOnly: true,
      contents: {
        'test-cards.gts': { Owner, Pet },
        [`${FOREIGN_PET_PATH}.json`]: petDoc('Ghost') as SingleCardDocument,
        [`${FOREIGN_NEIGHBOR_PATH}.json`]: petDoc(
          'Casper',
        ) as SingleCardDocument,
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      liveReadsResolveLinksOnly: true,
      contents: {
        [`${LOCAL_PET_PATH}.json`]: petDoc('Mango') as SingleCardDocument,
        ...ownerContents('local', LOCAL_PET),
        ...ownerContents('foreign', FOREIGN_PET),
      },
    });
    await getService('realm').login(testRealm2URL);
    await getService('realm').login(testRealmURL);
  });

  // Every card document the link loader asks the store for, in order. A reused
  // instance never reaches the store, so this is the per-edge cost the reuse
  // removes — and counting calls rather than network requests keeps the store's
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

  // The shape a page of results arrives in. Every parent is read first, so each
  // one deserializes while the shared target is still absent from the store and
  // leaves a placeholder of its own behind — the deserializer resolves a
  // relationship straight from the store when the target is already held, so a
  // parent read after the target had loaded would never reach the link loader
  // at all. Only then are the links read, one parent at a time and settled in
  // between, so nothing overlaps and every read after the first is one an
  // instance already in hand could answer.
  async function readThenRenderEach(ids: string[]) {
    let owners: CardDefType[] = [];
    for (let id of ids) {
      owners.push(await read(id));
    }
    for (let owner of owners) {
      await renderCard(loader, owner, 'isolated');
      // The link the rendered template reads, read here as well so the edge is
      // driven whatever the default template chooses to show.
      (owner as any).pet;
      await settled();
      await storeService.flush();
    }
  }

  function countFor(urls: string[], targetPath: string): number {
    return urls.filter((url) => url.includes(targetPath)).length;
  }

  test('a target shared by many parents loads once, not once per parent', async function (assert) {
    let tracker = trackCardDocLoads();
    try {
      await readThenRenderEach(ownerIds('local'));
      let urls = tracker.urls();
      assert.strictEqual(
        countFor(urls, LOCAL_PET_PATH),
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
      await readThenRenderEach(ownerIds('foreign'));
      // The other end of the same guardrail figure: one load per edge rather
      // than one per card, which is what a target no reuse covers costs.
      assert.strictEqual(
        countFor(tracker.urls(), FOREIGN_PET_PATH),
        PARENT_COUNT,
        'a target whose realm sends this store no index events is never reused',
      );
    } finally {
      tracker.restore();
    }
  });

  // The judgement the whole gate rests on, read directly rather than through
  // its effect on a load count: does this store hear that a given id was
  // re-indexed? It is a realm lookup against the store's live subscription
  // set, and an id reaches it under whichever spelling a link carried — so the
  // fold in front of that lookup has to agree with the one the subscribe path
  // performs, whatever spelling it is handed.
  test('index-event coverage is reported per subscribed realm, in any spelling of an id', async function (assert) {
    let answersFor = (id: string) =>
      (storeService as any).receivesIndexEventsFor(id) as boolean;

    // Reading a card is what subscribes the store to its realm.
    await read(LOCAL_PET);

    assert.true(
      answersFor(LOCAL_PET),
      'a target in a realm this store reads is covered',
    );
    assert.true(
      answersFor(rri(LOCAL_PET)),
      'and is still covered when the id arrives as an RRI',
    );
    assert.false(
      answersFor(FOREIGN_PET),
      'a realm nothing on the page has read is not covered',
    );
    assert.false(
      answersFor('some-local-id-no-realm-has-indexed'),
      'a local id names an instance no realm has indexed',
    );

    // Reading the second realm subscribes to it, and the answer moves with the
    // subscription rather than with the realm boundary.
    await read(FOREIGN_NEIGHBOR);
    assert.true(
      answersFor(FOREIGN_PET),
      'the same target is covered once its realm is subscribed',
    );
  });

  test('a target in a second realm the page also reads loads once', async function (assert) {
    // Reading any card in that realm is what subscribes this store to its index
    // events, which is the whole of what the target has to be covered by.
    await read(FOREIGN_NEIGHBOR);
    let tracker = trackCardDocLoads();
    try {
      await readThenRenderEach(ownerIds('foreign'));
      assert.strictEqual(
        countFor(tracker.urls(), FOREIGN_PET_PATH),
        1,
        'the subscription, not the realm boundary, is what qualifies a target',
      );
    } finally {
      tracker.restore();
    }
  });
});
