import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_FALLBACK_MODELS,
} from '@cardstack/runtime-common/matrix-constants';

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
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const otherRealmURL = 'http://test-realm/test2/';

// A card instance written out by hand, so a test can match its exact text.
function recipeJSON(
  name: 'Recipe' | 'Chef',
  attributes: Record<string, string>,
  chef?: string,
  module = '../recipe',
  helpers: string[] = [],
): string {
  let relationships: Record<string, { links: { self: string } }> = {};
  if (chef) {
    relationships.chef = { links: { self: chef } };
  }
  helpers.forEach((helper, index) => {
    relationships[`helpers.${index}`] = { links: { self: helper } };
  });
  return `${JSON.stringify(
    {
      data: {
        type: 'card',
        attributes,
        ...(Object.keys(relationships).length ? { relationships } : {}),
        meta: { adoptsFrom: { module, name } },
      },
    },
    null,
    2,
  )}\n`;
}

module('Integration | tools | run-realm-code', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    activeRealms: [testRealmURL, otherRealmURL],
    autostart: true,
  });

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
          'skills/test-skill/SKILL.md': `---
name: Test Skill
description: A skill a script turns on
boxel:
  kind: skill
---
# Test Skill
`,
          'pet.gts': `
            import { CardDef, field, contains } from '@cardstack/base/card-api';
            import StringField from '@cardstack/base/string';

            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field name = contains(StringField);
            }
          `,
          'Pet/mango.json': {
            data: {
              type: 'card',
              attributes: { name: 'Mango' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
          'Plain/base-typed.json': {
            data: {
              type: 'card',
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
          'recipe.gts': `
            import { contains, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class Chef extends CardDef {
              static displayName = 'Chef';
              @field name = contains(StringField);
              @field cardTitle = contains(StringField, {
                computeVia: function (this: Chef) {
                  return this.name;
                },
              });
            }

            export class Recipe extends CardDef {
              static displayName = 'Recipe';
              @field name = contains(StringField);
              @field cuisine = contains(StringField);
              @field chef = linksTo(Chef);
              @field helpers = linksToMany(Chef);
              @field cardTitle = contains(StringField, {
                computeVia: function (this: Recipe) {
                  return 'Recipe: ' + this.name;
                },
              });
            }
          `,
          'person.gts': `
            import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class Person extends CardDef {
              @field firstName = contains(StringField);
              @field friend = linksTo(() => Person);
              @field cardTitle = contains(StringField, {
                computeVia: function (this: Person) {
                  return this.firstName;
                },
              });
            }
          `,
          'Chef/ana.json': recipeJSON('Chef', { name: 'Ana' }),
          'Recipe/pancakes.json': recipeJSON(
            'Recipe',
            { name: 'Pancakes', cuisine: 'unknown' },
            '../Chef/ana',
          ),
          'Recipe/ramen.json': recipeJSON(
            'Recipe',
            { name: 'Ramen', cuisine: 'Japanese' },
            undefined,
            '../recipe',
            ['../Chef/ana'],
          ),
          'Recipe/desserts/tiramisu.json': recipeJSON(
            'Recipe',
            { name: 'Tiramisu', cuisine: 'unknown' },
            undefined,
            '../../recipe',
          ),
          'people/hassan.json': {
            data: {
              attributes: { firstName: 'Hassan' },
              relationships: {
                friend: { links: { self: './mango' } },
              },
              meta: {
                adoptsFrom: { module: '../person', name: 'Person' },
              },
            },
          },
          'people/mango.json': {
            data: {
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: '../person', name: 'Person' },
              },
            },
          },
        },
      }),
    );
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: otherRealmURL,
        contents: {
          'Recipe/elsewhere.json': recipeJSON(
            'Recipe',
            { name: 'Elsewhere', cuisine: 'unknown' },
            undefined,
            `${testRealmURL}recipe`,
          ),
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

  test('opens the card the script returns to show', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({ stacks: [[]], submode: 'interact' });
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('Pet/biscuit.json', JSON.stringify({
  data: {
    attributes: { name: 'Biscuit' },
    meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
  },
}));
return { show: 'Pet/biscuit' };`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved');
    assert.strictEqual(result.shownCard, `${testRealmURL}Pet/biscuit`);
    assert.notOk(result.showError);
    let shownIds = operatorModeStateService.state.stacks
      .flat()
      .map((item) => item.id);
    assert.true(
      shownIds.includes(`${testRealmURL}Pet/biscuit`),
      'the card is open on a stack',
    );
  });

  test('show opens a file that is not a card in code mode', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({ stacks: [[]], submode: 'interact' });
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return { show: 'notes/first.md' };`,
    });

    assert.strictEqual(result.shownCard, `${testRealmURL}notes/first.md`);
    assert.notOk(result.showError);
    assert.strictEqual(operatorModeStateService.state.submode, 'code');
    assert.strictEqual(
      operatorModeStateService.state.codePath?.href,
      `${testRealmURL}notes/first.md`,
    );
  });

  test('a card it cannot show does not fail the run', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({ stacks: [[]], submode: 'interact' });
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('seen.json', '{}');
return { show: 'Pet/missing' };`,
    });

    assert.strictEqual(result.files[0]?.status, 'saved', 'files still report');
    assert.notOk(result.shownCard);
    assert.true(
      /Not found: .*Pet\/missing/.test(result.showError ?? ''),
      `says why: ${result.showError}`,
    );

    let outside = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return { show: 'https://example.com/card' };`,
    });
    assert.true(
      /Path is outside this realm/.test(outside.showError ?? ''),
      `refuses another realm: ${outside.showError}`,
    );
    assert.deepEqual(
      operatorModeStateService.state.stacks.flat(),
      [],
      'nothing is opened',
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

  test('realm.cards.get returns a card as data, with computed fields and absolute URLs', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return {
  bare: await realm.cards.get('people/hassan'),
  withExtension: await realm.cards.get('people/hassan.json'),
  byURL: await realm.cards.get(${JSON.stringify(`${testRealmURL}people/hassan`)}),
};`,
    });

    assert.deepEqual(result.files, [], 'reading a card saves nothing');
    let { bare, withExtension, byURL } = JSON.parse(result.scriptResult!);
    assert.strictEqual(bare.path, 'people/hassan.json');
    assert.strictEqual(bare.id, `${testRealmURL}people/hassan`);
    assert.deepEqual(bare.type, {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    assert.strictEqual(bare.attributes.firstName, 'Hassan');
    assert.strictEqual(
      bare.attributes.cardTitle,
      'Hassan',
      'computed fields are included',
    );
    assert.deepEqual(
      bare.relationships,
      { friend: `${testRealmURL}people/mango` },
      'links are keyed by field path, as realm.cards.search returns them',
    );
    assert.deepEqual(withExtension, bare, 'a .json path reads the same card');
    assert.deepEqual(byURL, bare, 'a URL reads the same card');

    let afterEdit = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.cards.get('people/hassan');
await realm.fs.replace('people/hassan.json', '"Hassan"', '"Hassan Abdel"');
return await realm.cards.get('people/hassan');`,
    });
    assert.strictEqual(
      JSON.parse(afterEdit.scriptResult!).attributes.firstName,
      'Hassan Abdel',
      'a card read after an edit in the same run shows the edit',
    );

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.cards.get('people/missing');`,
      }),
      /Card not found/,
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.cards.get('https://example.com/card');`,
      }),
      /Path is outside this realm/,
    );
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

  test('realm.fs.writeBytes saves the decoded bytes of a new binary file', async function (assert) {
    let toolService = getService('tool-service');
    let network = getService('network');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `let saved = await realm.fs.writeBytes('images/dot.png', ${JSON.stringify(PNG_BASE64)});
return { saved, exists: await realm.fs.exists('images/dot.png') };`,
    });

    let expected = Uint8Array.from(atob(PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      saved: { path: 'images/dot.png', size: expected.byteLength, saved: true },
      exists: true,
    });
    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status, file.detail]),
      [[`${testRealmURL}images/dot.png`, 'saved', 'Binary file saved.']],
    );
    let response = await network.authedFetch(
      new URL('images/dot.png', testRealmURL),
    );
    assert.strictEqual(response.status, 200);
    assert.deepEqual(
      Array.from(new Uint8Array(await response.arrayBuffer())),
      Array.from(expected),
      'the realm holds the decoded bytes',
    );
  });

  test('realm.fs.writeBytes accepts a base64 data URL', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.fs.writeBytes('dot.png', ${JSON.stringify(
        `data:image/png;base64,${PNG_BASE64}`,
      )});`,
    });

    assert.true(JSON.parse(result.scriptResult!).saved);
  });

  test('realm.fs.writeBytes refuses a file that exists, and content that is not base64', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeBytes('task.json', ${JSON.stringify(PNG_BASE64)});`,
      }),
      /File already exists/,
      'refuses an existing text file',
    );
    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeBytes('dot.png', ${JSON.stringify(PNG_BASE64)});`,
    });
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeBytes('dot.png', ${JSON.stringify(PNG_BASE64)});`,
      }),
      /File already exists/,
      'refuses an existing binary file',
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeBytes('bad.png', 'not base64!');`,
      }),
      /not valid base64/,
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.readText('dot.png');`,
      }),
      /is a binary file/,
      'readText names a binary file instead of failing on its status',
    );
    // A vendor binary type, such as a spreadsheet, is binary too, so replace
    // cannot write a text-decoded copy over it.
    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeBytes('report.xlsx', ${JSON.stringify(PNG_BASE64)});`,
    });
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.replace('report.xlsx', 'a', 'b');`,
      }),
      /is a binary file/,
      'replace refuses a vendor binary type',
    );
  });

  test('realm.fs.writeBytes refuses a file over the size limit', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    // The script builds the base64 itself: it is larger than the code limit.
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeBytes('big.bin', 'AAAA'.repeat(700000));`,
      }),
      /at most 2000000 bytes per file.*No file was saved/,
    );
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

  module('room actions', function (hooks) {
    let roomId: string;
    let skillId = `${testRealmURL}skills/test-skill/SKILL.md`;
    let model = DEFAULT_FALLBACK_MODELS[0].modelId;

    hooks.beforeEach(async function () {
      await getService('matrix-service').ready;
      roomId = mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-actions',
      });
    });

    test('room actions change the room after the script finishes', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      let result = await command.execute({
        realm: testRealmURL,
        roomId,
        code: `return {
  skills: await room.enableSkills([${JSON.stringify(skillId)}]),
  model: await room.setModel(${JSON.stringify(model)}),
};`,
      });

      assert.deepEqual(JSON.parse(result.scriptResult!), {
        skills: { enable: [skillId], appliedAfterRun: true },
        model: { model, appliedAfterRun: true },
      });
      let skills = mockMatrixUtils.getRoomState(
        roomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      );
      assert.deepEqual(
        skills.enabledSkillCards.map((file: any) => file.sourceUrl),
        [skillId],
        'the skill is enabled',
      );
      assert.strictEqual(
        mockMatrixUtils.getRoomState(roomId, APP_BOXEL_ACTIVE_LLM)?.model,
        model,
        'the model is set',
      );
      assert.deepEqual(result.roomChanges, [
        `Enabled skills: ${skillId}`,
        `Model set to ${model}`,
      ]);

      await command.execute({
        realm: testRealmURL,
        roomId,
        code: `await room.disableSkills([${JSON.stringify(skillId)}]);`,
      });
      skills = mockMatrixUtils.getRoomState(
        roomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      );
      assert.deepEqual(skills.enabledSkillCards, [], 'the skill is disabled');
      assert.deepEqual(
        skills.disabledSkillCards.map((file: any) => file.sourceUrl),
        [skillId],
      );
    });

    test('a run that fails makes no room change', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId,
          code: `await room.enableSkills([${JSON.stringify(skillId)}]);
throw new Error('stop');`,
        }),
        /stop\. No file was saved\. The room changes it asked for were not made\./,
      );
      assert.notOk(
        mockMatrixUtils
          .getRoomEvents(roomId)
          .some((event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE),
        'the room skills are not changed',
      );
    });

    test('room actions refuse a skill that does not exist and an unknown model', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId,
          code: `await room.enableSkills([${JSON.stringify(`${testRealmURL}notes/first.md`)}]);`,
        }),
        /Not a skill card or skill markdown file/,
      );
      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId,
          code: `await room.setModel('no-such/model');`,
        }),
        /Unknown model: no-such\/model/,
      );
    });
  });

  test('realm.ui actions run in order after the script finishes', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `let queued = await realm.ui.openFile('pet.gts');
await realm.ui.previewFormat('Pet/mango', 'fitted');
return queued;`,
    });

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      action: 'openFile',
      runs: 'after the script finishes',
    });
    assert.deepEqual(
      result.uiActions.map(({ action, target, status }) => ({
        action,
        target,
        status,
      })),
      [
        {
          action: 'openFile',
          target: `${testRealmURL}pet.gts`,
          status: 'done',
        },
        {
          action: 'previewFormat',
          target: `${testRealmURL}Pet/mango (fitted)`,
          status: 'done',
        },
      ],
    );
    assert.strictEqual(operatorModeStateService.state.submode, 'code');
    assert.strictEqual(
      operatorModeStateService.state.codePath?.href,
      `${testRealmURL}pet.gts`,
    );
    assert.strictEqual(
      operatorModeStateService.state.moduleInspector,
      'preview',
    );
    let selection = getService('playground-panel-service').getSelection(
      `${testRealmURL}pet/Pet`,
    );
    assert.strictEqual(selection?.cardId, `${testRealmURL}Pet/mango`);
    assert.strictEqual(selection?.format, 'fitted');

    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.ui.switchSubmode('interact');`,
    });
    assert.strictEqual(operatorModeStateService.state.submode, 'interact');
  });

  test('realm.ui.previewFormat uses the base module of a card whose type comes from base', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let baseModule = getService('network').virtualNetwork.toURL(
      '@cardstack/base/card-api.gts',
    ).href;

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.ui.previewFormat('Plain/base-typed', 'isolated');`,
    });

    // The test user cannot read the base realm, so code mode refuses to open
    // it. What matters is which module the action asked for: the base module,
    // not a path inside the workspace.
    let detail = result.uiActions[0]?.detail ?? '';
    assert.true(
      detail.includes(baseModule),
      `asks for ${baseModule}: ${detail}`,
    );
    assert.false(
      detail.includes(`${testRealmURL}Plain/`),
      'does not join the module to the instance path',
    );
  });

  test('realm.ui opens a file the same run wrote', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('notes/second.md', '# Second\\n');
await realm.ui.openFile('notes/second.md');`,
    });

    assert.strictEqual(result.uiActions[0]?.status, 'done');
    assert.strictEqual(
      operatorModeStateService.state.codePath?.href,
      `${testRealmURL}notes/second.md`,
    );
  });

  test('realm.ui refuses a missing file, a path outside the realm, and a file that is not a card', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let run = (code: string) =>
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });

    await assert.rejects(
      run(`await realm.ui.openFile('missing.gts');`),
      /File not found/,
    );
    await assert.rejects(
      run(`await realm.ui.openFile('../elsewhere.gts');`),
      /Path must be relative to the realm root/,
    );
    await assert.rejects(
      run(`await realm.ui.previewFormat('task', 'isolated');`),
      /Not a card instance/,
    );
    await assert.rejects(
      run(`await realm.ui.previewFormat('Pet/mango', 'head');`),
      /one of these formats/,
    );
    await assert.rejects(
      run(`await realm.ui.switchSubmode('host');`),
      /expects 'interact' or 'code'/,
    );
  });

  test('a failed run does not do its realm.ui actions', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let submodeBefore = operatorModeStateService.state.submode;

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.ui.openFile('pet.gts');
throw new Error('stop here');`,
      }),
      /stop here\. No file was saved\. The UI actions it asked for were not done\./,
    );
    assert.strictEqual(operatorModeStateService.state.submode, submodeBefore);
  });

  module('realm.cards.search', function () {
    const recipeRef = `{ module: ${JSON.stringify(`${testRealmURL}recipe`)}, name: 'Recipe' }`;

    async function run(code: string) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);
      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });
      return { result, value: JSON.parse(result.scriptResult!) };
    }

    test('returns each card as plain data the script can use', async function (assert) {
      let { result, value } = await run(
        `return await realm.cards.search({ filter: { eq: { name: 'Pancakes' }, on: ${recipeRef} } });`,
      );

      assert.deepEqual(result.files, [], 'a search saves nothing');
      assert.strictEqual(value.total, 1);
      assert.false(value.truncated);
      assert.strictEqual(value.cards.length, 1);
      let [card] = value.cards;
      assert.strictEqual(card.id, `${testRealmURL}Recipe/pancakes`);
      assert.strictEqual(card.path, 'Recipe/pancakes.json');
      assert.deepEqual(card.type, {
        module: `${testRealmURL}recipe`,
        name: 'Recipe',
      });
      assert.strictEqual(card.attributes.name, 'Pancakes');
      assert.strictEqual(card.attributes.cuisine, 'unknown');
      assert.strictEqual(
        card.attributes.cardTitle,
        'Recipe: Pancakes',
        'computed values come from the index',
      );
      assert.strictEqual(
        card.relationships.chef,
        `${testRealmURL}Chef/ana`,
        'a link is the full URL of the card it names',
      );
    });

    test('a linksToMany field reports each link under its field path', async function (assert) {
      let { value } = await run(
        `return (await realm.cards.search({ filter: { eq: { name: 'Ramen' }, on: ${recipeRef} } })).cards[0].relationships;`,
      );

      assert.strictEqual(value['helpers.0'], `${testRealmURL}Chef/ana`);
    });

    test('a script can search, then read and edit every card it found', async function (assert) {
      let { result, value } = await run(`
const { cards } = await realm.cards.search({ filter: { eq: { cuisine: 'unknown' }, on: ${recipeRef} } });
for (const card of cards) {
  await realm.fs.replace(card.path, '"cuisine": "unknown"', '"cuisine": "Italian"');
}
return cards.map((card) => card.path);`);

      assert.deepEqual(value, [
        'Recipe/desserts/tiramisu.json',
        'Recipe/pancakes.json',
      ]);
      assert.deepEqual(
        result.files.map((file) => file.fileUrl),
        [
          `${testRealmURL}Recipe/desserts/tiramisu.json`,
          `${testRealmURL}Recipe/pancakes.json`,
        ],
      );
      let source = await getService('card-service').getSource(
        new URL(`${testRealmURL}Recipe/desserts/tiramisu.json`),
      );
      assert.true(source.content.includes('"cuisine": "Italian"'));
    });

    test('a type from a result is a type a query can search for', async function (assert) {
      let { value } = await run(`
const { cards: [pancakes] } = await realm.cards.search({ filter: { eq: { name: 'Pancakes' }, on: ${recipeRef} } });
const { cards } = await realm.cards.search({ filter: { type: pancakes.type } });
return cards.map((card) => card.path);`);

      assert.deepEqual(value, [
        'Recipe/desserts/tiramisu.json',
        'Recipe/pancakes.json',
        'Recipe/ramen.json',
      ]);
    });

    test('pages through the results and says when a page cut the list', async function (assert) {
      let { value } = await run(`
const first = await realm.cards.search({ filter: { type: ${recipeRef} }, page: { size: 2 } });
const second = await realm.cards.search({ filter: { type: ${recipeRef} }, page: { size: 2, number: 1 } });
return { first, second };`);

      assert.strictEqual(value.first.total, 3);
      assert.true(value.first.truncated);
      assert.deepEqual(
        value.first.cards.map((card: { path: string }) => card.path),
        ['Recipe/desserts/tiramisu.json', 'Recipe/pancakes.json'],
      );
      assert.false(
        value.second.truncated,
        'no card matches past the last page',
      );
      assert.deepEqual(
        value.second.cards.map((card: { path: string }) => card.path),
        ['Recipe/ramen.json'],
      );
    });

    test('searches only the realm the script runs in', async function (assert) {
      let { value } = await run(
        `return (await realm.cards.search({ filter: { type: ${recipeRef} } })).cards.map((card) => card.id);`,
      );
      assert.false(
        value.some((id: string) => id.startsWith(otherRealmURL)),
        "another realm's cards are not returned",
      );

      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);
      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.cards.search({ filter: { type: ${recipeRef} }, realms: [${JSON.stringify(otherRealmURL)}] });`,
        }),
        /realm\.cards\.search searches only this realm/,
      );
    });

    test('an invalid query rejects, and a script that catches it carries on', async function (assert) {
      let { value } = await run(`
let message;
try { await realm.cards.search({ filter: { type: ${recipeRef} }, limit: 10 }); } catch (e) { message = e.message; }
return { message, found: (await realm.cards.search({ filter: { type: ${recipeRef} } })).total };`);

      assert.true(
        /unknown field in query: limit/.test(value.message),
        `the bad query was refused: ${value.message}`,
      );
      assert.strictEqual(value.found, 3, 'the next search still ran');
    });

    test('a search does not count toward the file limit', async function (assert) {
      let { value } = await run(`
await realm.cards.search({ filter: { type: ${recipeRef} } });
let found = 0;
for (let i = 0; i < 20; i++) {
  if (!(await realm.fs.exists('missing-' + i + '.json'))) found++;
}
return found;`);

      assert.strictEqual(value, 20);
    });

    test('a search a realm did not answer fails instead of finding nothing', async function (assert) {
      let store = getService('store');
      let searchEntries = store.searchEntries;
      store.searchEntries = async () => ({
        data: [],
        meta: { page: { total: 0 }, incomplete: true },
      });
      try {
        let toolService = getService('tool-service');
        let command = new RunRealmCodeTool(toolService.toolContext);
        await assert.rejects(
          command.execute({
            realm: testRealmURL,
            roomId: '!room:example.com',
            code: `await realm.cards.search({ filter: { type: ${recipeRef} } });`,
          }),
          /did not answer/,
        );
      } finally {
        store.searchEntries = searchEntries;
      }
    });
  });
});

module(
  'Integration | tools | run-realm-code | read-only workspace',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      autostart: true,
      realmPermissions: { [testRealmURL]: ['read'] },
    });
    setupRealmCacheTeardown(hooks);

    hooks.beforeEach(async function () {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        enforcePermissions: true,
        permissions: { '*': ['read'] },
        contents: {
          'task.json': '{ "title": "Old title" }\n',
          'notes/first.md': '# First\n',
          'pet.gts': `
            import { CardDef, field, contains } from '@cardstack/base/card-api';
            import StringField from '@cardstack/base/string';

            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field name = contains(StringField);
            }
          `,
          'Pet/mango.json': {
            data: {
              type: 'card',
              attributes: { name: 'Mango' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
        },
      });
      await getService('realm').login(testRealmURL);
    });

    test('a script reads a workspace the user can only read', async function (assert) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `return {
  text: await realm.fs.readText('task.json'),
  exists: await realm.fs.exists('task.json'),
  notes: await realm.fs.list('notes'),
};`,
      });

      assert.deepEqual(result.files, [], 'nothing is saved');
      assert.deepEqual(JSON.parse(result.scriptResult!), {
        text: '{ "title": "Old title" }\n',
        exists: true,
        notes: [{ name: 'first.md', path: 'notes/first.md', kind: 'file' }],
      });
    });

    test('a script searches a workspace the user can only read', async function (assert) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `let found = await realm.cards.search({
  filter: { type: { module: ${JSON.stringify(`${testRealmURL}pet`)}, name: 'Pet' } },
});
return { total: found.total, paths: found.cards.map((card) => card.path) };`,
      });

      assert.deepEqual(result.files, [], 'nothing is saved');
      assert.deepEqual(JSON.parse(result.scriptResult!), {
        total: 1,
        paths: ['Pet/mango.json'],
      });
    });

    test('each write is refused, and the script goes on', async function (assert) {
      let toolService = getService('tool-service');
      let cardService = getService('card-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `let refused = [];
try { await realm.fs.writeText('new.json', '{}'); } catch (e) { refused.push(e.message); }
try { await realm.fs.replace('task.json', 'Old', 'New'); } catch (e) { refused.push(e.message); }
return { refused, text: await realm.fs.readText('task.json') };`,
      });

      assert.deepEqual(result.files, [], 'nothing is saved');
      let { refused, text } = JSON.parse(result.scriptResult!);
      assert.strictEqual(refused.length, 2, 'both writes are refused');
      for (let message of refused) {
        assert.true(
          /You can only read this workspace/.test(message),
          `the refusal says why: ${message}`,
        );
      }
      assert.strictEqual(text, '{ "title": "Old title" }\n');
      let source = await cardService.getSource(
        new URL(`${testRealmURL}new.json`),
      );
      assert.strictEqual(
        source.status,
        404,
        'the new file is not in the realm',
      );
    });

    test('a write the script does not catch fails the run, and the report says nothing was saved', async function (assert) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.fs.writeText('new.json', '{}');`,
        }),
        /You can only read this workspace.*No file was saved/,
      );
    });
  },
);
