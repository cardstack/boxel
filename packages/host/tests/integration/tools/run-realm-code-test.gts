import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import runRealmCode from '@cardstack/host/lib/realm-runner/runner';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | run-realm-code', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'task.json': `{
  "title": "Old title",
  "count": 1
}
`,
        },
      }),
    );
    await getService('realm').login(testRealmURL);
  });

  test('replays a replacement against the source that was read', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = `${testRealmURL}task.json`;

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      fileUrls: [fileUrl],
      code: `await Realm.replaceCode(${JSON.stringify(fileUrl)}, '"Old title"', '"New title"');`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    let source = await cardService.getSource(new URL(fileUrl));
    assert.strictEqual(
      source.content,
      `{
  "title": "New title",
  "count": 1
}
`,
    );
  });

  test('creates a declared source file', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = `${testRealmURL}new-task.json`;

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      fileUrls: [fileUrl],
      code: `await Realm.createFile(${JSON.stringify(fileUrl)}, '{\\n  "title": "New task"\\n}\\n');`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    let source = await cardService.getSource(new URL(fileUrl));
    assert.strictEqual(source.status, 200);
    assert.strictEqual(source.content, '{\n  "title": "New task"\n}\n');
  });

  test('a script that never returns is stopped by the sandbox, not by the caller', async function (assert) {
    // The deadline belongs to QuickJS, which interrupts the script itself. The
    // caller's timer is only a backstop for a worker that stops answering, so a
    // runaway script must report the interrupt — a caller timeout here would
    // mean the budget is being spent on something other than the script.
    let error: Error | undefined;
    try {
      await runRealmCode({
        code: 'while (true) {}',
        files: [],
        timeoutMs: 500,
      });
    } catch (e) {
      error = e as Error;
    }

    assert.ok(error, 'the run rejected');
    assert.strictEqual(error?.message, 'interrupted');
  });
});
