import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Command } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import TransformCardsCommand from '@cardstack/host/commands/transform-cards';

import RealmService from '@cardstack/host/services/realm';

import type * as CommandModule from 'https://cardstack.com/base/command';

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

module('Integration | commands | transform-cards', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Transform Cards Test Realm';
  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      let cardApi: typeof import('https://cardstack.com/base/card-api');
      let string: typeof import('https://cardstack.com/base/string');
      let CommandModule = await loader.import<typeof import('https://cardstack.com/base/command')>(
        `${baseRealm.url}command`,
      );

      cardApi = await loader.import(`${baseRealm.url}card-api`);
      string = await loader.import(`${baseRealm.url}string`);

      let { field, contains, CardDef } = cardApi;
      let { default: StringField } = string;
      let { JsonCard } = CommandModule;

      class Person extends CardDef {
        static displayName = 'Person';
        @field name = contains(StringField);
        @field age = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.name;
          },
        });
      }

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
        @field species = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.name;
          },
        });
      }

      class PrefixNameCommand extends Command<typeof JsonCard, typeof JsonCard> {
        async getInputType() {
          return JsonCard;
        }

        protected async run(
          input: CommandModule.JsonCard,
        ): Promise<CommandModule.JsonCard> {
          let json = { ...input.json };
          if (json.data?.attributes?.name) {
            json.data.attributes.name = `Transformed: ${json.data.attributes.name}`;
          }
          return new JsonCard({ json });
        }
      }

      class UppercaseNameCommand extends Command<
        typeof JsonCard,
        typeof JsonCard
      > {
        async getInputType() {
          return JsonCard;
        }

        protected async run(
          input: CommandModule.JsonCard,
        ): Promise<CommandModule.JsonCard> {
          let json = { ...input.json };
          if (json.data?.attributes?.name) {
            json.data.attributes.name = json.data.attributes.name.toUpperCase();
          }
          return new JsonCard({ json });
        }
      }

      class AddMetadataCommand extends Command<
        typeof JsonCard,
        typeof JsonCard
      > {
        async getInputType() {
          return JsonCard;
        }

        protected async run(
          input: CommandModule.JsonCard,
        ): Promise<CommandModule.JsonCard> {
          let json = { ...input.json };
          if (!json.data.attributes.metadata) {
            json.data.attributes.metadata = 'Added by TransformCardsCommand';
          }
          return new JsonCard({ json });
        }
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'pet.gts': { Pet },
          'Person/alice.json': `{
          "data": {
            "type": "card",
            "attributes": {
              "name": "Alice",
              "age": "30"
            },
            "meta": {
              "adoptsFrom": {
                "module": "../person",
                "name": "Person"
              }
            }
          }
        }`,
          'Person/bob.json': `{
          "data": {
            "type": "card",
            "attributes": {
              "name": "Bob",
              "age": "25"
            },
            "meta": {
              "adoptsFrom": {
                "module": "../person",
                "name": "Person"
              }
            }
          }
        }`,
          'Person/charlie.json': `{
          "data": {
            "type": "card",
            "attributes": {
              "name": "Charlie",
              "age": "35"
            },
            "meta": {
              "adoptsFrom": {
                "module": "../person",
                "name": "Person"
              }
            }
          }
        }`,
          'Pet/fluffy.json': `{
          "data": {
            "type": "card",
            "attributes": {
              "name": "Fluffy",
              "species": "Cat"
            },
            "meta": {
              "adoptsFrom": {
                "module": "../pet",
                "name": "Pet"
              }
            }
          }
        }`,
          'Pet/rover.json': `{
          "data": {
            "type": "card",
            "attributes": {
              "name": "Rover",
              "species": "Dog"
            },
            "meta": {
              "adoptsFrom": {
                "module": "../pet",
                "name": "Pet"
              }
            }
          }
        }`,
          'prefix-name-command.ts': { default: PrefixNameCommand },
          'uppercase-name-command.ts': { default: UppercaseNameCommand },
          'add-metadata-command.ts': { default: AddMetadataCommand },
          '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-t.png" }`,
        },
        loader,
      });
      return { loader };
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    ({ loader } = snapshot.get());
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(function () {
    snapshot.get();
  });

  test('transforms all cards matching a query', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    await transformCommand.execute({
      query: {
        filter: {
          type: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
      commandRef: {
        module: `${testRealmURL}prefix-name-command`,
        name: 'default',
      },
    });

    // Verify that all Person cards were transformed
    let { SearchCardsByQueryCommand } = await import(
      '@cardstack/host/commands/search-cards'
    );
    let searchCommand = new SearchCardsByQueryCommand(
      commandService.commandContext,
    );
    let { cardIds } = await searchCommand.execute({
      query: {
        filter: {
          type: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
    });

    let networkService = getService('network');

    for (let cardId of cardIds) {
      let url = new URL(cardId + '.json', testRealmURL);
      let response = await networkService.authedFetch(url);
      let content = await response.text();
      let cardData = JSON.parse(content);
      assert.ok(
        cardData.data.attributes.name.startsWith('Transformed: '),
        `Card ${cardId} should have transformed name: ${cardData.data.attributes.name}`,
      );
    }
  });

  test('transforms specific cards using title filter', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    await transformCommand.execute({
      query: {
        filter: {
          contains: { title: 'Alice' },
          on: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
      commandRef: {
        module: `${testRealmURL}uppercase-name-command`,
        name: 'default',
      },
    });

    // Verify only Alice's card was transformed
    let networkService = getService('network');

    let response = await networkService.authedFetch(
      new URL(`${testRealmURL}Person/alice.json`),
    );
    let aliceContent = await response.text();
    let aliceData = JSON.parse(aliceContent);
    assert.strictEqual(aliceData.data.attributes.name, 'ALICE');

    // Verify other cards weren't transformed
    response = await networkService.authedFetch(
      new URL(`${testRealmURL}Person/bob.json`),
    );
    let bobContent = await response.text();
    let bobData = JSON.parse(bobContent);
    assert.strictEqual(bobData.data.attributes.name, 'Bob');
  });

  test('transforms Pet cards with different command', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    await transformCommand.execute({
      query: {
        filter: {
          type: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        },
      },
      commandRef: {
        module: `${testRealmURL}add-metadata-command`,
        name: 'default',
      },
    });

    // Verify that Pet cards were transformed
    let networkService = getService('network');

    let response = await networkService.authedFetch(
      new URL(`${testRealmURL}Pet/fluffy.json`),
    );
    let fluffyContent = await response.text();
    let fluffyData = JSON.parse(fluffyContent);
    assert.strictEqual(
      fluffyData.data.attributes.metadata,
      'Added by TransformCardsCommand',
    );

    response = await networkService.authedFetch(
      new URL(`${testRealmURL}Pet/rover.json`),
    );
    let roverContent = await response.text();
    let roverData = JSON.parse(roverContent);
    assert.strictEqual(
      roverData.data.attributes.metadata,
      'Added by TransformCardsCommand',
    );
  });

  test('handles empty search results gracefully', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    // Search for non-existent cards
    await transformCommand.execute({
      query: {
        filter: {
          contains: { title: 'NonExistentCard' },
        },
      },
      commandRef: {
        module: `${testRealmURL}prefix-name-command`,
        name: 'default',
      },
    });

    // Should complete without error even when no cards match
    assert.ok(true, 'Command should complete without errors for empty results');
  });

  test('preserves JSON structure while transforming', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    // Get original structure first
    let networkService = getService('network');

    let response = await networkService.authedFetch(
      new URL(`${testRealmURL}Person/alice.json`),
    );
    let originalContent = await response.text();
    let originalData = JSON.parse(originalContent);

    await transformCommand.execute({
      query: {
        filter: {
          contains: { title: 'Alice' },
          on: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
      commandRef: {
        module: `${testRealmURL}prefix-name-command`,
        name: 'default',
      },
    });

    // Verify structure is preserved
    response = await networkService.authedFetch(
      new URL(`${testRealmURL}Person/alice.json`),
    );
    let transformedContent = await response.text();
    let transformedData = JSON.parse(transformedContent);

    assert.strictEqual(transformedData.data.type, originalData.data.type);
    assert.deepEqual(transformedData.data.meta, originalData.data.meta);
    assert.strictEqual(
      transformedData.data.attributes.age,
      originalData.data.attributes.age,
    );
    assert.strictEqual(
      transformedData.data.attributes.name,
      'Transformed: Alice',
    );
  });

  // Skipped because we don't have the ability to capture command errors in the current test setup
  skip('handles malformed command references gracefully', async function (assert) {
    let commandService = getService('command-service');
    let transformCommand = new TransformCardsCommand(
      commandService.commandContext,
    );

    try {
      await transformCommand.execute({
        query: {
          filter: {
            contains: { title: 'Alice' },
          },
        },
        commandRef: {
          module: `${testRealmURL}non-existent-command`,
          name: 'default',
        },
      });
      assert.notOk(
        true,
        'Should have thrown an error for non-existent command',
      );
    } catch (error: any) {
      assert.ok(
        error.message.includes('Could not load') ||
          error.message.includes('Module not found') ||
          error.message.includes('404'),
        `Error should indicate module loading failure: ${error.message}`,
      );
    }
  });
});
