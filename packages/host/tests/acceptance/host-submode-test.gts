import { click, waitFor, find, findAll, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  baseRealm,
  skillCardRef,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | host submode', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  setupBaseRealm(hooks);

  module('with a realm that is not publishable', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'index.json': new CardsGrid(),
          '.realm.json': {
            name: 'Test Workspace B',
            backgroundURL:
              'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
            iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
          },
        },
      });
    });

    test('host submode is not available', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}index.json`,
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').doesNotExist();
    });
  });

  module('with a realm that is publishable', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'index.json': new CardsGrid(),
          '.realm.json': {
            name: 'Test Workspace B',
            backgroundURL:
              'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
            iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
            publishable: true,
          },
        },
      });
    });

    test('host submode is available', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}index.json`,
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').exists();
    });
  });
});
