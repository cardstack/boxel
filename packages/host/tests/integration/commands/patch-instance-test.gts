import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { localId } from '@cardstack/runtime-common';
import { type RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';

import PatchCardInstanceCommand from '@cardstack/host/commands/patch-card-instance';

import type CommandService from '@cardstack/host/services/command-service';
import type StoreService from '@cardstack/host/services/store';

import { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  lookupService,
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import {
  CardDef,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  StringField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | patch-instance', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });
  let commandService: CommandService;
  let PersonDef: typeof CardDefType;
  let indexQuery: RealmIndexQueryEngine;

  hooks.beforeEach(async function () {
    commandService = lookupService<CommandService>('command-service');
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
    }
    PersonDef = Person;

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'Person/hassan.json': new Person({ name: 'Hassan' }),
        'Person/jade.json': new Person({ name: 'Jade' }),
        'Person/queenzy.json': new Person({ name: 'Queenzy' }),
        'Person/germaine.json': new Person({ name: 'Germaine' }),
      },
    });
    indexQuery = realm.realmIndexQueryEngine;
  });

  test('can patch a contains field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        attributes: {
          name: 'Paper',
        },
      },
    });

    let result = await indexQuery.instance(
      new URL(`${testRealmURL}Person/hassan`),
    );
    if (result && 'instance' in result) {
      assert.deepEqual(
        result.instance?.attributes,
        {
          name: 'Paper',
          description: null,
          nickNames: [],
          thumbnailURL: null,
          title: null,
        },
        'the attributes are correct',
      );
      assert.deepEqual(
        result.instance?.relationships,
        {
          bestFriend: {
            links: {
              self: null,
            },
          },
          friends: {
            links: {
              self: null,
            },
          },
        },
        'the relationships are correct',
      );
    } else {
      assert.ok(false, `expected result to be a card instance`);
    }
  });

  test('can patch a containsMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        attributes: {
          nickNames: ['Paper'],
        },
      },
    });

    let result = await indexQuery.instance(
      new URL(`${testRealmURL}Person/hassan`),
    );
    if (result && 'instance' in result) {
      assert.deepEqual(
        result.instance?.attributes,
        {
          name: 'Hassan',
          description: null,
          nickNames: ['Paper'],
          thumbnailURL: null,
          title: null,
        },
        'the attributes are correct',
      );
      assert.deepEqual(
        result.instance?.relationships,
        {
          bestFriend: {
            links: {
              self: null,
            },
          },
          friends: {
            links: {
              self: null,
            },
          },
        },
        'the relationships are correct',
      );
    } else {
      assert.ok(false, `expected result to be a card instance`);
    }
  });

  test('can patch a linksTo field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        relationships: {
          bestFriend: { links: { self: `${testRealmURL}Person/jade` } },
        },
      },
    });

    let result = await indexQuery.instance(
      new URL(`${testRealmURL}Person/hassan`),
    );
    if (result && 'instance' in result) {
      assert.deepEqual(
        result.instance?.attributes,
        {
          name: 'Hassan',
          description: null,
          nickNames: [],
          thumbnailURL: null,
          title: null,
        },
        'the attributes are correct',
      );
      assert.deepEqual(
        result.instance?.relationships,
        {
          bestFriend: {
            links: {
              self: `./jade`,
            },
          },
          friends: {
            links: {
              self: null,
            },
          },
        },
        'the relationships are correct',
      );
    } else {
      assert.ok(false, `expected result to be a card instance`);
    }
  });

  test('can patch a linksToMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        relationships: {
          'friends.0': { links: { self: `${testRealmURL}Person/germaine` } },
          'friends.1': { links: { self: `${testRealmURL}Person/queenzy` } },
        },
      },
    });

    let result = await indexQuery.instance(
      new URL(`${testRealmURL}Person/hassan`),
    );
    if (result && 'instance' in result) {
      assert.deepEqual(
        result.instance?.attributes,
        {
          name: 'Hassan',
          description: null,
          nickNames: [],
          thumbnailURL: null,
          title: null,
        },
        'the attributes are correct',
      );
      assert.deepEqual(
        result.instance?.relationships,
        {
          bestFriend: {
            links: {
              self: null,
            },
          },
          'friends.0': { links: { self: `./germaine` } },
          'friends.1': { links: { self: `./queenzy` } },
        },
        'the relationships are correct',
      );
    } else {
      assert.ok(false, `expected result to be a card instance`);
    }
  });

  test('can patch an unsaved instance', async function (assert) {
    let store = lookupService<StoreService>('store');
    let andrea = new PersonDef({ name: 'Andrea' });
    await store.add(andrea, { realm: testRealmURL, doNotPersist: true });

    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );
    await patchInstanceCommand.execute({
      cardId: andrea[localId],
      patch: {
        attributes: {
          nickNames: ['Air'],
        },
        relationships: {
          bestFriend: { links: { self: `${testRealmURL}Person/queenzy` } },
        },
      },
    });

    await waitUntil(() => andrea.id, {
      timeoutMessage: 'waiting for andrea to get assigned a remote id',
    });

    let result = await indexQuery.instance(new URL(andrea.id));
    if (result && 'instance' in result) {
      assert.deepEqual(
        result.instance?.attributes,
        {
          name: 'Andrea',
          description: null,
          nickNames: ['Air'],
          thumbnailURL: null,
          title: null,
        },
        'the attributes are correct',
      );
      assert.deepEqual(
        result.instance?.relationships,
        {
          bestFriend: { links: { self: `./queenzy` } },
          friends: {
            links: {
              self: null,
            },
          },
        },
        'the relationships are correct',
      );
    } else {
      assert.ok(false, `expected result to be a card instance`);
    }
  });
});
