import { waitFor, click, settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

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

module('Integration | ai-assistant-panel | turn settling', function (hooks) {
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

  // A question, then a reply with one call whose result has landed. The
  // question and reply carry `serverNow` as their homeserver time (the
  // browser's time when unset), and the result `resultAt`.
  function simulateAnsweredCall(
    roomId: string,
    resultAt?: number,
    serverNow?: number,
  ) {
    let at = serverNow ? { origin_server_ts: serverNow } : undefined;
    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      {
        body: 'Make me a card',
        msgtype: 'm.text',
      },
      at,
    );
    let replyId = simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'Writing the card.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: 'write-call',
            name: 'patchCardInstance',
            arguments: JSON.stringify({
              attributes: {
                cardId: `${testRealmURL}Card/1`,
                patch: { attributes: { title: 'Card' } },
              },
            }),
          },
        ],
      },
      at,
    );
    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId: 'write-call',
        'm.relates_to': {
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
          key: 'applied',
          event_id: replyId,
        },
        data: {},
      },
      { type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE, origin_server_ts: resultAt },
    );
  }

  test('a turn whose calls have their results waits for the reply the bot owes them', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateAnsweredCall(roomId);
    await waitFor(
      '[data-test-message-idx="1"] [data-test-tool-call-apply="applied"]',
    );
    await settled();
    assert
      .dom('[data-test-answer-footer]')
      .doesNotExist('the turn has not ended: no footer flashes under it');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Your card is ready.',
      msgtype: 'm.text',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="2"] [data-test-answer-footer]');
    assert
      .dom('[data-test-answer-footer]')
      .exists({ count: 1 }, 'the footer is under the reply that ends it');
  });

  test('a turn whose result is already past the wait settles at once', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateAnsweredCall(roomId, Date.now() - 60_000);
    await waitFor('[data-test-message-idx="1"] [data-test-answer-footer]');
    assert
      .dom('[data-test-message-idx="1"] [data-test-answer-footer]')
      .exists();
  });

  test('a turn whose reply never comes settles when its wait runs out', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // the result is 29.7 s older than the room's newest event: 0.3 s is left
    simulateAnsweredCall(roomId, Date.now() - 29_700);
    await waitFor(
      '[data-test-message-idx="1"] [data-test-tool-call-apply="applied"]',
    );
    assert
      .dom('[data-test-answer-footer]')
      .doesNotExist('the turn waits for the rest of its wait');
    await waitFor('[data-test-message-idx="1"] [data-test-answer-footer]', {
      timeout: 3000,
    });
    assert
      .dom('[data-test-message-idx="1"] [data-test-answer-footer]')
      .exists('the timer settles the turn');
  });

  test("a browser clock ahead of the homeserver's does not cut the wait short", async function (assert) {
    let roomId = await renderAiAssistantPanel();

    // every event is 40 s behind the browser's clock: the result is fresh
    let serverNow = Date.now() - 40_000;
    simulateAnsweredCall(roomId, serverNow, serverNow);
    await waitFor(
      '[data-test-message-idx="1"] [data-test-tool-call-apply="applied"]',
    );
    await settled();
    assert
      .dom('[data-test-answer-footer]')
      .doesNotExist('the fresh result still holds the turn');
  });
});
