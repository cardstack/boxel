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

// `MatrixService` is a singleton whose client-ready barrier
// (`#clientReadyDeferred`) is only fulfilled once, at boot, inside `loadSDK()`.
// Logout stays in-app (a router transition, not a page reload) and its
// `finally` runs `resetState()`, so the barrier must survive that reset: if it
// were replaced with a fresh, never-fulfilled deferred, the next login's
// `createRealmSession()` would await it forever and the auth page would never
// progress. This test locks down the invariant that `createRealmSession()`
// still resolves after a `resetState()`.
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

      // `logout()` runs `resetState()` in its `finally`. Drive that reset
      // directly so the test doesn't depend on the full logout network
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
        'createRealmSession settles after resetState — the clientReadyDeferred barrier survives the reset rather than being left pending',
      );
    });
  },
);
