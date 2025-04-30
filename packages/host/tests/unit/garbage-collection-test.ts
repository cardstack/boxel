import { type RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  baseRealm,
  localId,
  LooseSingleCardDocument,
  isNotLoadedError,
  type Loader,
  type CardErrorJSONAPI as CardError,
} from '@cardstack/runtime-common';

import IdentityContext, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-identity-context';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type CardDef as CardInstance } from 'https://cardstack.com/base/card-api';

import { saveCard, lookupLoaderService, testRealmURL } from '../helpers';
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
    loader = lookupLoaderService().loader;
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
    identityContext,
    jade,
    queenzy,
    germaine,
    boris,
    hassan,
  }: {
    identityContext: IdentityContext;
    jade: CardInstance;
    queenzy: CardInstance;
    germaine: CardInstance;
    boris: CardInstance;
    hassan: CardInstance;
  }) {
    await saveCard(jade, `${testRealmURL}jade`, loader, identityContext);
    await saveCard(queenzy, `${testRealmURL}queenzy`, loader, identityContext);
    await saveCard(
      germaine,
      `${testRealmURL}germaine`,
      loader,
      identityContext,
    );
    await saveCard(boris, `${testRealmURL}boris`, loader, identityContext);
    await saveCard(hassan, `${testRealmURL}hassan`, loader, identityContext);
  }

  async function setupTest(
    doSave?: (args: {
      identityContext: IdentityContext;
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
    let identityContext = new IdentityContext(referenceCount);

    identityContext.set(jade[localId], jade);
    identityContext.set(germaine[localId], germaine);
    identityContext.set(queenzy[localId], queenzy);
    identityContext.set(boris[localId], boris);
    identityContext.set(hassan[localId], hassan);

    await doSave?.({
      identityContext,
      jade,
      queenzy,
      germaine,
      boris,
      hassan,
    });

    return {
      referenceCount,
      identityContext,
      instances: { jade, queenzy, germaine, boris, hassan },
    };
  }

  test('can mark saved instances that have 0 reference count for GC', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
    assert.strictEqual(
      identityContext.get(jade.id),
      jade,
      'identityContext contains "jade"',
    );
    assert.strictEqual(
      identityContext.get(queenzy.id),
      queenzy,
      'identityContext contains "queenzy"',
    );
    assert.strictEqual(
      identityContext.get(germaine.id),
      germaine,
      'identityContext contains "germaine"',
    );
    assert.strictEqual(
      identityContext.get(boris.id),
      boris,
      'identityContext contains "boris"',
    );
    assert.strictEqual(
      identityContext.get(hassan.id),
      hassan,
      'identityContext contains "hassan"',
    );
  });

  test('can mark unsaved instances without that have a 0 reference count for GC', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
    assert.strictEqual(
      identityContext.get(jade[localId]),
      jade,
      'identityContext contains "jade"',
    );
    assert.strictEqual(
      identityContext.get(queenzy[localId]),
      queenzy,
      'identityContext contains "queenzy"',
    );
    assert.strictEqual(
      identityContext.get(germaine[localId]),
      germaine,
      'identityContext contains "germaine"',
    );
    assert.strictEqual(
      identityContext.get(boris[localId]),
      boris,
      'identityContext contains "boris"',
    );
    assert.strictEqual(
      identityContext.get(hassan[localId]),
      hassan,
      'identityContext contains "hassan"',
    );
  });

  test('can remove unsubscribed instances for GC after being marked in 2 consecutive sweeps', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);
    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
    assert.strictEqual(
      identityContext.get(jade.id),
      jade,
      'identityContext contains "jade"',
    );
    assert.strictEqual(
      identityContext.get(queenzy.id),
      queenzy,
      'identityContext contains "queenzy"',
    );
    assert.strictEqual(
      identityContext.get(germaine.id),
      germaine,
      'identityContext contains "germaine"',
    );
    assert.strictEqual(
      identityContext.get(hassan.id),
      hassan,
      'identityContext contains "hassan"',
    );
    assert.strictEqual(
      identityContext.get(boris.id),
      undefined,
      'identityContext does not contain "boris"',
    );
  });

  test('a GC candidate is no longer considered a GC candidate if it is consumed by an instance that has a reference count > 0 ', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { germaine, boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    germaine.friends = [boris];
    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
    assert.strictEqual(
      identityContext.get(boris.id),
      boris,
      'identityContext contains "boris"',
    );
  });

  test('a GC candidate is no longer considered a GC candidate if it is consumed by an unsaved instance that has a reference count > 0', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { germaine, boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    identityContext.sweep(api);

    germaine.friends = [boris];
    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
    assert.strictEqual(
      identityContext.get(boris[localId]),
      boris,
      'identityContext contains "boris"',
    );
  });

  test('an instance becomes a GC candidate when its reference count drops to 0 for its remote id', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    referenceCount.set(hassan.id, 0);

    identityContext.sweep(api); // this sweep removed boris

    assert.deepEqual(
      identityContext.gcCandidates.sort(),
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
      identityContext,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    identityContext.sweep(api);

    referenceCount.set(hassan[localId], 0);

    identityContext.sweep(api); // this sweep removed boris

    assert.deepEqual(
      identityContext.gcCandidates.sort(),
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
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    identityContext.get(boris.id);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after getting by remote id',
    );

    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct, sweep reintroduces GC candidate',
    );

    identityContext.set(boris.id, boris);
    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after setting by remote id',
    );
  });

  test('a GC candidate no longer becomes a GC candidate if it is accessed in the identity map by local id', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    identityContext.sweep(api);

    identityContext.get(boris[localId]);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after getting by local id',
    );

    identityContext.sweep(api);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct, sweep reintroduces GC candidate',
    );

    identityContext.set(boris[localId], boris);
    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after setting by local id',
    );
  });

  test('a GC candidate no longer remains a GC candidate if it accessed via setting a card error in the identity map', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    identityContext.addInstanceOrError(boris.id, makeError(boris.id));

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('can delete an instance from the identity map', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    identityContext.delete(hassan.id);

    assert.deepEqual(
      identityContext.get(hassan.id),
      undefined,
      'the instance does not exist',
    );
    assert.deepEqual(
      identityContext.get(hassan[localId]),
      undefined,
      'the instance does not exist via local id',
    );

    assert.deepEqual(
      identityContext.getInstanceOrError(hassan.id),
      undefined,
      'the instance does not exist',
    );
  });

  test('can delete an instance from the identity map by local id', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    identityContext.delete(hassan[localId]);

    assert.deepEqual(
      identityContext.get(hassan[localId]),
      undefined,
      'the instance does not exist',
    );

    assert.deepEqual(
      identityContext.get(hassan.id),
      undefined,
      'the instance does not exist via remote id',
    );

    assert.deepEqual(
      identityContext.getInstanceOrError(hassan[localId]),
      undefined,
      'the instance does not exist',
    );
  });

  test('can delete a card error from the identity map', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    identityContext.addInstanceOrError(hassan.id, makeError(hassan.id));
    identityContext.delete(hassan.id);

    assert.deepEqual(
      identityContext.getInstanceOrError(hassan.id),
      undefined,
      'the instance does not exist',
    );
  });

  test('deleting an entry from the identity map by remote id removes the GC candidate', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    identityContext.delete(boris.id);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('deleting an entry from the identity map by local id removes the GC candidate', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest();

    referenceCount.set(hassan[localId], 1);

    identityContext.sweep(api);

    identityContext.delete(boris[localId]);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('resetting the identity map clears all GC candidates', async function (assert) {
    let {
      referenceCount,
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    referenceCount.set(hassan.id, 1);

    identityContext.sweep(api);

    identityContext.reset();

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('resetting the identity map clears all instances but not card errors', async function (assert) {
    let {
      identityContext,
      instances: { hassan, jade },
    } = await setupTest(saveAll);

    identityContext.addInstanceOrError(hassan.id, makeError(hassan.id));
    identityContext.reset();

    assert.deepEqual(
      identityContext.getInstanceOrError(hassan.id),
      makeError(hassan.id),
      'no error is returned from identity map',
    );

    assert.deepEqual(
      identityContext.getInstanceOrError(jade.id),
      undefined,
      'no instance is returned from identity map',
    );
  });

  test('can add a card error to the identity map', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    let error = makeError(hassan.id);
    identityContext.addInstanceOrError(hassan.id, error);

    assert.strictEqual(
      identityContext.get(hassan.id),
      undefined,
      'no card instance exists for the id',
    );
    assert.strictEqual(
      identityContext.getInstanceOrError(hassan.id),
      error,
      'a card error exists for the id',
    );
  });

  test('can get a card from identity map using getInstanceOrError() by remote id', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    assert.strictEqual(
      identityContext.getInstanceOrError(hassan.id),
      hassan,
      'card instance is returned',
    );
  });

  test('can get a card from identity map using getInstanceOrError() by local id', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest();

    assert.strictEqual(
      identityContext.getInstanceOrError(hassan[localId]),
      hassan,
      'card instance is returned',
    );
  });

  test('can get a card from the identity map by correlating the last part of the remote id with the local id for an instance that has a newly assigned remote id', async function (assert) {
    let {
      identityContext,
      instances: { hassan },
    } = await setupTest();

    assert.strictEqual(
      identityContext.getInstanceOrError(`${testRealmURL}${hassan[localId]}`),
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
    let { identityContext } = await setupTest();
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
      identityContext,
    });

    try {
      (instance as any).bestFriend;
      throw new Error('expected NotLoadedError');
    } catch (err) {
      assert.true(isNotLoadedError(err), 'instance has NotLoaded error');
    }

    // success is not throwing
    identityContext.sweep(api);
  });
});
