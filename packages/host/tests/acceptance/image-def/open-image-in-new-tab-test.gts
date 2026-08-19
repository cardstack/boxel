import { visit, currentURL, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

// 1x1 transparent PNG, base64 decoded.
function makeRenderablePng(): Uint8Array {
  let base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=';
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

module(
  'Acceptance | image def | opening an image URL in a new tab',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupRealmCacheTeardown(hooks);
    setupTestRealmServiceWorker(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function () {
      setupUserSubscription();
      setupAuthEndpoints();
      await withCachedRealmSetup(async () =>
        setupAcceptanceTestRealm({
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            'open-in-tab.png': makeRenderablePng(),
          },
        }),
      );
    });

    test('cold-loading a binary image URL hydrates the stack as a FileDef item', async function (assert) {
      await visit('/test/open-in-tab.png');

      let imageUrl = `${testRealmURL}open-in-tab.png`;

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [[{ id: imageUrl, format: 'isolated', type: 'file' }]],
        submode: Submodes.Interact,
      });

      await waitFor(`img[src="${imageUrl}"]`);
      assert
        .dom(`img[src="${imageUrl}"]`)
        .exists(
          'the ImageDef isolated template renders the image at its realm URL',
        );
    });
  },
);
