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
