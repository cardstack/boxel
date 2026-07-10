import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  fields,
  localId,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import type { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';

import type ToolService from '@cardstack/host/services/tool-service';
import PatchCardInstanceTool from '@cardstack/host/tools/patch-card-instance';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  cardInfo,
  setupOnSave,
  withSlowSave,
  type TestContextWithSave,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
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

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

module('Integration | tools | patch-instance', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  const saveWaitTimeoutMs = 5000;
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });
  let toolService: ToolService;
  let PersonDef: typeof CardDefType;
  let indexQuery: RealmIndexQueryEngine;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    toolService = getService('tool-service');
    class SpecialStringA extends StringField {}
    class SpecialStringB extends StringField {}
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
    }
    PersonDef = Person;

    let { realm } = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person, SpecialStringA, SpecialStringB },
          'Person/hassan.json': new Person({ name: 'Hassan' }),
          'Person/polymorphic-nicknames.json': new Person({
            name: 'Polymorphic Nicknames',
            nickNames: ['Alpha', 'Beta'],
            [fields]: {
              'nickNames.0': SpecialStringA,
              'nickNames.1': SpecialStringB,
            },
          }),
          'Person/jade.json': new Person({ name: 'Jade' }),
          'Person/queenzy.json': new Person({ name: 'Queenzy' }),
          'Person/germaine.json': new Person({ name: 'Germaine' }),
        },
      }),
    );
    indexQuery = realm.realmIndexQueryEngine;
  });

  test<TestContextWithSave>('can patch a contains field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
      undefined,
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('can patch a containsMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
      undefined,
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('patching a containsMany field with a shorter array fully replaces it (no stale trailing items)', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
      patch: { attributes: { nickNames: ['Paper', 'Pinky', 'Pix'] } },
    });
    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for the first save',
    });

    let savesAfterGrow = saves;
    await patchInstanceCommand.execute({
      cardId: `${testRealmURL}Person/hassan`,
      patch: { attributes: { nickNames: ['Paper'] } },
    });
    await waitUntil(() => saves > savesAfterGrow, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for the second save',
    });

    let result = await indexQuery.instance(url);
    let instance =
      result && result.type === 'instance' ? result.instance : undefined;
    assert.ok(instance, 'instance payload is present');
    if (!instance) {
      throw new Error('expected instance payload');
    }
    assert.deepEqual(
      instance.attributes?.nickNames,
      ['Paper'],
      'the containsMany array was fully replaced, not index-merged',
    );
  });

  test<TestContextWithSave>('patching a polymorphic containsMany field clears stale field metadata', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
      {
        cardType: PersonDef,
      },
    );
    let cardId = `${testRealmURL}Person/polymorphic-nicknames`;
    let saves = 0;
    let savedDoc: SingleCardDocument | undefined;
    this.onSave((saveURL, doc) => {
      if (saveURL.href === cardId && typeof doc !== 'string') {
        saves++;
        savedDoc = doc as SingleCardDocument;
      }
    });

    await patchInstanceCommand.execute({
      cardId,
      patch: { attributes: { nickNames: ['Beta'] } },
    });
    await waitUntil(() => saves > 0, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for the first save',
    });

    assert.deepEqual(
      savedDoc?.data.attributes?.nickNames,
      ['Beta'],
      'the shorter array was persisted',
    );
    assert.strictEqual(
      savedDoc?.data.meta.fields?.['nickNames.0'],
      undefined,
      'first index metadata was cleared on replacement',
    );
    assert.strictEqual(
      savedDoc?.data.meta.fields?.['nickNames.1'],
      undefined,
      'second index metadata was cleared on replacement',
    );

    let savesAfterShrink = saves;
    await patchInstanceCommand.execute({
      cardId,
      patch: { attributes: { nickNames: ['Beta', 'Gamma'] } },
    });
    await waitUntil(() => saves > savesAfterShrink, {
      timeout: saveWaitTimeoutMs,
      timeoutMessage: 'timed out waiting for the second save',
    });

    assert.deepEqual(
      savedDoc?.data.attributes?.nickNames,
      ['Beta', 'Gamma'],
      'the expanded array was persisted without a reload',
    );
    assert.strictEqual(
      savedDoc?.data.meta.fields?.['nickNames.1'],
      undefined,
      'old second index metadata did not come back after expanding',
    );
  });

  test<TestContextWithSave>('can patch a linksTo field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('can patch a linksToMany field', async function (assert) {
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
        'friends.0': { links: { self: `./germaine` } },
        'friends.1': { links: { self: `./queenzy` } },
      },
      'the relationships are correct',
    );
  });

  test<TestContextWithSave>('patch command returns before persistence completes', async function (assert) {
    assert.expect(6);

    let storeService = getService('store');
    let cardId = `${testRealmURL}Person/hassan`;
    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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

    let patchInstanceCommand = new PatchCardInstanceTool(
      toolService.toolContext,
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
      },
      'the relationships are correct',
    );
  });
});
