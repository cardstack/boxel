import { settled, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Realm } from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import ENV from '@cardstack/host/config/environment';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type StoreService from '@cardstack/host/services/store';

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

const USER_CHOICE_ID = `${testRealmURL}SystemCard/user-choice`;
const ENV_DEFAULT_ID = `${testRealmURL}SystemCard/env-default`;

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

async function seedRealm(
  mockMatrixUtils: ReturnType<typeof setupMockMatrix>,
  opts: { withEnvDefault: boolean; withUserChoice: boolean },
): Promise<Realm> {
  let contents: Record<string, unknown> = {
    '.realm.json': `{ "name": "Fallback Banner Live Delete Test Realm" }`,
  };
  if (opts.withUserChoice) {
    contents['SystemCard/user-choice.json'] = SYSTEM_CARD_CONTENT;
  }
  if (opts.withEnvDefault) {
    contents['SystemCard/env-default.json'] = SYSTEM_CARD_CONTENT;
  }
  let realm!: Realm;
  await withCachedRealmSetup(async () => {
    let setup = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents,
    });
    realm = setup.realm;
    return setup;
  });
  return realm;
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

  let aiAssistantPanelService = getService(
    'ai-assistant-panel-service',
  ) as AiAssistantPanelService;
  aiAssistantPanelService.openPanel();
  await settled();
  await waitFor('[data-test-close-ai-assistant]');
}

module(
  'Integration | ai-assistant-panel | fallback-banner | live delete | in-tab UI delete of user-chosen card, no env default',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: USER_CHOICE_ID },
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = undefined;
      await seedRealm(mockMatrixUtils, {
        withUserChoice: true,
        withEnvDefault: false,
      });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('deleting the active SystemCard in-tab surfaces the fallback banner and clears the user preference', async function (assert) {
      await openAiAssistantPanel();
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(
        matrixService.systemCard?.id,
        USER_CHOICE_ID,
        'precondition: the user-chosen SystemCard is active',
      );
      assert
        .dom('[data-test-fallback-banner]')
        .doesNotExist('precondition: banner is not shown while the card loads');

      let storeService = getService('store') as StoreService;
      await storeService.delete(USER_CHOICE_ID);
      await settled();

      assert
        .dom('[data-test-fallback-banner]')
        .exists('banner appears after the active SystemCard is deleted in-tab');
      assert.true(
        matrixService.isUsingFallbackSystemCard,
        'chain reported as broken once the active card is gone',
      );
      assert.strictEqual(
        matrixService.systemCard,
        undefined,
        'the deleted card is no longer the active SystemCard',
      );
      assert.deepEqual(
        mockMatrixUtils.getSystemCardAccountData(),
        { id: undefined },
        'matrix account-data preference is cleared so the dangling id is not rebroadcast',
      );
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-banner | live delete | cross-machine delete of user-chosen card, no env default',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: USER_CHOICE_ID },
    });
    let realm!: Realm;

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = undefined;
      realm = await seedRealm(mockMatrixUtils, {
        withUserChoice: true,
        withEnvDefault: false,
      });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('a delete originating elsewhere (realm invalidation) surfaces the banner and clears the user preference', async function (assert) {
      await openAiAssistantPanel();
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(
        matrixService.systemCard?.id,
        USER_CHOICE_ID,
        'precondition: the user-chosen SystemCard is active',
      );

      // Bypass StoreService.delete — simulate the other-tab / other-machine
      // path where the realm deletes the file and broadcasts an invalidation
      // event into the realm auth room.
      await realm.delete('SystemCard/user-choice.json');
      await settled();

      assert
        .dom('[data-test-fallback-banner]')
        .exists('banner appears after the cross-machine deletion propagates');
      assert.true(
        matrixService.isUsingFallbackSystemCard,
        'chain reported as broken once the realm invalidation arrives',
      );
      assert.strictEqual(
        matrixService.systemCard,
        undefined,
        'the deleted card is no longer the active SystemCard',
      );
      assert.deepEqual(
        mockMatrixUtils.getSystemCardAccountData(),
        { id: undefined },
        'matrix account-data preference is cleared on cross-machine deletion too',
      );
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-banner | live delete | env default deleted with no user choice',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
    });
    let realm!: Realm;

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = ENV_DEFAULT_ID;
      realm = await seedRealm(mockMatrixUtils, {
        withUserChoice: false,
        withEnvDefault: true,
      });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('deleting the env-default SystemCard surfaces the banner without touching account data', async function (assert) {
      await openAiAssistantPanel();
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(
        matrixService.systemCard?.id,
        ENV_DEFAULT_ID,
        'precondition: env default is the active SystemCard',
      );
      assert.strictEqual(
        mockMatrixUtils.getSystemCardAccountData(),
        undefined,
        'precondition: no user preference is recorded',
      );

      await realm.delete('SystemCard/env-default.json');
      await settled();

      assert
        .dom('[data-test-fallback-banner]')
        .exists('banner appears after the env-default card is deleted');
      assert.true(
        matrixService.isUsingFallbackSystemCard,
        'chain reported as broken once env default is gone',
      );
      assert.strictEqual(
        matrixService.systemCard,
        undefined,
        'no SystemCard is active after the env default is deleted',
      );
      assert.strictEqual(
        mockMatrixUtils.getSystemCardAccountData(),
        undefined,
        'no account-data write occurs when the deleted card was the env default, not a user pick',
      );
    });
  },
);

module(
  'Integration | ai-assistant-panel | fallback-banner | live delete | user-chosen card deleted, env default takes over silently',
  function (hooks) {
    commonSetup(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: USER_CHOICE_ID },
    });

    hooks.beforeEach(async function () {
      ENV.defaultSystemCardId = ENV_DEFAULT_ID;
      await seedRealm(mockMatrixUtils, {
        withUserChoice: true,
        withEnvDefault: true,
      });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('env default silently takes over and the user preference is cleared, no banner', async function (assert) {
      await openAiAssistantPanel();
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(
        matrixService.systemCard?.id,
        USER_CHOICE_ID,
        'precondition: the user-chosen SystemCard is active',
      );

      let storeService = getService('store') as StoreService;
      await storeService.delete(USER_CHOICE_ID);
      await settled();

      assert
        .dom('[data-test-fallback-banner]')
        .doesNotExist('no banner — env default takes over silently');
      assert.false(
        matrixService.isUsingFallbackSystemCard,
        'chain is healthy once env default takes over',
      );
      assert.strictEqual(
        matrixService.systemCard?.id,
        ENV_DEFAULT_ID,
        'env default is the active SystemCard after deletion',
      );
      assert.deepEqual(
        mockMatrixUtils.getSystemCardAccountData(),
        { id: undefined },
        'matrix account-data preference is cleared even when env default rescues us',
      );
    });
  },
);
