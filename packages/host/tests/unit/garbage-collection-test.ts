import { type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  localId,
  LooseSingleCardDocument,
  isNotLoadedError,
  type Loader,
  type CardErrorJSONAPI as CardError,
} from '@cardstack/runtime-common';

import CardStore, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-card-store';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type CardDef as CardInstance } from 'https://cardstack.com/base/card-api';

import { saveCard, testRealmURL } from '../helpers';
import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;

module('Unit | identity-context garbage collection', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let api: typeof CardAPI;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    api = await loader.import(`${baseRealm.url}card-api`);
  });

  function makeError(id: string): CardError {
    return {
      id,
      status: 500,
      title: 'test card error',
      message: "i'm a test card error",
      realm: undefined,
      meta: {
        lastKnownGoodHtml: null,
        cardTitle: null,
        scopedCssUrls: [],
        stack: null,
      },
    };
  }

  async function saveAll({
    store,
    jade,
    queenzy,
    germaine,
    boris,
    hassan,
  }: {
    store: CardStore;
    jade: CardInstance;
    queenzy: CardInstance;
    germaine: CardInstance;
    boris: CardInstance;
    hassan: CardInstance;
  }) {
    await saveCard(jade, `${testRealmURL}jade`, loader, store);
    await saveCard(queenzy, `${testRealmURL}queenzy`, loader, store);
    await saveCard(germaine, `${testRealmURL}germaine`, loader, store);
    await saveCard(boris, `${testRealmURL}boris`, loader, store);
    await saveCard(hassan, `${testRealmURL}hassan`, loader, store);
  }

  async function setupTest(
    doSave?: (args: {
      store: CardStore;
      jade: CardInstance;
      queenzy: CardInstance;
      germaine: CardInstance;
      boris: CardInstance;
      hassan: CardInstance;
    }) => Promise<void>,
  ) {
    class Person extends CardDef {
      @field name = contains(StringField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
    }
    loader.shimModule(`${testRealmURL}test-cards`, { Person });

    let jade = new Person({ name: 'Jade' });
    let queenzy = new Person({ name: 'Queenzy' });
    let germaine = new Person({ name: 'Germaine', bestFriend: queenzy });
    let boris = new Person({ name: 'Boris' });
    let hassan = new Person({
      name: 'Hassan',
      bestFriend: jade,
      friends: [germaine],
    });

    let referenceCount: ReferenceCount = new Map();
    let fetch = getService('network').fetch;
    let store = new CardStore(referenceCount, fetch);

    store.set(jade[localId], jade);
    store.set(germaine[localId], germaine);
    store.set(queenzy[localId], queenzy);
    store.set(boris[localId], boris);
    store.set(hassan[localId], hassan);

    await doSave?.({
      store,
      jade,
      queenzy,
      germaine,
      boris,
      hassan,
    });

    return {
      referenceCount,
      store,
      instances: { jade, queenzy, germaine, boris, hassan },
    };
  }

  test('can mark saved instances that have 0 reference count for GC', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    assert.deepEqual(
      store.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
    assert.strictEqual(store.get(jade.id), jade, 'store contains "jade"');
    assert.strictEqual(
      store.get(queenzy.id),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.get(germaine.id),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(store.get(boris.id), boris, 'store contains "boris"');
    assert.strictEqual(store.get(hassan.id), hassan, 'store contains "hassan"');
  });

  test('can mark unsaved instances without that have a 0 reference count for GC', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    store.sweep(api);

    assert.deepEqual(
      store.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
    assert.strictEqual(store.get(jade[localId]), jade, 'store contains "jade"');
    assert.strictEqual(
      store.get(queenzy[localId]),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.get(germaine[localId]),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(
      store.get(boris[localId]),
      boris,
      'store contains "boris"',
    );
    assert.strictEqual(
      store.get(hassan[localId]),
      hassan,
      'store contains "hassan"',
    );
  });

  test('can remove unsubscribed instances for GC after being marked in 2 consecutive sweeps', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);
    store.sweep(api);

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
    assert.strictEqual(store.get(jade.id), jade, 'store contains "jade"');
    assert.strictEqual(
      store.get(queenzy.id),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.get(germaine.id),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(store.get(hassan.id), hassan, 'store contains "hassan"');
    assert.strictEqual(
      store.get(boris.id),
      undefined,
      'store does not contain "boris"',
    );
  });

  test('a GC candidate is no longer considered a GC candidate if it is consumed by an instance that has a reference count > 0 ', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { germaine, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    germaine.friends = [boris];
    store.sweep(api);

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
    assert.strictEqual(store.get(boris.id), boris, 'store contains "boris"');
  });

  test('a GC candidate is no longer considered a GC candidate if it is consumed by an unsaved instance that has a reference count > 0', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { germaine, boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    store.sweep(api);

    germaine.friends = [boris];
    store.sweep(api);

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
    assert.strictEqual(
      store.get(boris[localId]),
      boris,
      'store contains "boris"',
    );
  });

  test('an instance becomes a GC candidate when its reference count drops to 0 for its remote id', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    referenceCount.set(hassan.id, 0);

    store.sweep(api); // this sweep removed boris

    assert.deepEqual(
      store.gcCandidates.sort(),
      [
        jade[localId],
        germaine[localId],
        queenzy[localId],
        hassan[localId],
      ].sort(),
      'the GC candidates are correct',
    );
  });

  test('an instance becomes a GC candidate when its reference count drops to zero for its local id', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    store.sweep(api);

    referenceCount.set(hassan[localId], 0);

    store.sweep(api); // this sweep removed boris

    assert.deepEqual(
      store.gcCandidates.sort(),
      [
        jade[localId],
        germaine[localId],
        queenzy[localId],
        hassan[localId],
      ].sort(),
      'the GC candidates are correct',
    );
  });

  test('a GC candidate no longer becomes a GC candidate if it is accessed in the identity map by remote id', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    store.get(boris.id);

    assert.deepEqual(
      store.gcCandidates,
      [],
      'the GC candidates are correct after getting by remote id',
    );

    store.sweep(api);

    assert.deepEqual(
      store.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct, sweep reintroduces GC candidate',
    );

    store.set(boris.id, boris);
    assert.deepEqual(
      store.gcCandidates,
      [],
      'the GC candidates are correct after setting by remote id',
    );
  });

  test('a GC candidate no longer becomes a GC candidate if it is accessed in the identity map by local id', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    store.sweep(api);

    store.get(boris[localId]);

    assert.deepEqual(
      store.gcCandidates,
      [],
      'the GC candidates are correct after getting by local id',
    );

    store.sweep(api);

    assert.deepEqual(
      store.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct, sweep reintroduces GC candidate',
    );

    store.set(boris[localId], boris);
    assert.deepEqual(
      store.gcCandidates,
      [],
      'the GC candidates are correct after setting by local id',
    );
  });

  test('a GC candidate no longer remains a GC candidate if it accessed via setting a card error in the identity map', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    store.addInstanceOrError(boris.id, makeError(boris.id));

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
  });

  test('can delete an instance from the identity map', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    store.delete(hassan.id);

    assert.deepEqual(
      store.get(hassan.id),
      undefined,
      'the instance does not exist',
    );
    assert.deepEqual(
      store.get(hassan[localId]),
      undefined,
      'the instance does not exist via local id',
    );

    assert.deepEqual(
      store.getInstanceOrError(hassan.id),
      undefined,
      'the instance does not exist',
    );
  });

  test('can delete an instance from the identity map by local id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    store.delete(hassan[localId]);

    assert.deepEqual(
      store.get(hassan[localId]),
      undefined,
      'the instance does not exist',
    );

    assert.deepEqual(
      store.get(hassan.id),
      undefined,
      'the instance does not exist via remote id',
    );

    assert.deepEqual(
      store.getInstanceOrError(hassan[localId]),
      undefined,
      'the instance does not exist',
    );
  });

  test('can delete a card error from the identity map', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    store.addInstanceOrError(hassan.id, makeError(hassan.id));
    store.delete(hassan.id);

    assert.deepEqual(
      store.getInstanceOrError(hassan.id),
      undefined,
      'the instance does not exist',
    );
  });

  test('deleting an entry from the identity map by remote id removes the GC candidate', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    store.delete(boris.id);

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
  });

  test('deleting an entry from the identity map by local id removes the GC candidate', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    store.sweep(api);

    store.delete(boris[localId]);

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
  });

  test('resetting the identity map clears all GC candidates', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    store.sweep(api);

    store.reset();

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
  });

  test('resetting the identity map clears all instances but not card errors', async function (assert) {
    let {
      store,
      instances: { hassan, jade },
    } = await setupTest(saveAll);

    store.addInstanceOrError(hassan.id, makeError(hassan.id));
    store.reset();

    assert.deepEqual(
      store.getInstanceOrError(hassan.id),
      makeError(hassan.id),
      'no error is returned from identity map',
    );

    assert.deepEqual(
      store.getInstanceOrError(jade.id),
      undefined,
      'no instance is returned from identity map',
    );
  });

  test('can add a card error to the identity map', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    // remove the current hassan instance so the stale card doesn't bleed thru
    store.delete(hassan.id);

    let error = makeError(hassan.id);
    store.addInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.get(hassan.id),
      undefined,
      'no card instance exists for the id',
    );
    assert.strictEqual(
      store.getInstanceOrError(hassan.id),
      error,
      'a card error exists for the id',
    );
  });

  test('can get a card from identity map using getInstanceOrError() by remote id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    assert.strictEqual(
      store.getInstanceOrError(hassan.id),
      hassan,
      'card instance is returned',
    );
  });

  test('can get a card from identity map using getInstanceOrError() by local id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest();

    assert.strictEqual(
      store.getInstanceOrError(hassan[localId]),
      hassan,
      'card instance is returned',
    );
  });

  test('can get a card from the identity map by correlating the last part of the remote id with the local id for an instance that has a newly assigned remote id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest();

    assert.strictEqual(
      store.getInstanceOrError(`${testRealmURL}${hassan[localId]}`),
      hassan,
      'card instance is returned',
    );

    assert.strictEqual(
      hassan.id,
      `${testRealmURL}${hassan[localId]}`,
      'instance has remote id set correctly',
    );
  });

  test('can handle encountering a NotLoaded error in an instance during garbage collection', async function (assert) {
    let { store } = await setupTest();
    let doc: LooseSingleCardDocument = {
      data: {
        id: `${testRealmURL}wu`,
        type: 'card',
        attributes: {
          name: 'Wu',
        },
        relationships: {
          bestFriend: {
            links: { self: `${testRealmURL}not-loaded` },
            // this is what a NotLoaded error looks like: a relationship data.id
            // that has no associated included resource
            data: {
              id: `${testRealmURL}not-loaded`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    };
    let instance = await api.createFromSerialized(doc.data, doc, undefined, {
      store,
    });

    try {
      (instance as any).bestFriend;
      throw new Error('expected NotLoadedError');
    } catch (err) {
      assert.true(isNotLoadedError(err), 'instance has NotLoaded error');
    }

    // success is not throwing
    store.sweep(api);
  });

  test('return a stale instance when the server state reflects an error for an id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    let error = makeError(hassan.id);
    store.addInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.get(hassan.id),
      hassan,
      'stale hassan instance is returned',
    );

    assert.strictEqual(
      store.getInstanceOrError(hassan.id),
      hassan,
      'stale hassan instance is returned',
    );
  });

  test('can get an error for an id when a stale instance exists', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    let error = makeError(hassan.id);
    store.addInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.getError(hassan.id),
      error,
      'a card error exists for the id',
    );
  });

  test('setting an instance clears a card error', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    let error = makeError(hassan.id);
    store.addInstanceOrError(hassan.id, error);
    assert.strictEqual(
      store.getError(hassan.id),
      error,
      'a card error exists for the id',
    );

    store.addInstanceOrError(hassan.id, hassan);
    assert.strictEqual(
      store.getError(hassan.id),
      undefined,
      'a card error does not exist for the id',
    );
  });

  test('can get the consumers of an instance', async function (assert) {
    let {
      store,
      instances: { germaine, queenzy },
    } = await setupTest();

    let consumers = store.consumersOf(api, queenzy);
    assert.deepEqual(
      consumers,
      [germaine],
      'the consumers for queenzy are correct',
    );
  });

  test('can get the dependencies of an instance', async function (assert) {
    let {
      store,
      instances: { hassan, jade, germaine },
    } = await setupTest();

    let dependencies = store.dependenciesOf(api, hassan);
    assert.deepEqual(
      dependencies,
      [jade, germaine],
      'the dependencies for hassan are correct',
    );
  });
});
