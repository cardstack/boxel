import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type LooseSingleCardDocument,
  type Permissions,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
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
  getRelationshipMembershipState,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
  updateFromSerialized,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const MANGO = `${testRealmURL}Pet/mango`;
const GHOST = `${testRealmURL}Pet/ghost`;

const PERSON = `${testRealmURL}Person/hassan`;

let loader: Loader;
let storeService: StoreService;
let cardStore: CardStore;
let testRealm: Realm;

// The card GET the host reloads from serves a broken link as a plain relationship
// link (identical to a not-yet-loaded link) with the target absent from
// `included` — the same wire `reloadInstance` feeds back into
// `updateFromSerialized`.
function personDoc(): LooseSingleCardDocument {
  return {
    data: {
      id: PERSON,
      type: 'card',
      attributes: { firstName: 'Hassan' },
      relationships: {
        pet: { links: { self: GHOST } },
        'pets.0': { links: { self: MANGO } },
        'pets.1': { links: { self: GHOST } },
      },
      meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
    },
  };
}

module('Integration | linksTo sentinel reload', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
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
      @field firstName = contains(StringField);
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field pets = linksToMany(Pet);
    }

    ({ realm: testRealm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
        'Pet/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' },
            },
          },
        },
        // Person/hassan pins a present link (mango) and two broken links (ghost)
        // across both arities.
        'Person/hassan.json': personDoc() as SingleCardDocument,
      },
    }));
    await getService('realm').login(testRealmURL);
  });

  // Count card-document loads against the broken reference — the fetch a
  // re-armed link kicks off on the next render.
  function trackGhostLoads(): { count: () => number; restore: () => void } {
    let count = 0;
    let original = cardStore.loadCardDocument;
    (cardStore as any).loadCardDocument = function (url: string, opts: any) {
      if (url.includes('Pet/ghost')) {
        count++;
      }
      return original.call(cardStore, url, opts);
    };
    return {
      count: () => count,
      restore: () => {
        (cardStore as any).loadCardDocument = original;
      },
    };
  }

  async function loadHassan(): Promise<CardDefType> {
    storeService.addReference(PERSON);
    await storeService.flush();
    return storeService.peek(PERSON) as CardDefType;
  }

  // Read both relationships the way a render does, driving the lazy loads.
  function readLinks(person: CardDefType) {
    (person as any).pet;
    (person as any).pets;
  }

  function petKind(person: CardDefType): string {
    return getRelationshipMembershipState(person, 'pet').membership![0].kind;
  }
  function petsKinds(person: CardDefType): string[] {
    return getRelationshipMembershipState(person, 'pets').membership!.map(
      (s) => s.kind,
    );
  }

  test('N reloads with an unchanged broken reference produce no re-fetch', async function (assert) {
    let person = await loadHassan();
    readLinks(person);
    await waitUntil(() => petKind(person) === 'not-found');
    await waitUntil(() => petsKinds(person).includes('not-found'));

    let tracker = trackGhostLoads();
    try {
      let doc = personDoc();
      for (let i = 0; i < 5; i++) {
        await updateFromSerialized(person as any, doc, cardStore);
        // Read before any render touches the field: a carried sentinel stays
        // terminal (`not-found`); a re-armed slot reverts to `not-loaded`, which
        // the next render would re-fetch.
        assert.strictEqual(
          petKind(person),
          'not-found',
          `reload ${i}: singular link stays terminal (not re-armed)`,
        );
        assert.deepEqual(
          petsKinds(person),
          ['present', 'not-found'],
          `reload ${i}: plural links stay terminal (not re-armed)`,
        );
        readLinks(person); // the render each incremental event drives
        await settled();
      }
    } finally {
      tracker.restore();
    }

    assert.strictEqual(
      tracker.count(),
      0,
      'the known-broken links are not re-fetched across 5 reloads',
    );
  });

  test('creating the missing target heals the card on the next reload', async function (assert) {
    let person = await loadHassan();
    readLinks(person);
    await waitUntil(() => petKind(person) === 'not-found');
    await waitUntil(() => petsKinds(person).includes('not-found'));

    // The missing target comes into existence; the consumer reloads, and its
    // reload document includes the freshly-created target so the link resolves.
    await testRealm.write(
      'Pet/ghost.json',
      JSON.stringify({
        data: {
          attributes: { firstName: 'Ghost' },
          meta: {
            adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' },
          },
        },
      } as LooseSingleCardDocument),
    );

    let doc = (await getService('card-service').fetchJSON(
      PERSON,
    )) as LooseSingleCardDocument;
    await updateFromSerialized(person as any, doc, cardStore);
    readLinks(person);
    await waitUntil(() => petKind(person) === 'present');
    await waitUntil(() => !petsKinds(person).includes('not-found'));

    assert.strictEqual(petKind(person), 'present', 'singular link healed');
    assert.deepEqual(
      petsKinds(person),
      ['present', 'present'],
      'plural links healed',
    );
  });

  test('a reload that re-points a broken link to a different reference re-arms it', async function (assert) {
    let CASPER = `${testRealmURL}Pet/casper`;
    let person = await loadHassan();
    readLinks(person);
    await waitUntil(() => petKind(person) === 'not-found');
    await waitUntil(() => petsKinds(person).includes('not-found'));

    // The links are re-pointed to a different (still-missing) target. The stale
    // sentinel no longer describes the reference, so it must not be carried — the
    // slot re-arms to not-loaded, and the next render retries the new target.
    let repointed: LooseSingleCardDocument = {
      data: {
        id: PERSON,
        type: 'card',
        attributes: { firstName: 'Hassan' },
        relationships: {
          pet: { links: { self: CASPER } },
          'pets.0': { links: { self: MANGO } },
          'pets.1': { links: { self: CASPER } },
        },
        meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
      },
    };
    await updateFromSerialized(person as any, repointed, cardStore);

    assert.strictEqual(
      getRelationshipMembershipState(person, 'pet').membership![0].kind,
      'not-loaded',
      're-pointed singular link re-arms to not-loaded (stale sentinel dropped)',
    );
    assert.strictEqual(
      getRelationshipMembershipState(person, 'pets').membership![1].kind,
      'not-loaded',
      're-pointed plural element re-arms to not-loaded (stale sentinel dropped)',
    );

    readLinks(person);
    await waitUntil(() => petKind(person) === 'not-found');
    let petState = getRelationshipMembershipState(person, 'pet').membership![0];
    assert.strictEqual(
      petState.reference,
      CASPER,
      'the retried link surfaces the new reference, not the stale one',
    );
  });
});
