import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CardStore, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-card-store';

import { setupRenderingTest } from '../helpers/setup';

const CARD = 'http://test-realm/test/Pet/mango';
const OTHER_CARD = 'http://test-realm/other/Pet/ghost';

// The store's answer to "can a link edge take what you are already holding for
// this id instead of loading it?" Two unrelated guarantees can produce a yes —
// the scoping an indexing render puts the store under, and the index-event
// coverage its owner reports — and a store that has neither says no.
module('Unit | resident instance reuse', function (hooks) {
  setupRenderingTest(hooks);

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelJobId;
  });

  function enterRenderScope() {
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelJobId = '17.23';
  }

  function makeStore(coveredIds?: string[]): CardStore {
    let referenceCount: ReferenceCount = new Map();
    let network = getService('network');
    let storeHooks = coveredIds
      ? { receivesIndexEventsFor: (id: string) => coveredIds.includes(id) }
      : undefined;
    return new CardStore(
      referenceCount,
      (async () => new Response('{}')) as typeof globalThis.fetch,
      network.virtualNetwork,
      // Only the hook under test is supplied; the rest of the owner's surface
      // is never reached from here.
      storeHooks as any,
    );
  }

  test('a render scope makes what the store holds reusable on its own', function (assert) {
    enterRenderScope();
    let store = makeStore();
    assert.true(
      store.canReuseResidentInstance(CARD),
      'the scope answers for every id, with no owner consulted',
    );
  });

  test('a render flag without a job id is not a scope', function (assert) {
    (globalThis as any).__boxelRenderContext = true;
    let store = makeStore();
    assert.false(
      store.canReuseResidentInstance(CARD),
      'a render that scopes nothing offers nothing to reuse on',
    );
  });

  test('outside a scope reuse follows the index-event coverage the owner reports', function (assert) {
    let store = makeStore([CARD]);
    assert.true(
      store.canReuseResidentInstance(CARD),
      'a target whose changes reach this store is reusable',
    );
    assert.false(
      store.canReuseResidentInstance(OTHER_CARD),
      'a target whose changes would never reach this store is not',
    );
  });

  test('a store with no owner to ask never reuses', function (assert) {
    let store = makeStore();
    assert.false(
      store.canReuseResidentInstance(CARD),
      'nothing vouches for what this store holds, so every edge loads',
    );
  });
});
