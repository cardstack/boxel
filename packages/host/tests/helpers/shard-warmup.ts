// Synthetic warmup module — registered first on every shard so that the
// per-shard "boot cost" (Ember app boot, base-realm imports, mock matrix,
// initial test realm setup, and the operator-mode surfaces nearly every
// acceptance module reaches: a card rendered on the interact stack and a
// file open in code submode) lands on this module rather than on whichever
// real test file ember-exam happens to schedule first. The MEMPROBE_FILE
// line for this module then becomes the "shard boot cost" baseline, and
// real modules report a clean per-file delta independent of position.
//
// The memory-baseline gate depends on that independence: a cost the warmup
// leaves unpaid lands on the first acceptance module of each shard, and a
// shard re-split that moves a module into that slot reads as a regression.
//
// Exposed as registerShardWarmup() so test-helper.js can invoke it only
// inside ember-exam partitioned runs — the only context where a per-shard
// warmup makes sense. In live-test mode (software-factory factory-test-realm)
// the warmup module's mock-matrix / acceptance-test-realm setup conflicts
// with the real running realm server, so it must not register there.

import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupMockMatrix } from './mock-matrix';
import { setupApplicationTest } from './setup';
import visitOperatorMode from './visit-operator-mode';

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

    test('warm the interact stack and code submode', async function (assert) {
      let cardId = `${testRealmURL}ModelConfiguration/test-gpt`;

      await visitOperatorMode({
        stacks: [[{ id: cardId, format: 'isolated' }]],
      });
      await waitFor(`[data-test-stack-card="${cardId}"]`);

      await visitOperatorMode({
        submode: 'code',
        codePath: `${cardId}.json`,
      });
      await waitFor('[data-test-editor]');
      await waitFor('[data-test-code-mode-card-renderer-body]');

      assert.ok(true, 'operator mode warmup completed');
    });
  });
}
