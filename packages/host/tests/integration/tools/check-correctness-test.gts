import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { CommandContext } from '@cardstack/runtime-common';

import CheckCorrectnessTool from '@cardstack/host/tools/check-correctness';
import PatchCardInstanceTool from '@cardstack/host/tools/patch-card-instance';
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

function petDocument(name: string, hasError: boolean) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { name, hasError },
        meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
      },
    },
    null,
    2,
  );
}

// A run-realm-code script that replaces the whole content of the existing
// file at `path`.
function overwriteScript(path: string, content: string) {
  let p = JSON.stringify(path);
  return `await realm.fs.replace(${p}, await realm.fs.readText(${p}), ${JSON.stringify(
    content,
  )});`;
}

// A run-realm-code script that creates the file at `path`.
function writeTextScript(path: string, content: string) {
  return `await realm.fs.writeText(${JSON.stringify(path)}, ${JSON.stringify(
    content,
  )});`;
}

module('Integration | tools | check-correctness', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    autostart: true,
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'pet.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          import BooleanField from "@cardstack/base/boolean";
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
            @field hasError = contains(BooleanField);
            @field boom = contains(StringField, {
              computeVia: function (this: Pet) {
                if (this.hasError) {
                  throw new Error('Name cannot be "Bill"');
                }
                return 'ok';
              },
            });
          }
        `,
          'settings.json': {
            type: 'module',
            meta: { version: 1 },
            attributes: { enabled: true },
          },
          'Pet/billy.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Billy',
                hasError: false,
              },
              meta: {
                adoptsFrom: {
                  module: '../pet',
                  name: 'Pet',
                },
              },
            },
          },
        },
      }),
    );
    let realmService = getService('realm');
    let messageService = getService('message-service');
    messageService.register();
    await realmService.login(testRealmURL);
  });

  test('reports card instance correctness when PatchCardInstanceTool is used', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let store = getService('store') as any;
    let loader = getService('loader-service').loader as any;
    let { Pet } = await loader.import(`${testRealmURL}pet`);

    let cardId = `${testRealmURL}Pet/billy`;
    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let command = new CheckCorrectnessTool(toolService.toolContext);
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let roomId = '!room:example.com';

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(firstResult.correct, 'initial run reports no errors');

    let patchCommand = new PatchCardInstanceTool(toolService.toolContext, {
      cardType: Pet,
    });
    await patchCommand.execute({
      cardId,
      patch: {
        attributes: {
          name: 'Bill',
          hasError: true,
        },
      },
      roomId,
    });

    let secondResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.false(
      secondResult.correct,
      'second run reports errors after invalid change',
    );
    assert.ok(
      secondResult.errors.some((e: string) =>
        e.includes('Name cannot be "Bill"'),
      ),
      'reports the validation error from the card constructor',
    );

    // Put the card back to its working state. We can't use PatchCardInstanceTool, because the instance
    // is broken and patching won't work. Instead, we need to write the file directly.
    let revertResult = await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Billy', false)),
    });

    assert.strictEqual(
      revertResult.files[0]?.status,
      'saved',
      'revert write is saved',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });

  test('reports card instance correctness when RunRealmCodeTool is used', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let store = getService('store') as any;

    let command = new CheckCorrectnessTool(toolService.toolContext);
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let cardId = `${testRealmURL}Pet/billy`;
    let roomId = '!room:example.com';

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });
    assert.true(firstResult.correct, 'initial run reports no errors');

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Bill', true)),
    });

    let secondResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.false(secondResult.correct, 'second run reports errors');
    assert.ok(
      secondResult.errors.some((e: string) =>
        e.includes('Name cannot be "Bill"'),
      ),
      'reports the validation error from the card constructor',
    );

    // Put the card back to its working state
    let revertResult = await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: overwriteScript('Pet/billy.json', petDocument('Billy', false)),
    });

    assert.strictEqual(
      revertResult.files[0]?.status,
      'saved',
      'revert write is saved',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });

  test('skips correctness checks for empty files', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let emptyFileUrl = `${testRealmURL}empty.gts`;
    let cardService = getService('card-service');

    await runRealmCodeCommand.execute({
      realm: testRealmURL,
      roomId,
      code: writeTextScript('empty.gts', ''),
    });

    await waitUntil(async () => {
      let { status, content } = await cardService.getSource(
        new URL(emptyFileUrl),
      );
      return status === 200 && content.trim() === '';
    });

    let result = await command.execute({
      targetType: 'file',
      targetRef: emptyFileUrl,
      roomId,
    });

    assert.true(result.correct, 'empty file reports as correct');
    assert.deepEqual(result.errors, [], 'no errors are reported');
  });

  test('does not treat ordinary JSON configuration as a malformed card', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let command = new CheckCorrectnessTool(toolService.toolContext);

    let result = await command.execute({
      targetType: 'file',
      targetRef: `${testRealmURL}settings.json`,
      roomId: '!room:example.com',
    });

    assert.true(result.correct, 'ordinary JSON is not treated as a card');
    assert.deepEqual(result.errors, [], 'no card-document errors are reported');
  });

  test('reports size limit errors for file writes', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let runRealmCodeCommand = new RunRealmCodeTool(toolService.toolContext);
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let fileUrl = `${testRealmURL}notes.txt`;

    let originalMaxSize = environmentService.fileSizeLimitBytes;
    environmentService.fileSizeLimitBytes = 20;

    try {
      await assert.rejects(
        runRealmCodeCommand.execute({
          realm: testRealmURL,
          roomId,
          code: writeTextScript('notes.txt', 'x'.repeat(21)),
        }),
        'the oversized write is refused',
      );

      let result = await command.execute({
        targetType: 'file',
        targetRef: fileUrl,
        roomId,
      });

      assert.false(result.correct, 'size limit error reports incorrect');
      assert.ok(
        result.errors[0]?.includes('exceeds maximum allowed size (20 bytes)'),
        'error mentions size limit',
      );
    } finally {
      environmentService.fileSizeLimitBytes = originalMaxSize;
    }
  });

  test('reports size limit errors for card writes via PatchCardInstanceTool', async function (assert) {
    let toolService = getService('tool-service') as {
      toolContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let loader = getService('loader-service').loader as any;
    let store = getService('store') as any;
    let command = new CheckCorrectnessTool(toolService.toolContext);
    let roomId = '!room:example.com';
    let { Pet } = await loader.import(`${testRealmURL}pet`);
    let cardId = `${testRealmURL}Pet/billy`;

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let originalMaxSize = environmentService.cardSizeLimitBytes;
    environmentService.cardSizeLimitBytes = 1000;

    try {
      let patchCommand = new PatchCardInstanceTool(toolService.toolContext, {
        cardType: Pet,
      });

      await patchCommand.execute({
        cardId,
        patch: {
          attributes: {
            name: 'x'.repeat(2000),
          },
        },
        roomId,
      });

      let result = await command.execute({
        targetType: 'card',
        targetRef: cardId,
        roomId,
      });
      assert.false(result.correct, 'size limit error reports incorrect');
      assert.ok(
        result.errors[0]?.includes('exceeds maximum allowed size (1000 bytes)'),
        'error mentions size limit',
      );
    } finally {
      environmentService.cardSizeLimitBytes = originalMaxSize;
    }
  });
});
