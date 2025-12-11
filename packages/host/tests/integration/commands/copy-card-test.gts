import { module, test } from 'qunit';

import {
  realmURL as realmURLSymbol,
  baseRealm,
} from '@cardstack/runtime-common';

import CopyCardToRealmCommand from '@cardstack/host/commands/copy-card';
import CopyCardToStackCommand from '@cardstack/host/commands/copy-card-to-stack';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';
import { getService } from '@universal-ember/test-support';

const testRealm2URL = 'http://test-realm/test2/';

module('Integration | commands | copy-card', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await loader.import(`${baseRealm.url}command`);
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
        loader,
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
          'Pet/fluffy.json': {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Fluffy',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}pet`,
                  name: 'Pet',
                },
              },
            },
          },
        },
        loader,
      });
      return {};
    },
  });

  hooks.beforeEach(async function () {
    // Ensure realms are logged in with write permissions
    let realmService = getService('realm');
    await realmService.login(testRealmURL);
    await realmService.login(testRealm2URL);
  });

  module('CopyCardToRealmCommand', function () {
    test('copies card to target realm', async function (assert) {
      let commandService = getService('command-service');
      let copyCardCommand = new CopyCardToRealmCommand(
        commandService.commandContext,
      );

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

    test('errors when user does not have write permissions to target realm', async function (assert) {
      let commandService = getService('command-service');
      let copyCardCommand = new CopyCardToRealmCommand(
        commandService.commandContext,
      );

      let sourceCardUrl = `${testRealmURL}Pet/mango`;
      let targetRealm = testRealm2URL;

      // Log out from all realms, then log back into source realm only
      let realmService = getService('realm');
      realmService.logout();
      await realmService.login(testRealmURL);

      // Get the source card using the store
      let store = getService('store');
      let sourceCard = (await store.get(sourceCardUrl)) as CardDef;
      assert.ok(sourceCard, 'source card exists');

      try {
        await copyCardCommand.execute({
          sourceCard,
          targetRealm,
        });
        assert.ok(false, 'should have thrown an error');
      } catch (error: any) {
        assert.ok(error instanceof Error, 'throws an error');
        assert.strictEqual(
          error.message,
          `Do not have write permissions to ${targetRealm}`,
          'error message indicates write permission issue',
        );
      }
    });
  });

  module('CopyCardToStackCommand', function () {
    test('copies card to stack when valid targetStackIndex is provided', async function (assert) {
      let commandService = getService('command-service');
      let copyCardToStackCommand = new CopyCardToStackCommand(
        commandService.commandContext,
      );

      let sourceCardUrl = `${testRealmURL}Pet/mango`;
      let targetStackIndex = 0;
      let targetCardUrl = `${testRealm2URL}Pet/fluffy`;

      // Mock the operator mode state service to return a card in the target stack
      let operatorModeStateService = getService('operator-mode-state-service');
      operatorModeStateService.topMostStackItems = () => [
        new StackItem({
          id: targetCardUrl,
          format: 'isolated',
          stackIndex: 0,
        }),
      ];

      // Get the source card using the store
      let store = getService('store');
      let sourceCard = (await store.get(sourceCardUrl)) as CardDef;
      assert.ok(sourceCard, 'source card exists');
      assert.strictEqual(
        sourceCard[realmURLSymbol]?.href,
        testRealmURL,
        'source card is from expected realm',
      );

      let result = await copyCardToStackCommand.execute({
        sourceCard,
        targetStackIndex,
      });

      assert.ok(result.newCardId, 'new card URL is returned');
      assert.true(
        result.newCardId.startsWith(testRealm2URL),
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
        testRealm2URL,
        'copied card is in target realm',
      );
    });
    test('errors when targetStackIndex does not exist', async function (assert) {
      let commandService = getService('command-service');
      let copyCardToStackCommand = new CopyCardToStackCommand(
        commandService.commandContext,
      );

      let sourceCardUrl = `${testRealmURL}Pet/mango`;
      let targetStackIndex = 99; // Non-existent stack index

      // Get the source card using the store
      let store = getService('store');
      let sourceCard = (await store.get(sourceCardUrl)) as CardDef;

      try {
        await copyCardToStackCommand.execute({
          sourceCard,
          targetStackIndex,
        });
        assert.ok(false, 'should have thrown an error');
      } catch (error: any) {
        assert.ok(error instanceof Error, 'throws an error');
        assert.true(
          error.message.includes('Cannot find topmost card in target stack'),
          'error message mentions missing stack',
        );
      }
    });
  });
});
