import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import CopyCardCommand from '@cardstack/host/commands/copy-card';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const testRealm2URL = 'http://test-realm/test2/';

module('Integration | commands | copy-card', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'pet.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field firstName = contains(StringField);
          }
        `,
        'Pet/mango.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mango',
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

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
  });

  test('copies card to target realm', async function (assert) {
    let commandService = getService('command-service');
    let copyCardCommand = new CopyCardCommand(commandService.commandContext);

    let sourceCardUrl = `${testRealmURL}Pet/mango`;
    let targetRealm = testRealm2URL;

    // Get the source card using the store
    let store = getService('store');
    let sourceCard = (await store.get(sourceCardUrl)) as CardDef;
    assert.ok(sourceCard, 'source card exists');
    assert.strictEqual(
      sourceCard[realmURLSymbol]?.href,
      testRealmURL,
      'source card is from expected realm',
    );

    let result = await copyCardCommand.execute({
      sourceCard,
      targetRealm,
    });

    assert.ok(result.newCardId, 'new card URL is returned');
    assert.true(
      result.newCardId.startsWith(targetRealm),
      'new card is created in target realm',
    );
    assert.notEqual(
      result.newCardId,
      sourceCardUrl,
      'new card has different URL than source',
    );

    // Verify the card was actually copied by getting it from the store
    let copiedCard = (await store.get(result.newCardId)) as CardDef;
    assert.ok(copiedCard, 'copied card exists in store');
    assert.strictEqual(
      copiedCard[realmURLSymbol]?.href,
      targetRealm,
      'copied card is in target realm',
    );
  });

  test('errors when stackIndex is provided but does not exist', async function (assert) {
    let commandService = getService('command-service');
    let copyCardCommand = new CopyCardCommand(commandService.commandContext);

    let sourceCardUrl = `${testRealmURL}Pet/mango`;
    let targetStackIndex = 99; // Non-existent stack index

    // Get the source card using the store
    let store = getService('store');
    let sourceCard = (await store.get(sourceCardUrl)) as CardDef;

    try {
      await copyCardCommand.execute({
        sourceCard,
        targetStackIndex,
      });
      assert.ok(false, 'should have thrown an error');
    } catch (error: any) {
      assert.ok(error instanceof Error, 'throws an error');
      assert.true(
        error.message.includes('Cannot find topmost card in target stack'),
      );
    }
  });

  test('errors when neither stackIndex nor targetRealm is provided', async function (assert) {
    let commandService = getService('command-service');
    let copyCardCommand = new CopyCardCommand(commandService.commandContext);

    let sourceCardUrl = `${testRealmURL}Pet/mango`;

    // Get the source card using the store
    let store = getService('store');
    let sourceCard = (await store.get(sourceCardUrl)) as CardDef;

    try {
      await copyCardCommand.execute({
        sourceCard,
      });
      assert.ok(false, 'should have thrown an error');
    } catch (error: any) {
      assert.ok(error instanceof Error, 'throws an error');
      assert.true(
        error.message.includes(
          'Both targetStackIndex and targetRealm are set; only one should be set -- using targetRealm',
        ),
      );
    }
  });
});
