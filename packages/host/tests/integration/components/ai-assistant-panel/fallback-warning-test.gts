import { settled, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import ENV from '@cardstack/host/config/environment';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
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

const BAD_SYSTEM_CARD_ID = `${testRealmURL}SystemCard/does-not-exist`;
const GOOD_SYSTEM_CARD_ID = `${testRealmURL}SystemCard/default`;

const SYSTEM_CARD_CONTENT = {
  data: {
    type: 'card',
    attributes: {},
    meta: {
      adoptsFrom: {
        module: 'https://cardstack.com/base/system-card',
        name: 'SystemCard',
      },
    },
  },
};

function envDefaultGuard(hooks: NestedHooks) {
  let original: string | undefined;
  hooks.beforeEach(function () {
    original = ENV.defaultSystemCardId;
  });
  hooks.afterEach(function () {
    ENV.defaultSystemCardId = original;
  });
}

function commonSetup(hooks: NestedHooks) {
  let loader: Loader;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);
  envDefaultGuard(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupRealmCacheTeardown(hooks);
}

async function seedRealm(mockMatrixUtils: ReturnType<typeof setupMockMatrix>) {
  await withCachedRealmSetup(async () =>
    setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        '.realm.json': `{ "name": "Fallback Warning Test Realm" }`,
        'SystemCard/default.json': SYSTEM_CARD_CONTENT,
      },
    }),
  );
}

async function openAiAssistantPanel(): Promise<void> {
  let operatorModeStateService = getService(
    'operator-mode-state-service',
  ) as OperatorModeStateService;
  operatorModeStateService.restore({ stacks: [[]] });

  await renderComponent(
    class TestDriver extends GlimmerComponent {
      noop = () => {};
      <template><OperatorMode @onClose={{this.noop}} /></template>
    },
  );

  // Open the panel via the service rather than clicking the toggle button —
  // `openPanel` kicks off `loadRoomsTask` and settling the click stalls
  // against the empty mock matrix backend.
  let aiAssistantPanelService = getService(
    'ai-assistant-panel-service',
  ) as AiAssistantPanelService;
  aiAssistantPanelService.openPanel();
  await settled();
  await waitFor('[data-test-close-ai-assistant]');
}

module(
  'Integration | ai-assistant-panel | fallback-warning | broken chain (user pick fails + no env default)',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: BAD_SYSTEM_CARD_ID },
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = undefined;
      await seedRealm(mockMatrixUtils);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('isUsingFallbackSystemCard is true', function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.true(
        matrixService.isUsingFallbackSystemCard,
        'chain reported as broken',
      );
    });

    test('warning icon renders in the panel header', async function (assert) {
      await openAiAssistantPanel();

      assert
        .dom('[data-test-fallback-warning]')
        .exists('warning icon is rendered when the SystemCard chain is broken');
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-warning | broken chain (env default fails)',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = BAD_SYSTEM_CARD_ID;
      await seedRealm(mockMatrixUtils);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('isUsingFallbackSystemCard is true even with no user choice', function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.true(
        matrixService.isUsingFallbackSystemCard,
        'env default failure surfaces as broken chain',
      );
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-warning | silent env-default recovery',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: BAD_SYSTEM_CARD_ID },
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = GOOD_SYSTEM_CARD_ID;
      await seedRealm(mockMatrixUtils);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('isUsingFallbackSystemCard stays false when env default loads successfully', function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.false(
        matrixService.isUsingFallbackSystemCard,
        'user-pick failure recovered silently via env default',
      );
      assert.strictEqual(
        matrixService.systemCard?.id,
        GOOD_SYSTEM_CARD_ID,
        'env default is the active system card',
      );
    });

    test('warning icon does not render', async function (assert) {
      await openAiAssistantPanel();
      assert.dom('[data-test-fallback-warning]').doesNotExist();
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-warning | MVP steady state (no SystemCard configured)',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = undefined;
      await seedRealm(mockMatrixUtils);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('isUsingFallbackSystemCard is false in MVP steady state', function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.false(
        matrixService.isUsingFallbackSystemCard,
        'no user choice + no env default = no chain to break',
      );
    });

    test('warning icon does not render', async function (assert) {
      await openAiAssistantPanel();
      assert.dom('[data-test-fallback-warning]').doesNotExist();
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-warning | healthy SystemCard',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: GOOD_SYSTEM_CARD_ID },
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = GOOD_SYSTEM_CARD_ID;
      await seedRealm(mockMatrixUtils);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('isUsingFallbackSystemCard is false', function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.false(matrixService.isUsingFallbackSystemCard);
      assert.strictEqual(matrixService.systemCard?.id, GOOD_SYSTEM_CARD_ID);
    });

    test('warning icon does not render', async function (assert) {
      await openAiAssistantPanel();
      assert.dom('[data-test-fallback-warning]').doesNotExist();
    });
  },
);
