// Synthetic warmup module — registered first on every shard so that the
// per-shard "boot cost" (Ember app boot, base-realm imports, mock matrix,
// initial test realm setup) lands on this module rather than on whichever
// real test file ember-exam happens to schedule first. The MEMPROBE_FILE
// line for this module then becomes the "shard boot cost" baseline, and
// real modules report a clean per-file delta independent of position.
//
// Exposed as registerShardWarmup() so test-helper.js can invoke it only
// inside ember-exam partitioned runs — the only context where a per-shard
// warmup makes sense. In live-test mode (software-factory factory-test-realm)
// the warmup module's mock-matrix / acceptance-test-realm setup conflicts
// with the real running realm server, so it must not register there.

import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupMockMatrix } from './mock-matrix';
import { setupApplicationTest } from './setup';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupUserSubscription,
  testRealmURL,
} from './index';

export function registerShardWarmup() {
  module('__shard_warmup__', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    let { createAndJoinRoom } = mockMatrixUtils;

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-warmup',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      let loaderService = getService('loader-service');
      let loader = loaderService.loader;
      // Prime the loader with the most commonly imported base-realm modules
      // so subsequent real tests don't pay the import cost.
      await loader.import('@cardstack/base/card-api');
      await loader.import('@cardstack/base/string');
      await loader.import('@cardstack/base/spec');

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: { ...SYSTEM_CARD_FIXTURE_CONTENTS },
      });
    });

    test('warm boot the test environment', async function (assert) {
      await visit('/');
      assert.ok(true, 'shard warmup completed');
    });
  });
}
