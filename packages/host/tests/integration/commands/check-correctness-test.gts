import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { CommandContext } from '@cardstack/runtime-common';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';

import CheckCorrectnessCommand from '@cardstack/host/commands/check-correctness';
import PatchCardInstanceCommand from '@cardstack/host/commands/patch-card-instance';
import PatchCodeCommand from '@cardstack/host/commands/patch-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | check-correctness', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    autostart: true,
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import BooleanField from "https://cardstack.com/base/boolean";
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
    });
    let realmService = getService('realm');
    let messageService = getService('message-service');
    messageService.register();
    await realmService.login(testRealmURL);
  });

  test('reports card instance correctness when PatchCardInstanceCommand is used', async function (assert) {
    let commandService = getService('command-service') as {
      commandContext: CommandContext;
    };
    let store = getService('store') as any;
    let loader = getService('loader-service').loader as any;
    let { Pet } = await loader.import(`${testRealmURL}pet`);

    let cardId = `${testRealmURL}Pet/billy`;
    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let command = new CheckCorrectnessCommand(commandService.commandContext);
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);
    let roomId = '!room:example.com';

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(firstResult.correct, 'initial run reports no errors');

    let patchCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      { cardType: Pet },
    );
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
    console.log(secondResult.errors);
    assert.ok(
      secondResult.errors.some((e: string) =>
        e.includes('Name cannot be "Bill"'),
      ),
      'reports the validation error from the card constructor',
    );

    // Put the card back to its working state. We can't use PatchCardInstanceCommand, because the instance
    // is broken and patching won't work. Instead, we need to patch the code directly.

    let revertResult = await patchCodeCommand.execute({
      fileUrl: `${cardId}.json`,
      codeBlocks: [
        `╔═══ SEARCH ════╗
      "hasError": true,
      "name": "Bill"
╠═══════════════╣
      "hasError": false,
      "name": "Billy"
╚═══ REPLACE ═══╝`,
      ],
      roomId,
    });

    assert.strictEqual(
      revertResult.results[0].status,
      'applied',
      'revert patch is applied',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });

  test('reports card instance correctness when PatchCodeCommand is used', async function (assert) {
    let commandService = getService('command-service') as {
      commandContext: CommandContext;
    };
    let store = getService('store') as any;

    let command = new CheckCorrectnessCommand(commandService.commandContext);
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);
    let cardId = `${testRealmURL}Pet/billy`;
    let fileUrl = `${cardId}.json`;
    let roomId = '!room:example.com';

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let firstResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });
    assert.true(firstResult.correct, 'initial run reports no errors');

    const patchBlocks = [
      `╔═══ SEARCH ════╗
{"data":{"type":"card","attributes":{"name":"Billy","hasError":false},"meta":{"adoptsFrom":{"module":"../pet","name":"Pet"}}}}
╠═══════════════╣
{"data":{"type":"card","attributes":{"name":"Bill","hasError":true},"meta":{"adoptsFrom":{"module":"../pet","name":"Pet"}}}}
╚═══ REPLACE ═══╝`,
    ];

    await patchCodeCommand.execute({
      fileUrl,
      codeBlocks: patchBlocks,
      roomId,
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

    const revertBlocks = [
      `╔═══ SEARCH ════╗
{"data":{"type":"card","attributes":{"name":"Bill","hasError":true},"meta":{"adoptsFrom":{"module":"../pet","name":"Pet"}}}}
╠═══════════════╣
{"data":{"type":"card","attributes":{"name":"Billy","hasError":false},"meta":{"adoptsFrom":{"module":"../pet","name":"Pet"}}}}
╚═══ REPLACE ═══╝`,
    ];

    // Put the card back to its working state
    let revertResult = await patchCodeCommand.execute({
      fileUrl,
      codeBlocks: revertBlocks,
      roomId,
    });

    assert.strictEqual(
      revertResult.results[0].status,
      'applied',
      'revert patch is applied',
    );

    let thirdResult = await command.execute({
      targetType: 'card',
      targetRef: cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });

  test('skips correctness checks for empty files', async function (assert) {
    let commandService = getService('command-service') as {
      commandContext: CommandContext;
    };
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);
    let command = new CheckCorrectnessCommand(commandService.commandContext);
    let roomId = '!room:example.com';
    let emptyFileUrl = `${testRealmURL}empty.gts`;
    let cardService = getService('card-service');

    const codeBlock = `${SEARCH_MARKER}
${SEPARATOR_MARKER}
${REPLACE_MARKER}`;

    await patchCodeCommand.execute({
      fileUrl: emptyFileUrl,
      codeBlocks: [codeBlock],
      roomId,
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

  test('reports size limit errors for file writes', async function (assert) {
    let commandService = getService('command-service') as {
      commandContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let cardService = getService('card-service');
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);
    let command = new CheckCorrectnessCommand(commandService.commandContext);
    let roomId = '!room:example.com';
    let fileUrl = `${testRealmURL}pet.gts`;

    let originalMaxSize = environmentService.maxCardWriteSizeBytes;
    environmentService.maxCardWriteSizeBytes = 20;

    try {
      let { content } = await cardService.getSource(new URL(fileUrl));
      const codeBlock = `${SEARCH_MARKER}
${content}
${SEPARATOR_MARKER}
${'x'.repeat(21)}
${REPLACE_MARKER}`;
      await patchCodeCommand.execute({
        fileUrl,
        codeBlocks: [codeBlock],
        roomId,
      });

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
      environmentService.maxCardWriteSizeBytes = originalMaxSize;
    }
  });

  test('reports size limit errors for card writes via PatchCardInstanceCommand', async function (assert) {
    let commandService = getService('command-service') as {
      commandContext: CommandContext;
    };
    let environmentService = getService('environment-service') as any;
    let loader = getService('loader-service').loader as any;
    let store = getService('store') as any;
    let command = new CheckCorrectnessCommand(commandService.commandContext);
    let roomId = '!room:example.com';
    let { Pet } = await loader.import(`${testRealmURL}pet`);
    let cardId = `${testRealmURL}Pet/billy`;

    store.addReference(cardId);
    await store.waitForCardLoad(cardId);

    let originalMaxSize = environmentService.maxCardWriteSizeBytes;
    environmentService.maxCardWriteSizeBytes = 1000;

    try {
      let patchCommand = new PatchCardInstanceCommand(
        commandService.commandContext,
        { cardType: Pet },
      );

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
      console.log(result.errors);
      assert.false(result.correct, 'size limit error reports incorrect');
      assert.ok(
        result.errors[0]?.includes('exceeds maximum allowed size (20 bytes)'),
        'error mentions size limit',
      );
    } finally {
      environmentService.maxCardWriteSizeBytes = originalMaxSize;
    }
  });
});
