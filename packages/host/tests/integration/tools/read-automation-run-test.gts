import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ReadAutomationRunTool from '@cardstack/host/tools/read-automation-run';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  setupRealmServerEndpoints,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | read-automation-run', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  // What the realm server is asked, and what it answers.
  let asked: string[];
  let answer: { status: number; body: unknown };

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({ mockMatrixUtils, contents: {} }),
    );
    asked = [];
    answer = { status: 200, body: {} };
    let realmServer = getService('realm-server');
    Object.defineProperty(realmServer, 'authedFetch', {
      value: async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { 'content-type': 'application/json' },
        });
      },
      configurable: true,
    });
  });

  async function read(json: Record<string, unknown>) {
    let tool = new ReadAutomationRunTool(
      getService('tool-service').toolContext,
    );
    let result = await tool.execute({ json });
    return result.json as {
      ok: boolean;
      status: number;
      body: Record<string, unknown>;
    };
  }

  test("reads a run's report from the realm server, for the realm and run asked", async function (assert) {
    answer = {
      status: 200,
      body: { data: { type: 'automation-run-report', id: 'run-1' } },
    };
    let result = await read({
      realm: testRealmURL,
      run: 'run-1',
      read: 'report',
    });
    assert.strictEqual(asked.length, 1);
    let url = new URL(asked[0]);
    assert.strictEqual(
      url.href.split('?')[0],
      `${getService('realm-server').url.href}_automation-run-report`,
    );
    assert.strictEqual(url.searchParams.get('realm'), testRealmURL);
    assert.strictEqual(url.searchParams.get('run'), 'run-1');
    assert.deepEqual(result, {
      ok: true,
      status: 200,
      body: { data: { type: 'automation-run-report', id: 'run-1' } },
    });
  });

  test("reads one page of a run's log, past a line and at the levels asked", async function (assert) {
    await read({
      realm: testRealmURL,
      run: 'run-1',
      read: 'log',
      after: 41,
      limit: 500,
      levels: ['warn', 'error'],
    });
    let url = new URL(asked[0]);
    assert.true(url.pathname.endsWith('/_automation-run-log'));
    assert.strictEqual(url.searchParams.get('realm'), testRealmURL);
    assert.strictEqual(url.searchParams.get('run'), 'run-1');
    assert.strictEqual(url.searchParams.get('after'), '41');
    assert.strictEqual(url.searchParams.get('limit'), '500');
    assert.strictEqual(url.searchParams.get('level'), 'warn,error');
  });

  test('answers a refusal with its status and no body', async function (assert) {
    answer = { status: 403, body: { errors: ['not a direct writer'] } };
    let result = await read({
      realm: testRealmURL,
      run: 'run-1',
      read: 'report',
    });
    assert.deepEqual(result, { ok: false, status: 403, body: {} });
  });

  test('refuses an input that names no realm, no run, or nothing to read', async function (assert) {
    for (let json of [
      { run: 'run-1', read: 'report' },
      { realm: testRealmURL, read: 'report' },
      { realm: testRealmURL, run: 'run-1', read: 'storage' },
      { realm: testRealmURL, run: 'run-1', read: 'log', after: 'start' },
      { realm: testRealmURL, run: 'run-1', read: 'log', levels: [] },
    ]) {
      await assert.rejects(read(json), JSON.stringify(json));
    }
    assert.strictEqual(asked.length, 0, 'the realm server is never asked');
  });
});
