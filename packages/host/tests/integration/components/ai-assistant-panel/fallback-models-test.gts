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

  let { createAndJoinRoom, getRoomState, simulateRemoteMessage } =
    mockMatrixUtils;

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

  test('resolveActiveLLMConfig fills caps from DEFAULT_FALLBACK_MODELS for a curated model when no systemCard', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();
    assert.strictEqual(
      matrixService.systemCard,
      undefined,
      'precondition: no systemCard',
    );

    let caps = matrixService.resolveActiveLLMConfig(roomId, CURATED_MODEL_ID);

    assert.strictEqual(
      caps.toolsSupported,
      CURATED_ROW.toolsSupported,
      'toolsSupported from curated row',
    );
    assert.deepEqual(
      caps.inputModalities,
      CURATED_ROW.inputModalities,
      'inputModalities from curated row',
    );
    assert.strictEqual(
      caps.reasoningEffort,
      undefined,
      'reasoningEffort never auto-filled from the curated fallback',
    );
  });

  test('resolveActiveLLMConfig falls to conservative floor for a non-curated model with no prior event', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

    let caps = matrixService.resolveActiveLLMConfig(
      roomId,
      NON_CURATED_MODEL_ID,
    );

    assert.false(
      caps.toolsSupported,
      'conservative floor disables tools for an unknown model',
    );
    assert.deepEqual(
      caps.inputModalities,
      ['text'],
      'conservative floor limits modalities to text',
    );
    assert.strictEqual(
      caps.reasoningEffort,
      undefined,
      'reasoningEffort stays undefined at the floor',
    );
  });

  test('resolveActiveLLMConfig: caller override beats DEFAULT_FALLBACK_MODELS', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

    let caps = matrixService.resolveActiveLLMConfig(roomId, CURATED_MODEL_ID, {
      toolsSupported: false,
    });

    assert.false(
      caps.toolsSupported,
      'explicit caller override wins over the curated row',
    );
    assert.deepEqual(
      caps.inputModalities,
      CURATED_ROW.inputModalities,
      'fields not overridden still come from the curated row',
    );
  });

  test('resolveActiveLLMConfig rehydrates caps from a prior valid event for the same model', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let matrixService = getMatrixService();

    // Seed a prior valid active-llm event for an uncurated model. The dumb
    // wire writer ships the caps verbatim, and the timeline propagates them
    // back into the local MatrixRoom event list.
    await matrixService.sendActiveLLMEvent(roomId, 'uncurated/model-x', {
      toolsSupported: true,
      inputModalities: ['text', 'audio'],
    });
    await waitUntil(() =>
      matrixService
        .getRoomData(roomId)
        ?.events?.some(
          (e) =>
            e.type === APP_BOXEL_ACTIVE_LLM &&
            (e as { content?: { model?: string } }).content?.model ===
              'uncurated/model-x',
        ),
    );

    let caps = matrixService.resolveActiveLLMConfig(
      roomId,
      'uncurated/model-x',
    );

    assert.true(
      caps.toolsSupported,
      'toolsSupported rehydrated from prior event',
    );
    assert.deepEqual(
      caps.inputModalities,
      ['text', 'audio'],
      'inputModalities rehydrated from prior event',
    );
  });

  test('resolveActiveLLMConfig skips a prior broken event and falls to the conservative floor', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let matrixService = getMatrixService();

    // Seed a CS-11249-era broken event: caps missing. Layer 4 must filter it
    // out and resolution must drop to the conservative floor.
    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      { model: 'uncurated/broken-model' },
      { type: APP_BOXEL_ACTIVE_LLM, state_key: '' },
    );
    await waitUntil(() =>
      matrixService
        .getRoomData(roomId)
        ?.events?.some(
          (e) =>
            e.type === APP_BOXEL_ACTIVE_LLM &&
            (e as { content?: { model?: string } }).content?.model ===
              'uncurated/broken-model',
        ),
    );

    let caps = matrixService.resolveActiveLLMConfig(
      roomId,
      'uncurated/broken-model',
    );

    assert.false(
      caps.toolsSupported,
      'broken prior event ignored; tools disabled at the floor',
    );
    assert.deepEqual(
      caps.inputModalities,
      ['text'],
      'broken prior event ignored; modalities at the floor',
    );
  });

  test('sendActiveLLMEvent ships resolved caps on the wire for a curated model', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

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
      'state event reflects the resolved caps; reasoningEffort stays undefined',
    );
  });

  test('sendActiveLLMEvent preserves an explicit caller override on the wire', async function (assert) {
    let roomId = freshRoom();
    let matrixService = getMatrixService();

    await matrixService.sendActiveLLMEvent(roomId, CURATED_MODEL_ID, {
      toolsSupported: false,
    });

    let state = getRoomState(roomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.false(
      state?.content?.toolsSupported,
      'caller override survives the internal resolver',
    );
    assert.deepEqual(
      state?.content?.inputModalities,
      CURATED_ROW.inputModalities,
      'fields not overridden still come from the curated row',
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
