import type { RenderingTestContext } from '@ember/test-helpers';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type SessionService from '@cardstack/host/services/session';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

// Bug 2 (CS-12207 family): logout stays in-app (a router transition, not a page
// reload), so `resetState()` cancels the AI panel's `loadRoomsTask` and clears
// `currentRoomId`, but nothing re-arms the task on re-login. Arming used to live
// only in the service constructor and the `openPanel()` click — one-shot sites
// the re-login path never revisits — so the panel showed a perpetual loading
// indicator. The fix routes re-arming through the session lifecycle:
// MatrixService.start() broadcasts `notifySessionStarted()`, the panel's
// `sessionStarted()` re-runs `ensureRoomsLoaded()`, and the panel re-enters a
// room. This test locks that in.
module(
  'Integration | ai-assistant-panel | re-login after logout',
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

    test('panel re-enters a room after logout → re-login instead of spinning forever', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let panelService = getService(
        'ai-assistant-panel-service',
      ) as AiAssistantPanelService;
      let operatorModeStateService = getService(
        'operator-mode-state-service',
      ) as OperatorModeStateService;
      let session = getService('session') as SessionService;
      await matrixService.ready;

      // Open the assistant and enter a room the way a first login would.
      // openAiAssistant() persists open=true, so the panel stays open across
      // the logout reset (operator-mode-state resetState re-reads that key).
      operatorModeStateService.openAiAssistant();
      await panelService.openPanel();
      await waitUntil(() => matrixService.currentRoomId, { timeout: 5000 });
      assert.ok(
        matrixService.currentRoomId,
        'a room is entered on initial login',
      );

      // Drive the in-app logout reset directly (mirrors logout()'s
      // `notifySessionEnded()` broadcast + its `finally { resetState() }`)
      // without the network logout / router transition.
      matrixService.resetState();
      session.notifySessionEnded();
      await settled();
      assert.notOk(
        matrixService.currentRoomId,
        'logout clears the current room',
      );
      assert.true(panelService.isOpen, 'the panel is still open after logout');

      // Re-login. start() converges on notifySessionStarted(), which re-arms
      // the panel via sessionStarted() → ensureRoomsLoaded().
      await matrixService.start();
      await settled();
      await waitUntil(() => matrixService.currentRoomId, { timeout: 5000 });

      assert.ok(
        matrixService.currentRoomId,
        'the panel re-enters a room after re-login',
      );
      assert.false(
        panelService.loadingRooms,
        'the panel is not stuck loading after re-login',
      );
    });
  },
);
