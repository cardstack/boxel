import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CheckCorrectnessCommand from '@cardstack/host/commands/check-correctness';
import PatchCardInstanceCommand from '@cardstack/host/commands/patch-card-instance';
import PatchCodeCommand from '@cardstack/host/commands/patch-code';

import { type CommandContext } from '@cardstack/runtime-common';

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
      cardId,
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
      cardId,
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
      cardId,
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
      cardId,
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
      cardId,
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
      cardId,
      roomId,
    });

    assert.true(thirdResult.correct, 'third run reports no errors');
  });
});
