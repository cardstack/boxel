import type { RenderingTestContext } from '@ember/test-helpers';
import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  isCardInstance,
  baseFileRef,
  baseRef,
  isCardResource,
  isFileMetaResource,
  type Loader,
  type Realm,
  type CardResource,
  type Saved,
} from '@cardstack/runtime-common';

import { fileTreeFromIndex } from '@cardstack/host/resources/file-tree-from-index';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  testRRI,
  setupLocalIndexing,
  setupCardLogs,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  CardDef,
  contains,
  field,
  StringField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

module('Integration | store search public API', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let loader: Loader;
  let realm: Realm;
  let storeService: StoreService;

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let bookRef = { module: testRRI('book'), name: 'Book' };

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    storeService = getService('store');

    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
      @field status = contains(StringField);
    }

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'book.gts': { Book },
        'books/1.json': new Book({ title: 'Mango', status: 'ready' }),
        'books/2.json': new Book({ title: 'Van Gogh', status: 'draft' }),
        'files/hello.txt': 'Hello world',
        'files/notes/today.txt': 'Some notes',
      },
    }));
  });

  test('search returns instances only and hydrates them into the store', async function (assert) {
    let instances = await storeService.search<CardDefType>(
      { filter: { type: bookRef } },
      [testRealmURL],
    );

    assert.strictEqual(instances.length, 2, 'both books are returned');
    for (let instance of instances) {
      assert.true(isCardInstance(instance), 'the result is a card instance');
      assert.strictEqual(
        storeService.peek(instance.id!),
        instance,
        'the instance is resident in the store',
      );
    }
    assert.deepEqual(
      instances.map((instance) => (instance as any).title).sort(),
      ['Mango', 'Van Gogh'],
    );
  });

  test('search with a BaseDef type filter stays pinned to card instances', async function (assert) {
    // BaseDef terminates both kinds' type chains, so as a filter it matches
    // file rows too — but it selects no kind, so `search` pins the 'cards'
    // scope for it just like an untyped query.
    let instances = await storeService.search<CardDefType>(
      { filter: { type: baseRef } },
      [testRealmURL],
    );

    assert.true(
      instances.every((instance) => isCardInstance(instance)),
      'every result is a card instance — no plain files, no dual-indexed `.json` file rows',
    );
    assert.deepEqual(
      instances.map((instance) => (instance as any).title).sort(),
      ['Mango', 'Van Gogh'],
    );
  });

  test('search with includeMeta returns the single { instances, meta } shape', async function (assert) {
    let result = await storeService.search<CardDefType>(
      { filter: { type: bookRef } },
      [testRealmURL],
      { includeMeta: true },
    );

    assert.deepEqual(Object.keys(result).sort(), ['instances', 'meta']);
    assert.strictEqual(result.meta.page.total, 2);
    assert.true(
      result.instances.every((instance) => isCardInstance(instance)),
      'every result is a card instance',
    );
  });

  test('search rejects the removed asData path', async function (assert) {
    await assert.rejects(
      storeService.search({ filter: { type: bookRef }, asData: true } as any, [
        testRealmURL,
      ]),
      /instances only.*searchEntries/,
    );
  });

  test('searchEntries returns the raw entry wire format without hydrating', async function (assert) {
    let doc = await storeService.searchEntries(
      {
        filter: { 'item.on': bookRef },
        fields: { entry: ['item'] },
      },
      [testRealmURL],
    );

    assert.strictEqual(doc.data.length, 2, 'both books are returned');
    for (let entry of doc.data) {
      assert.strictEqual(entry.type, 'entry');
      assert.strictEqual(
        entry.relationships.item?.data.type,
        'card',
        'the entry links its item serialization',
      );
      assert.strictEqual(
        entry.relationships.item?.data.id,
        entry.id,
        'the entry and its item share the bare card URL',
      );
      assert.strictEqual(
        storeService.peek(entry.id),
        undefined,
        'searchEntries deposits nothing in the store',
      );
    }
    let items = (doc.included ?? []).filter((resource) =>
      isCardResource(resource),
    ) as CardResource<Saved>[];
    assert.strictEqual(items.length, 2, 'the full items ride in included');
    assert.deepEqual(
      items.map((item) => item.attributes?.title).sort(),
      ['Mango', 'Van Gogh'],
      'the items are full serializations',
    );
    assert.true(
      items.every((item) => !('sparseFields' in item.meta)),
      'a full item carries no sparseFields marker',
    );
  });

  test('searchEntries returns field-limited items per the sparse fieldset', async function (assert) {
    let doc = await storeService.searchEntries(
      {
        filter: { 'item.on': bookRef },
        fields: { entry: ['item.title'] },
      },
      [testRealmURL],
    );

    let items = (doc.included ?? []).filter((resource) =>
      isCardResource(resource),
    ) as CardResource<Saved>[];
    assert.strictEqual(items.length, 2);
    for (let item of items) {
      assert.deepEqual(
        (item.meta as any).sparseFields,
        ['title'],
        'the sparse marker records the requested fields',
      );
      assert.deepEqual(
        Object.keys(item.attributes ?? {}),
        ['title'],
        'only the requested attributes ride along',
      );
    }
  });

  test('searchEntries returns file-meta items for a file query', async function (assert) {
    let doc = await storeService.searchEntries(
      {
        filter: { 'item.on': baseFileRef },
        fields: { entry: ['item'] },
      },
      [testRealmURL],
    );

    let fileURLs = doc.data.map((entry) => entry.id);
    assert.true(
      fileURLs.includes(`${testRealmURL}files/hello.txt`),
      'the file entry id is its canonical URL',
    );
    assert.true(
      (doc.included ?? []).some((resource) => isFileMetaResource(resource)),
      'file-meta items ride in included',
    );
  });

  test('the file tree consumer works via searchEntries', async function (assert) {
    let fileTree = fileTreeFromIndex(storeService, () => testRealmURL);
    fileTree.entries; // reading the resource activates it
    await waitUntil(() => !fileTree.isLoading && fileTree.entries.length > 0);

    let files = fileTree.entries.find((entry) => entry.name === 'files');
    assert.strictEqual(files?.kind, 'directory');
    let names = [...(files?.children?.keys() ?? [])];
    assert.deepEqual(names.sort(), ['hello.txt', 'notes']);
    assert.strictEqual(
      files?.children?.get('notes')?.children?.get('today.txt')?.kind,
      'file',
    );
  });

  test('the file tree updates live on an incremental index event', async function (assert) {
    let fileTree = fileTreeFromIndex(storeService, () => testRealmURL);
    fileTree.entries;
    await waitUntil(() => !fileTree.isLoading && fileTree.entries.length > 0);

    await realm.write('files/added-later.txt', 'fresh');
    await waitUntil(() => {
      let files = fileTree.entries.find((entry) => entry.name === 'files');
      return files?.children?.has('added-later.txt');
    });
    assert.true(
      fileTree.entries
        .find((entry) => entry.name === 'files')
        ?.children?.has('added-later.txt'),
      'the new file appears after the incremental index event',
    );
  });
});
