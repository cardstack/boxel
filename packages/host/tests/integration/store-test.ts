import { type RenderingTestContext } from '@ember/test-helpers';

import { module, test as _test } from 'qunit';

import { baseRealm, type Loader, type Realm } from '@cardstack/runtime-common';

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

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = lookupLoaderService().loader;
    api = await loader.import(`${baseRealm.url}card-api`);
    store = this.owner.lookup('service:store') as StoreService;

    class Person extends CardDef {
      @field name = contains(StringField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
    }

    ({ adapter: testRealmAdapter, realm: testRealm } =
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
        },
      }));

    // TODO cleanup
    api;
    testRealm;
    testRealmAdapter;
    store;
  });

  // TODO Test Store API:
  // createSubscriber
  // unloadResource
  // create
  // add
  // save
  // peek
  // delete
  // patch
  // search
  // getSaveState
});
