import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';
import type { Query } from '@cardstack/runtime-common/query';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import ENV from '@cardstack/host/config/environment';

import type MatrixService from '@cardstack/host/services/matrix-service';
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
  SYSTEM_CARD_FIXTURE_CONTENTS,
  type RealmContents,
} from '../../../helpers';
import { setupBaseRealm } from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

// A minimal stand-in for the real `OpenRouterModel` catalog card — just the
// fields the picker's cost-tier lookup reads (`modelId` + `pricing`).
const OPENROUTER_MODEL_SOURCE = `
  import { CardDef, FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class OpenRouterPricing extends FieldDef {
    static displayName = 'OpenRouter Pricing';
    @field prompt = contains(StringField);
    @field completion = contains(StringField);
  }

  export class OpenRouterModel extends CardDef {
    static displayName = 'OpenRouter Model';
    @field modelId = contains(StringField);
    @field pricing = contains(OpenRouterPricing);
  }
`;

function openRouterModelInstance(
  modelId: string,
  prompt: string,
  completion: string,
) {
  return {
    data: {
      type: 'card',
      attributes: {
        modelId,
        pricing: { prompt, completion, request: null, image: null },
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}openrouter-model`,
          name: 'OpenRouterModel',
        },
      },
    },
  };
}

function openRouterRealmURLGuard(hooks: NestedHooks) {
  let original: string | undefined;
  hooks.beforeEach(function () {
    // Point the picker's catalog lookup at the test realm, which holds the
    // OpenRouterModel fixtures (the test environment leaves this unset).
    original = ENV.resolvedOpenRouterRealmURL;
    ENV.resolvedOpenRouterRealmURL = testRealmURL;
  });
  hooks.afterEach(function () {
    ENV.resolvedOpenRouterRealmURL = original;
  });
}

function commonSetup(hooks: NestedHooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);
  openRouterRealmURLGuard(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () =>
      await (getService('loader-service').loader as Loader).import(
        '@cardstack/base/card-api',
      ),
  );
  setupRealmCacheTeardown(hooks);
}

async function seedRealm(
  mockMatrixUtils: ReturnType<typeof setupMockMatrix>,
  realmName: string,
  extraContents: RealmContents = {},
) {
  await withCachedRealmSetup(async () =>
    setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'openrouter-model.gts': OPENROUTER_MODEL_SOURCE,
        // sonnet: blended (3*3 + 15)/4 = 6/M => $$$
        'OpenRouterModel/sonnet.json': openRouterModelInstance(
          'anthropic/claude-sonnet-4.6',
          '0.000003',
          '0.000015',
        ),
        // flash: blended (3*0.1 + 0.4)/4 = 0.175/M => $
        'OpenRouterModel/flash.json': openRouterModelInstance(
          'google/gemini-3-flash-preview',
          '0.0000001',
          '0.0000004',
        ),
        // gpt-5.4: zero-priced => Free
        'OpenRouterModel/gpt.json': openRouterModelInstance(
          'openai/gpt-5.4',
          '0',
          '0',
        ),
        '.realm.json': `{ "name": "${realmName}" }`,
        ...extraContents,
      },
    }),
  );
}

async function openPicker() {
  getService('operator-mode-state-service').restore({ stacks: [[]] });
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      noop = () => {};
      <template><OperatorMode @onClose={{this.noop}} /></template>
    },
  );
  await waitFor('[data-test-open-ai-assistant]');
  await click('[data-test-open-ai-assistant]');
  await waitFor('[data-test-room-settled]');
  await click('[data-test-llm-select-selected]');
  await waitFor('.menu-content');
}

// The badge text for a picker row, keyed by the row's option id (the raw
// model id in the fallback branch; the ModelConfiguration card id in the
// system-card branch).
function costBadge(optionId: string): string | undefined {
  return document
    .querySelector(
      `[data-test-llm-select-item="${optionId}"] [data-test-llm-cost]`,
    )
    ?.textContent?.trim();
}

module(
  'Integration | ai-assistant-panel | model cost tier | fallback model list',
  function (hooks) {
    commonSetup(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
      now: (() => {
        let clock = new Date(2026, 4, 25).getTime();
        return () => (clock += 10);
      })(),
    });

    hooks.beforeEach(async function () {
      await seedRealm(mockMatrixUtils, 'Model Cost Tier Test Realm');
    });

    test('picker shows a $…$$$$ / Free cost badge derived from OpenRouter pricing', async function (assert) {
      await openPicker();

      await waitUntil(() => costBadge('anthropic/claude-sonnet-4.6'));

      assert.strictEqual(
        costBadge('anthropic/claude-sonnet-4.6'),
        '$$$',
        'a $6/M blended model reads as $$$',
      );
      assert.strictEqual(
        costBadge('google/gemini-3-flash-preview'),
        '$',
        'a sub-$1/M blended model reads as $',
      );
      assert.strictEqual(
        costBadge('openai/gpt-5.4'),
        'Free',
        'a zero-priced model reads as Free',
      );
    });

    test('picker omits the badge for a model absent from the catalog', async function (assert) {
      await openPicker();

      // 'anthropic/claude-opus-4.7' is a curated fallback row but has no
      // matching OpenRouterModel fixture, so it carries no badge.
      await waitUntil(() => costBadge('anthropic/claude-sonnet-4.6'));
      assert
        .dom('[data-test-llm-select-item="anthropic/claude-opus-4.7"]')
        .exists('the uncatalogued model is still listed');
      assert.strictEqual(
        costBadge('anthropic/claude-opus-4.7'),
        undefined,
        'no cost badge when the model is not in the catalog',
      );
    });

    test('picker degrades to no badges when the catalog search fails', async function (assert) {
      let store = getService('store') as StoreService;
      let originalSearch = store.search;
      // Fail only the cost-tier lookup (queries typed on OpenRouterModel);
      // everything else the panel does keeps its real search.
      (store as any).search = function (query: Query, ...rest: unknown[]) {
        if (JSON.stringify(query.filter ?? {}).includes('OpenRouterModel')) {
          return Promise.reject(new Error('catalog realm is down'));
        }
        return (originalSearch as any).call(this, query, ...rest);
      };
      try {
        await openPicker();
        await settled();

        // The failure is caught inside the load task; if it leaked, QUnit
        // would fail this test on the unhandled rejection.
        assert
          .dom('[data-test-llm-select-item="anthropic/claude-sonnet-4.6"]')
          .exists('the picker still lists its models');
        assert.strictEqual(
          costBadge('anthropic/claude-sonnet-4.6'),
          undefined,
          'no badge when the catalog search fails',
        );
        assert.dom('[data-test-llm-cost]').doesNotExist('no badges at all');
      } finally {
        (store as any).search = originalSearch;
      }
    });
  },
);

module(
  'Integration | ai-assistant-panel | model cost tier | system card model list',
  function (hooks) {
    commonSetup(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
      systemCardAccountData: { id: `${testRealmURL}SystemCard/default` },
      now: (() => {
        let clock = new Date(2026, 4, 25).getTime();
        return () => (clock += 10);
      })(),
    });

    hooks.beforeEach(async function () {
      // The system-card fixture's configurations reference gpt-5 (uncatalogued
      // here) and the sonnets; catalog cards below give sonnet 4.6 a $$$ tier
      // and sonnet 4.5 a Free tier, keyed by modelId, not config id.
      await seedRealm(mockMatrixUtils, 'Model Cost Tier System Card Realm', {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'OpenRouterModel/sonnet-45.json': openRouterModelInstance(
          'anthropic/claude-sonnet-4.5',
          '0',
          '0',
        ),
      });
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('badges attach to model configurations via their modelId', async function (assert) {
      await openPicker();

      let sonnet46ConfigId = `${testRealmURL}ModelConfiguration/test-claude-sonnet-46`;
      await waitUntil(() => costBadge(sonnet46ConfigId));

      assert.strictEqual(
        costBadge(sonnet46ConfigId),
        '$$$',
        'config row carries the tier of its catalog model',
      );
      assert.strictEqual(
        costBadge(`${testRealmURL}ModelConfiguration/test-claude-sonnet-45`),
        'Free',
        'a zero-priced catalog model reads as Free',
      );
      assert.strictEqual(
        costBadge(`${testRealmURL}ModelConfiguration/test-claude-37-sonnet`),
        undefined,
        'no badge for a config whose model is not in the catalog',
      );
      assert
        .dom('[data-test-llm-cost-selected]')
        .hasText('$$$', 'the selected model shows its badge in the header');
    });
  },
);
