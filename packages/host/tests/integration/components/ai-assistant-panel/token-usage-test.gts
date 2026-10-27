import { waitFor, waitUntil, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

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
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | token usage', function (hooks) {
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

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

  let { simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.operatorModeController.showTokens = true;

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Test Workspace' }),
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

  test('usage arriving on an edit after the finishing one still reaches the message', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // The finishing edit has already gone out without usage; the counts
    // trail on a second edit of the same, already-finished message.
    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Here is your answer.',
      msgtype: 'm.text',
      isStreamingFinished: true,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert
      .dom('[data-test-message-idx="0"] [data-test-token-usage]')
      .doesNotExist();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Here is your answer.',
      msgtype: 'm.text',
      isStreamingFinished: true,
      data: {
        usage: { promptTokens: 1200, completionTokens: 340 },
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });

    await waitFor('[data-test-message-idx="0"] [data-test-token-usage]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-token-usage]')
      .containsText('1,200 in');
    assert
      .dom('[data-test-message-idx="0"] [data-test-token-usage]')
      .containsText('340 out');
  });

  test("the session's total is in the latest answer's footer, not a line of its own", async function (assert) {
    let roomId = await renderAiAssistantPanel();

    for (let [question, answer, costUsd] of [
      ['First question', 'First answer.', 0.012],
      ['Second question', 'Second answer.', 0.0304],
    ] as const) {
      simulateRemoteMessage(roomId, '@testuser:localhost', {
        body: question,
        msgtype: 'm.text',
      });
      simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: answer,
        msgtype: 'm.text',
        isStreamingFinished: true,
        data: {
          usage: { promptTokens: 1000, completionTokens: 100, costUsd },
        },
      });
    }

    await waitUntil(
      () =>
        document
          .querySelector(
            '[data-test-message-idx="3"] [data-test-answer-footer]',
          )
          ?.textContent?.includes('this session') ?? false,
    );
    assert
      .dom('[data-test-message-idx="3"] [data-test-answer-footer]')
      .containsText('42 credits this session');
    assert.dom('[data-test-conversation-token-usage]').doesNotExist();
  });
});
