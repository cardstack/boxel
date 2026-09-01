import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import RealmService from '@cardstack/host/services/realm';
import AuthedFetchTool from '@cardstack/host/tools/authed-fetch';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  setupRealmServerEndpoints,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let mockFetchResponse: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

let lastFetchArgs: { url: string; options?: RequestInit } | undefined;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | tools | authed-fetch', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  hooks.beforeEach(function () {
    let networkService = getService('network') as NetworkService;
    Object.defineProperty(networkService, 'authedFetch', {
      get() {
        return async (
          url: string,
          options?: RequestInit,
        ): Promise<typeof mockFetchResponse> => {
          lastFetchArgs = { url, options };
          return mockFetchResponse;
        };
      },
      configurable: true,
    });
  });

  hooks.beforeEach(function () {
    lastFetchArgs = undefined;
  });

  test('returns ok, status, and body for a successful JSON response', async function (assert) {
    mockFetchResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: 'hello' }),
    };
    let toolService = getService('tool-service');
    let command = new AuthedFetchTool(toolService.toolContext);
    let result = await command.execute({
      url: 'https://example.com/api/resource',
    });
    assert.true(result.ok);
    assert.strictEqual(result.status, 200);
    assert.deepEqual(result.body, { data: 'hello' });
  });

  test('returns ok=false for a failed response', async function (assert) {
    mockFetchResponse = {
      ok: false,
      status: 404,
      text: async () => 'not found',
    };
    let toolService = getService('tool-service');
    let command = new AuthedFetchTool(toolService.toolContext);
    let result = await command.execute({
      url: 'https://example.com/api/missing',
    });
    assert.false(result.ok);
    assert.strictEqual(result.status, 404);
    assert.deepEqual(result.body, { rawText: 'not found' });
  });

  test('sends a JSON request body with authentication', async function (assert) {
    mockFetchResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: 'mutated' }),
    };
    let toolService = getService('tool-service');
    let command = new AuthedFetchTool(toolService.toolContext);
    let requestBody = JSON.stringify({
      href: '/Student/demo',
      source: '.location = "In Classroom";',
      syntax: 'solidified',
    });

    let result = await command.execute({
      url: 'https://example.com/realm/_mutate',
      method: 'POST',
      acceptHeader: 'application/vnd.card+json',
      contentType: 'application/json',
      requestBody,
    });

    assert.true(result.ok);
    assert.deepEqual(lastFetchArgs, {
      url: 'https://example.com/realm/_mutate',
      options: {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
    });
  });
});
