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

// A prerender tab serves index visits from many jobs and holds the instances
// those visits loaded. Residency is what lets a target shared by hundreds of
// owners load once, but it is also handed to `linksTo` / `linksToMany`
// deserialization — and to the lazy link loader's reuse — with no freshness
// check, and nothing tells a prerender tab that a card it holds has since been
// rewritten: the write lands in the realm server, and the tab carries no
// realm-event subscription. So a card the realm rewrote between jobs would
// reduce into an owner's `computeVia` at its pre-write value, and the owner's
// row would commit that number as though it were current.
//
// The job boundary is therefore where residency has to end — and only there,
// so the within-a-job sharing that makes a dense render affordable survives.
module('Unit | job-scoped instance residency', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelJobId = '17.23';
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelJobId;
  });

  // Built per test: the base-realm definitions these extend are only loaded
  // once `setupBaseRealm` has run.
  function makePerson(name: string) {
    class Person extends CardDef {
      @field name = contains(StringField);
    }
    return new Person({ name });
  }

  // Serves any card-source request from memory: these tests only need a load
  // to reach the store's job-scope check, never a realm.
  function makeStore(): CardStore {
    let referenceCount: ReferenceCount = new Map();
    let network = getService('network');
    let stubFetch = async (input: RequestInfo | URL): Promise<Response> => {
      let href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let id = new URL(href).href.replace(/\.json$/, '');
      return new Response(
        JSON.stringify({
          data: {
            id,
            type: 'card',
            attributes: { name: 'Test' },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/vnd.card+source' },
        },
      );
    };
    return new CardStore(
      referenceCount,
      stubFetch as typeof globalThis.fetch,
      network.virtualNetwork,
    );
  }

  const residentURL = 'http://localhost:4201/test/jade';
  const otherURL = 'http://localhost:4201/test/queenzy';

  test('a card resident from an earlier job is not handed to the next one', async function (assert) {
    let store = makeStore();
    // The job this tab is already serving: a load of its own, then a card left
    // resident by it.
    await store.loadCardDocument(otherURL);
    let jade = makePerson('Jade');
    store.setCard(residentURL, jade);
    assert.strictEqual(
      store.getCard(residentURL),
      jade,
      'the card is resident while its own job runs',
    );

    (globalThis as any).__boxelJobId = '18.24';
    // The next job's first document load is where the store observes the new
    // job id — the same point the wire-document cache drops its entries.
    await store.loadCardDocument(otherURL);

    assert.strictEqual(
      store.getCard(residentURL),
      undefined,
      'the previous job’s copy is gone, so the next read of it loads from the realm',
    );
  });

  test('the job boundary is observed even when the new job loads nothing', async function (assert) {
    let store = makeStore();
    await store.loadCardDocument(otherURL);
    let jade = makePerson('Jade');
    store.setCard(residentURL, jade);

    // The render route fetches a card's source itself rather than through the
    // store, and a render whose link targets are all resident never loads
    // anything — so this is the only call that tells the store the job moved
    // on, and it has to be enough on its own.
    (globalThis as any).__boxelJobId = '18.24';
    store.observeIndexingJob();

    assert.strictEqual(
      store.getCard(residentURL),
      undefined,
      'residency ended at the boundary without a load to trigger it',
    );
  });

  test('a card stays resident for the life of one job', async function (assert) {
    let store = makeStore();
    let jade = makePerson('Jade');
    store.setCard(residentURL, jade);

    await store.loadCardDocument(otherURL);

    assert.strictEqual(
      store.getCard(residentURL),
      jade,
      'a shared target still loads once per job',
    );
  });

  test('residency outside an indexing render is left alone', async function (assert) {
    delete (globalThis as any).__boxelRenderContext;
    let store = makeStore();
    let jade = makePerson('Jade');
    store.setCard(residentURL, jade);

    (globalThis as any).__boxelJobId = '18.24';
    await store.loadCardDocument(otherURL);

    assert.strictEqual(
      store.getCard(residentURL),
      jade,
      'the app’s store keeps its instances — realm events are what refresh it',
    );
  });
});
