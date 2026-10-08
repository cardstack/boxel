import { waitFor, click, settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
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
import { setupBaseRealm } from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | compaction', function (hooks) {
  const realmName = 'Compaction Test Realm';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      let clock = new Date(2024, 8, 20).getTime();
      return () => (clock += 10);
    })(),
  });

  let { simulateRemoteMessage } = mockMatrixUtils;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'realm.json': realmConfigCardJSON({ name: realmName }),
        },
      }),
    );
  });

  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  async function openAiAssistant(): Promise<string> {
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

  async function renderAiAssistantPanel() {
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        noop = () => {};
        <template><OperatorMode @onClose={{this.noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('it shows a compaction on the answer it delays', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let responseEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert
      .dom('[data-test-message-idx="0"] [data-test-compaction-status]')
      .doesNotExist('no compaction before ai-bot starts one');

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      { status: 'running', responseEventId } as any,
      { type: APP_BOXEL_COMPACTION_EVENT_TYPE },
    );
    await waitFor('[data-test-compaction-status="running"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-compaction-status]')
      .containsText('Summarizing earlier conversation');
    assert
      .dom('[data-test-compaction-status] [data-test-apply-state="applying"]')
      .exists('a spinner shows while ai-bot summarizes');
    assert
      .dom('[data-test-compaction-status] [data-test-view-code-button]')
      .doesNotExist('there is no summary to show yet');

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        status: 'done',
        responseEventId,
        upToEventId: 'some-event',
        summary: 'Objective: build a wedding planner.',
        summaryVersion: 1,
      } as any,
      { type: APP_BOXEL_COMPACTION_EVENT_TYPE },
    );
    await waitFor('[data-test-compaction-status="done"]');
    assert
      .dom('[data-test-compaction-status]')
      .containsText('Summarized earlier conversation');
    assert
      .dom('[data-test-compaction-status] [data-test-apply-state="applied"]')
      .exists();
    assert.dom('[data-test-compaction-summary]').doesNotExist();

    await click('[data-test-compaction-status] [data-test-view-code-button]');
    assert
      .dom('[data-test-compaction-summary]')
      .hasText('Objective: build a wedding planner.');
  });

  test('it shows a failed compaction', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let responseEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      { status: 'running', responseEventId } as any,
      { type: APP_BOXEL_COMPACTION_EVENT_TYPE },
    );
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      { status: 'failed', responseEventId } as any,
      { type: APP_BOXEL_COMPACTION_EVENT_TYPE },
    );
    await waitFor('[data-test-compaction-status="failed"]');
    assert
      .dom('[data-test-compaction-status]')
      .containsText('Could not summarize earlier conversation');
    assert
      .dom('[data-test-compaction-status] [data-test-apply-state="failed"]')
      .exists();
  });

  test('it ignores a compaction event that ai-bot did not send', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let responseEventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      { status: 'running', responseEventId } as any,
      { type: APP_BOXEL_COMPACTION_EVENT_TYPE },
    );
    await settled();
    assert.dom('[data-test-compaction-status]').doesNotExist();
  });
});
