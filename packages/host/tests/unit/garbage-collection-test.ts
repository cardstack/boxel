import { registerDestructor } from '@ember/destroyable';
import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  localId,
  type Loader,
  type CardErrorJSONAPI as CardError,
} from '@cardstack/runtime-common';

import CardStore, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-card-store';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { CardDef as CardInstance } from 'https://cardstack.com/base/card-api';

import { saveCard, testRealmURL } from '../helpers';
import {
  CardDef,
  FileDef,
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
    delete (globalThis as any).__boxelRenderContext;
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
    let network = getService('network');
    let store = new CardStore(
      referenceCount,
      network.fetch,
      network.virtualNetwork,
    );

    store.setCard(jade[localId], jade);
    store.setCard(germaine[localId], germaine);
    store.setCard(queenzy[localId], queenzy);
    store.setCard(boris[localId], boris);
    store.setCard(hassan[localId], hassan);

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
    assert.strictEqual(store.getCard(jade.id), jade, 'store contains "jade"');
    assert.strictEqual(
      store.getCard(queenzy.id),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.getCard(germaine.id),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(
      store.getCard(boris.id),
      boris,
      'store contains "boris"',
    );
    assert.strictEqual(
      store.getCard(hassan.id),
      hassan,
      'store contains "hassan"',
    );
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
    assert.strictEqual(
      store.getCard(jade[localId]),
      jade,
      'store contains "jade"',
    );
    assert.strictEqual(
      store.getCard(queenzy[localId]),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.getCard(germaine[localId]),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(
      store.getCard(boris[localId]),
      boris,
      'store contains "boris"',
    );
    assert.strictEqual(
      store.getCard(hassan[localId]),
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
    assert.strictEqual(store.getCard(jade.id), jade, 'store contains "jade"');
    assert.strictEqual(
      store.getCard(queenzy.id),
      queenzy,
      'store contains "queenzy"',
    );
    assert.strictEqual(
      store.getCard(germaine.id),
      germaine,
      'store contains "germaine"',
    );
    assert.strictEqual(
      store.getCard(hassan.id),
      hassan,
      'store contains "hassan"',
    );
    assert.strictEqual(
      store.getCard(boris.id),
      undefined,
      'store does not contain "boris"',
    );
  });

  test('instances removed by GC have destructors run', async function (assert) {
    let {
      store,
      instances: { boris },
    } = await setupTest(saveAll);

    registerDestructor(boris, () => {
      assert.step('boris destructor called');
    });
    store.sweep(api);
    store.sweep(api);
    await settled();

    assert.verifySteps(
      ['boris destructor called'],
      'destructor was called exactly once',
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
    assert.strictEqual(
      store.getCard(boris.id),
      boris,
      'store contains "boris"',
    );
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
      store.getCard(boris[localId]),
      boris,
      'store contains "boris"',
    );
  });

  test('FileDef dependencies keep file-meta instances reachable via card references', async function (assert) {
    class FilePerson extends CardDef {
      @field attachment = linksTo(FileDef);
    }

    let referenceCount: ReferenceCount = new Map();
    let network = getService('network');
    let store = new CardStore(
      referenceCount,
      network.fetch,
      network.virtualNetwork,
    );

    let fileUrl = `${testRealmURL}hero.png`;
    let fileDef = new FileDef({
      id: fileUrl,
      sourceUrl: fileUrl,
      url: fileUrl,
      name: 'hero.png',
      contentType: 'image/png',
    });
    let person = new FilePerson({ attachment: fileDef });

    store.setFileMeta(fileUrl, fileDef);
    store.setCard(person[localId], person);

    referenceCount.set(person[localId], 1);

    store.sweep(api);
    store.sweep(api);

    assert.strictEqual(
      store.getFileMeta(fileUrl),
      fileDef,
      'file meta instance is retained when referenced via a card dependency',
    );
    assert.deepEqual(
      store.gcCandidates,
      [],
      'no GC candidates remain when file meta is reachable',
    );
  });

  test('a `.json` FileDef does not collide with the same-named card id (CS-11622)', async function (assert) {
    let referenceCount: ReferenceCount = new Map();
    let network = getService('network');
    let store = new CardStore(
      referenceCount,
      network.fetch,
      network.virtualNetwork,
    );

    // The realm config has two identities that differ only by extension: the
    // card `…/realm` and the file `…/realm.json`. File-meta keyed without its
    // extension would collapse onto the card id, so peeking the card id as
    // file-meta would wrongly find the FileDef and the card would open as a
    // `.json` file instead of a card.
    class RealmConfig extends CardDef {}
    let cardId = `${testRealmURL}realm`;
    let fileUrl = `${cardId}.json`;
    let realmConfig = new RealmConfig();
    store.setCard(cardId, realmConfig);

    let fileDef = new FileDef({
      id: fileUrl,
      sourceUrl: fileUrl,
      url: fileUrl,
      name: 'realm.json',
      contentType: 'application/json',
    });
    store.setFileMeta(fileUrl, fileDef);

    assert.strictEqual(
      store.getFileMeta(fileUrl),
      fileDef,
      'the FileDef is found by its full `.json` URL',
    );
    assert.strictEqual(
      store.getFileMeta(cardId),
      undefined,
      'the card id does not resolve to the colliding FileDef',
    );
    assert.strictEqual(
      store.getCard(cardId),
      realmConfig,
      'the card is still found by its (extension-less) card id',
    );

    // Deleting the file by its `.json` URL removes only the file-meta row; the
    // same-named card must survive. The GC sweep deletes resident file-meta
    // this way (`this.delete(fileDef.id)`), so a `.json` delete must never
    // evict a live card.
    store.delete(fileUrl);
    assert.strictEqual(
      store.getFileMeta(fileUrl),
      undefined,
      'the FileDef is removed when deleted by its `.json` URL',
    );
    assert.strictEqual(
      store.getCard(cardId),
      realmConfig,
      'deleting the `.json` file leaves the same-named card in place',
    );

    // The inverse separation must hold too: deleting the card removes only the
    // card and leaves the same-named FileDef untouched.
    store.setFileMeta(fileUrl, fileDef);
    store.delete(cardId);
    assert.strictEqual(
      store.getCard(cardId),
      undefined,
      'the card is removed when deleted by its (extension-less) id',
    );
    assert.strictEqual(
      store.getFileMeta(fileUrl),
      fileDef,
      'deleting the card leaves the same-named FileDef in place',
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

    store.getCard(boris.id);

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

    store.setCard(boris.id, boris);
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

    store.getCard(boris[localId]);

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

    store.setCard(boris[localId], boris);
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

    store.addCardInstanceOrError(boris.id, makeError(boris.id));

    assert.deepEqual(store.gcCandidates, [], 'the GC candidates are correct');
  });

  test('can delete an instance from the identity map', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    store.delete(hassan.id);

    assert.deepEqual(
      store.getCard(hassan.id),
      undefined,
      'the instance does not exist',
    );
    assert.deepEqual(
      store.getCard(hassan[localId]),
      undefined,
      'the instance does not exist via local id',
    );

    assert.deepEqual(
      store.getCardInstanceOrError(hassan.id),
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
      store.getCard(hassan[localId]),
      undefined,
      'the instance does not exist',
    );

    assert.deepEqual(
      store.getCard(hassan.id),
      undefined,
      'the instance does not exist via remote id',
    );

    assert.deepEqual(
      store.getCardInstanceOrError(hassan[localId]),
      undefined,
      'the instance does not exist',
    );
  });

  test('can delete a card error from the identity map', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    store.addCardInstanceOrError(hassan.id, makeError(hassan.id));
    store.delete(hassan.id);

    assert.deepEqual(
      store.getCardInstanceOrError(hassan.id),
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

  test('garbage collects instances that only consume each other', async function (assert) {
    let {
      referenceCount,
      store,
      instances: { hassan },
    } = await setupTest();

    referenceCount.clear();
    store.reset();

    let Person = hassan.constructor as typeof CardInstance;
    let alpha = new Person({ name: 'Alpha' });
    let beta = new Person({ name: 'Beta' });
    (alpha as any).bestFriend = beta;
    (beta as any).bestFriend = alpha;

    store.setCard(alpha[localId], alpha);
    store.setCard(beta[localId], beta);

    store.sweep(api);

    assert.deepEqual(
      [...store.gcCandidates].sort(),
      [alpha[localId], beta[localId]].sort(),
      'cyclic instances become GC candidates after initial sweep',
    );

    store.sweep(api);

    assert.strictEqual(
      store.getCard(alpha[localId]),
      undefined,
      'alpha instance is collected',
    );
    assert.strictEqual(
      store.getCard(beta[localId]),
      undefined,
      'beta instance is collected',
    );
    assert.deepEqual(
      store.gcCandidates,
      [],
      'no GC candidates remain after collecting the cycle',
    );
  });

  test('resetting the identity map clears instances and errors', async function (assert) {
    let {
      store,
      instances: { hassan, jade },
    } = await setupTest(saveAll);

    store.addCardInstanceOrError(hassan.id, makeError(hassan.id));
    store.reset();

    assert.strictEqual(
      store.getCardInstanceOrError(hassan.id),
      undefined,
      'card errors are cleared alongside instances',
    );

    assert.deepEqual(
      store.getCardInstanceOrError(jade.id),
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
    store.addCardInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.getCard(hassan.id),
      undefined,
      'no card instance exists for the id',
    );
    assert.strictEqual(
      store.getCardInstanceOrError(hassan.id),
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
      store.getCardInstanceOrError(hassan.id),
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
      store.getCardInstanceOrError(hassan[localId]),
      hassan,
      'card instance is returned',
    );
  });

  test('can get a card from the identity map by correlating the last part of the remote id with the local id, without reconciling the instance id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest();

    let idBefore = hassan.id;

    assert.strictEqual(
      store.getCardInstanceOrError(`${testRealmURL}${hassan[localId]}`),
      hassan,
      'card instance is returned by correlating the remote id tail to the local id',
    );

    // The lookup is a pure read: it must NOT write the instance's tracked `id`.
    // Identity reconciliation (local id -> remote id) happens when the store
    // learns the remote id out of band (the realm invalidation event /
    // save-deserialize flow), not as a side effect of a bare lookup — which can
    // run during render, where mutating the tracked id trips a backtracking
    // re-render assertion.
    assert.strictEqual(
      hassan.id,
      idBefore,
      'the bare lookup leaves the instance id unchanged',
    );
  });

  test('return a stale instance when the server state reflects an error for an id', async function (assert) {
    let {
      store,
      instances: { hassan },
    } = await setupTest(saveAll);

    let error = makeError(hassan.id);
    store.addCardInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.getCard(hassan.id),
      hassan,
      'stale hassan instance is returned',
    );

    assert.strictEqual(
      store.getCardInstanceOrError(hassan.id),
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
    store.addCardInstanceOrError(hassan.id, error);

    assert.strictEqual(
      store.getCardError(hassan.id),
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
    store.addCardInstanceOrError(hassan.id, error);
    assert.strictEqual(
      store.getCardError(hassan.id),
      error,
      'a card error exists for the id',
    );

    store.addCardInstanceOrError(hassan.id, hassan);
    assert.strictEqual(
      store.getCardError(hassan.id),
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
