import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import { RenderingTestContext } from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test, skip } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import ShowCardCommand from '@cardstack/host/commands/show-card';
import { StackItem } from '@cardstack/host/lib/stack-item';

import type { OperatorModeState } from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';

import * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

class MockOperatorModeStateService extends Service {
  @tracked state: Partial<OperatorModeState> = {
    submode: 'interact' as 'interact' | 'code',
    codeSelection: undefined as string | undefined,
  };
  @tracked codePathString: string | undefined;

  addedStackItems: StackItem[] = [];
  updatedCodePaths: URL[] = [];

  numberOfStacks() {
    return 2;
  }

  async createStackItem(
    id: string,
    stackIndex: number,
    format: 'isolated' | 'edit' = 'isolated',
  ): Promise<StackItem> {
    let stackItem = new StackItem({
      id,
      stackIndex,
      format,
    });
    return stackItem;
  }

  addItemToStack(stackItem: StackItem) {
    this.addedStackItems.push(stackItem);
  }

  updateCodePath(url: URL) {
    this.updatedCodePaths.push(url);
    this.codePathString = url.href;
  }

  reset() {
    this.addedStackItems = [];
    this.updatedCodePaths = [];
    this.state = { submode: 'interact', codeSelection: undefined };
    this.codePathString = undefined;
  }

  get workspaceChooserOpened() {
    return this.state.workspaceChooserOpened ?? false;
  }

  closeWorkspaceChooser() {
    this.state.workspaceChooserOpened = false;
  }
}

class MockPlaygroundPanelService extends Service {
  persistedSelections: Array<{
    cardRef: string;
    cardId: string;
    format: string;
    stack: any;
  }> = [];

  persistSelections(
    cardRef: string,
    cardId: string,
    format: string,
    stack: any,
  ) {
    this.persistedSelections.push({ cardRef, cardId, format, stack });
  }

  reset() {
    this.persistedSelections = [];
  }
}

module('Integration | Command | show-card', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);

  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () =>
      await getService('loader-service').loader.import(
        `${baseRealm.url}card-api`,
      ),
  );

  const realmName = 'Show Card Test Realm';
  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': `
          import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';

          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
            @field lastName = contains(StringField);
            @field title = contains(StringField, {
              computeVia: function (this: Person) {
                return [this.firstName, this.lastName].filter(Boolean).join(' ');
              },
            });
          }
        `,
          'pet.gts': `
          import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';

          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
            @field species = contains(StringField);
            @field title = contains(StringField, {
              computeVia: function (this: Pet) {
                return this.name;
              },
            });
          }
        `,
          'Person/alice.json': {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Alice',
                lastName: 'Johnson',
              },
              meta: {
                adoptsFrom: {
                  module: `../person`,
                  name: 'Person',
                },
              },
            },
          },
          'Person/bob.json': {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Bob',
                lastName: 'Smith',
              },
              meta: {
                adoptsFrom: {
                  module: `../person`,
                  name: 'Person',
                },
              },
            },
          },
          'Pet/fluffy.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Fluffy',
                species: 'Cat',
              },
              meta: {
                adoptsFrom: {
                  module: `../pet`,
                  name: 'Pet',
                },
              },
            },
          },
          '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-s.png" }`,
        },
        loader,
      });
      return { loader };
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  let command: ShowCardCommand;
  let mockOperatorModeStateService: MockOperatorModeStateService;
  let mockPlaygroundPanelService: MockPlaygroundPanelService;

  hooks.beforeEach(function (this: RenderingTestContext) {
    mockOperatorModeStateService = new MockOperatorModeStateService();
    mockPlaygroundPanelService = new MockPlaygroundPanelService();

    getOwner(this)!.register(
      'service:operator-mode-state-service',
      mockOperatorModeStateService,
      { instantiate: false },
    );
    getOwner(this)!.register(
      'service:playground-panel-service',
      mockPlaygroundPanelService,
      { instantiate: false },
    );

    command = new ShowCardCommand(getService('command-service').commandContext);
  });

  hooks.afterEach(function () {
    mockOperatorModeStateService.reset();
    mockPlaygroundPanelService.reset();
  });

  module('interact submode', function () {
    test('adds card to stack when in interact submode', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'interact',
        codeSelection: undefined,
      };

      await command.execute({ cardId });

      assert.strictEqual(
        mockOperatorModeStateService.addedStackItems.length,
        1,
        'One stack item was added',
      );

      const addedItem = mockOperatorModeStateService.addedStackItems[0];
      assert.strictEqual(
        addedItem.id,
        cardId,
        'Stack item contains correct card id',
      );
      assert.strictEqual(
        addedItem.stackIndex,
        1,
        'Stack item is added to stack index 1 (minimum of numberOfStacks() and 1)',
      );
      assert.strictEqual(
        addedItem.format,
        'isolated',
        'Stack item has isolated format',
      );
    });

    test('calculates correct stack index based on numberOfStacks', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'interact',
        codeSelection: undefined,
      };

      // Test when numberOfStacks returns 0
      mockOperatorModeStateService.numberOfStacks = () => 0;
      await command.execute({ cardId });

      assert.strictEqual(
        mockOperatorModeStateService.addedStackItems[0].stackIndex,
        0,
        'Stack index is 0 when numberOfStacks returns 0',
      );

      // Reset and test when numberOfStacks returns 3
      mockOperatorModeStateService.reset();
      mockOperatorModeStateService.state = {
        submode: 'interact',
        codeSelection: undefined,
      };
      mockOperatorModeStateService.numberOfStacks = () => 3;
      await command.execute({ cardId });

      assert.strictEqual(
        mockOperatorModeStateService.addedStackItems[0].stackIndex,
        1,
        'Stack index is 1 when numberOfStacks returns 3 (minimum of 3 and 1)',
      );
    });

    test('closes workspace chooser, if open', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'interact',
        codeSelection: undefined,
        workspaceChooserOpened: true,
      };

      await command.execute({ cardId });

      assert.false(
        mockOperatorModeStateService.state.workspaceChooserOpened,
        'Workspace chooser is closed after showing card',
      );
    });
  });

  module('code submode', function () {
    test('uses specified format when provided', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'code',
        codeSelection: undefined,
      };

      await command.execute({ cardId, format: 'edit' });

      // Verify that playground panel service was called with correct format
      assert.strictEqual(
        mockPlaygroundPanelService.persistedSelections.length,
        1,
        'One selection was persisted',
      );

      const persistedSelection =
        mockPlaygroundPanelService.persistedSelections[0];
      assert.strictEqual(
        persistedSelection.format,
        'edit',
        'Persisted selection has correct format',
      );
    });

    test('defaults to isolated format when format is not provided', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'code',
        codeSelection: undefined,
      };

      await command.execute({ cardId });

      // Verify that playground panel service was called with default format
      assert.strictEqual(
        mockPlaygroundPanelService.persistedSelections.length,
        1,
        'One selection was persisted',
      );

      const persistedSelection =
        mockPlaygroundPanelService.persistedSelections[0];
      assert.strictEqual(
        persistedSelection.format,
        'isolated',
        'Persisted selection has default isolated format',
      );
    });

    test('updates code path and persists selections when in code submode', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      mockOperatorModeStateService.state = {
        submode: 'code',
        codeSelection: undefined,
      };

      await command.execute({ cardId, format: 'isolated' });

      // Verify that playground panel service was called with correct parameters
      assert.strictEqual(
        mockPlaygroundPanelService.persistedSelections.length,
        1,
        'One selection was persisted',
      );

      const persistedSelection =
        mockPlaygroundPanelService.persistedSelections[0];
      assert.strictEqual(
        persistedSelection.cardId,
        cardId,
        'Persisted selection has correct card ID',
      );
      assert.strictEqual(
        persistedSelection.format,
        'isolated',
        'Persisted selection has isolated format',
      );
      assert.strictEqual(
        persistedSelection.stack,
        undefined,
        'Persisted selection has undefined stack',
      );

      // Verify that code path was updated
      assert.strictEqual(
        mockOperatorModeStateService.updatedCodePaths.length,
        1,
        'Code path was updated',
      );
      const updatedPath = mockOperatorModeStateService.updatedCodePaths[0];
      assert.strictEqual(
        updatedPath.href,
        `${testRealmURL}person.gts`,
        'Code path points to person.gts module',
      );
    });

    // Errors thrown in test are not caught by the test framework
    skip('throws error when card is not found in store', async function (assert) {
      const cardId = `${testRealmURL}NonexistentCard/1`;
      mockOperatorModeStateService.state = {
        submode: 'code',
        codeSelection: undefined,
      };

      try {
        await command.execute({ cardId });
        assert.ok(false, 'Expected error to be thrown');
      } catch (error: any) {
        assert.ok(
          error.message.includes('Card with id') &&
            error.message.includes('not found in store'),
          'Error thrown when card not found in store',
        );
      }
    });

    test('updates code path when current path does not match card module', async function (assert) {
      const cardId = `${testRealmURL}Pet/fluffy`;
      mockOperatorModeStateService.state = {
        submode: 'code',
        codeSelection: undefined,
      };
      mockOperatorModeStateService.codePathString = `${testRealmURL}person.gts`;

      await command.execute({ cardId });

      // Verify that code path was updated to the pet module
      assert.strictEqual(
        mockOperatorModeStateService.updatedCodePaths.length,
        1,
        'Code path was updated',
      );
      const updatedPath = mockOperatorModeStateService.updatedCodePaths[0];
      assert.strictEqual(
        updatedPath.href,
        `${testRealmURL}pet.gts`,
        'Code path was updated to pet.gts module',
      );
    });
  });

  module('unknown submode', function () {
    test('logs error for unknown submode', async function (assert) {
      const cardId = `${testRealmURL}Person/alice`;
      // @ts-expect-error - intentionally setting invalid submode for testing
      mockOperatorModeStateService.state = { submode: 'unknown' };

      let consoleErrorCalled = false;
      const originalConsoleError = console.error;
      console.error = (message: string, submode: string) => {
        consoleErrorCalled = true;
        assert.strictEqual(
          message,
          'Unknown submode:',
          'Correct error message logged',
        );
        assert.strictEqual(submode, 'unknown', 'Correct submode logged');
      };

      try {
        await command.execute({ cardId });

        assert.ok(consoleErrorCalled, 'console.error was called');
        assert.strictEqual(
          mockOperatorModeStateService.addedStackItems.length,
          0,
          'No stack items were added',
        );
        assert.strictEqual(
          mockPlaygroundPanelService.persistedSelections.length,
          0,
          'No selections were persisted',
        );
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  module('command metadata', function () {
    test('has correct description and action verb', function (assert) {
      assert.strictEqual(
        command.description,
        'Show a card in the UI. The cardId must be a fully qualified URL.',
        'Command has correct description',
      );
      assert.strictEqual(
        ShowCardCommand.actionVerb,
        'Show Card',
        'Command has correct action verb',
      );
    });

    test('getInputType returns ShowCardInput', async function (assert) {
      const inputType = await command.getInputType();
      assert.ok(inputType, 'Input type is defined');
      // We can't easily test the exact type without mocking the command module loading
      // but we can verify that getInputType doesn't throw an error
    });

    test('getInputJsonSchema', async function (assert) {
      let loader = getService('loader-service').loader;
      let mappings = await basicMappings(loader);
      let cardAPI = await loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`,
      );
      const inputSchema = await command.getInputJsonSchema(cardAPI, mappings);
      assert.ok(inputSchema, 'Input JSON schema is defined');
      assert.deepEqual(
        inputSchema,
        {
          attributes: {
            properties: {
              cardId: { type: 'string' },
              format: { type: 'string' },
            },
            required: ['cardId'],
            type: 'object',
          },
        },
        'Input schema excludes cardInfo, requires cardId',
      );
    });
  });
});
