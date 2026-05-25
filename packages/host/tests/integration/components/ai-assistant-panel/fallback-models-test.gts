import { click, waitFor, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_FALLBACK_MODELS,
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
} from '../../../helpers';
import { setupBaseRealm } from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

const CURATED_MODEL_ID = 'anthropic/claude-sonnet-4.6';
const CURATED_ROW = DEFAULT_FALLBACK_MODELS.find(
  (m) => m.modelId === CURATED_MODEL_ID,
)!;
const NON_CURATED_MODEL_ID = 'some-non-curated/model';

module('Integration | ai-assistant-panel | fallback-models', function (hooks) {
  const realmName = 'Fallback Models Test Realm';
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
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      let clock = new Date(2026, 4, 25).getTime();
      return () => (clock += 10);
    })(),
  });

  let { createAndJoinRoom, getRoomState } = mockMatrixUtils;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          '.realm.json': `{ "name": "${realmName}" }`,
        },
      }),
    );
  });

  function getMatrixService(): MatrixService {
    return getService('matrix-service') as MatrixService;
  }

  function freshRoom(): string {
    return createAndJoinRoom({
      sender: '@testuser:localhost',
      name: `fallback-test-room-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  async function setCardInOperatorModeState() {
    operatorModeStateService.restore({ stacks: [[]] });
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

  async function renderAiAssistantPanel(): Promise<string> {
    await setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        noop = () => {};
        <template><OperatorMode @onClose={{this.noop}} /></template>
      },
    );
    return openAiAssistant();
  }

  test('sendActiveLLMEvent fills caps from constant for a curated model when no systemCard', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();
    assert.strictEqual(
      matrixService.systemCard,
      undefined,
      'precondition: no systemCard',
    );

    await matrixService.sendActiveLLMEvent(roomId, CURATED_MODEL_ID);

    let state = getRoomState(roomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.deepEqual(
      state?.content,
      {
        model: CURATED_MODEL_ID,
        toolsSupported: CURATED_ROW.toolsSupported,
        reasoningEffort: undefined,
        inputModalities: CURATED_ROW.inputModalities,
      },
      'curated model caps filled from DEFAULT_FALLBACK_MODELS',
    );
  });

  test('sendActiveLLMEvent ships undefined caps for a non-curated model (constant does not cover it)', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

    await matrixService.sendActiveLLMEvent(roomId, NON_CURATED_MODEL_ID);

    let state = getRoomState(roomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.strictEqual(
      state?.content?.model,
      NON_CURATED_MODEL_ID,
      'non-curated model id ships as-is',
    );
    assert.strictEqual(
      state?.content?.toolsSupported,
      undefined,
      'no caps for non-curated model',
    );
    assert.strictEqual(
      state?.content?.inputModalities,
      undefined,
      'no inputModalities for non-curated model',
    );
  });

  test('sendActiveLLMEvent respects explicit toolsSupported: false (never overridden by constant)', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

    await matrixService.sendActiveLLMEvent(roomId, CURATED_MODEL_ID, {
      toolsSupported: false,
    });

    let state = getRoomState(roomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.false(
      state?.content?.toolsSupported,
      'explicit false is preserved on the wire',
    );
    // inputModalities not provided by caller → falls back to the constant
    assert.deepEqual(
      state?.content?.inputModalities,
      CURATED_ROW.inputModalities,
      'partial config: missing inputModalities filled from constant',
    );
  });

  test('picker shows the curated fallback models when no systemCard is configured', async function (assert) {
    let matrixService = getMatrixService();
    assert.strictEqual(
      matrixService.systemCard,
      undefined,
      'precondition: no systemCard',
    );

    await renderAiAssistantPanel();
    await click('[data-test-llm-select-selected]');
    await waitFor('.menu-content');

    for (let row of DEFAULT_FALLBACK_MODELS) {
      await waitUntil(() =>
        document
          .querySelector('.menu-content')
          ?.textContent?.includes(row.displayName),
      );
      assert
        .dom('.menu-content')
        .containsText(
          row.displayName,
          `picker shows ${row.displayName} from the curated fallback list`,
        );
    }
  });
});
