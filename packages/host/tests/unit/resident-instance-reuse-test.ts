import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CardStore, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-card-store';

import {
  CardDef,
  contains,
  field,
  StringField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const CARD = 'http://test-realm/test/Pet/mango';
const OTHER_CARD = 'http://test-realm/other/Pet/ghost';

// The store's answer to "can a link edge take what you are already holding for
// this id instead of loading it?" Three things have to hold: the store holds a
// finished instance for that id, and then either the scoping an indexing render
// puts the store under, or the index-event coverage its owner reports. A store
// with none of them says no.
module('Unit | resident instance reuse', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelJobId;
  });

  function enterRenderScope() {
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelJobId = '17.23';
  }

  // Built per test: the base-realm definitions these extend are only loaded
  // once `setupBaseRealm` has run.
  function makePet(name: string): CardDefType {
    class Pet extends CardDef {
      @field firstName = contains(StringField);
    }
    return new Pet({ firstName: name }) as CardDefType;
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

  // A finished deserialize is what moves an instance into the tracked bucket,
  // so a test that wants the completion gate satisfied seeds it there.
  function seedCompleted(store: CardStore, id: string) {
    store.setCard(id, makePet('Mango'));
  }

  test('a render scope makes what the store holds reusable on its own', function (assert) {
    enterRenderScope();
    let store = makeStore();
    seedCompleted(store, CARD);
    assert.true(
      store.canReuseResidentInstance(CARD),
      'the scope answers for every id, with no owner consulted',
    );
  });

  test('a render flag without a job id is not a scope', function (assert) {
    (globalThis as any).__boxelRenderContext = true;
    let store = makeStore();
    seedCompleted(store, CARD);
    assert.false(
      store.canReuseResidentInstance(CARD),
      'a render that scopes nothing offers nothing to reuse on',
    );
  });

  test('outside a scope reuse follows the index-event coverage the owner reports', function (assert) {
    let store = makeStore([CARD]);
    seedCompleted(store, CARD);
    seedCompleted(store, OTHER_CARD);
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
    seedCompleted(store, CARD);
    assert.false(
      store.canReuseResidentInstance(CARD),
      'nothing vouches for what this store holds, so every edge loads',
    );
  });

  // The completion half of the gate. A deserialize plants its instance before
  // it builds a single field and leaves a failed one in place so cyclic
  // deserialization can still resolve it, so "the store has something under
  // this id" and "that something is finished" are different questions — and
  // only the second one licenses handing it to a reader.
  test('an instance that has not finished deserializing is never reused', function (assert) {
    enterRenderScope();
    let store = makeStore([CARD]);
    store.setCardNonTracked(CARD, makePet('Half-built') as any);
    assert.false(
      store.canReuseResidentInstance(CARD),
      'a scope does not make a half-built instance reusable',
    );
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelJobId;
    assert.false(
      store.canReuseResidentInstance(CARD),
      'neither does the owner reporting coverage of it',
    );
  });

  test('an id the store holds nothing for is not reusable', function (assert) {
    enterRenderScope();
    let store = makeStore([CARD]);
    assert.false(
      store.canReuseResidentInstance(CARD),
      'there is no resident instance to stand in for the load',
    );
  });
});
