import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';
import {
  basicMappings,
  type ObjectSchema,
} from '@cardstack/runtime-common/helpers/ai';

import { StackItem } from '@cardstack/host/lib/stack-item';
import CopyCardToRealmTool from '@cardstack/host/tools/copy-card';
import CopyCardToStackTool from '@cardstack/host/tools/copy-card-to-stack';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef } from '@cardstack/base/card-api';

const testRealm2URL = 'http://test-realm/test2/';

module('Integration | tools | copy-card', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'pet.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
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
                  module: '@cardstack/base/cards-grid',
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
      });
    });

    // Ensure realms are logged in with write permissions
    let realmService = getService('realm');
    await realmService.login(testRealmURL);
    await realmService.login(testRealm2URL);
  });

  module('CopyCardToRealmTool', function () {
    test('copies card to target realm', async function (assert) {
      let toolService = getService('tool-service');
      let copyCardCommand = new CopyCardToRealmTool(toolService.toolContext);

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

    test('puts the copy beneath localDir, in a folder named after its type', async function (assert) {
      let toolService = getService('tool-service');
      let copyCardCommand = new CopyCardToRealmTool(toolService.toolContext);

      let store = getService('store');
      let sourceCard = (await store.get(`${testRealmURL}Pet/mango`)) as CardDef;

      let result = await copyCardCommand.execute({
        sourceCard,
        targetRealm: testRealm2URL,
        localDir: 'projects/acme',
      });

      assert.true(
        result.newCardId.startsWith(`${testRealm2URL}projects/acme/Pet/`),
        `copy lands at <targetRealm><localDir>/<CardTypeName>/<generated-id>, got ${result.newCardId}`,
      );
      let copiedCard = (await store.get(result.newCardId)) as CardDef;
      assert.strictEqual(
        (copiedCard as CardDef & { firstName: string }).firstName,
        'Mango',
        'the copy is readable at newCardId',
      );
    });

    test('reads a leading slash in localDir as the realm root', async function (assert) {
      let copyCardCommand = new CopyCardToRealmTool(
        getService('tool-service').toolContext,
      );
      let store = getService('store');
      let sourceCard = (await store.get(`${testRealmURL}Pet/mango`)) as CardDef;

      let result = await copyCardCommand.execute({
        sourceCard,
        targetRealm: testRealm2URL,
        localDir: '/projects/acme',
      });

      assert.true(
        result.newCardId.startsWith(`${testRealm2URL}projects/acme/Pet/`),
        `copy stays inside the target realm, got ${result.newCardId}`,
      );
    });

    test('refuses a localDir that leaves the target realm', async function (assert) {
      let copyCardCommand = new CopyCardToRealmTool(
        getService('tool-service').toolContext,
      );
      let store = getService('store');
      let sourceCard = (await store.get(`${testRealmURL}Pet/mango`)) as CardDef;

      for (let localDir of ['../test', 'projects/../../test', '%2e%2e/test']) {
        await assert.rejects(
          copyCardCommand.execute({
            sourceCard,
            targetRealm: testRealm2URL,
            localDir,
          }),
          /is not a folder inside/,
          `localDir "${localDir}" is refused`,
        );
      }
    });

    test('refuses to run without a sourceCard, saying how to pass one', async function (assert) {
      let copyCardCommand = new CopyCardToRealmTool(
        getService('tool-service').toolContext,
      );

      await assert.rejects(
        copyCardCommand.execute({ targetRealm: testRealm2URL } as any),
        /No sourceCard to copy: pass the card as relationships\.sourceCard\.links\.self/,
      );
    });

    test('the tool schema describes how targetRealm and localDir make up the path of the copy', async function (assert) {
      let loader = getService('loader-service').loader;
      let cardAPI = await loader.import<typeof CardAPI>(
        '@cardstack/base/card-api',
      );
      let mappings = await basicMappings(loader);
      let copyCardCommand = new CopyCardToRealmTool(
        getService('tool-service').toolContext,
      );

      let schema = await copyCardCommand.getInputJsonSchema(
        cardAPI,
        mappings,
        true,
      );
      let { properties } = schema.attributes as ObjectSchema;

      assert.true(
        properties.targetRealm?.description?.includes(
          '<targetRealm><localDir>/<CardTypeName>/<generated-id>.json',
        ),
        'targetRealm states the path the copy is written to',
      );
      assert.true(
        properties.localDir?.description?.includes(
          'projects/acme/Incident/<generated-id>.json',
        ),
        'localDir gives an example of the folder it adds and the generated file name',
      );
    });

    test('errors when user does not have write permissions to target realm', async function (assert) {
      let toolService = getService('tool-service');
      let copyCardCommand = new CopyCardToRealmTool(toolService.toolContext);

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

  module('CopyCardToStackTool', function () {
    test('copies card to stack when valid targetStackIndex is provided', async function (assert) {
      let toolService = getService('tool-service');
      let copyCardToStackCommand = new CopyCardToStackTool(
        toolService.toolContext,
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
    test('puts the copy beneath localDir in the target stack realm', async function (assert) {
      let copyCardToStackCommand = new CopyCardToStackTool(
        getService('tool-service').toolContext,
      );

      let operatorModeStateService = getService('operator-mode-state-service');
      operatorModeStateService.topMostStackItems = () => [
        new StackItem({
          id: `${testRealm2URL}Pet/fluffy`,
          format: 'isolated',
          stackIndex: 0,
        }),
      ];

      let store = getService('store');
      let sourceCard = (await store.get(`${testRealmURL}Pet/mango`)) as CardDef;

      let result = await copyCardToStackCommand.execute({
        sourceCard,
        targetStackIndex: 0,
        localDir: 'projects/acme',
      });

      assert.true(
        result.newCardId.startsWith(`${testRealm2URL}projects/acme/Pet/`),
        `copy lands beneath localDir in the stack's realm, got ${result.newCardId}`,
      );
    });

    test('errors when targetStackIndex does not exist', async function (assert) {
      let toolService = getService('tool-service');
      let copyCardToStackCommand = new CopyCardToStackTool(
        toolService.toolContext,
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
