import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { localId, type SingleCardDocument } from '@cardstack/runtime-common';
import type { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';

import PatchCardInstanceCommand from '@cardstack/host/commands/patch-card-instance';

import type CommandService from '@cardstack/host/services/command-service';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  cardInfo,
  setupOnSave,
  withSlowSave,
  type TestContextWithSave,
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
  setupOnSave(hooks);
  const saveWaitTimeoutMs = 5000;
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });
  let commandService: CommandService;
  let PersonDef: typeof CardDefType;
  let indexQuery: RealmIndexQueryEngine;

  hooks.beforeEach(async function () {
    commandService = getService('command-service');
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

  test<TestContextWithSave>('can patch a contains field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );
    let url = new URL(`${testRealmURL}Person/hassan`);
    let saves = 0;
    this.onSave((saveURL) => {
      if (saveURL.href === url.href) {
        saves++;
      }
    });

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        attributes: {
          name: 'Paper',
        },
      },
    });

    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for save to complete',
    });

    let result = await indexQuery.instance(url);
    assert.ok(result, 'instance query returned a result');
    assert.strictEqual(result?.type, 'instance', 'result is an instance');
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }

    assert.deepEqual(
      instance.attributes,
      {
        name: 'Paper',
        cardDescription: null,
        nickNames: [],
        cardThumbnailURL: null,
        cardTitle: 'Untitled Card',
        cardInfo,
      },
      'the attributes are correct',
    );
    assert.deepEqual(
      instance.relationships,
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
        'cardInfo.theme': { links: { self: null } },
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('can patch a containsMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );
    let url = new URL(`${testRealmURL}Person/hassan`);
    let saves = 0;
    this.onSave((saveURL) => {
      if (saveURL.href === url.href) {
        saves++;
      }
    });

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        attributes: {
          nickNames: ['Paper'],
        },
      },
    });

    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for save to complete',
    });

    let result = await indexQuery.instance(url);
    assert.ok(result, 'instance query returned a result');
    assert.strictEqual(result?.type, 'instance', 'result is an instance');
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }

    assert.deepEqual(
      instance.attributes,
      {
        name: 'Hassan',
        cardDescription: null,
        nickNames: ['Paper'],
        cardThumbnailURL: null,
        cardTitle: 'Untitled Card',
        cardInfo,
      },
      'the attributes are correct',
    );
    assert.deepEqual(
      instance.relationships,
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
        'cardInfo.theme': { links: { self: null } },
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('can patch a linksTo field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );
    let url = new URL(`${testRealmURL}Person/hassan`);
    let saves = 0;
    this.onSave((saveURL) => {
      if (saveURL.href === url.href) {
        saves++;
      }
    });

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        relationships: {
          bestFriend: { links: { self: `${testRealmURL}Person/jade` } },
        },
      },
    });

    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for save to complete',
    });

    let result = await indexQuery.instance(url);
    assert.ok(result, 'instance query returned a result');
    assert.strictEqual(result?.type, 'instance', 'result is an instance');
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }

    assert.deepEqual(
      instance.attributes,
      {
        name: 'Hassan',
        cardDescription: null,
        nickNames: [],
        cardThumbnailURL: null,
        cardTitle: 'Untitled Card',
        cardInfo,
      },
      'the attributes are correct',
    );
    assert.deepEqual(
      instance.relationships,
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
        'cardInfo.theme': { links: { self: null } },
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('can patch a linksToMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );
    let url = new URL(`${testRealmURL}Person/hassan`);
    let saves = 0;
    this.onSave((saveURL) => {
      if (saveURL.href === url.href) {
        saves++;
      }
    });

    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: {
        relationships: {
          'friends.0': { links: { self: `${testRealmURL}Person/germaine` } },
          'friends.1': { links: { self: `${testRealmURL}Person/queenzy` } },
        },
      },
    });

    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for save to complete',
    });

    let result = await indexQuery.instance(url);
    assert.ok(result, 'instance query returned a result');
    assert.strictEqual(result?.type, 'instance', 'result is an instance');
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }

    assert.deepEqual(
      instance.attributes,
      {
        name: 'Hassan',
        cardDescription: null,
        nickNames: [],
        cardThumbnailURL: null,
        cardTitle: 'Untitled Card',
        cardInfo,
      },
      'the attributes are correct',
    );
    assert.deepEqual(
      instance.relationships,
      {
        bestFriend: {
          links: {
            self: null,
          },
        },
        'friends.0': { links: { self: `./germaine` } },
        'friends.1': { links: { self: `./queenzy` } },
        'cardInfo.theme': { links: { self: null } },
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('patch command returns before persistence completes', async function (assert) {
    assert.expect(6);

    let storeService = getService('store');
    let cardId = `${testRealmURL}Person/hassan`;
    let patchInstanceCommand = new PatchCardInstanceCommand(
      commandService.commandContext,
      {
        cardType: PersonDef,
      },
    );

    let saves = 0;
    let savedName: string | undefined;
    this.onSave((url, doc) => {
      if (url.href === cardId && typeof doc !== 'string') {
        saves++;
        savedName = (doc as SingleCardDocument).data.attributes?.name as
          | string
          | undefined;
      }
    });

    let patchOptions: Parameters<typeof storeService.patch>[2];
    let originalPatch = storeService.patch;
    storeService.patch = async function (
      this: typeof storeService,
      id,
      patch,
      opts: {
        doNotPersist?: true;
        doNotWaitForPersist?: true;
        clientRequestId?: string;
      },
    ) {
      patchOptions = opts;
      return await originalPatch.call(this, id, patch, opts);
    };

    try {
      await withSlowSave(100, async () => {
        await patchInstanceCommand.execute({
          cardId,
          patch: {
            attributes: {
              name: 'Hassan Optimistic',
            },
          },
        });

        let localCard = storeService.peek(cardId);
        assert.ok(localCard, 'local card is present');
        if (localCard) {
          assert.strictEqual(
            (localCard as any).name,
            'Hassan Optimistic',
            'local card updated immediately',
          );
        }
        assert.strictEqual(saves, 0, 'persistence has not run yet');
      });
    } finally {
      storeService.patch = originalPatch;
    }

    assert.true(
      patchOptions?.doNotWaitForPersist,
      'store.patch invoked with doNotWaitForPersist',
    );

    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for save to complete',
    });
    assert.strictEqual(
      savedName,
      'Hassan Optimistic',
      'background save includes updated data',
    );

    let persisted = await storeService.get(cardId);
    assert.strictEqual(
      (persisted as any).name,
      'Hassan Optimistic',
      'remote card reflects update after background save',
    );
  });

  test('can patch an unsaved instance', async function (assert) {
    let store = getService('store');
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
    assert.ok(result, 'instance query returned a result');
    assert.strictEqual(result?.type, 'instance', 'result is an instance');
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }
    assert.deepEqual(
      instance.attributes,
      {
        name: 'Andrea',
        cardDescription: null,
        nickNames: ['Air'],
        cardThumbnailURL: null,
        cardTitle: 'Untitled Card',
        cardInfo,
      },
      'the attributes are correct',
    );
    assert.deepEqual(
      instance.relationships,
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
  });
});
