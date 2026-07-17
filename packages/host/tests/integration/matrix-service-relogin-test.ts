import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { rawTimeout } from 'ember-concurrency';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

// CS-12207: `MatrixService` is a singleton whose client-ready barrier
// (`#clientReadyDeferred`) is only fulfilled once, at boot, inside `loadSDK()`.
// Logout stays in-app (a router transition, not a page reload) and its
// `finally` runs `resetState()`, which recreates the client synchronously but
// then replaces `#clientReadyDeferred` with a fresh, never-fulfilled deferred.
// The next login awaits that deferred in `createRealmSession()`, so it hangs
// forever and the auth page never progresses. This test locks down the
// invariant that `createRealmSession()` still resolves after a `resetState()`.
module(
  'Integration | matrix-service | re-login after logout',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    setupBaseRealm(hooks);

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      });
    });

    test('createRealmSession resolves after resetState (logout) instead of hanging', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;

      // `logout()` recreates the client and installs a fresh
      // `#clientReadyDeferred` via `resetState()` in its `finally`. Drive that
      // reset directly so the test doesn't depend on the full logout network
      // roundtrip / router transition.
      matrixService.resetState();

      const TIMEOUT = Symbol('timeout');
      let result = await Promise.race([
        matrixService.createRealmSession(new URL(testRealmURL)),
        rawTimeout(2000).then(() => TIMEOUT),
      ]);

      assert.notStrictEqual(
        result,
        TIMEOUT,
        'createRealmSession settles after resetState — the re-created clientReadyDeferred is fulfilled rather than left pending',
      );
    });
  },
);
