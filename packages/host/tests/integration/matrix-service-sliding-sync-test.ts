import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  SLIDING_SYNC_AI_ROOM_LIST_NAME,
  SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT,
} from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

import type { MockSlidingSync } from '../helpers/mock-matrix/_sliding-sync';

module(
  'Integration | matrix-service | sliding-sync timeline_limit bump',
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

    test('raises AI-room list timeline_limit via setList after the first SlidingSyncState.Complete fires', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let slidingSync = (matrixService as unknown as { slidingSync?: unknown })
        .slidingSync as MockSlidingSync | undefined;

      assert.ok(slidingSync, 'matrix-service has a slidingSync instance');

      let aiListCalls = slidingSync!.setListCalls.filter(
        (c) => c.listKey === SLIDING_SYNC_AI_ROOM_LIST_NAME,
      );
      assert.strictEqual(
        aiListCalls.length,
        1,
        'setList is called exactly once for the AI-room list',
      );
      assert.strictEqual(
        aiListCalls[0]?.list.timeline_limit,
        SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT,
        'AI-room list is bumped to the steady-state timeline_limit',
      );
      assert.deepEqual(
        aiListCalls[0]?.list.filters,
        { is_dm: false },
        'AI-room list filters preserved across the bump',
      );
    });
  },
);
