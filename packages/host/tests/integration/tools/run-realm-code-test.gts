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

  // `realm.capture` captures through the realm server; this answers every
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
              type: 'capture-result',
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
          'notes/first.md': '# First\n',
        },
      }),
    );
    await getService('realm').login(testRealmURL);
  });

  test('realm.capture attaches a capture to the result and tells the script only what it needs', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.capture('task.json');`,
    });

    assert.strictEqual(captureRequests.length, 1, 'one capture request');
    // `task.json` is plain JSON, not a card instance, so it is captured
    // through its file view.
    assert.strictEqual(
      captureRequests[0].data.attributes.fileURL,
      `${testRealmURL}task.json`,
    );
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      path: 'task.json',
      kind: 'file',
      format: 'isolated',
      width: 1,
      height: 1,
      attached: true,
    });
    assert.strictEqual(
      result.captures.length,
      1,
      'the capture rides the result',
    );
    assert.strictEqual(result.captures[0].contentType, 'image/png');
    assert.ok(result.captures[0].url, 'the capture is uploaded to the room');
  });

  test('the result attaches the files the run saved, then the captures it took', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('seen.json', '{}');
return await realm.capture('seen.json');`,
    });

    let attachments = command.resultAttachments(result);
    assert.deepEqual(
      attachments.map((file) => file.sourceUrl),
      [`${testRealmURL}seen.json`, result.captures[0].sourceUrl],
      'the saved file, then the capture',
    );
    assert.strictEqual(
      attachments[0].url,
      undefined,
      'the saved file is uploaded from the realm when the result is sent',
    );
    assert.strictEqual(
      attachments[1].url,
      result.captures[0].url,
      'the capture rides as the media already uploaded',
    );
  });

  test('realm.capture refuses a fourth capture in one run', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `for (let i = 0; i < 4; i++) { await realm.capture('task.json'); }`,
      }),
      /realm\.capture may run at most 3 times in one run/,
    );
    assert.strictEqual(captureRequests.length, 3, 'three captures were taken');
  });

  test('realm.capture refuses a path outside the realm', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.capture('https://example.com/page.html');`,
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

  test('lists a directory without counting toward the file limit', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return {
  root: await realm.fs.list(),
  notes: await realm.fs.list('notes'),
  notesWithSlash: await realm.fs.list('notes/'),
  notesByURL: await realm.fs.list(${JSON.stringify(`${testRealmURL}notes/`)}),
};`,
    });

    assert.deepEqual(result.files, [], 'a listing saves nothing');
    let listed = JSON.parse(result.scriptResult!);
    assert.deepEqual(
      listed.root.find((entry: { name: string }) => entry.name === 'task.json'),
      { name: 'task.json', path: 'task.json', kind: 'file' },
    );
    assert.deepEqual(
      listed.root.find((entry: { name: string }) => entry.name === 'notes'),
      { name: 'notes', path: 'notes/', kind: 'directory' },
    );
    let notes = [{ name: 'first.md', path: 'notes/first.md', kind: 'file' }];
    assert.deepEqual(listed.notes, notes);
    assert.deepEqual(listed.notesWithSlash, notes);
    assert.deepEqual(listed.notesByURL, notes);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.list('../');`,
      }),
      /Path must be relative to the realm root/,
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.list('missing');`,
      }),
      /Directory not found/,
    );
  });

  // The realm-server mock has no realm-creation endpoint, so `createRealm` is
  // stubbed to hand back the URL the server would mint for the endpoint, and
  // the realm-info fetch for the unmounted new realm is skipped.
  function stubWorkspaceCreation() {
    let calls: { endpoint: string; name: string }[] = [];
    let realmServer = getService('realm-server');
    realmServer.createRealm = async (args) => {
      calls.push(args);
      return new URL(`http://test-realm/testuser/${args.endpoint}/`);
    };
    getService('realm').ensureRealmMeta = async () => {};
    return calls;
  }

  test('realm.workspaces.create creates a workspace, returns its URL, and opens it after the run', async function (assert) {
    let createRealmCalls = stubWorkspaceCreation();
    let operatorModeStateService = getService('operator-mode-state-service');
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `let created = await realm.workspaces.create({ name: 'Sales Pipeline' });
return { created, realmAfterCreate: realm.current.url };`,
    });

    assert.deepEqual(
      createRealmCalls.map(({ endpoint, name }) => ({ endpoint, name })),
      [{ endpoint: 'sales-pipeline', name: 'Sales Pipeline' }],
      'the endpoint is derived from the name, as the create-workspace tool does',
    );
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      created: {
        url: 'http://test-realm/testuser/sales-pipeline/',
        name: 'Sales Pipeline',
      },
      realmAfterCreate: testRealmURL,
    });
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0]?.[0]?.id,
      'http://test-realm/testuser/sales-pipeline/index',
      'the new workspace is opened once the run ends',
    );
    assert.deepEqual(
      result.createdWorkspaces,
      ['http://test-realm/testuser/sales-pipeline/'],
      'the result names the created workspace',
    );
  });

  test('a failed run names the workspaces it created and opens none', async function (assert) {
    stubWorkspaceCreation();
    let operatorModeStateService = getService('operator-mode-state-service');
    let stackBefore = operatorModeStateService.state?.stacks[0]?.[0]?.id;
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.workspaces.create({ name: 'First Try' });
throw new Error('boom');`,
      }),
      /boom.*Workspaces already created by this run: http:\/\/test-realm\/testuser\/first-try\//,
    );
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0]?.[0]?.id,
      stackBefore,
      'no workspace is opened after a failed run',
    );
  });

  test('a run that saves files and creates a workspace stays in its realm', async function (assert) {
    stubWorkspaceCreation();
    let operatorModeStateService = getService('operator-mode-state-service');
    let stackBefore = operatorModeStateService.state?.stacks[0]?.[0]?.id;
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('notes/new-workspace.txt', 'hello');
await realm.workspaces.create({ name: 'Side Project' });`,
    });

    assert.deepEqual(result.createdWorkspaces, [
      'http://test-realm/testuser/side-project/',
    ]);
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0]?.[0]?.id,
      stackBefore,
      'the new workspace is not opened, so the next run defaults to this realm',
    );
  });

  test('realm.workspaces.create refuses options that are not strings', async function (assert) {
    let createRealmCalls = stubWorkspaceCreation();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.workspaces.create({ name: 42 });`,
      }),
      /expects name to be a string/,
    );
    assert.strictEqual(createRealmCalls.length, 0, 'no realm is created');
  });

  // The realm-server mock has no realm-deletion endpoint, so `deleteRealm` is
  // stubbed to record its argument. The workspace to delete is not mounted,
  // so its ownership is stubbed too.
  function stubWorkspaceDeletion(ownedRealmURL: string) {
    let calls: string[] = [];
    getService('realm-server').deleteRealm = async (realmURL) => {
      calls.push(realmURL);
    };
    let realmService = getService('realm');
    let isRealmOwner = realmService.isRealmOwner.bind(realmService);
    realmService.isRealmOwner = (url) =>
      url === ownedRealmURL || isRealmOwner(url);
    return calls;
  }

  test('a script that deletes a workspace always waits for the user', function (assert) {
    assert.true(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `await realm.workspaces.delete('http://test-realm/testuser/old/');`,
      }),
      'a run that names realm.workspaces.delete waits for a click',
    );
    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `await realm.fs.writeText('a.json', '{}');`,
      }),
      'other runs keep the room mode',
    );
    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor(undefined),
      'a call whose input has not arrived yet is not judged',
    );
  });

  test('realm.workspaces.delete deletes a workspace the user owns', async function (assert) {
    let oldWorkspace = 'http://test-realm/testuser/old/';
    let deleteRealmCalls = stubWorkspaceDeletion(oldWorkspace);
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.workspaces.delete('${oldWorkspace}');`,
    });

    assert.deepEqual(deleteRealmCalls, [oldWorkspace]);
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      url: oldWorkspace,
      deleted: true,
    });
  });

  test('the result names the deleted workspace when the script does not return it', async function (assert) {
    let oldWorkspace = 'http://test-realm/testuser/old/';
    stubWorkspaceDeletion(oldWorkspace);
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.workspaces.delete('${oldWorkspace}');`,
    });

    assert.deepEqual(result.deletedWorkspaces, [oldWorkspace]);
  });

  test('a failed run names the workspaces it deleted', async function (assert) {
    let oldWorkspace = 'http://test-realm/testuser/old/';
    stubWorkspaceDeletion(oldWorkspace);
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.workspaces.delete('${oldWorkspace}');
throw new Error('boom');`,
      }),
      /boom.*Workspaces already deleted by this run: http:\/\/test-realm\/testuser\/old\//,
    );
  });

  test('a workspace recreated at a URL the run deleted is opened', async function (assert) {
    let oldWorkspace = 'http://test-realm/testuser/old/';
    stubWorkspaceDeletion(oldWorkspace);
    stubWorkspaceCreation();
    let operatorModeStateService = getService('operator-mode-state-service');
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.workspaces.delete('${oldWorkspace}');
await realm.workspaces.create({ name: 'Old' });`,
    });

    assert.strictEqual(
      operatorModeStateService.state?.stacks[0]?.[0]?.id,
      `${oldWorkspace}index`,
    );
  });

  test('realm.workspaces.delete refuses a workspace the user does not own', async function (assert) {
    let deleteRealmCalls = stubWorkspaceDeletion(
      'http://test-realm/testuser/old/',
    );
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.workspaces.delete('http://test-realm/someone-else/theirs/');`,
      }),
      /the current user is not its owner/,
    );
    assert.deepEqual(deleteRealmCalls, [], 'no realm is deleted');
  });

  test('a script that reaches realm.workspaces.delete another way is refused', async function (assert) {
    let oldWorkspace = 'http://test-realm/testuser/old/';
    let deleteRealmCalls = stubWorkspaceDeletion(oldWorkspace);
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    let code = `let workspaces = realm.workspaces;
await workspaces['del' + 'ete']('${oldWorkspace}');`;

    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor({ code }),
      'this run would not wait for a click',
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      }),
      /must be called by that name/,
    );
    assert.deepEqual(deleteRealmCalls, [], 'no realm is deleted');
  });
});
