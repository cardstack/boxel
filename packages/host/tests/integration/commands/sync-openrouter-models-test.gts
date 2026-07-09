import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardService from '@cardstack/host/services/card-service';
import SyncOpenRouterModelsCommand from '@cardstack/host/tools/sync-openrouter-models';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// The models the stubbed OpenRouter HTTP API returns for the test.
let apiModels: { id: string }[];
// The atomic operations the sync command derives, captured instead of written.
let capturedOperations: AtomicOperation[];

// Capture the operations the command derives so the test can assert which
// existing cards it discovered, without exercising the realm write path.
class CapturingCardService extends CardService {
  override async executeAtomicOperations(
    operations: AtomicOperation[],
    _realmUrl: URL,
  ): Promise<any> {
    capturedOperations.push(...operations);
    return {};
  }
}

module('Integration | commands | sync-openrouter-models', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let originalFetch: typeof globalThis.fetch;

  // Register the capturing card-service first — before any later hook resolves
  // the store, which would instantiate the real card-service and shadow this.
  hooks.beforeEach(function (this: RenderingTestContext) {
    capturedOperations = [];
    getOwner(this)!.register('service:card-service', CapturingCardService);
    loader = getService('loader-service').loader;

    // The command lists models from the OpenRouter HTTP API via the global
    // fetch; stub just that URL and pass everything else (including the realm
    // search) through untouched.
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === OPENROUTER_MODELS_URL) {
        return new Response(JSON.stringify({ data: apiModels }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  });

  hooks.afterEach(function () {
    globalThis.fetch = originalFetch;
  });

  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    // A minimal stand-in for the real OpenRouterModel card: the sync command
    // matches existing instances by this module path + name.
    class OpenRouterModel extends CardDef {
      static displayName = 'OpenRouterModel';
      @field modelId = contains(StringField);
    }

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'openrouter-model.gts': { OpenRouterModel },
          'OpenRouterModel/openai-gpt-4.json': new OpenRouterModel({
            modelId: 'openai/gpt-4',
          }),
          'OpenRouterModel/legacy-model.json': new OpenRouterModel({
            modelId: 'legacy/model',
          }),
          'realm.json': realmConfigCardJSON({
            name: 'OpenRouter Models',
          }),
        },
      });
    });
  });

  function runSync() {
    let toolService = getService('tool-service');
    let command = new SyncOpenRouterModelsCommand(toolService.commandContext);
    return command.execute({ realmIdentifier: testRealmURL });
  }

  function opFor(href: string) {
    return capturedOperations.find((op) => op.href === href);
  }

  test('discovers existing OpenRouterModel slugs through /_search', async function (assert) {
    // The API still lists gpt-4 (slug openai-gpt-4) and introduces a new model
    // (slug google-gemini-pro); the pre-existing legacy-model is absent.
    apiModels = [{ id: 'openai/gpt-4' }, { id: 'google/gemini-pro' }];

    let result = await runSync();

    // The existing, still-listed model is discovered via search, so it is updated
    // in place rather than re-added.
    assert.strictEqual(
      opFor('OpenRouterModel/openai-gpt-4.json')?.op,
      'update',
      'existing listed model resolves to an update',
    );

    // The model not previously in the realm is added.
    assert.strictEqual(
      opFor('OpenRouterModel/google-gemini-pro.json')?.op,
      'add',
      'previously unknown model resolves to an add',
    );

    // The existing model the API no longer lists is discovered via search and
    // marked deprecated — this op only exists because the search surfaced its slug.
    let legacyOp = opFor('OpenRouterModel/legacy-model.json');
    assert.strictEqual(
      legacyOp?.op,
      'update',
      'existing-but-delisted model resolves to an update',
    );
    assert.true(
      (legacyOp?.data as any)?.attributes?.deprecated,
      'existing model absent from the API is marked deprecated',
    );

    assert.ok(
      result.status.includes('1 deprecated'),
      'status reports the one deprecated model discovered via search',
    );
  });
});
