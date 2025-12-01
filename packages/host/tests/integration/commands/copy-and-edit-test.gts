import { settled } from '@ember/test-helpers';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import CopyAndEditCommand from '@cardstack/host/commands/copy-and-edit';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | copy-and-edit', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'content-card.gts': `
          import { CardDef, contains, field, linksTo } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Child extends CardDef {
            static displayName = 'Child';
            @field name = contains(StringField);
          }

          export class Parent extends CardDef {
            static displayName = 'Parent';
            @field child = linksTo(Child);
          }
        `,
        'Child/og.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Original',
            },
            meta: {
              adoptsFrom: {
                module: '../content-card',
                name: 'Child',
              },
            },
          },
        },
        'Parent/root.json': {
          data: {
            type: 'card',
            relationships: {
              child: {
                data: {
                  type: 'card',
                  id: '../Child/og',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../content-card',
                name: 'Parent',
              },
            },
          },
        },
      },
    });

    let realmService = getService('realm');
    await realmService.login(testRealmURL);
  });

  test('copies card and relinks parent in same realm', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let parentCard = (await store.get(`${testRealmURL}Parent/root`)) as CardDef;
    let childCard = (await store.get(`${testRealmURL}Child/og`)) as CardDef;

    // prime stack so deriveLinkedParent can find the parent above the child
    operatorModeStateService.addItemToStack(
      new StackItem({
        id: parentCard.id as string,
        format: 'isolated',
        stackIndex: 0,
      }),
    );
    operatorModeStateService.addItemToStack(
      new StackItem({
        id: childCard.id as string,
        format: 'isolated',
        stackIndex: 0,
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    let result = await command.execute({
      card: childCard,
    });

    assert.ok(result.newCard, 'returns new card reference');
    assert.strictEqual(
      result.newCard[realmURLSymbol]?.href,
      testRealmURL,
      'new card is in same realm as source',
    );

    await settled();

    let updatedParent = (await store.get(
      parentCard.id as string,
    )) as CardDef;
    assert.strictEqual(
      (updatedParent as any).child?.id ?? (updatedParent as any).child,
      result.newCard.id ?? result.newCard,
      'parent now links to copied child',
    );
  });
});
