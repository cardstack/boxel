import { type RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  isCardInstance,
  baseRealm,
  type Loader,
  type Realm,
} from '@cardstack/runtime-common';

import IdentityContext from '@cardstack/host/lib/gc-identity-context';
import type StoreService from '@cardstack/host/services/store';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  lookupLoaderService,
  testRealmURL,
  setupLocalIndexing,
  setupOnSave,
  setupCardLogs,
  setupIntegrationTestRealm,
} from '../helpers';

import { TestRealmAdapter } from '../helpers/adapter';
import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  BooleanField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | Store', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let api: typeof CardAPI;
  let loader: Loader;
  let testRealm: Realm;
  let testRealmAdapter: TestRealmAdapter;
  let store: StoreService;
  let identityContext: IdentityContext;

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  function forceGC() {
    identityContext.sweep(api);
    identityContext.sweep(api);
  }

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Person extends CardDef {
      @field name = contains(StringField);
      @field hasError = contains(BooleanField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
      @field boom = contains(StringField, {
        computeVia: function (this: Person) {
          if (this.hasError) {
            throw new Error('intentional error thrown');
          }
          return 'boom';
        },
      });
    }

    loader = lookupLoaderService().loader;
    api = await loader.import(`${baseRealm.url}card-api`);
    store = this.owner.lookup('service:store') as StoreService;
    identityContext = (store as any).identityContext as IdentityContext;

    ({ adapter: testRealmAdapter, realm: testRealm } =
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/hassan.json': new Person({ name: 'Hassan' }),
          'Person/jade.json': new Person({ name: 'Jade' }),
          'Person/queenzy.json': new Person({ name: 'Queenzy' }),
          'Person/germaine.json': new Person({ name: 'Germaine' }),
          'Person/boris.json': new Person({ name: 'Boris' }),
        },
      }));

    // TODO cleanup
    testRealm;
    testRealmAdapter;
  });

  // TODO Test Store API:
  // save
  // create
  // add
  // add tries to add unknown instance
  // add of unsaved instance triggers instance auto updates from realm index events
  // peek
  // delete
  // patch
  // search
  // getSaveState
  // save
  // receive realm index event updates instance
  // receive realm index event with code changes updates instance and reloads the identity map (local ID's are different after reloading identity map)
  // receive realm index event can move a card into an error state
  // receive realm index event can move an error state into a valid card
  // auto save when instance data changes
  // capture error during auto save

  test('can add reference to a card url', async function (assert) {
    let instance = store.peek(`${testRealmURL}hassan`);
    assert.strictEqual(instance, undefined, 'instance is not in store yet');

    store.addReference(`${testRealmURL}Person/hassan`);

    await store.flush();
    instance = store.peek(`${testRealmURL}Person/hassan`);
    if (isCardInstance(instance)) {
      assert.strictEqual(
        (instance as any).name,
        'Hassan',
        'instance is cached in store',
      );
    } else {
      assert.ok(
        false,
        `expected instance to be a card:${JSON.stringify(instance, null, 2)}`,
      );
    }

    forceGC();

    instance = store.peek(`${testRealmURL}Person/hassan`);
    if (isCardInstance(instance)) {
      assert.strictEqual(
        (instance as any).name,
        'Hassan',
        'instance is cached in store after GC',
      );
    } else {
      assert.ok(
        false,
        `expected instance to be a card:${JSON.stringify(instance, null, 2)} after GC`,
      );
    }
  });

  test('can drop reference to a card url', async function (assert) {
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let instance = store.peek(`${testRealmURL}Person/hassan`);
    assert.ok(instance, 'instance is in store');
    store.dropReference(`${testRealmURL}Person/hassan`);

    forceGC();

    assert.strictEqual(
      store.peek(`${testRealmURL}Person/hassan`),
      undefined,
      'instance has been garbage collected from the store',
    );
  });
});
