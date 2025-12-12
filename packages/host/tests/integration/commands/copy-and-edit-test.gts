import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  realmURL as realmURLSymbol,
  baseRealm,
} from '@cardstack/runtime-common';

import CopyAndEditCommand from '@cardstack/host/commands/copy-and-edit';
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

const otherRealmURL = 'http://other-realm/test2/';

module('Integration | commands | copy-and-edit', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, otherRealmURL],
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
          'content-card.gts': `
          import { CardDef, contains, field, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Child extends CardDef {
            static displayName = 'Child';
            @field name = contains(StringField);
          }

          export class Parent extends CardDef {
            static displayName = 'Parent';
            @field child = linksTo(Child);
            @field children = linksToMany(() => Child);
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
                'children.0': {
                  links: {
                    self: '../Child/og',
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
          'simple-card.gts': `
          import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class SimpleCard extends CardDef {
            static displayName = 'SimpleCard';
          }
        `,
          'simple-card-instance.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './simple-card',
                  name: 'SimpleCard',
                },
              },
            },
          },
        },
        loader,
      });

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: otherRealmURL,
        contents: {
          'content-card.gts': `
          import { CardDef, contains, field } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Child extends CardDef {
            static displayName = 'Child';
            @field name = contains(StringField);
          }
        `,
          'Child/remote.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'RemoteChild',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}content-card`,
                  name: 'Child',
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
    let realmService = getService('realm');
    await realmService.login(testRealmURL);
    await realmService.login(otherRealmURL);
  });

  test('copies card and relinks linksTo parent (same realm)', async function (assert) {
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
        relationshipContext: {
          fieldName: 'child',
          fieldType: 'linksTo',
        },
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: childCard,
    });

    await settled();

    let updatedParent = (await store.get(parentCard.id as string)) as CardDef;
    let newChildId =
      (updatedParent as any).child?.id ?? (updatedParent as any).child;

    assert.ok(newChildId, 'parent now links to a child (linksTo)');
    assert.notEqual(
      newChildId,
      childCard.id,
      'parent links to a different child after copy',
    );
    if (newChildId) {
      let copiedChild = (await store.get(newChildId)) as CardDef;
      assert.strictEqual(
        copiedChild[realmURLSymbol]?.href,
        testRealmURL,
        'new child is in same realm as source',
      );
    }
  });

  test('copies card without linked parent (query-derived stack) and does not throw', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let childCard = (await store.get(`${testRealmURL}Child/og`)) as CardDef;

    // simulate a query-derived stack: only the index card present
    operatorModeStateService.clearStacks();
    operatorModeStateService.addItemToStack(
      operatorModeStateService.createStackItem(
        `${testRealmURL}index`,
        0,
        'isolated',
      ),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: childCard,
    });

    assert.ok(true, 'command completes without throwing when no parent linked');
  });

  test('copies card in single stack and replaces current item', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let simpleCard = (await store.get(
      `${testRealmURL}simple-card-instance`,
    )) as CardDef;

    operatorModeStateService.addItemToStack(
      new StackItem({
        id: simpleCard.id as string,
        format: 'isolated',
        stackIndex: 0,
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: simpleCard,
    });

    await settled();

    let stacks = operatorModeStateService.state?.stacks ?? [];
    let topItemId = stacks[0]?.[stacks[0].length - 1]?.id;
    assert.ok(topItemId, 'stack has a top item after copy');
    assert.notEqual(
      topItemId,
      simpleCard.id,
      'stack item replaced with copied card',
    );
  });

  test('copies card and relinks linksToMany parent (same realm)', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let parentCard = (await store.get(`${testRealmURL}Parent/root`)) as CardDef;
    let childCard = (await store.get(`${testRealmURL}Child/og`)) as CardDef;

    // stack: parent above child
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
        relationshipContext: {
          fieldName: 'children',
          fieldType: 'linksToMany',
        },
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: childCard,
    });

    await settled();

    let updatedParent = (await store.get(parentCard.id as string)) as CardDef;
    let newChildrenIds =
      ((updatedParent as any).children as any[])?.map((c: any) => c?.id ?? c) ??
      [];
    assert.ok(
      newChildrenIds.some((id) => id && id !== childCard.id),
      'linksToMany children updated to include copied child',
    );
  });

  test('copies linked card and relinks linksTo parent (cross realm)', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let parentCard = (await store.get(`${testRealmURL}Parent/root`)) as CardDef;
    let remoteChild = (await store.get(
      `${otherRealmURL}Child/remote`,
    )) as CardDef;

    operatorModeStateService.addItemToStack(
      new StackItem({
        id: parentCard.id as string,
        format: 'isolated',
        stackIndex: 0,
      }),
    );
    operatorModeStateService.addItemToStack(
      new StackItem({
        id: remoteChild.id as string,
        format: 'isolated',
        stackIndex: 0,
        relationshipContext: {
          fieldName: 'child',
          fieldType: 'linksTo',
        },
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: remoteChild,
    });

    await settled();

    let updatedParent = (await store.get(parentCard.id as string)) as CardDef;
    let newChildId =
      (updatedParent as any).child?.id ?? (updatedParent as any).child;

    assert.ok(newChildId, 'parent now links to a child after copy');
    assert.notEqual(
      newChildId,
      remoteChild.id,
      'parent links to a different child after copy',
    );
    assert.ok(
      (newChildId as string).startsWith(otherRealmURL),
      'copied child remains in original remote realm',
    );
  });

  test('copies card and relinks linksToMany parent (cross realm)', async function (assert) {
    let commandService = getService('command-service');
    let store = getService('store');
    let operatorModeStateService = getService('operator-mode-state-service');

    let parentCard = (await store.get(`${testRealmURL}Parent/root`)) as CardDef;
    let remoteChild = (await store.get(
      `${otherRealmURL}Child/remote`,
    )) as CardDef;

    // seed parent children with remote child
    (parentCard as any).children = [remoteChild];
    if (parentCard.id) {
      store.save(parentCard.id as string);
    }

    operatorModeStateService.addItemToStack(
      new StackItem({
        id: parentCard.id as string,
        format: 'isolated',
        stackIndex: 0,
      }),
    );
    operatorModeStateService.addItemToStack(
      new StackItem({
        id: remoteChild.id as string,
        format: 'isolated',
        stackIndex: 0,
        relationshipContext: {
          fieldName: 'children',
          fieldType: 'linksToMany',
        },
      }),
    );

    let command = new CopyAndEditCommand(commandService.commandContext);
    await command.execute({
      card: remoteChild,
    });

    await settled();

    let updatedParent = (await store.get(parentCard.id as string)) as CardDef;
    let newChildrenIds =
      ((updatedParent as any).children as any[])?.map((c: any) => c?.id ?? c) ??
      [];
    assert.ok(
      newChildrenIds.some((id) => id && id !== remoteChild.id),
      'linksToMany children updated to include copied child',
    );
    assert.ok(
      newChildrenIds.some(
        (id) => id && (id as string).startsWith(otherRealmURL),
      ),
      'copied child remains in original remote realm',
    );
  });
});
