import { click, waitFor, waitUntil, settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../../helpers';
import { setupBaseRealm } from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module(
  'Integration | ai-assistant-panel | to-device streaming previews',
  function (hooks) {
    const realmName = 'Operator Mode Workspace';
    let loader: Loader;
    let matrixService: MatrixService;
    let operatorModeStateService: OperatorModeStateService;

    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    setupBaseRealm(hooks);

    hooks.beforeEach(function () {
      loader = getService('loader-service').loader;
    });

    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupRealmCacheTeardown(hooks);
    setupCardLogs(
      hooks,
      async () => await loader.import('@cardstack/base/card-api'),
    );

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    let { simulateRemoteMessage, simulateToDeviceEvent } = mockMatrixUtils;

    let noop = () => {};

    hooks.beforeEach(async function () {
      operatorModeStateService = getService('operator-mode-state-service');
      matrixService = getService('matrix-service');

      await withCachedRealmSetup(async () => {
        await setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'realm.json': realmConfigCardJSON({ name: realmName }),
          },
        });
      });
    });

    async function renderAiAssistantPanel() {
      operatorModeStateService.restore({ stacks: [[]] });
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor('[data-test-open-ai-assistant]');
      await click('[data-test-open-ai-assistant]');
      await waitFor('[data-test-room-settled]');
      let roomId = document
        .querySelector('[data-test-room]')
        ?.getAttribute('data-test-room');
      if (!roomId) {
        throw new Error('Expected a room ID');
      }
      return roomId;
    }

    // Sends the "thinking" placeholder ai-bot lands before it streams. In
    // to-device mode this is the only room event until the final consolidated
    // edit; the in-flight state arrives as to-device previews keyed by this
    // event id.
    function sendPlaceholder(roomId: string) {
      return simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: false,
        data: { context: { agentId: matrixService.agentId } },
      });
    }

    function preview(
      roomId: string,
      parentEventId: string,
      sequence: number,
      body: string,
      reasoning = '',
    ) {
      simulateToDeviceEvent(APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE, {
        roomId,
        parentEventId,
        sequence,
        body,
        reasoning,
        toolRequests: [],
      });
    }

    test('a preview hydrates body and reasoning into the streaming message', async function (assert) {
      let roomId = await renderAiAssistantPanel();
      let eventId = sendPlaceholder(roomId);
      await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);

      preview(
        roomId,
        eventId,
        0,
        'You should get a poodle.',
        'They mentioned they like small dogs.',
      );

      await waitUntil(() =>
        document
          .querySelector('[data-test-message-idx="0"]')
          ?.textContent?.includes('You should get a poodle.'),
      );
      assert
        .dom('[data-test-message-idx="0"]')
        .containsText('You should get a poodle.');
      assert
        .dom('[data-test-message-idx="0"]')
        .containsText('They mentioned they like small dogs.');
    });

    test('previews accumulate full state and bump the message updated timestamp', async function (assert) {
      let roomId = await renderAiAssistantPanel();
      let eventId = sendPlaceholder(roomId);
      await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);

      let roomResource = matrixService.roomResources.get(roomId)!;
      let createdAt = roomResource.messages[0].created.getTime();

      preview(roomId, eventId, 0, 'You should');
      await settled();
      preview(roomId, eventId, 1, 'You should get a poodle.');
      await waitUntil(() =>
        document
          .querySelector('[data-test-message-idx="0"]')
          ?.textContent?.includes('You should get a poodle.'),
      );

      // updateMessage stamps a fresh `updated` on every applied preview, which
      // is exactly the value room-message.gts compares against to decide the
      // streaming stall timeout — so the timeout resets for free.
      assert.ok(
        roomResource.messages[0].updated.getTime() >= createdAt,
        'the message updated timestamp advances as previews arrive',
      );
    });

    test('an out-of-order or duplicate preview is dropped by sequence', async function (assert) {
      let roomId = await renderAiAssistantPanel();
      let eventId = sendPlaceholder(roomId);
      await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);

      preview(roomId, eventId, 5, 'The latest accumulated text.');
      await waitUntil(() =>
        document
          .querySelector('[data-test-message-idx="0"]')
          ?.textContent?.includes('The latest accumulated text.'),
      );

      // A lower sequence arriving late must not regress the message to older
      // content.
      preview(roomId, eventId, 3, 'Stale earlier text.');
      await settled();

      assert
        .dom('[data-test-message-idx="0"]')
        .containsText('The latest accumulated text.');
      assert
        .dom('[data-test-message-idx="0"]')
        .doesNotContainText('Stale earlier text.');
    });

    test('a preview for an unknown parent event or another room is a no-op', async function (assert) {
      let roomId = await renderAiAssistantPanel();
      let eventId = sendPlaceholder(roomId);
      await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);

      // Unknown parent event id — placeholder never loaded / already finalized.
      preview(roomId, '$does-not-exist', 0, 'Orphan preview.');
      // Correct parent, wrong room — must not leak across rooms.
      preview('!some-other-room:localhost', eventId, 0, 'Wrong room preview.');
      await settled();

      assert
        .dom('[data-test-message-idx="0"]')
        .doesNotContainText('Orphan preview.');
      assert
        .dom('[data-test-message-idx="0"]')
        .doesNotContainText('Wrong room preview.');

      // The room still works: a valid preview for the real message applies.
      preview(roomId, eventId, 1, 'A valid preview lands.');
      await waitUntil(() =>
        document
          .querySelector('[data-test-message-idx="0"]')
          ?.textContent?.includes('A valid preview lands.'),
      );
      assert
        .dom('[data-test-message-idx="0"]')
        .containsText('A valid preview lands.');
    });
  },
);
