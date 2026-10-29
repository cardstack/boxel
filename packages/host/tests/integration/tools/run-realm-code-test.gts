import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  CAPTURE_SOURCE_URL_PREFIX,
  DEFAULT_FALLBACK_MODELS,
} from '@cardstack/runtime-common/matrix-constants';

import runRealmCode from '@cardstack/host/lib/realm-runner/runner';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  createJWT,
  resetCatalogRealmURL,
  setCatalogRealmURL,
  testRealmSecretSeed,
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef } from '@cardstack/base/card-api';

const otherRealmURL = 'http://test-realm/test2/';

// Makes the realm service know a workspace the user can read under
// `identifier`, without a realm behind it: the capture endpoint is stubbed,
// so only the realm service's view of the workspace matters.
function knowReadableWorkspace(
  identifier: string,
  permissions: ('read' | 'write')[] = ['read'],
) {
  getService('realm').getOrCreateRealmResource(
    identifier,
    createJWT(
      {
        user: '@testuser:localhost',
        realm: identifier,
        sessionRoom: 'boxel-session-room-id',
        permissions,
        realmServerURL: 'http://test-realm/',
      },
      '1d',
      testRealmSecretSeed,
    ),
    { exact: true },
  );
}

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

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

  let adapter: any;

  hooks.beforeEach(async function () {
    ({ adapter } = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'task.json': `{
  "title": "Old title",
  "count": 1
}
`,
          'notes/first.md': '# First\n',
          'images/existing.png': Uint8Array.from(atob(PNG_BASE64), (char) =>
            char.charCodeAt(0),
          ),
          // A zip local-file header followed by bytes that are not UTF-8.
          'docs/report.docx': Uint8Array.from([
            0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0xff, 0xfe, 0x9c,
          ]),
          'docs/README': 'Plain text with no extension\n',
          'docs/replacement.txt': 'A replacement character: \uFFFD\n',
          // "café" in Latin-1, which is not UTF-8.
          'docs/latin1.txt': Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
          'unformatted.gts': `import { CardDef } from "@cardstack/base/card-api"
export class Unformatted extends CardDef {}
`,
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
          'Spec/pet.json': {
            data: {
              type: 'card',
              attributes: {
                cardTitle: 'Pet',
                cardDescription: 'A pet with a name',
                specType: 'card',
                readMe: '# Pet\n\nUse Pet for any animal with a name.',
                ref: { module: '../pet', name: 'Pet' },
              },
              meta: {
                adoptsFrom: { module: '@cardstack/base/spec', name: 'Spec' },
              },
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
    ));
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
      viewportWidth: 1280,
      viewportHeight: 800,
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

  test('Stop ends a run that waits on realm.ask', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let asked = false;
    // The reader never answers.
    command.onAsk = () => {
      asked = true;
      return new Promise(() => undefined);
    };

    let run = command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.ask({ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] });
return 'answered';`,
    });
    await waitUntil(() => asked);
    command.stop();

    await assert.rejects(run, /stopped/i, 'the run ends without an answer');
  });

  // The tool service is what puts a run's question to the reader: the row
  // shows its picker from `scriptAsks` and answers through it.
  function askThroughToolService(command: RunRealmCodeTool, callId: string) {
    let toolService = getService('tool-service') as unknown as {
      askFromScript: (
        id: string,
        request: unknown,
      ) => ReturnType<NonNullable<RunRealmCodeTool['onAsk']>>;
    };
    command.onAsk = (request) => toolService.askFromScript(callId, request);
  }

  test("a reader's pick reaches the script as its value and its label", async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    askThroughToolService(command, 'ask-call');

    let run = command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.ask({ question: 'Which one?', options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] });`,
    });
    // the sandbox starts before the script asks, slowly on a busy machine
    await waitUntil(() => toolService.scriptAsks.has('ask-call'), {
      timeout: 10000,
    });
    let ask = toolService.scriptAsks.get('ask-call')!;
    assert.strictEqual(ask.request.question, 'Which one?');
    ask.answer('b');

    let result = await run;
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      answer: 'b',
      label: 'Beta',
    });
    assert.false(
      toolService.scriptAsks.has('ask-call'),
      'the answered question is gone',
    );
  });

  test("Stop through the tool service withdraws the run's question", async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    askThroughToolService(command, 'stopped-ask-call');
    (
      toolService as unknown as {
        stoppableTools: Map<string, { roomId: string; stop: () => void }>;
      }
    ).stoppableTools.set('stopped-ask-call', {
      roomId: '!room:example.com',
      stop: () => command.stop(),
    });

    let run = command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.ask({ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] });
return 'answered';`,
    });
    // the sandbox starts before the script asks, slowly on a busy machine
    await waitUntil(() => toolService.scriptAsks.has('stopped-ask-call'), {
      timeout: 10000,
    });
    toolService.stopTool('stopped-ask-call');

    assert.false(
      toolService.scriptAsks.has('stopped-ask-call'),
      'the picker is withdrawn at once',
    );
    await assert.rejects(
      run,
      /stopped|ended/i,
      'the run ends without an answer',
    );
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
    assert.true(
      attachments[1].sourceUrl.startsWith(CAPTURE_SOURCE_URL_PREFIX),
      `the capture is named by a capture source URL, which keeps it out of correctness checks: ${attachments[1].sourceUrl}`,
    );
  });

  test('an edit that lint takes back is reported as unchanged, not saved', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let fileUrl = new URL(`${testRealmURL}tidy.gts`);
    let unusedImport = "\nimport NumberField from '@cardstack/base/number';";
    // the realm's lint deletes unused base imports; the test realm's lint
    // passes text through, so this one does just that
    let passThrough = adapter.lintStub;
    adapter.lintStub = async (request: Request) => ({
      output: (await request.text()).replace(unusedImport, ''),
      fixed: true,
      messages: [],
    });

    // a first run saves the module as lint leaves it
    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('tidy.gts', "import StringField from '@cardstack/base/string';\\nimport { CardDef, field, contains } from '@cardstack/base/card-api';\\n\\nexport class Tidy extends CardDef {\\n  @field name = contains(StringField);\\n}\\n");`,
    });
    let before = (await cardService.getSource(fileUrl)).content;

    // lint removes the unused import, which leaves the file as it was
    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.replace(
  'tidy.gts',
  "import StringField from '@cardstack/base/string';",
  "import StringField from '@cardstack/base/string';\\nimport NumberField from '@cardstack/base/number';",
);`,
    });

    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status]),
      [[fileUrl.href, 'unchanged']],
    );
    assert.deepEqual(
      command.resultAttachments(result),
      [],
      'an unchanged file is not attached, so no correctness check runs on it',
    );
    assert.strictEqual(
      (await cardService.getSource(fileUrl)).content,
      before,
      'the file was not written',
    );
    adapter.lintStub = passThrough;
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
      operatorModeStateService.state.codePath,
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

  test('realm.capture captures a card by its path or its id, with the options it is given', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return [
  await realm.capture('Pet/mango'),
  await realm.capture('${testRealmURL}Pet/mango', {
    format: 'embedded',
    viewportWidth: 600,
    viewportHeight: 400,
    target: '.name',
  }),
];`,
    });

    assert.strictEqual(captureRequests.length, 2, 'two capture requests');
    let [byPath, byId] = captureRequests.map((r) => r.data.attributes);
    assert.strictEqual(byPath.cardId, `${testRealmURL}Pet/mango`);
    assert.strictEqual(byId.cardId, `${testRealmURL}Pet/mango`);
    assert.strictEqual(byId.format, 'embedded');
    assert.deepEqual(byId.captureSpec, {
      viewport: { width: 600, height: 400 },
      target: '.name',
    });
    let [first, second] = JSON.parse(result.scriptResult!);
    assert.strictEqual(first.path, 'Pet/mango');
    assert.strictEqual(first.kind, 'card');
    assert.strictEqual(
      second.path,
      'Pet/mango',
      'a URL in the run realm is named by its path',
    );
    assert.strictEqual(second.format, 'embedded');
    assert.strictEqual(second.viewportWidth, 600);
    assert.strictEqual(second.viewportHeight, 400);
    assert.strictEqual(second.target, '.name');
    assert.strictEqual(first.target, undefined, 'a page capture has none');
    assert.strictEqual(result.captures.length, 2);
  });

  test('realm.capture refuses a URL outside every workspace', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.capture('https://example.com/page.html');`,
      }),
      /not in a workspace the user can read/,
    );
    assert.strictEqual(captureRequests.length, 0, 'no capture is attempted');
  });

  test('realm.capture finds the workspace of a prefixed id, whatever form the workspace is known by', async function (assert) {
    let { virtualNetwork } = getService('network');
    virtualNetwork.addRealmMapping(
      '@test/mapped/',
      'http://test-realm/mapped/',
    );
    try {
      knowReadableWorkspace('@test/mapped/');
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `return await realm.capture('@test/mapped/Pet/mango');`,
      });

      assert.strictEqual(captureRequests.length, 1, 'one capture request');
      let { realmURL, cardId } = captureRequests[0].data.attributes;
      assert.strictEqual(realmURL, 'http://test-realm/mapped/');
      assert.strictEqual(cardId, 'http://test-realm/mapped/Pet/mango');
      assert.strictEqual(
        JSON.parse(result.scriptResult!).path,
        '@test/mapped/Pet/mango',
        'the capture is named by the id the script gave',
      );
    } finally {
      virtualNetwork.removeRealmMapping('@test/mapped/');
    }
  });

  test('realm.capture asks a workspace nested under the run realm for its own card, and names it by its URL', async function (assert) {
    let nestedRealmURL = `${testRealmURL}nested/`;
    knowReadableWorkspace(nestedRealmURL);
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return [
  await realm.capture('${nestedRealmURL}Pet/mango'),
  await realm.capture('${testRealmURL}Pet/mango'),
];`,
    });

    assert.deepEqual(
      captureRequests.map((r) => r.data.attributes.realmURL),
      [nestedRealmURL, testRealmURL],
      'each capture is asked of the deepest workspace that holds it',
    );
    let [nested, own] = JSON.parse(result.scriptResult!);
    assert.strictEqual(
      nested.path,
      `${nestedRealmURL}Pet/mango`,
      'a card in the nested workspace keeps its URL',
    );
    assert.strictEqual(own.path, 'Pet/mango');
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

  test('realm.fs.delete deletes a file the same run created, and the result reports it', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeText('plan.md', '# Plan\\n');
await realm.fs.writeText('kept.md', '# Kept\\n');
await realm.fs.writeBytes('dot.png', ${JSON.stringify(PNG_BASE64)});
let deleted = [
  await realm.fs.delete('plan.md'),
  await realm.fs.delete('dot.png'),
];
return {
  deleted,
  planExists: await realm.fs.exists('plan.md'),
  dotExists: await realm.fs.exists('dot.png'),
};`,
    });

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      deleted: [
        { path: 'plan.md', deleted: true },
        { path: 'dot.png', deleted: true },
      ],
      planExists: false,
      dotExists: false,
    });
    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status]),
      [
        [`${testRealmURL}kept.md`, 'saved'],
        [`${testRealmURL}plan.md`, 'deleted'],
        [`${testRealmURL}dot.png`, 'deleted'],
      ],
    );
    assert.deepEqual(
      command
        .resultAttachments(result)
        .map((attachment) => attachment.sourceUrl),
      [`${testRealmURL}kept.md`],
      'a deleted file is not attached to the result',
    );
    for (let path of ['plan.md', 'dot.png']) {
      let source = await cardService.getSource(new URL(path, testRealmURL));
      assert.strictEqual(source.status, 404, `${path} is not in the realm`);
    }
  });

  test('realm.fs.delete refuses a binary file the run created when someone replaced it', async function (assert) {
    let toolService = getService('tool-service');
    let network = getService('network');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let dotURL = `${testRealmURL}dot.png`;
    let replacement = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);

    // A collaborator saves other bytes to the file right after the run
    // creates it.
    let real = network.authedFetch;
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        let response = await real(url, init);
        if (url === dotURL && init?.method === 'POST' && response.ok) {
          let replaced = await real(dotURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new Blob([replacement as BlobPart]),
          });
          assert.true(replaced.ok, 'the collaborator replaced the file');
        }
        return response;
      },
    });

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeBytes('dot.png', ${JSON.stringify(PNG_BASE64)});
try {
  await realm.fs.delete('dot.png');
  return 'deleted';
} catch (e) {
  return e.message;
}`,
    });

    assert.true(
      /File changed while the script ran: .*dot\.png/.test(
        JSON.parse(result.scriptResult!),
      ),
      `the delete is refused: ${result.scriptResult}`,
    );
    let response = await real(dotURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    assert.strictEqual(response.status, 200, 'dot.png is still in the realm');
    assert.deepEqual(
      Array.from(new Uint8Array(await response.arrayBuffer())),
      Array.from(replacement),
      "the collaborator's bytes are kept",
    );
  });

  test('a script that deletes a file always waits for the user', function (assert) {
    assert.true(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `await realm.fs.delete('notes/first.md');`,
      }),
      'a run that names realm.fs.delete waits for a click',
    );
    assert.true(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `await realm.fs.writeText('a.md', 'x'); await realm.fs.delete('a.md');`,
      }),
      'a run that deletes only its own file also waits for a click',
    );
    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `await realm.fs.writeText('a.md', 'x');`,
      }),
      'a run that deletes nothing keeps the room mode',
    );
  });

  test('realm.fs.delete deletes files that were there before the run, and the result reports them', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.readText('notes/first.md');
await realm.fs.replace('task.json', '"Old title"', '"New title"');
await realm.fs.writeText('plan.md', '# Plan\\n');
let deleted = [
  await realm.fs.delete('notes/first.md'),
  await realm.fs.delete('task.json'),
  await realm.fs.delete('images/existing.png'),
  await realm.fs.delete('plan.md'),
];
let refused = [];
try { await realm.fs.delete('notes/first.md'); } catch (e) { refused.push(e.message); }
try { await realm.fs.delete('missing.md'); } catch (e) { refused.push(e.message); }
try { await realm.fs.delete('notes/'); } catch (e) { refused.push(e.message); }
return { deleted, refused };`,
    });

    let { deleted, refused } = JSON.parse(result.scriptResult!);
    assert.deepEqual(deleted, [
      { path: 'notes/first.md', deleted: true },
      { path: 'task.json', deleted: true },
      { path: 'images/existing.png', deleted: true },
      { path: 'plan.md', deleted: true },
    ]);
    assert.true(
      /this run already deleted it: .*notes\/first\.md/.test(refused[0]),
      `a file the run already deleted: ${refused[0]}`,
    );
    assert.true(
      /File not found: .*missing\.md/.test(refused[1]),
      `a file that does not exist: ${refused[1]}`,
    );
    assert.true(
      /Path must be relative to the realm root: notes\//.test(refused[2]),
      `a folder: ${refused[2]}`,
    );
    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status, file.detail]),
      [
        [
          `${testRealmURL}plan.md`,
          'deleted',
          'Created by this run and then deleted.',
        ],
        [
          `${testRealmURL}notes/first.md`,
          'deleted',
          'Existed before this run; deleted.',
        ],
        [
          `${testRealmURL}task.json`,
          'deleted',
          'Existed before this run; deleted.',
        ],
        [
          `${testRealmURL}images/existing.png`,
          'deleted',
          'Existed before this run; deleted.',
        ],
      ],
    );
    for (let path of ['notes/first.md', 'task.json', 'images/existing.png']) {
      let source = await cardService.getSource(new URL(path, testRealmURL));
      assert.strictEqual(source.status, 404, `${path} is not in the realm`);
    }
  });

  test('realm.fs.delete refuses a file someone changed after the script read it', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let network = getService('network');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let noteURL = `${testRealmURL}notes/first.md`;

    // A collaborator saves other text to the file right after the script
    // reads it.
    let real = network.authedFetch;
    let changed = false;
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        let response = await real(url, init);
        if (url === noteURL && !init?.method && !changed) {
          changed = true;
          let replaced = await real(noteURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new Blob(['# Changed\n']),
          });
          assert.true(replaced.ok, 'the collaborator changed the file');
        }
        return response;
      },
    });

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.readText('notes/first.md');
try {
  await realm.fs.delete('notes/first.md');
  return 'deleted';
} catch (e) {
  return e.message;
}`,
    });

    assert.true(
      /File changed while the script ran: .*notes\/first\.md/.test(
        JSON.parse(result.scriptResult!),
      ),
      `the delete is refused: ${result.scriptResult}`,
    );
    let source = await cardService.getSource(new URL(noteURL));
    assert.strictEqual(source.status, 200, 'the file is still in the realm');
    assert.strictEqual(source.content, '# Changed\n', 'the change is kept');
  });

  test('a script that reaches realm.fs.delete another way is refused', async function (assert) {
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    let code = `await realm.fs['de' + 'lete']('notes/first.md');`;

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
    let source = await cardService.getSource(
      new URL('notes/first.md', testRealmURL),
    );
    assert.strictEqual(source.status, 200, 'the file is still in the realm');
  });

  test('a failed run names the files from before the run that it deleted', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.delete('notes/first.md');
await realm.fs.readText('missing.md');`,
      }),
      /Files that existed before this run and that it already deleted: .*notes\/first\.md/,
    );
  });

  test('a failed run names the files it created and deleted', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.writeText('plan.md', 'x');
await realm.fs.delete('plan.md');
await realm.fs.readText('missing.md');`,
      }),
      /No file was saved\. Files this run created and already deleted: .*plan\.md/,
    );
  });

  test('realm.fs.copy copies a file and leaves the source as it was', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.fs.copy('notes/first.md', 'notes/second.md');`,
    });

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      path: 'notes/second.md',
      saved: true,
    });
    assert.deepEqual(
      result.files.map((file) => [file?.fileUrl, file?.status]),
      [[`${testRealmURL}notes/second.md`, 'saved']],
    );
    let copy = await cardService.getSource(
      new URL(`${testRealmURL}notes/second.md`),
    );
    assert.strictEqual(copy.content, '# First\n');
    let source = await cardService.getSource(
      new URL(`${testRealmURL}notes/first.md`),
    );
    assert.strictEqual(source.content, '# First\n', 'the source is unchanged');
  });

  test('realm.fs.copy of a card instance in the same folder loads as the same card type', async function (assert) {
    let toolService = getService('tool-service');
    let store = getService('store');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.copy('Pet/mango.json', 'Pet/mango-copy.json');
await realm.fs.replace('Pet/mango-copy.json', '"Mango"', '"Mango Two"');`,
    });

    let copy = (await store.get(`${testRealmURL}Pet/mango-copy`)) as CardDef;
    assert.strictEqual((copy.constructor as typeof CardDef).displayName, 'Pet');
    assert.strictEqual((copy as any).name, 'Mango Two');
  });

  test('realm.fs.copy refuses an existing target, a missing source, and paths outside the realm', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let run = (code: string) =>
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });

    await assert.rejects(
      run(`await realm.fs.copy('notes/first.md', 'task.json');`),
      /File already exists: .*task\.json/,
    );
    let target = await cardService.getSource(
      new URL(`${testRealmURL}task.json`),
    );
    assert.true(
      target.content.includes('"Old title"'),
      'the existing target is unchanged',
    );
    await assert.rejects(
      run(`await realm.fs.copy('nope.md', 'copy.md');`),
      /File not found: .*nope\.md/,
    );
    await assert.rejects(
      run(`await realm.fs.copy('notes/first.md', '../elsewhere.md');`),
      /Path must be relative to the realm root/,
    );
    await assert.rejects(
      run(
        `await realm.fs.copy('https://example.com/other/first.md', 'copy.md');`,
      ),
      /Path is outside this realm/,
    );
  });

  test('realm.fs.copy refuses files that are not UTF-8 text', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    for (let [from, to] of [
      ['images/existing.png', 'images/existing-copy.png'],
      ['docs/report.docx', 'docs/report-copy.docx'],
      ['docs/latin1.txt', 'docs/latin1-copy.txt'],
    ]) {
      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.fs.copy('${from}', '${to}');`,
        }),
        /is a binary file/,
        `refuses ${from}`,
      );
      let copy = await cardService.getSource(new URL(`${testRealmURL}${to}`));
      assert.strictEqual(copy.status, 404, `no copy of ${from} is saved`);
    }
  });

  test('realm.fs.copy copies UTF-8 text byte for byte, whatever its content type', async function (assert) {
    let toolService = getService('tool-service');
    let network = getService('network');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let bytesOf = async (path: string) => {
      let response = await network.authedFetch(`${testRealmURL}${path}`, {
        headers: { Accept: 'application/vnd.card+source' },
      });
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    };

    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.copy('docs/README', 'docs/README-copy');
await realm.fs.copy('docs/replacement.txt', 'docs/replacement-copy.txt');
await realm.fs.copy('unformatted.gts', 'unformatted-copy.gts');`,
    });

    for (let path of [
      'docs/README',
      'docs/replacement.txt',
      'unformatted.gts',
    ]) {
      let copyPath = path.replace(/(\.[^./]+)?$/, '-copy$1');
      assert.deepEqual(
        await bytesOf(copyPath),
        await bytesOf(path),
        `${copyPath} has the same bytes as ${path}`,
      );
    }
  });

  test('a binary file exists, and is not overwritten', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let run = (code: string) =>
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });

    let result = await run(
      `return await realm.fs.exists('images/existing.png');`,
    );
    assert.true(JSON.parse(result.scriptResult!), 'exists returns true');
    await assert.rejects(
      run(`await realm.fs.copy('notes/first.md', 'images/existing.png');`),
      /File already exists: .*existing\.png/,
    );
    await assert.rejects(
      run(`await realm.fs.writeText('images/existing.png', 'text');`),
      /File already exists; use realm\.fs\.replace/,
    );
  });

  module('realm.fs.download', function (hooks) {
    // A source outside any realm, served by the virtual network so no real
    // network is used.
    const sourceURL = 'https://media.example/images/pet.png';
    let pngBytes = Uint8Array.from(atob(PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    let sourceRequests: string[];

    hooks.beforeEach(function () {
      sourceRequests = [];
      getService('network').virtualNetwork.mount(
        async (req: Request) => {
          if (!req.url.startsWith('https://media.example/')) {
            return null;
          }
          sourceRequests.push(req.url);
          if (req.url === sourceURL) {
            return new Response(pngBytes, {
              status: 200,
              headers: { 'Content-Type': 'image/png' },
            });
          }
          if (req.url.endsWith('/nine.bin')) {
            return new Response(new Uint8Array(9_000_000), {
              status: 200,
              headers: { 'Content-Type': 'application/octet-stream' },
            });
          }
          if (req.url.endsWith('/large.bin')) {
            return new Response(new Uint8Array(10_000_001), {
              status: 200,
              headers: { 'Content-Type': 'application/octet-stream' },
            });
          }
          return new Response('Not found', { status: 404 });
        },
        { prepend: true },
      );
    });

    test('saves the file at a URL into the realm', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );
      let code = `return await realm.fs.download('${sourceURL}', 'images/pet.png');`;
      assert.true(
        RunRealmCodeTool.neverAutoExecutesFor({ code }),
        'a run that names realm.fs.download waits for a click',
      );

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });

      assert.deepEqual(JSON.parse(result.scriptResult!), {
        path: 'images/pet.png',
        size: pngBytes.byteLength,
        saved: true,
      });
      assert.deepEqual(
        result.files.map((file) => [file.fileUrl, file.status, file.detail]),
        [[`${testRealmURL}images/pet.png`, 'saved', 'Binary file saved.']],
      );
      let response = await getService('network').authedFetch(
        new URL('images/pet.png', testRealmURL),
      );
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        Array.from(new Uint8Array(await response.arrayBuffer())),
        Array.from(pngBytes),
        'the realm holds the downloaded bytes',
      );
    });

    test('realm.fs.delete removes a file the same run downloaded', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.fs.download('${sourceURL}', 'images/pet.png');
return {
  deleted: await realm.fs.delete('images/pet.png'),
  exists: await realm.fs.exists('images/pet.png'),
};`,
      });

      assert.deepEqual(JSON.parse(result.scriptResult!), {
        deleted: { path: 'images/pet.png', deleted: true },
        exists: false,
      });
      assert.deepEqual(
        result.files.map((file) => [file.fileUrl, file.status]),
        [[`${testRealmURL}images/pet.png`, 'deleted']],
      );
    });

    test('refuses an existing file, a path with no extension, a source that is not http, and a failed download', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );
      let run = (code: string) =>
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code,
        });

      await assert.rejects(
        run(`await realm.fs.download('${sourceURL}', 'task.json');`),
        /File already exists/,
      );
      await assert.rejects(
        run(`await realm.fs.download('${sourceURL}', 'images/pet');`),
        /needs a path with a file extension/,
      );
      await assert.rejects(
        run(`await realm.fs.download('file:///etc/hosts', 'hosts.txt');`),
        /downloads only http and https URLs/,
      );
      assert.deepEqual(sourceRequests, [], 'nothing was fetched so far');
      await assert.rejects(
        run(
          `await realm.fs.download('https://media.example/missing.png', 'missing.png');`,
        ),
        /Unable to download https:\/\/media\.example\/missing\.png: 404.*No file was saved/,
      );
    });

    test('refuses a file over the size limit', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.fs.download('https://media.example/large.bin', 'large.bin');`,
        }),
        /at most 10000000 bytes per file.*No file was saved/,
      );
    });

    test('a download whose save fails still counts toward the per-run limit', async function (assert) {
      // Every save under failing/ fails after the download has arrived.
      getService('network').virtualNetwork.mount(
        async (req: Request) => {
          if (
            req.method === 'POST' &&
            req.url.startsWith(`${testRealmURL}failing/`)
          ) {
            return new Response('Server error', { status: 500 });
          }
          return null;
        },
        { prepend: true },
      );
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `let errors = [];
for (let name of ['a', 'b', 'c']) {
  try {
    await realm.fs.download('https://media.example/nine.bin', 'failing/' + name + '.bin');
  } catch (error) {
    errors.push(error.message);
  }
}
return errors;`,
      });

      let errors = JSON.parse(result.scriptResult!) as string[];
      assert.strictEqual(errors.length, 3, 'no save succeeded');
      assert.notOk(/per run/.test(errors[0]), errors[0]);
      assert.notOk(/per run/.test(errors[1]), errors[1]);
      assert.ok(
        /at most 25000000 bytes per run/.test(errors[2]),
        'the third download is over the bytes the failed saves left',
      );
    });

    test('a download the script did not await fails the run and is not fetched', async function (assert) {
      // Holds the destination lookup until the run has ended.
      getService('network').virtualNetwork.mount(
        async (req: Request) => {
          if (req.method === 'GET' && req.url === `${testRealmURL}late.png`) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          return null;
        },
        { prepend: true },
      );
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );

      // The download is still waiting on its lookup when the script
      // returns, so the run fails, as for any realm call not awaited. The
      // failure is reported only once that lookup has answered.
      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `realm.fs.download('${sourceURL}', 'late.png');
return 'done';`,
        }),
        /await every realm call/,
      );

      assert.deepEqual(sourceRequests, [], 'nothing is fetched');
      let response = await getService('network').authedFetch(
        new URL('late.png', testRealmURL),
      );
      assert.strictEqual(response.status, 404, 'nothing is saved');
    });

    test('a script that reaches realm.fs.download another way is refused', async function (assert) {
      let command = new RunRealmCodeTool(
        getService('tool-service').toolContext,
      );
      let code = `await realm.fs['down' + 'load']('${sourceURL}', 'pet.png');`;

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
        /realm\.fs\.download must be called by that name/,
      );
      assert.deepEqual(sourceRequests, [], 'nothing is fetched');
    });
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

  test('resolves paths against the realm root named without its trailing slash', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL.replace(/\/$/, ''),
      roomId: '!room:example.com',
      code: `return await realm.fs.readText('task.json');`,
    });

    assert.true(JSON.parse(result.scriptResult!).includes('"count"'));
  });

  test('refuses a folder in the realm as the realm, and names the root and the path to use', async function (assert) {
    let toolService = getService('tool-service');
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let folder = `${testRealmURL}card-mutation/relink/`;

    for (let realm of [folder, folder.replace(/\/$/, '')]) {
      await assert.rejects(
        command.execute({
          realm,
          roomId: '!room:example.com',
          code: `return await realm.fs.replace('task.json', '"count": 1', '"count": 2');`,
        }),
        (error: Error) =>
          error.message ===
          `${realm} is card-mutation/relink inside the workspace ${testRealmURL}, ` +
            `not its root. Pass ${testRealmURL} as realm, and name each file ` +
            `by its path from there: card-mutation/relink for that file, ` +
            `card-mutation/relink.json for that card, or card-mutation/relink/ and the ` +
            `file's name for a file in that folder`,
      );
    }
    let source = await cardService.getSource(
      new URL(`${testRealmURL}task.json`),
    );
    assert.true(
      source.content.includes('"count": 1'),
      'the script does not run against the root',
    );
  });

  test('refuses a file or card in the realm as the realm, and names it by its path from the root', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    for (let local of [
      'Event/intro-to-pottery.json',
      'Event/intro-to-pottery',
      'docs/README',
    ]) {
      let realm = `${testRealmURL}${local}`;
      await assert.rejects(
        command.execute({
          realm,
          roomId: '!room:example.com',
          code: `return 'ran';`,
        }),
        (error: Error) =>
          error.message ===
          `${realm} is ${local} inside the workspace ${testRealmURL}, ` +
            `not its root. Pass ${testRealmURL} as realm, and name each file ` +
            `by its path from there: ${local} for that file, ` +
            `${local}.json for that card, or ${local}/ and the ` +
            `file's name for a file in that folder`,
      );
    }
  });

  test('refuses a realm with a malformed percent-encoding as one it cannot reach', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);
    let realm = `${testRealmURL}folder%E0/`;

    await assert.rejects(
      command.execute({
        realm,
        roomId: '!room:example.com',
        code: `return 'ran';`,
      }),
      (error: Error) =>
        error.message === `The current user cannot read or write ${realm}`,
    );
  });

  test('reads files and cards named by the prefix of the realm it runs in', async function (assert) {
    let { virtualNetwork } = getService('network');
    let prefix = '@test/path-prefix/';
    virtualNetwork.addRealmMapping(prefix, testRealmURL);
    try {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `let byPrefix = await realm.cards.get('${prefix}people/hassan');
let byURL = await realm.cards.get(${JSON.stringify(`${testRealmURL}people/hassan`)});
let listByPrefix = await realm.fs.list('${prefix}people/');
let listByURL = await realm.fs.list(${JSON.stringify(`${testRealmURL}people/`)});
let rootByPrefix = await realm.fs.list('${prefix}');
let rootByURL = await realm.fs.list('');
return { byPrefix, byURL, listByPrefix, listByURL, rootByPrefix, rootByURL };`,
      });
      let { byPrefix, byURL, listByPrefix, listByURL, rootByPrefix, rootByURL } =
        JSON.parse(result.scriptResult!);
      assert.deepEqual(byPrefix, byURL, 'a card reads the same by prefix');
      assert.deepEqual(
        listByPrefix,
        listByURL,
        'a folder lists the same by prefix',
      );
      assert.deepEqual(
        rootByPrefix,
        rootByURL,
        'the realm root lists the same by prefix',
      );

      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.cards.get('@test/unregistered/people/hassan');`,
        }),
        /Path is outside this realm/,
      );
    } finally {
      virtualNetwork.removeRealmMapping(prefix);
    }
  });

  test('refuses a folder of a realm named by a prefix, and names the root by that prefix', async function (assert) {
    let { virtualNetwork } = getService('network');
    let prefix = '@test/folder-input/';
    virtualNetwork.addRealmMapping(prefix, testRealmURL);
    try {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);
      let folder = `${prefix}card-mutation/relink/`;

      await assert.rejects(
        command.execute({
          realm: folder,
          roomId: '!room:example.com',
          code: `return 'ran';`,
        }),
        (error: Error) =>
          error.message ===
          `${folder} is card-mutation/relink inside the workspace ${prefix}, ` +
            `not its root. Pass ${prefix} as realm, and name each file ` +
            `by its path from there: card-mutation/relink for that file, ` +
            `card-mutation/relink.json for that card, or card-mutation/relink/ and the ` +
            `file's name for a file in that folder`,
      );
    } finally {
      virtualNetwork.removeRealmMapping(prefix);
    }
  });

  test('runs in the realm root named with a query string', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: `${testRealmURL}?x=1`,
      roomId: '!room:example.com',
      code: `return await realm.fs.readText('task.json');`,
    });

    assert.true(JSON.parse(result.scriptResult!).includes('"count"'));
  });

  test('runs in a workspace nested under the realm, learned after it', async function (assert) {
    let nestedRealmURL = `${testRealmURL}nested/`;
    knowReadableWorkspace(nestedRealmURL);
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: nestedRealmURL,
      roomId: '!room:example.com',
      code: `return 'ran';`,
    });

    assert.strictEqual(JSON.parse(result.scriptResult!), 'ran');
  });

  test('asks a workspace nested under the realm for its own permissions', async function (assert) {
    let nestedRealmURL = `${testRealmURL}nested/`;
    knowReadableWorkspace(nestedRealmURL, []);
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: nestedRealmURL,
        roomId: '!room:example.com',
        code: `return 'ran';`,
      }),
      (error: Error) =>
        error.message ===
        `The current user cannot read or write ${nestedRealmURL}`,
      'the readable outer realm does not answer for the nested one',
    );
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

  test('a thrown message that ends a sentence gets no second period', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `throw new Error('Could not find the styles.');`,
      }),
      /Could not find the styles\. No file was saved\./,
    );
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

  test('realm.entries.search runs several searches in one script and returns only what the script keeps', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `const found = {};
for (const title of ['Pet', 'Unicorn']) {
  const { entries, total, truncated, incomplete } = await realm.entries.search(
    {
      filter: {
        on: { module: '@cardstack/base/spec', name: 'Spec' },
        eq: { cardTitle: title },
      },
    },
    { realms: [realm.current.url] },
  );
  found[title] = {
    total,
    truncated,
    incomplete,
    entries: entries.map((entry) => ({
      url: entry.url,
      kind: entry.kind,
      specType: entry.specType,
      refName: entry.ref?.name,
      readMe: entry.readMe,
    })),
  };
}
return found;`,
    });

    assert.deepEqual(result.files, [], 'a search saves nothing');
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      Pet: {
        total: 1,
        truncated: false,
        incomplete: false,
        entries: [
          {
            url: `${testRealmURL}Spec/pet`,
            kind: 'card',
            specType: 'card',
            refName: 'Pet',
            readMe: '# Pet\n\nUse Pet for any animal with a name.',
          },
        ],
      },
      Unicorn: { total: 0, truncated: false, incomplete: false, entries: [] },
    });
  });

  test('realm.entries.search caps the entries at the limit and reports the rest', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `const { entries, total, truncated } = await realm.entries.search(
  {},
  { realms: [realm.current.url], scope: 'cards', limit: 1 },
);
return { count: entries.length, kind: entries[0].kind, more: total > 1, truncated };`,
    });

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      count: 1,
      kind: 'card',
      more: true,
      truncated: true,
    });
  });

  test('realm.entries.search finds the entries of a realm named by a registered prefix', async function (assert) {
    let { virtualNetwork } = getService('network');
    virtualNetwork.addRealmMapping('@test/mapped/', otherRealmURL);
    try {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `const { entries, total, incomplete } = await realm.entries.search(
  {
    filter: {
      on: { module: ${JSON.stringify(`${testRealmURL}recipe`)}, name: 'Recipe' },
      eq: { name: 'Elsewhere' },
    },
  },
  { realms: ['@test/mapped'], scope: 'cards' },
);
return { total, incomplete, urls: entries.map((entry) => entry.url) };`,
      });

      assert.deepEqual(JSON.parse(result.scriptResult!), {
        total: 1,
        incomplete: false,
        urls: [`${otherRealmURL}Recipe/elsewhere`],
      });
    } finally {
      virtualNetwork.removeRealmMapping('@test/mapped/');
    }
  });

  test('realm.entries.search sends a realm as the identifier given, once per realm', async function (assert) {
    let { virtualNetwork } = getService('network');
    let sentRealms: string[][] = [];
    let spy = async (request: Request) => {
      if (new URL(request.url).pathname.endsWith('/_federated-search')) {
        sentRealms.push(JSON.parse(await request.clone().text()).realms);
      }
      return null;
    };
    virtualNetwork.mount(spy, { prepend: true });
    try {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({}, { realms: ['@cardstack/base/', ${JSON.stringify(
          virtualNetwork.toURL('@cardstack/base/').href,
        )}] });`,
      });

      assert.deepEqual(
        sentRealms,
        [['@cardstack/base/']],
        'the prefix goes out as given, and its URL, naming the same realm, is dropped',
      );

      // The realm server reads any spelling of a realm, so the host never
      // has to name base by its deprecated alias.
      await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({}, { realms: ['@cardstack/base/'] });`,
      });
      assert.deepEqual(
        sentRealms[1],
        ['@cardstack/base/'],
        'the base prefix goes out as given',
      );
    } finally {
      virtualNetwork.unmount(spy);
    }
  });

  test('realm.entries.search refuses a scoped identifier no realm is registered under', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({}, { realms: ['@nope/realm/'] });`,
      }),
      (error: Error) =>
        error.message.includes('Unknown realm identifier "@nope/realm/"') &&
        error.message.includes('@cardstack/catalog/'),
    );
    // A package namespace resolves, but names no realm.
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({}, { realms: ['@cardstack/boxel-ui/'] });`,
      }),
      /Unknown realm identifier "@cardstack\/boxel-ui\/"/,
    );
  });

  test('realm.entries.search refuses a page and an unknown scope', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({ page: { number: 1 } });`,
      }),
      /does not page; pass \{ limit \}/,
    );
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.entries.search({}, { scope: 'modules' });`,
      }),
      /Invalid scope "modules"/,
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

  // The realm server does the indexing; these record what the run asked for.
  function stubIndexing() {
    let calls: { action: string; realm: string; urls?: string[] }[] = [];
    let realmService = getService('realm');
    realmService.invalidateUrls = async (realm, urls) => {
      calls.push({ action: 'invalidate', realm, urls });
    };
    realmService.reindex = async (realm) => {
      calls.push({ action: 'reindex', realm });
    };
    realmService.fullReindex = async (realm) => {
      calls.push({ action: 'fullReindex', realm });
    };
    realmService.cancelIndexingJob = async (realm) => {
      calls.push({ action: 'cancelJob', realm });
    };
    return calls;
  }

  test('realm.index.invalidate and realm.index.reindex refresh the index of the run realm without a click', async function (assert) {
    let calls = stubIndexing();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    let code = `return {
  invalidated: await realm.index.invalidate(['Pet/mango.json', '${testRealmURL}pet.gts']),
  one: await realm.index.invalidate('task.json'),
  reindex: await realm.index.reindex(),
};`;

    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor({ code }),
      'the run keeps the room mode',
    );
    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });

    assert.deepEqual(calls, [
      {
        action: 'invalidate',
        realm: testRealmURL,
        urls: [`${testRealmURL}Pet/mango.json`, `${testRealmURL}pet.gts`],
      },
      {
        action: 'invalidate',
        realm: testRealmURL,
        urls: [`${testRealmURL}task.json`],
      },
      { action: 'reindex', realm: testRealmURL },
    ]);
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      invalidated: { invalidated: ['Pet/mango.json', 'pet.gts'] },
      one: { invalidated: ['task.json'] },
      reindex: { reindex: 'started' },
    });
    assert.deepEqual(result.indexActions, [
      'invalidate Pet/mango.json, pet.gts',
      'invalidate task.json',
      'reindex',
    ]);
  });

  test('realm.index.invalidate refuses a path outside the realm and an empty list', async function (assert) {
    let calls = stubIndexing();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `let refused = [];
try { await realm.index.invalidate(['http://other-realm/a.json']); } catch (e) { refused.push(e.message); }
try { await realm.index.invalidate([]); } catch (e) { refused.push(e.message); }
return refused;`,
    });

    let [outside, empty] = JSON.parse(result.scriptResult!);
    assert.true(/Path is outside this realm/.test(outside), outside);
    assert.true(/expects a path or an array/.test(empty), empty);
    assert.deepEqual(calls, [], 'nothing is invalidated');
  });

  test('a script that starts a full reindex or cancels an indexing job always waits for the user', async function (assert) {
    let calls = stubIndexing();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    for (let code of [
      `await realm.index.fullReindex();`,
      `await realm.index.cancelJob();`,
    ]) {
      assert.true(
        RunRealmCodeTool.neverAutoExecutesFor({ code }),
        `waits for a click: ${code}`,
      );
    }

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return {
  cancel: await realm.index.cancelJob(),
  full: await realm.index.fullReindex(),
};`,
    });

    assert.deepEqual(calls, [
      { action: 'cancelJob', realm: testRealmURL },
      { action: 'fullReindex', realm: testRealmURL },
    ]);
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      cancel: { cancelled: true },
      full: { fullReindex: 'started' },
    });
  });

  test('a failed run names the index actions it already started', async function (assert) {
    let calls = stubIndexing();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.index.invalidate('task.json');
await realm.index.fullReindex();
throw new Error('boom');`,
      }),
      /boom\. No file was saved\. Index actions already started by this run: invalidate task\.json; fullReindex/,
    );
    assert.deepEqual(calls, [
      {
        action: 'invalidate',
        realm: testRealmURL,
        urls: [`${testRealmURL}task.json`],
      },
      { action: 'fullReindex', realm: testRealmURL },
    ]);
  });

  test('a script that reaches realm.index.fullReindex another way is refused', async function (assert) {
    let calls = stubIndexing();
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    let code = `let index = realm.index;
await index['full' + 'Reindex']();`;

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
      /realm\.index\.fullReindex must be called by that name/,
    );
    assert.deepEqual(calls, [], 'no reindex starts');
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
      operatorModeStateService.state.codePath,
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
      operatorModeStateService.state.codePath,
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

  module('realm.cards.update', function () {
    async function run(code: string) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);
      return await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code,
      });
    }

    async function cardJSON(path: string) {
      let source = await getService('card-service').getSource(
        new URL(`${testRealmURL}${path}`),
      );
      return JSON.parse(source.content);
    }

    test('changes the fields it is given and keeps the others', async function (assert) {
      let result = await run(`
const updated = await realm.cards.update('Recipe/pancakes', { cuisine: 'French' });
return updated;`);

      assert.deepEqual(JSON.parse(result.scriptResult!), {
        path: 'Recipe/pancakes.json',
        fields: ['cuisine'],
        saves: 'after the script finishes',
      });
      assert.deepEqual(
        result.files.map((file) => [file.fileUrl, file.status]),
        [[`${testRealmURL}Recipe/pancakes.json`, 'saved']],
      );
      let { data } = await cardJSON('Recipe/pancakes.json');
      assert.strictEqual(data.attributes.cuisine, 'French');
      assert.strictEqual(data.attributes.name, 'Pancakes');
      assert.strictEqual(
        data.relationships.chef.links.self,
        '../Chef/ana',
        'links are kept',
      );
    });

    test('saves the update to a realm named by a prefix-form identifier', async function (assert) {
      let { virtualNetwork } = getService('network');
      let testRealmPrefix = '@test/cards-update/';
      virtualNetwork.addRealmMapping(testRealmPrefix, testRealmURL);
      try {
        let toolService = getService('tool-service');
        let result = await new RunRealmCodeTool(
          toolService.toolContext,
        ).execute({
          realm: testRealmPrefix,
          roomId: '!room:example.com',
          code: `await realm.cards.update('Recipe/pancakes', { cuisine: 'Belgian' });`,
        });

        assert.deepEqual(
          result.files.map((file) => file.status),
          ['saved'],
          'the update is saved',
        );
        let { data } = await cardJSON('Recipe/pancakes.json');
        assert.strictEqual(data.attributes.cuisine, 'Belgian');
      } finally {
        virtualNetwork.removeRealmMapping(testRealmPrefix);
      }
    });

    test('edits a long text field in the script without cutting it', async function (assert) {
      let long = Array.from(
        { length: 40 },
        (_, n) => `Line ${n}: a \`code\` span, a \${placeholder} and "quotes".`,
      ).join('\n');
      assert.true(long.length > 500);
      await run(
        `await realm.cards.update('Pet/mango', { name: ${JSON.stringify(long)} });`,
      );

      let result = await run(`
const card = await realm.cards.get('Pet/mango');
const name = card.attributes.name.replace('Line 0:', 'First line:');
await realm.cards.update('Pet/mango', { name });
return name.length;`);

      let expected = long.replace('Line 0:', 'First line:');
      assert.strictEqual(JSON.parse(result.scriptResult!), expected.length);
      let { data } = await cardJSON('Pet/mango.json');
      assert.strictEqual(data.attributes.name, expected);
    });

    test('updates more cards than the file limit in one run, and saves them all', async function (assert) {
      let cardService = getService('card-service');
      for (let n = 0; n < 25; n++) {
        await cardService.saveSource(
          new URL(`${testRealmURL}Recipe/batch/r${n}.json`),
          recipeJSON(
            'Recipe',
            { name: `R${n}`, cuisine: 'batch' },
            undefined,
            '../../recipe',
          ),
          'editor',
        );
      }

      // The cards are named by path: a search would depend on the index
      // having caught up with the saves above.
      let result = await run(`
for (let n = 0; n < 25; n++) {
  await realm.cards.update('Recipe/batch/r' + n, { cuisine: 'done' });
}`);

      assert.strictEqual(result.files.length, 25, 'the result names each card');
      for (let n of [0, 24]) {
        let { data } = await cardJSON(`Recipe/batch/r${n}.json`);
        assert.strictEqual(data.attributes.cuisine, 'done');
        assert.strictEqual(data.attributes.name, `R${n}`);
      }
    });

    test('refuses an update that makes a card larger than the card size limit, counted in bytes', async function (assert) {
      // Each emoji is 2 UTF-16 code units but 4 bytes in UTF-8.
      let result = await run(`
try {
  await realm.cards.update('Pet/mango', { name: '\u{1F600}'.repeat(200000) });
} catch (error) {
  return error.message;
}`);

      assert.true(
        /Card is too large after this update: .*Pet\/mango\.json/.test(
          JSON.parse(result.scriptResult!),
        ),
        result.scriptResult,
      );
      assert.deepEqual(result.files, [], 'nothing is saved');
    });

    test('two updates to the same card in one run both apply', async function (assert) {
      let result = await run(`
await realm.cards.update('Recipe/ramen', { cuisine: 'Japanese street food' });
await realm.cards.update('Recipe/ramen.json', { name: 'Shoyu ramen' });`);

      assert.strictEqual(result.files.length, 1);
      let { data } = await cardJSON('Recipe/ramen.json');
      assert.strictEqual(data.attributes.cuisine, 'Japanese street food');
      assert.strictEqual(data.attributes.name, 'Shoyu ramen');
    });

    test('a run that fails saves no card update, and says so', async function (assert) {
      await assert.rejects(
        run(`
await realm.cards.update('Recipe/pancakes', { cuisine: 'French' });
throw new Error('stop');`),
        /stop.*The card updates it asked for were not saved/,
      );
      let { data } = await cardJSON('Recipe/pancakes.json');
      assert.strictEqual(data.attributes.cuisine, 'unknown');
    });

    test('refuses a file that is not a card, attributes that are not an object, and realm.fs on an updated card', async function (assert) {
      let result = await run(`
const errors = [];
for (const call of [
  () => realm.cards.update('task.json', { title: 'x' }),
  () => realm.cards.update('Recipe/missing', { name: 'x' }),
  () => realm.cards.update('Recipe/pancakes', ['x']),
  () => realm.cards.update('Recipe/pancakes', 'x'),
]) {
  try { await call(); } catch (error) { errors.push(error.message); }
}
await realm.cards.update('Recipe/ramen', { cuisine: 'Ramen-ya' });
try { await realm.fs.readText('Recipe/ramen.json'); } catch (error) { errors.push(error.message); }
return errors;`);

      let errors = JSON.parse(result.scriptResult!) as string[];
      assert.true(
        /Not a card instance: .*task\.json/.test(errors[0]!),
        errors[0],
      );
      assert.true(/Card not found/.test(errors[1]!), errors[1]);
      assert.true(/attributes object/.test(errors[2]!), errors[2]);
      assert.true(/attributes object/.test(errors[3]!), errors[3]);
      assert.true(
        /realm\.fs cannot read or change it in the same run/.test(errors[4]!),
        errors[4],
      );
      let { data } = await cardJSON('Recipe/ramen.json');
      assert.strictEqual(data.attributes.cuisine, 'Ramen-ya');
    });
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

const readOnlyRealmURL = 'http://test-realm/other/';

module(
  'Integration | tools | run-realm-code | read-only workspace',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      autostart: true,
      activeRealms: [testRealmURL, readOnlyRealmURL],
      realmPermissions: {
        [testRealmURL]: ['read'],
        [readOnlyRealmURL]: ['read'],
      },
    });
    let captureRequests: any[] = [];
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

    hooks.beforeEach(async function () {
      captureRequests = [];
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: readOnlyRealmURL,
        enforcePermissions: true,
        permissions: { '*': ['read'] },
        contents: {
          'brand.md': '# Brand\n',
        },
      });
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
      await getService('realm').login(readOnlyRealmURL);
    });

    test('realm.capture captures in a workspace the user can only read, and in another workspace by URL', async function (assert) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `return [
  await realm.capture('notes/first.md'),
  await realm.capture('${readOnlyRealmURL}brand.md'),
];`,
      });

      assert.deepEqual(
        captureRequests.map((r) => r.data.attributes.fileURL),
        [`${testRealmURL}notes/first.md`, `${readOnlyRealmURL}brand.md`],
      );
      assert.deepEqual(
        captureRequests.map((r) => r.data.attributes.realmURL),
        [testRealmURL, readOnlyRealmURL],
        'each capture is asked of the workspace that holds it',
      );
      assert.deepEqual(
        JSON.parse(result.scriptResult!).map((c: { path: string }) => c.path),
        ['notes/first.md', `${readOnlyRealmURL}brand.md`],
        'a capture in another workspace is named by its URL',
      );
      assert.strictEqual(result.captures.length, 2);
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

    test('realm.index calls are refused', async function (assert) {
      let toolService = getService('tool-service');
      let command = new RunRealmCodeTool(toolService.toolContext);

      let result = await command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `let refused = [];
try { await realm.index.invalidate('task.json'); } catch (e) { refused.push(e.message); }
try { await realm.index.reindex(); } catch (e) { refused.push(e.message); }
return refused;`,
      });

      let refused = JSON.parse(result.scriptResult!);
      assert.strictEqual(refused.length, 2, 'both calls are refused');
      for (let message of refused) {
        assert.true(
          /You can only read this workspace/.test(message),
          `the refusal says why: ${message}`,
        );
      }
    });
  },
);

// `realm.images.generate` sends its request through the realm server's proxy,
// which needs a realm server session, so these tests sign a user in.
module('Integration | tools | run-realm-code | images', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // `realm.images.generate` asks the image model through the realm server's
  // proxy; this answers every request with the same PNG and records the
  // request it forwarded. A request whose prompt is `never answers` gets no
  // answer until it is aborted, or until a fallback long after any test
  // timing.
  let imageRequests: any[] = [];
  let abortedImageRequests = 0;
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        let body = await req.clone().json();
        let request = JSON.parse(body.requestBody);
        imageRequests.push({ url: body.url, request });
        if (request.messages[0].content[0].text === 'never answers') {
          await new Promise<void>((resolve, reject) => {
            let fallback = setTimeout(resolve, 20_000);
            let onAbort = () => {
              clearTimeout(fallback);
              abortedImageRequests += 1;
              reject(new DOMException('aborted', 'AbortError'));
            };
            if (req.signal.aborted) {
              onAbort();
            }
            req.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  images: [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/png;base64,${PNG_BASE64}` },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    imageRequests = [];
    abortedImageRequests = 0;
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'task.json': '{ "title": "Old title" }\n',
        'photos/cat.jpg': 'not really a jpeg',
      },
    });
  });

  test('a script that generates images always waits for the user, and gets more time', function (assert) {
    let code = `await realm.images.generate({ prompt: 'a cat', path: 'cat.png' });`;
    assert.true(
      RunRealmCodeTool.neverAutoExecutesFor({ code }),
      'a run that names realm.images.generate waits for a click',
    );
    assert.true(
      RunRealmCodeTool.extraExecuteTimeMsFor({ code }) > 0,
      'the tool service gives the run more time',
    );
    assert.strictEqual(
      RunRealmCodeTool.extraExecuteTimeMsFor({
        code: `await realm.fs.writeText('a.json', '{}');`,
      }),
      0,
      'other runs keep the usual execute timeout',
    );
  });

  test('realm.fs.delete removes an image the same run generated', async function (assert) {
    let toolService = getService('tool-service');
    let command = new RunRealmCodeTool(toolService.toolContext);

    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.images.generate({ prompt: 'A small dot', path: 'images/dot.png' });
return {
  deleted: await realm.fs.delete('images/dot.png'),
  exists: await realm.fs.exists('images/dot.png'),
};`,
    });

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      deleted: { path: 'images/dot.png', deleted: true },
      exists: false,
    });
    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status]),
      [[`${testRealmURL}images/dot.png`, 'deleted']],
    );
  });

  test('realm.images.generate saves the image and returns its path', async function (assert) {
    let toolService = getService('tool-service');
    let network = getService('network');
    let command = new RunRealmCodeTool(toolService.toolContext);

    // The source image the request names is in the realm.
    await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `await realm.fs.writeBytes('source.png', ${JSON.stringify(PNG_BASE64)});`,
    });
    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `return await realm.images.generate({
  prompt: 'A small dot',
  path: 'images/dot',
  sourceImageUrl: 'source.png',
  llmModel: 'test/image-model',
});`,
    });

    let expected = Uint8Array.from(atob(PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    assert.deepEqual(JSON.parse(result.scriptResult!), {
      path: 'images/dot.png',
      contentType: 'image/png',
      size: expected.byteLength,
      saved: true,
    });
    assert.deepEqual(
      result.files.map((file) => [file.fileUrl, file.status]),
      [[`${testRealmURL}images/dot.png`, 'saved']],
    );
    assert.strictEqual(imageRequests.length, 1, 'one image was requested');
    let [{ request }] = imageRequests;
    assert.strictEqual(request.model, 'test/image-model');
    assert.deepEqual(request.messages[0].content, [
      { type: 'text', text: 'A small dot' },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${PNG_BASE64}` },
      },
    ]);
    let response = await network.authedFetch(
      new URL('images/dot.png', testRealmURL),
    );
    assert.deepEqual(
      Array.from(new Uint8Array(await response.arrayBuffer())),
      Array.from(expected),
      'the realm holds the image bytes',
    );
  });

  test('realm.images.generate refuses a fifth image in one run', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `for (let i = 1; i <= 5; i++) {
  await realm.images.generate({ prompt: 'dot ' + i, path: 'dots/' + i + '.png' });
}`,
      }),
      /at most 4 images.*Files already saved by this run: .*dots\/4\.png/,
    );
    assert.strictEqual(imageRequests.length, 4, 'four images were requested');
  });

  test('realm.images.generate refuses an existing file before it asks the model', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.images.generate({ prompt: 'a task', path: 'task.json' });`,
      }),
      /File already exists/,
    );
    assert.strictEqual(imageRequests.length, 0, 'no image was requested');
  });

  test('realm.images.generate refuses a path whose image may be saved over an existing file, before it asks the model', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    // The model may answer with a JPEG, which would be saved as cat.jpg.
    for (let path of ['photos/cat', 'photos/cat.png']) {
      await assert.rejects(
        command.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `await realm.images.generate({ prompt: 'a cat', path: '${path}' });`,
        }),
        /File already exists: .*photos\/cat\.jpg/,
        `${path} is refused`,
      );
    }
    assert.strictEqual(imageRequests.length, 0, 'no image was requested');
  });

  test('realm.images.generate takes one file slot per image', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    // 16 files read plus 4 extensionless images is the 20-file limit.
    let result = await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code: `for (let i = 1; i <= 16; i++) {
  await realm.fs.exists('missing-' + i + '.json');
}
let paths = [];
for (let i = 1; i <= 4; i++) {
  paths.push((await realm.images.generate({ prompt: 'dot ' + i, path: 'dots/' + i })).path);
}
return paths;`,
    });
    assert.deepEqual(JSON.parse(result.scriptResult!), [
      'dots/1.png',
      'dots/2.png',
      'dots/3.png',
      'dots/4.png',
    ]);
  });

  test('realm.images.generate refuses a source image outside this realm', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `await realm.images.generate({
  prompt: 'a dot',
  path: 'dot.png',
  sourceImageUrl: 'http://other-realm.example/private/photo.png',
});`,
      }),
      /Path is outside this realm/,
    );
    assert.strictEqual(imageRequests.length, 0, 'no image was requested');
  });

  test('an image request still in flight when the run ends is stopped', async function (assert) {
    let cardService = getService('card-service');
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);

    let started = Date.now();
    await assert.rejects(
      command.execute({
        realm: testRealmURL,
        roomId: '!room:example.com',
        code: `realm.images.generate({ prompt: 'never answers', path: 'late.png' });`,
      }),
      /await every realm call/,
    );
    assert.true(
      Date.now() - started < 15_000,
      'the run reports without waiting for the image',
    );
    if (imageRequests.length > 0) {
      assert.strictEqual(
        abortedImageRequests,
        1,
        'the image request was aborted',
      );
    }
    await settled();
    let source = await cardService.getSource(
      new URL(`${testRealmURL}late.png`),
    );
    assert.strictEqual(source.status, 404, 'no image was saved');
  });

  test('a script that reaches realm.images.generate another way is refused', async function (assert) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    let code = `let images = realm['ima' + 'ges'];
await images.generate({ prompt: 'a dot', path: 'dot.png' });`;

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
      /realm\.images\.generate must be called by that name/,
    );
    assert.strictEqual(imageRequests.length, 0, 'no image was requested');
  });
});

// The catalog-reuse feature is read from the room's messages, which reach the
// room resources only for a signed-in user.
module(
  'Integration | tools | run-realm-code | catalog-reuse',
  function (hooks) {
    setupRenderingTest(hooks);
    // The test build lists no catalog, so list one for the default realms
    // to leave out. It must be listed before the user signs in.
    hooks.beforeEach(function () {
      setCatalogRealmURL(
        getService('network').virtualNetwork.toURL('@cardstack/catalog/').href,
      );
    });
    hooks.afterEach(function () {
      resetCatalogRealmURL();
    });
    setupLocalIndexing(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });
    setupRealmCacheTeardown(hooks);

    hooks.beforeEach(async function () {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: { 'note.md': '# Note\n' },
      });
    });

    test('realm.entries.search leaves the catalog out unless the room enabled catalog-reuse', async function (assert) {
      await getService('matrix-service').ready;
      let roomId = mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'catalog-reuse',
      });
      let { virtualNetwork } = getService('network');
      let sentRealms: string[][] = [];
      let spy = async (request: Request) => {
        if (new URL(request.url).pathname.endsWith('/_federated-search')) {
          sentRealms.push(JSON.parse(await request.clone().text()).realms);
        }
        return null;
      };
      virtualNetwork.mount(spy, { prepend: true });
      let catalogURL = virtualNetwork.toURL('@cardstack/catalog/').href;
      try {
        let realmServer = getService('realm-server');
        await realmServer.ready;
        let isCatalog = (realm: string) =>
          realm === '@cardstack/catalog/' || realm === catalogURL;
        assert.ok(
          realmServer.availableRealmIdentifiers.some(isCatalog),
          'the catalog is one of the available realms',
        );
        let command = new RunRealmCodeTool(
          getService('tool-service').toolContext,
        );
        let search = (code: string) =>
          command.execute({ realm: testRealmURL, roomId, code });

        await search(
          `return await realm.entries.search({}, { realms: ['@cardstack/catalog/'] });`,
        );
        await search(
          `await realm.entries.search({}, { realms: ['@cardstack/catalog/', realm.current.url] });`,
        );
        await search(`await realm.entries.search({});`);
        await search(
          `await realm.entries.search({}, { realms: [${JSON.stringify(
            `${catalogURL}components/`,
          )}] });`,
        );
        assert.strictEqual(
          sentRealms.length,
          2,
          'a search of the catalog alone, or of a folder in it, is answered empty, without a request',
        );
        assert.deepEqual(
          sentRealms[0],
          [testRealmURL],
          'a named catalog is dropped',
        );
        assert.notOk(
          sentRealms[1].some(isCatalog),
          'the default realms leave the catalog out',
        );

        mockMatrixUtils.simulateRemoteMessage(roomId, '@testuser:localhost', {
          msgtype: 'm.text',
          body: 'boxel-debug:feature:enable:catalog-reuse',
        });
        await settled();
        await search(
          `await realm.entries.search({}, { realms: ['@cardstack/catalog/'] });`,
        );
        assert.deepEqual(
          sentRealms[2],
          ['@cardstack/catalog/'],
          'with the feature on, the catalog is searched',
        );
      } finally {
        virtualNetwork.unmount(spy);
      }
    });

    test('realm.cards.search in the catalog finds nothing unless the room enabled catalog-reuse', async function (assert) {
      await getService('matrix-service').ready;
      let roomId = mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'catalog-reuse',
      });
      let { virtualNetwork } = getService('network');
      let catalogURL = virtualNetwork.toURL('@cardstack/catalog/').href;
      let searches = 0;
      // Stands in for the catalog: a public realm whose searches are counted.
      let catalog = async (request: Request) => {
        let { pathname } = new URL(request.url);
        if (request.url === `${catalogURL}_info`) {
          return new Response(
            JSON.stringify({
              data: {
                id: catalogURL,
                type: 'realm-info',
                attributes: { name: 'Catalog' },
              },
            }),
            {
              headers: {
                'content-type': SupportedMimeType.RealmInfo,
                'x-boxel-realm-public-readable': 'true',
              },
            },
          );
        }
        if (
          pathname.endsWith('_search') ||
          pathname.endsWith('_federated-search')
        ) {
          searches++;
          return new Response(
            JSON.stringify({ data: [], meta: { page: { total: 0 } } }),
            { headers: { 'content-type': SupportedMimeType.CardJson } },
          );
        }
        return null;
      };
      virtualNetwork.mount(catalog, { prepend: true });
      try {
        await getService('realm').ensureRealmMeta(catalogURL);
        let command = new RunRealmCodeTool(
          getService('tool-service').toolContext,
        );
        let search = async () =>
          JSON.parse(
            (
              await command.execute({
                realm: '@cardstack/catalog/',
                roomId,
                code: `return await realm.cards.search({});`,
              })
            ).scriptResult!,
          );

        assert.deepEqual(
          await search(),
          { cards: [], total: 0, truncated: false },
          'the catalog answers empty',
        );
        assert.strictEqual(searches, 0, 'without a request');

        mockMatrixUtils.simulateRemoteMessage(roomId, '@testuser:localhost', {
          msgtype: 'm.text',
          body: 'boxel-debug:feature:enable:catalog-reuse',
        });
        // The message reaches the room's events a tick after it is sent.
        await waitUntil(() =>
          getService('matrix-service')
            .roomResources.get(roomId)
            ?.events.some(
              (event) =>
                (event.content as { body?: string })?.body ===
                'boxel-debug:feature:enable:catalog-reuse',
            ),
        );
        await search();
        assert.strictEqual(searches, 1, 'with the feature on, it is searched');
      } finally {
        virtualNetwork.unmount(catalog);
      }
    });
  },
);

// `realm.web.search`, `realm.web.read` and `realm.resolve` send their requests
// through the realm server's proxy, which needs a realm server session, so
// these tests sign a user in. The proxy is stubbed: each test says how the
// service behind it answers, and every forwarded request is recorded.
module('Integration | tools | run-realm-code | research', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  type Forwarded = { url: string; request: any };
  let forwarded: Forwarded[] = [];
  let answer: (forwarded: Forwarded) => Response;
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        let body = await req.clone().json();
        let request = { url: body.url, request: JSON.parse(body.requestBody) };
        forwarded.push(request);
        return answer(request);
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // An OpenRouter chat answer whose message content is `content`.
  function chat(content: string, extra: Record<string, unknown> = {}) {
    return json({
      model: 'openai/gpt-4.1-mini',
      choices: [{ finish_reason: 'stop', message: { content, ...extra } }],
    });
  }

  const RECIPE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'servings'],
    properties: {
      title: { type: 'string' },
      servings: { type: 'integer', minimum: 1 },
    },
  };

  async function run(code: string) {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    return await command.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });
  }

  hooks.beforeEach(async function () {
    forwarded = [];
    answer = () => json({ error: { message: 'no answer set' } }, 500);
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { 'task.json': '{ "title": "Old title" }\n' },
    });
  });

  test('research calls need no click, and a run that names one gets more time', function (assert) {
    for (let code of [
      `await realm.web.search('chili recipe');`,
      `await realm.web.read('https://example.com/');`,
      `await realm.resolve({});`,
    ]) {
      assert.false(
        RunRealmCodeTool.neverAutoExecutesFor({ code }),
        `no click for ${code}`,
      );
      assert.true(
        RunRealmCodeTool.extraExecuteTimeMsFor({ code }) > 0,
        `more time for ${code}`,
      );
    }
  });

  test('realm.web.search returns the url_citation sources of an Exa search', async function (assert) {
    answer = () =>
      chat('Here are some chili recipes.', {
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://www.budgetbytes.com/chili/',
              title: 'Chili - Budget Bytes',
              content: 'A classic beef chili.',
            },
          },
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://www.budgetbytes.com/chili/',
              title: 'Duplicate',
              content: 'Duplicate',
            },
          },
          { type: 'file', file: { name: 'ignored' } },
          {
            type: 'url_citation',
            url_citation: { url: 'https://example.com/chili' },
          },
        ],
      });

    let result = await run(
      `return await realm.web.search('beef chili recipe', { limit: 3, includeDomains: ['BudgetBytes.com'] });`,
    );

    assert.deepEqual(JSON.parse(result.scriptResult!), [
      {
        url: 'https://www.budgetbytes.com/chili/',
        title: 'Chili - Budget Bytes',
        snippet: 'A classic beef chili.',
      },
      { url: 'https://example.com/chili', title: '', snippet: '' },
    ]);
    assert.strictEqual(forwarded.length, 1, 'one request was forwarded');
    let [{ url, request }] = forwarded;
    assert.strictEqual(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(request.plugins, [
      {
        id: 'web',
        engine: 'exa',
        max_results: 3,
        include_domains: ['budgetbytes.com'],
      },
    ]);
    assert.strictEqual(
      request.messages.at(-1).content,
      'beef chili recipe',
      'the query is the user message',
    );
    assert.strictEqual(
      result.activity.length,
      1,
      'the search is in the run activity',
    );
    assert.true(
      /Exa searched for "beef chili recipe".*2 results/.test(
        result.activity[0]!,
      ),
      result.activity[0]!,
    );
  });

  test('realm.web.search refuses a limit outside 1 to 10 without a request', async function (assert) {
    await assert.rejects(
      run(`await realm.web.search('chili', { limit: 11 });`),
      /limit must be a whole number from 1 to 10/,
    );
    assert.strictEqual(forwarded.length, 0, 'nothing was forwarded');
  });

  test('realm.web.read returns the page markdown, capped, with its metadata', async function (assert) {
    let markdown = '# Chili\n' + 'x'.repeat(70_000);
    answer = () =>
      json({
        success: true,
        data: {
          markdown,
          metadata: {
            title: 'Chili',
            statusCode: 200,
            contentType: 'text/html; charset=utf-8',
            sourceURL: 'https://www.budgetbytes.com/chili/',
            ogImage: 'https://www.budgetbytes.com/chili.jpg',
          },
        },
      });

    let result =
      await run(`let page = await realm.web.read('https://www.budgetbytes.com/chili/');
return { url: page.url, length: page.markdown.length, start: page.markdown.slice(0, 7), truncated: page.truncated, metadata: page.metadata };`);

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      url: 'https://www.budgetbytes.com/chili/',
      length: 64_000,
      start: '# Chili',
      truncated: true,
      metadata: {
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
        title: 'Chili',
        sourceURL: 'https://www.budgetbytes.com/chili/',
      },
    });
    let [{ url, request }] = forwarded;
    assert.strictEqual(url, 'https://api.firecrawl.dev/v2/scrape');
    assert.strictEqual(request.url, 'https://www.budgetbytes.com/chili/');
    assert.deepEqual(request.formats, ['markdown']);
    assert.true(request.onlyMainContent, 'main content by default');
    assert.deepEqual(result.activity, ['Firecrawl read www.budgetbytes.com']);
  });

  test('realm.web.read throws with the status and Firecrawl’s reason', async function (assert) {
    answer = ({ request }) =>
      request.url.endsWith('.svg')
        ? json(
            {
              success: false,
              code: 'SCRAPE_UNSUPPORTED_FILE_ERROR',
              error: 'The file type is not supported.',
            },
            400,
          )
        : json(
            {
              success: false,
              error:
                'This website is no longer supported, we do not support this site.',
            },
            403,
          );

    let result = await run(`let errors = [];
for (let url of ['https://www.seriouseats.com/chili', 'https://example.com/logo.svg']) {
  try {
    await realm.web.read(url);
  } catch (error) {
    errors.push(error.message);
  }
}
return errors;`);

    let [site, svg] = JSON.parse(result.scriptResult!);
    assert.true(/HTTP 403/.test(site), site);
    assert.true(/we do not support this site/.test(site), site);
    assert.true(/HTTP 400/.test(svg), svg);
    assert.true(/SCRAPE_UNSUPPORTED_FILE_ERROR/.test(svg), svg);
    assert.strictEqual(result.activity.length, 2);
    assert.true(
      /^Firecrawl could not read www\.seriouseats\.com: .*we do not support this site/.test(
        result.activity[0]!,
      ),
      result.activity[0]!,
    );
  });

  test('an uncaught realm.web.read failure fails the run with the reason', async function (assert) {
    answer = () =>
      json({ success: false, error: 'we do not support this site' }, 403);
    await assert.rejects(
      run(`await realm.web.read('https://www.seriouseats.com/chili');`),
      /HTTP 403: we do not support this site/,
    );
  });

  test('realm.resolve returns JSON that matches outputSchema', async function (assert) {
    answer = () => chat('{"title":"Beef Chili","servings":6}');

    let result = await run(`return await realm.resolve({
  instruction: 'Normalize this recipe header.',
  input: { name: ' beef chili ', serves: 'six' },
  error: 'servings must be a number',
  outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
});`);

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      output: { title: 'Beef Chili', servings: 6 },
      model: 'openai/gpt-4.1-mini',
    });
    let [{ request }] = forwarded;
    assert.deepEqual(request.response_format.json_schema.schema, RECIPE_SCHEMA);
    assert.true(request.response_format.json_schema.strict, 'strict output');
    assert.deepEqual(JSON.parse(request.messages[1].content), {
      instruction: 'Normalize this recipe header.',
      input: { name: ' beef chili ', serves: 'six' },
      error: 'servings must be a number',
    });
  });

  test('realm.resolve refuses an answer that does not match outputSchema', async function (assert) {
    answer = () => chat('{"title":"Beef Chili","servings":0,"notes":"x"}');

    await assert.rejects(
      run(`await realm.resolve({
  instruction: 'Normalize this recipe header.',
  input: { name: 'beef chili' },
  outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
});`),
      /does not match outputSchema/,
    );
  });

  test('realm.resolve refuses an open schema without a request', async function (assert) {
    await assert.rejects(
      run(`await realm.resolve({
  instruction: 'Normalize this.',
  input: { name: 'beef chili' },
  outputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
});`),
      /additionalProperties must be false/,
    );
    assert.strictEqual(forwarded.length, 0, 'nothing was forwarded');
  });

  test('realm.resolve may be called at most 3 times per run', async function (assert) {
    answer = () => chat('{"title":"Chili","servings":4}');

    let result = await run(`let outcomes = [];
for (let i = 0; i < 4; i++) {
  try {
    await realm.resolve({
      instruction: 'Normalize this recipe header.',
      input: { i },
      outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
    });
    outcomes.push('ok');
  } catch (error) {
    outcomes.push(error.message);
  }
}
return outcomes;`);

    let outcomes = JSON.parse(result.scriptResult!);
    assert.deepEqual(outcomes.slice(0, 3), ['ok', 'ok', 'ok']);
    assert.true(/at most 3 times per run/.test(outcomes[3]), outcomes[3]);
    assert.strictEqual(forwarded.length, 3, 'three requests were forwarded');
  });

  test('realm.resolve refuses a request for code, and an answer that holds code', async function (assert) {
    await assert.rejects(
      run(`await realm.resolve({
  instruction: 'Write a JavaScript function that parses this recipe.',
  input: { name: 'beef chili' },
  outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
});`),
      /does not write code, scripts, markup or commands/,
    );
    assert.strictEqual(forwarded.length, 0, 'no model was asked');

    answer = () => chat('{"title":"<script>alert(1)</script>","servings":4}');
    await assert.rejects(
      run(`await realm.resolve({
  instruction: 'Normalize this recipe header.',
  input: { name: 'beef chili' },
  outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
});`),
      /the answer looked like code/,
    );
  });

  test('realm.resolve takes data instructions and answers that only share words with code', async function (assert) {
    answer = () =>
      chat(
        JSON.stringify({
          title: 'Create an account first => then <b>log in</b>',
          servings: 4,
        }),
      );
    for (let instruction of [
      'Update the prices to USD.',
      'Normalize each address and return the ISO country code.',
      'Export the recipe header as a title and a serving count.',
    ]) {
      let result = await run(`return await realm.resolve({
  instruction: ${JSON.stringify(instruction)},
  input: { name: 'beef chili' },
  outputSchema: ${JSON.stringify(RECIPE_SCHEMA)},
});`);
      assert.strictEqual(
        JSON.parse(result.scriptResult!).output.servings,
        4,
        `answered: ${instruction}`,
      );
    }
  });

  test('realm.web.search takes maxResults as an alias of limit, and includeContent', async function (assert) {
    answer = () =>
      chat('Sources.', {
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://example.com/a',
              title: 'A',
              content: 'y'.repeat(3_000),
            },
          },
          {
            type: 'url_citation',
            url_citation: { url: 'http://192.168.1.10/private', title: 'B' },
          },
        ],
      });

    let result =
      await run(`let [found] = await realm.web.search('logos', { maxResults: 2, includeContent: true, tbs: 'qdr:m' });
return { count: (await realm.web.search('logos', { limit: 2, maxResults: 2 })).length, snippet: found.snippet.length, content: found.content.length };`);

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      count: 1,
      snippet: 1_000,
      content: 3_000,
    });
    assert.strictEqual(forwarded[0].request.plugins[0].max_results, 2);
    assert.true(
      forwarded[0].request.messages.at(-1).content.includes('qdr:m'),
      'the time filter reaches the model',
    );
    await assert.rejects(
      run(`await realm.web.search('logos', { limit: 2, maxResults: 3 });`),
      /limit and maxResults must match/,
    );
  });

  test('realm.web.read refuses local and private-network URLs without a request', async function (assert) {
    for (let url of [
      'http://localhost:4201/base/',
      'http://192.168.1.10/',
      'https://user:secret@example.com/',
    ]) {
      await assert.rejects(
        run(`await realm.web.read('${url}');`),
        /cannot read URLs with credentials, local hosts or private-network addresses/,
        url,
      );
    }
    assert.strictEqual(forwarded.length, 0, 'nothing was forwarded');
  });

  test('realm.activity records the steps of a multi-step script', async function (assert) {
    let result =
      await run(`await realm.activity({ message: 'Gather sources', current: 2, total: 4 });
await realm.activity({ message: 'Write the card', phase: 'write' });
return 1;`);

    assert.deepEqual(result.activity, [
      'Step 2 of 4 · Gather sources',
      'Write the card (write)',
    ]);
    await assert.rejects(
      run(
        `await realm.activity({ message: 'Too far', current: 5, total: 4 });`,
      ),
      /current cannot be more than total/,
    );
  });

  test('realm.plan names the steps ahead, and activity counts inside one', async function (assert) {
    let result =
      await run(`await realm.plan(['Search calendars', 'Read each page', 'Compare']);
await realm.activity({ message: 'Read each page', current: 2, total: 3, count: 3, of: 5 });
return 1;`);

    assert.deepEqual(result.activity, [
      'Plan · Search calendars · Read each page · Compare',
      'Step 2 of 3 · Read each page',
    ]);
    await assert.rejects(
      run(`await realm.plan([]);`),
      /realm.plan expects 1 to 12 step names/,
    );
    await assert.rejects(
      run(
        `await realm.activity({ message: 'Read', current: 1, total: 2, count: 6, of: 5 });`,
      ),
      /count cannot be more than of/,
    );
  });

  // Auto-fix answers come from the same proxy. `fix` turns the code the
  // runner sent into the code the model answers with.
  function answerFixes(fix: (code: string) => string) {
    answer = ({ request }) => {
      let { code } = JSON.parse(request.messages[1].content);
      return chat(
        JSON.stringify({
          fixedCode: fix(code),
          summary: "added a missing ']'",
        }),
      );
    };
  }

  const BROKEN = `let items = [1, 2, 3;
return items.length;`;

  test('auto-fix patches a missing bracket and the run completes', async function (assert) {
    answerFixes((code) => code.replace('3;', '3];'));

    let result = await run(BROKEN);

    assert.strictEqual(result.scriptResult, '3', 'the fixed script ran');
    assert.strictEqual(forwarded.length, 1, 'one model call');
    let [{ url, request }] = forwarded;
    assert.strictEqual(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.strictEqual(request.model, 'openai/gpt-4.1-mini');
    let sent = JSON.parse(request.messages[1].content);
    assert.strictEqual(sent.code, BROKEN, 'the model gets the script');
    assert.strictEqual(sent.error.name, 'SyntaxError');
    assert.strictEqual(result.activity.length, 1);
    assert.true(
      /^Fixed a SyntaxError( at line \d+)?: added a missing '\]' \(auto-fix by openai\/gpt-4\.1-mini\)$/.test(
        result.activity[0]!,
      ),
      result.activity[0]!,
    );
    assert.strictEqual(result.scriptFixes.length, 1);
    assert.true(
      result.scriptFixes[0]!.includes(
        '- let items = [1, 2, 3;\n+ let items = [1, 2, 3];',
      ),
      result.scriptFixes[0]!,
    );
  });

  test('auto-fix fixes a ReferenceError thrown before any realm call', async function (assert) {
    answerFixes((code) => code.replace('itmes', 'items'));

    let result = await run(`let items = [1, 2];
return itmes.length;`);

    assert.strictEqual(result.scriptResult, '2');
    assert.strictEqual(forwarded.length, 1);
  });

  test('a script that runs cleanly makes no auto-fix call', async function (assert) {
    let result = await run(`return 1 + 1;`);
    assert.strictEqual(result.scriptResult, '2');
    assert.strictEqual(forwarded.length, 0, 'no model call');
    assert.deepEqual(result.scriptFixes, []);
  });

  test('an error after a realm call is not auto-fixed', async function (assert) {
    answerFixes((code) => code.replace('notDefined()', 'null'));
    await assert.rejects(
      run(`await realm.fs.exists('task.json');
notDefined();`),
      /ReferenceError/,
    );
    assert.strictEqual(forwarded.length, 0, 'no model call');
  });

  test('a fix that adds a realm call is rejected', async function (assert) {
    answerFixes((code) =>
      code.replace('3;', "3];\nawait realm.fs.exists('task.json');"),
    );
    await assert.rejects(
      run(BROKEN),
      /SyntaxError[\s\S]*rejected the fix: the fix added realm\.fs\.exists/,
    );
    assert.strictEqual(forwarded.length, 1);
  });

  test('a fix that changes the arguments of a realm call is rejected', async function (assert) {
    answerFixes((code) =>
      code
        .replace('3;', '3];')
        .replace("delete('draft.json')", "delete('index.json')"),
    );
    await assert.rejects(
      run(`let items = [1, 2, 3;
await realm.fs.delete('draft.json');`),
      /rejected the fix: the fix changed a line that uses realm or room/,
    );
  });

  test('a fix that changes too much is rejected', async function (assert) {
    answerFixes((code) =>
      code.replace('3;', `3];\n${'items.push(0);\n'.repeat(8)}`),
    );
    await assert.rejects(
      run(BROKEN),
      /rejected the fix: the fix changed more than 5 lines/,
    );
  });

  test('auto-fix stops after its attempt cap', async function (assert) {
    // Each fix compiles no better than the script it replaced.
    answerFixes((code) =>
      code.includes('3;') ? code.replace('3;', '3}') : code.replace('3}', '3;'),
    );
    await assert.rejects(
      run(BROKEN),
      /SyntaxError[\s\S]*auto-fixed the script/,
    );
    assert.strictEqual(forwarded.length, 2, 'two fixes were asked for');
  });
});
