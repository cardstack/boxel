import { type RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import IdentityContext from '@cardstack/host/lib/gc-identity-context';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

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

  async function setupTest() {
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
    await saveCard(jade, `${testRealmURL}jade`, loader);
    await saveCard(queenzy, `${testRealmURL}queenzy`, loader);
    await saveCard(germaine, `${testRealmURL}germaine`, loader);
    await saveCard(boris, `${testRealmURL}boris`, loader);
    await saveCard(hassan, `${testRealmURL}hassan`, loader);

    let subscribers = new Map<string, { resources: unknown[] }>();
    let identityContext = new IdentityContext(api, subscribers);

    identityContext.set(jade.id, jade);
    identityContext.set(germaine.id, germaine);
    identityContext.set(queenzy.id, queenzy);
    identityContext.set(boris.id, boris);
    identityContext.set(hassan.id, hassan);

    return {
      subscribers,
      identityContext,
      instances: { jade, queenzy, germaine, boris, hassan },
    };
  }

  test('can mark unsubscribed instances for GC', async function (assert) {
    let {
      subscribers,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest();

    subscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris.id],
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

  test('can remove unsubscribed instances for GC after being marked in 2 consecutive sweeps', async function (assert) {
    let {
      subscribers,
      identityContext,
      instances: { jade, germaine, queenzy, boris, hassan },
    } = await setupTest();

    subscribers.set(hassan.id, { resources: [true] });

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
      subscribers,
      identityContext,
      instances: { germaine, boris, hassan },
    } = await setupTest();

    subscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    assert.deepEqual(
      identityContext.gcCandidates,
      [boris.id],
      'the GC candidates are correct',
    );

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

  test('an instance becomes a GC candidate when it loses all subscribers', async function (assert) {
    let {
      subscribers,
      identityContext,
      instances: { jade, germaine, queenzy, hassan },
    } = await setupTest();

    subscribers.set(hassan.id, { resources: [true] });

    identityContext.sweep();

    subscribers.set(hassan.id, { resources: [] });

    identityContext.sweep(); // this sweep removed boris

    assert.deepEqual(
      identityContext.gcCandidates,
      [jade.id, germaine.id, queenzy.id, hassan.id],
      'the GC candidates are correct',
    );
  });
});
