import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import RunRealmScriptTool from '@cardstack/host/tools/run-realm-script';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BaseToolModule from '@cardstack/base/command';

let mockResponse: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};
let requests: { url: string; options?: RequestInit }[];

class TestRealmScriptResult {
  declare output: unknown;

  constructor({ output }: { output: unknown }) {
    this.output = output;
  }
}

class TestableRunRealmScriptTool extends RunRealmScriptTool {
  protected override async loadToolModule(): Promise<typeof BaseToolModule> {
    return {
      RunRealmScriptResult: TestRealmScriptResult,
    } as unknown as typeof BaseToolModule;
  }

  callRun(input: {
    realmIdentifier: string;
    code: string;
    mode: string;
    input?: unknown;
    notebook?: unknown;
  }) {
    return this.run(input as BaseToolModule.RunRealmScriptInput);
  }
}

module('Integration | tools | run-realm-script', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
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
    requests = [];
    let network = getService('network') as NetworkService;
    Object.defineProperty(network, 'authedFetch', {
      get() {
        return async (url: string, options?: RequestInit) => {
          requests.push({ url, options });
          return mockResponse;
        };
      },
      configurable: true,
    });
  });

  test('uses the authenticated read boundary for preview mode', async function (assert) {
    mockResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ scanned: 12, matches: ['a.gts'] }),
    };
    let toolService = getService('tool-service');
    let tool = new TestableRunRealmScriptTool(toolService.toolContext);
    let result = await tool.callRun({
      realmIdentifier: testRealmURL.slice(0, -1),
      code: 'return await realm.fs.glob("**/*.gts");',
      mode: 'preview',
    });

    assert.deepEqual(result.output, {
      scanned: 12,
      matches: ['a.gts'],
    });
    assert.strictEqual(
      requests[0].url,
      `${testRealmURL}_realm-program`,
      'targets the Realm-specific endpoint',
    );
    assert.strictEqual(
      requests[0].options?.method,
      'QUERY',
      'preview uses the read permission boundary',
    );
    assert.deepEqual(JSON.parse(requests[0].options?.body as string), {
      code: 'return await realm.fs.glob("**/*.gts");',
      mode: 'preview',
    });
  });

  test('uses the authenticated write boundary for commit mode', async function (assert) {
    mockResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ committed: true }),
    };
    let toolService = getService('tool-service');
    let tool = new TestableRunRealmScriptTool(toolService.toolContext);
    await tool.callRun({
      realmIdentifier: testRealmURL,
      code: 'realm.fs.writeText("hello.txt", "hi");',
      mode: 'commit',
    });

    assert.strictEqual(
      requests[0].options?.method,
      'POST',
      'commit uses the write permission boundary',
    );
  });

  test('forwards Matrix-room notebook state and explicit inputs', async function (assert) {
    mockResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ notebook: { reused: false } }),
    };
    let toolService = getService('tool-service');
    let tool = new TestableRunRealmScriptTool(toolService.toolContext);
    let notebook = {
      sessionId: '!room:localhost',
      cellId: 'grep',
      persistence: 'ephemeral',
      inputs: {
        candidates: {
          cellId: 'search',
          pointer: '/result/value/candidates',
        },
      },
    };
    await tool.callRun({
      realmIdentifier: testRealmURL,
      code: 'return realm.input.candidates;',
      mode: 'preview',
      input: { direct: 'value' },
      notebook,
    });

    assert.deepEqual(JSON.parse(requests[0].options?.body as string), {
      code: 'return realm.input.candidates;',
      mode: 'preview',
      input: { direct: 'value' },
      notebook,
    });
  });

  test('surfaces structured Realm Program errors', async function (assert) {
    mockResponse = {
      ok: false,
      status: 501,
      text: async () =>
        JSON.stringify({
          error: {
            message: 'Realm Program failed after a write',
            details: {
              effects: [
                {
                  scope: 'realm',
                  method: 'POST',
                  path: 'partial.json',
                  status: 201,
                  ok: true,
                },
              ],
              notebook: {
                sessionId: '!room:localhost',
                cellId: 'commit-cell',
                snapshot: {
                  cells: [{ cellId: 'commit-cell', status: 'indeterminate' }],
                },
              },
            },
          },
        }),
    };
    let toolService = getService('tool-service');
    let tool = new TestableRunRealmScriptTool(toolService.toolContext);

    await assert.rejects(
      tool.callRun({
        realmIdentifier: testRealmURL,
        code: 'return 1;',
        mode: 'preview',
      }),
      /Realm Program failed after a write; raw API effects before failure:.*partial\.json.*notebook state:.*indeterminate/,
    );
  });

  test('rejects unknown modes before making a request', async function (assert) {
    let toolService = getService('tool-service');
    let tool = new TestableRunRealmScriptTool(toolService.toolContext);

    await assert.rejects(
      tool.callRun({
        realmIdentifier: testRealmURL,
        code: 'return 1;',
        mode: 'unsafe',
      }),
      /must be "preview" or "commit"/,
    );
    assert.strictEqual(requests.length, 0, 'does not make a request');
  });
});
