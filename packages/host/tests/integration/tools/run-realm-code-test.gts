import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import runRealmCode from '@cardstack/host/lib/realm-runner/runner';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
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

  // `realm.view` captures through the realm server; this answers every
  // capture with a 1×1 PNG and records what was asked for.
  let captureRequests: any[] = [];
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  setupRealmServerEndpoints(hooks, [
    {
      route: '_capture',
      getResponse: async (req: Request) => {
        captureRequests.push(await req.clone().json());
        return new Response(
          JSON.stringify({
            data: {
              type: 'capture-card-result',
              attributes: {
                status: 'ready',
                base64: PNG_BASE64,
                width: 1,
                height: 1,
                contentType: 'image/png',
              },
            },
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        );
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(function () {
    captureRequests = [];
  });

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

  test('realm.view attaches a capture to the result and tells the script only what it needs', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.view('task.json');`,
    });

    assert.strictEqual(captureRequests.length, 1, 'one capture request');
    assert.strictEqual(
      captureRequests[0].data.attributes.cardId,
      `${testRealmURL}task.json`,
    );
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      path: 'task.json',
      kind: 'card',
      format: 'isolated',
      width: 1,
      height: 1,
      attached: true,
    });
    assert.strictEqual(result.views.length, 1, 'the capture rides the result');
    assert.strictEqual(result.views[0].contentType, 'image/png');
    assert.true(result.views[0].url?.startsWith('mxc://'));
  });

  test('realm.view refuses a fourth capture in one run', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `for (let i = 0; i < 4; i++) { await realm.view('task.json'); }`,
      }),
      /realm\.view may capture at most 3 times in one run/,
    );
    assert.strictEqual(captureRequests.length, 3, 'three captures were taken');
  });

  test('realm.view refuses a path outside the realm', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.view('https://example.com/page.html');`,
      }),
      /Path is outside this realm/,
    );
    assert.strictEqual(captureRequests.length, 0, 'no capture is attempted');
  });

  test('replays a replacement against the source that was read', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = `${testRealmURL}task.json`;

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.replace(${JSON.stringify(fileUrl)}, '"Old title"', '"New title"');`,
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
      code: `await realm.fs.writeText(${JSON.stringify(fileUrl)}, '{\\n  "title": "New task"\\n}\\n');`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    let source = await cardService.getSource(new URL(fileUrl));
    assert.strictEqual(source.status, 200);
    assert.strictEqual(source.content, '{\n  "title": "New task"\n}\n');
  });

  test('resolves paths against the realm root', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = `${testRealmURL}task.json`;

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.fs.replace('task.json', '"count": 1', '"count": 2');`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      path: 'task.json',
      matches: 1,
      saved: true,
    });
    let source = await cardService.getSource(new URL(fileUrl));
    assert.true(source.content.includes('"count": 2'));
  });

  test('refuses paths outside the realm, and names the files it already saved', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = `${testRealmURL}task.json`;

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.replace('task.json', '"count": 1', '"count": 2');
await realm.fs.writeText('../elsewhere.json', '{}');`,
      }),
      /Path must be relative to the realm root.*Files already saved by this run: .*task\.json/,
    );
    // Writes save as they happen, so the replace before the bad path stays.
    let source = await cardService.getSource(new URL(fileUrl));
    assert.true(source.content.includes('"count": 2'));
  });

  test('reads a file inside the script and edits it from what it read', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `const task = JSON.parse(await realm.fs.readText('task.json'));
await realm.fs.replace('task.json', '"count": ' + task.count, '"count": ' + (task.count + 1));
return { exists: await realm.fs.exists('task.json'), missing: await realm.fs.exists('nope.json') };`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      exists: true,
      missing: false,
    });
    let source = await cardService.getSource(
      new URL(`${testRealmURL}task.json`),
    );
    assert.true(source.content.includes('"count": 2'));
  });

  test('each write is saved before the script goes on', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    // The script fails after its first write; that write is already in the
    // realm, not held back until the script ends.
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeText('first.json', '{}');
throw new Error('stop here');`,
      }),
      /stop here.*Files already saved by this run: .*first\.json/,
    );
    let source = await cardService.getSource(
      new URL(`${testRealmURL}first.json`),
    );
    assert.strictEqual(source.status, 200);
  });

  test('a caught failed write does not fail the run', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.replace('task.json', '"count": 1', '"count": 2');
try { await realm.fs.replace('task.json', 'not there', 'x'); } catch (e) {}
return 'done';`,
    });

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0]?.status, 'saved');
    let source = await cardService.getSource(
      new URL(`${testRealmURL}task.json`),
    );
    assert.true(source.content.includes('"count": 2'));
  });

  test('a caught failed read does not fail the run', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `let found = true;
try { await realm.fs.readText('new-task.json'); } catch (e) { found = false; }
if (!found) await realm.fs.writeText('new-task.json', '{}');
return found;`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    let source = await cardService.getSource(
      new URL(`${testRealmURL}new-task.json`),
    );
    assert.strictEqual(source.status, 200);
  });

  test('a realm call the script does not await fails the run, and the report says whether it saved', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let error: Error | undefined;
    try {
      await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `realm.fs.writeText('late.json', '{}');`,
      });
    } catch (e) {
      error = e as Error;
    }
    assert.ok(error, 'the run rejected');
    assert.true(
      /await every realm call/.test(error?.message ?? ''),
      `the error says to await every realm call: ${error?.message}`,
    );
    // The write races the end of the run: it is saved if it reaches the save
    // before the session closes, and refused if it does not. Either is
    // correct. What must hold is that the report and the realm agree, and
    // that nothing lands after the report.
    let reportedSaved = /Files already saved by this run: .*late\.json/.test(
      error?.message ?? '',
    );
    let reportedNoneSaved = /No file was saved/.test(error?.message ?? '');
    assert.notStrictEqual(
      reportedSaved,
      reportedNoneSaved,
      `the report says either that late.json was saved or that nothing was: ${error?.message}`,
    );
    await settled();
    let source = await cardService.getSource(
      new URL(`${testRealmURL}late.json`),
    );
    assert.strictEqual(
      source.status,
      reportedSaved ? 200 : 404,
      reportedSaved
        ? 'the file the report names as saved is in the realm'
        : 'the report said nothing was saved, and nothing landed after it',
    );
  });

  test('a script that never returns is stopped by the sandbox, not by the caller', async function (assert) {
    // The deadline belongs to QuickJS, which interrupts the script itself. The
    // caller's timer is only a backstop for a worker that stops answering, so a
    // runaway script must report the interrupt — a caller timeout here would
    // mean the budget is being spent on something other than the script.
    let error: Error | undefined;
    try {
      await runRealmCode(
        {
          code: 'while (true) {}',
          realmURL: testRealmURL,
          timeoutMs: 500,
        },
        async () => null,
      );
    } catch (e) {
      error = e as Error;
    }

    assert.ok(error, 'the run rejected');
    assert.strictEqual(error?.message, 'interrupted');
  });
});
