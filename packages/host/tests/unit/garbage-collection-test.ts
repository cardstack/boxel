import { type RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import IdentityContext, {
  type Subscriber,
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
  let localId: (typeof CardAPI)['localId'];

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = lookupLoaderService().loader;
    api = await loader.import(`${baseRealm.url}card-api`);
    localId = api.localId;
  });

  async function saveAll({
    localIds,
    jade,
    queenzy,
    germaine,
    boris,
    hassan,
  }: {
    localIds: Map<string, string | null>;
    jade: CardInstance;
    queenzy: CardInstance;
    germaine: CardInstance;
    boris: CardInstance;
    hassan: CardInstance;
  }) {
    await saveCard(jade, `${testRealmURL}jade`, loader);
    localIds.set(jade[localId], jade.id);
    await saveCard(queenzy, `${testRealmURL}queenzy`, loader);
    localIds.set(queenzy[localId], queenzy.id);
    await saveCard(germaine, `${testRealmURL}germaine`, loader);
    localIds.set(germaine[localId], germaine.id);
    await saveCard(boris, `${testRealmURL}boris`, loader);
    localIds.set(boris[localId], boris.id);
    await saveCard(hassan, `${testRealmURL}hassan`, loader);
    localIds.set(hassan[localId], hassan.id);
  }

  async function setupTest(
    doSave?: (args: {
      localIds: Map<string, string | null>;
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
    let localIds = new Map<string, string | null>([
      [jade[localId], null],
      [queenzy[localId], null],
      [germaine[localId], null],
      [boris[localId], null],
      [hassan[localId], null],
    ]);
    await doSave?.({
      localIds,
      jade,
      queenzy,
      germaine,
      boris,
      hassan,
    });

    let remoteIdSubscribers: Subscriber = new Map();
    let localIdSubscribers: Subscriber = new Map();
    let identityContext = new IdentityContext({
      api,
      localIds,
      remoteIdSubscribers,
      localIdSubscribers,
    });

    identityContext.set(jade.id, jade);
    identityContext.set(germaine.id, germaine);
    identityContext.set(queenzy.id, queenzy);
    identityContext.set(boris.id, boris);
    identityContext.set(hassan.id, hassan);

    return {
      localIds,
      remoteIdSubscribers,
      localIdSubscribers,
      identityContext,
      instances: { jade, queenzy, germaine, boris, hassan },
    };
  }

  test('can mark unsubscribed instances that have been saved for GC', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

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

  test('can mark unsaved instances without subscribers for GC', async function (assert) {
    let {
      localIdSubscribers,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

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
      remoteIdSubscribers,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();
    identityContext.sweep();

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

  test('a GC candidate is no longer considered a GC candidate if it is consumed by a subscriber', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { germaine, boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    germaine.friends = [boris];
    identityContext.sweep();

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

  test('a GC candidate is no longer considered a GC candidate if it is consumed by an unsaved subscriber', async function (assert) {
    let {
      localIdSubscribers,
      identityContext,
      instances: { germaine, boris, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

    germaine.friends = [boris];
    identityContext.sweep();

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

  test('an instance becomes a GC candidate when it loses all subscribers', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    remoteIdSubscribers.set(hassan.id, { resources: [] });

    identityContext.sweep(); // this sweep removed boris

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

  test('an instance becomes a GC candidate when it loses all unsaved subscribers', async function (assert) {
    let {
      localIdSubscribers,
      identityContext,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

    localIdSubscribers.set(hassan[localId], { resources: [] });

    identityContext.sweep(); // this sweep removed boris

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
      remoteIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    identityContext.get(boris.id);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after getting by remote id',
    );

    identityContext.sweep();

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
      localIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

    identityContext.get(boris[localId]);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct after getting by local id',
    );

    identityContext.sweep();

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

  test('a GC candidate remains a GC candidate if it is accessed via a set "null" in the identity map by remote id', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    identityContext.set(boris.id, null);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
  });

  test('a GC candidate remains a GC candidate if it is accessed via a set "null" in the identity map by local id', async function (assert) {
    let {
      localIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

    identityContext.set(boris[localId], null);

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris[localId]],
      'the GC candidates are correct',
    );
  });

  test('deleting an entry from the identity map by remote id removes the GC candidate', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    identityContext.delete(boris.id);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('deleting an entry from the identity map by local id removes the GC candidate', async function (assert) {
    let {
      localIdSubscribers,
      identityContext,
      instances: { boris, hassan },
    } = await setupTest();

    localIdSubscribers.set(hassan[localId], { resources: [true] });

    identityContext.sweep();

    identityContext.delete(boris[localId]);

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  test('resetting the identity map clears all GC candidates', async function (assert) {
    let {
      remoteIdSubscribers,
      identityContext,
      instances: { hassan },
    } = await setupTest(saveAll);

    remoteIdSubscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    identityContext.reset();

    assert.deepEqual(
      identityContext.gcCandidates,
      [],
      'the GC candidates are correct',
    );
  });

  // TODO add tests that use local ID's
});
