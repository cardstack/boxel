import format from 'date-fns/format';
import {
  baseRealm,
  IndexQueryEngine,
  internalKeyFor,
  type CodeRef,
  type LooseCardResource,
  type Loader,
  type ResolvedCodeRef,
  DBAdapter,
  IndexWriter,
} from '../index';
import { serializeCard } from '../helpers/indexer';
import { testRealmURL } from '../helpers/const';
import { type SharedTests } from '../helpers';
import { type TestIndexRow, setupIndex, getTypes } from '../helpers/indexer';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { cardSrc } from '../etc/test-fixtures';

interface TestCards {
  [name: string]: CardDef;
}

const tests = Object.freeze({
  'can get all cards with empty filter': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      loader,
    );
    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      results,
      [
        await serializeCard(mango),
        await serializeCard(paper),
        await serializeCard(vangogh),
      ],
      'results are correct',
    );
  },

  'deleted cards are not included in results': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { is_deleted: false } },
      { card: vangogh, data: { is_deleted: null } },
      { card: paper, data: { is_deleted: true } },
    ]);

    let { meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      loader,
    );
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
  },

  'error docs are not included in results': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}1.json`,
        type: 'error',
        realm_version: 1,
        realm_url: testRealmURL,
        pristine_doc: undefined,
        types: [],
        error_doc: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      },
      {
        url: `${testRealmURL}mango.json`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        pristine_doc: await serializeCard(mango),
        types: await getTypes(mango),
        error_doc: undefined,
      },
      {
        url: `${testRealmURL}vangogh.json`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        pristine_doc: await serializeCard(vangogh),
        types: await getTypes(vangogh),
        error_doc: undefined,
      },
    ]);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      loader,
    );
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  'can filter by type': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;

    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      { filter: { type } },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'eq'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
      // this card's "name" field doesn't match our filter since our filter
      // specified "name" fields of Person cards
      { card: paper, data: { search_doc: { name: 'Mango' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          eq: { name: 'Mango' },
          on: type,
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can filter using 'eq' thru nested fields": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { 'address.city': 'Barksville' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can use 'eq' to match multiple fields": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            nickNames: ['Mang Mang', 'Baby'],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            nickNames: ['Big boy', 'Farty'],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { name: 'Van Gogh', nickNames: 'Farty' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "can use 'eq' to find 'null' values": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: null,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { name: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [ringo.id], 'results are correct');
  },

  "can use 'eq' to match against number type": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            age: 4,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            age: 8,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { age: 4 },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'eq' to match against boolean type": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            isHairy: false,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            isHairy: true,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Van Gogh',
            isHairy: null,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: { isHairy: false },
          },
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [mango.id], 'results are correct');
    }
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: { isHairy: true },
          },
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
    }
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: { isHairy: null },
          },
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [ringo.id], 'results are correct');
    }
  },

  'can filter eq from a code ref query value': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { stringFieldEntry, numberFieldEntry } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: stringFieldEntry,
        data: {
          search_doc: {
            title: stringFieldEntry.title,
            ref: internalKeyFor((stringFieldEntry as any).ref, undefined),
          },
        },
      },
      {
        card: numberFieldEntry,
        data: {
          search_doc: {
            title: numberFieldEntry.title,
            ref: internalKeyFor((numberFieldEntry as any).ref, undefined),
          },
        },
      },
    ]);

    let type = await simpleCatalogEntryType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: {
            ref: {
              module: `${baseRealm.url}string`,
              name: 'default',
            },
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [stringFieldEntry.id],
      'results are correct',
    );
  },

  'can filter eq from a date query value': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mangoBirthday, vangoghBirthday } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mangoBirthday,
        data: {
          search_doc: {
            title: mangoBirthday.title,
            venue: (mangoBirthday as any).venue,
            date: format((mangoBirthday as any).date, 'yyyy-MM-dd'),
          },
        },
      },
      {
        card: vangoghBirthday,
        data: {
          search_doc: {
            title: vangoghBirthday.title,
            venue: (vangoghBirthday as any).venue,
            date: format((vangoghBirthday as any).date, 'yyyy-MM-dd'),
          },
        },
      },
    ]);

    let type = await eventType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: {
            date: '2024-10-30',
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mangoBirthday.id],
      'results are correct',
    );
  },

  "can search with a 'not' filter": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          not: { eq: { name: 'Mango' } },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [ringo.id, vangogh.id],
      'results are correct',
    );
  },

  'can handle a filter with double negatives': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          not: { not: { not: { eq: { name: 'Mango' } } } },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [ringo.id, vangogh.id],
      'results are correct',
    );
  },

  "can use a 'contains' filter": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          contains: { name: 'ngo' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, ringo.id],
      'results are correct',
    );
  },

  'contains filter is case insensitive': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          contains: { name: 'mang' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'contains' to match multiple fields": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            nickNames: ['Mang Mang', 'Pee Baby'],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            nickNames: ['Big Baby', 'Farty'],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          contains: { name: 'ngo', nickNames: 'Baby' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use a 'contains' filter to match 'null'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: null,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          contains: { name: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "can use 'every' to combine multiple filters": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          every: [
            {
              eq: { 'address.city': 'Barksville' },
            },
            {
              not: { eq: { 'address.street': '456 Grand Blvd' } },
            },
          ],
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'any' to combine multiple filters": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          any: [{ eq: { name: 'Mango' } }, { eq: { name: 'Van Gogh' } }],
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  'gives a good error when query refers to missing card': async (
    assert,
    { indexQueryEngine, dbAdapter, loader },
  ) => {
    await setupIndex(dbAdapter, []);

    try {
      await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: {
              module: `${testRealmURL}nonexistent`,
              name: 'Nonexistent',
            },
            eq: { nonExistentField: 'hello' },
          },
        },
        loader,
      );
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to nonexistent type: import { Nonexistent } from "${testRealmURL}nonexistent"`,
      );
    }
    let cardRef: CodeRef = {
      type: 'fieldOf',
      field: 'name',
      card: {
        module: `${testRealmURL}nonexistent`,
        name: 'Nonexistent',
      },
    };
    try {
      await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: cardRef,
            eq: { name: 'Simba' },
          },
        },
        loader,
      );
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to nonexistent type: ${JSON.stringify(
          cardRef,
          null,
          2,
        )}`,
      );
    }
  },

  'gives a good error when query refers to missing field': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    await setupIndex(dbAdapter, []);
    let type = await personCardType(testCards);

    try {
      await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: {
              name: 'Cardy',
              nonExistentField: 'hello',
            },
          },
        },
        loader,
      );
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to nonexistent field "nonExistentField" on type ${JSON.stringify(
          type,
        )}`,
      );
    }
  },

  "it can filter on a plural primitive field using 'eq'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            nickNames: ['Mang Mang', 'Baby'],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            nickNames: ['Big boy', 'Farty'],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { nickNames: 'Farty' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "it can filter on a nested field within a plural composite field using 'eq'":
    async (assert, { indexQueryEngine, dbAdapter, loader, testCards }) => {
      let { mango, vangogh } = testCards;
      await setupIndex(dbAdapter, [
        {
          card: mango,
          data: {
            search_doc: {
              name: 'Mango',
              friends: [
                {
                  name: 'Van Gogh',
                },
                { name: 'Ringo' },
              ],
            },
          },
        },
        {
          card: vangogh,
          data: {
            search_doc: {
              name: 'Van Gogh',
              friends: [{ name: 'Ringo' }],
            },
          },
        },
      ]);

      let type = await personCardType(testCards);
      {
        let { cards: results, meta } = await indexQueryEngine.search(
          new URL(testRealmURL),
          {
            filter: {
              on: type,
              eq: { 'friends.name': 'Van Gogh' },
            },
          },
          loader,
        );

        assert.strictEqual(
          meta.page.total,
          1,
          'the total results meta is correct',
        );
        assert.deepEqual(getIds(results), [mango.id], 'results are correct');
      }
      {
        let { cards: results, meta } = await indexQueryEngine.search(
          new URL(testRealmURL),
          {
            filter: {
              on: type,
              eq: { 'friends.name': 'Ringo' },
            },
          },
          loader,
        );

        assert.strictEqual(
          meta.page.total,
          2,
          'the total results meta is correct',
        );
        assert.deepEqual(
          getIds(results),
          [mango.id, vangogh.id],
          'results are correct',
        );
      }
    },

  'it can match a null in a plural field': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            nickNames: ['Mang Mang', 'Baby'],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            nickNames: null,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { nickNames: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  'it can match a leaf plural field nested in a plural composite field': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            friends: [
              {
                name: 'Van Gogh',
                nickNames: ['Big Baby', 'Farty'],
              },
              { name: 'Ringo', nickNames: ['Mang Mang', 'Baby'] },
            ],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            friends: [{ name: 'Ringo', nickNames: ['Ring Ring'] }],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { 'friends.nickNames': 'Baby' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  'it can match thru a plural nested composite field that is field of a singular composite field':
    async (assert, { indexQueryEngine, dbAdapter, loader, testCards }) => {
      let { mango, vangogh } = testCards;
      await setupIndex(dbAdapter, [
        {
          card: mango,
          data: {
            search_doc: {
              name: 'Mango',
              bestFriend: {
                name: 'Van Gogh',
                friends: [{ name: 'Ringo' }, { name: 'Van Gogh' }],
              },
            },
          },
        },
        {
          card: vangogh,
          data: {
            search_doc: {
              name: 'Van Gogh',
              bestFriend: { name: 'Ringo', friends: [{ name: 'Lucky' }] },
            },
          },
        },
      ]);

      let type = await personCardType(testCards);
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: { 'bestFriend.friends.name': 'Lucky' },
          },
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
    },

  "can return a single result for a card when there are multiple matches within a result's search doc":
    async (assert, { indexQueryEngine, dbAdapter, loader, testCards }) => {
      let { mango } = testCards;
      await setupIndex(dbAdapter, [
        {
          card: mango,
          data: {
            search_doc: {
              name: 'Mango',
              friends: [
                { name: 'Ringo', bestFriend: { name: 'Mango' } },
                { name: 'Van Gogh', bestFriend: { name: 'Mango' } },
              ],
            },
          },
        },
      ]);

      let type = await personCardType(testCards);
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            eq: { 'friends.bestFriend.name': 'Mango' },
          },
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [mango.id], 'results are correct');
    },

  'can perform query against WIP version of the index': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      dbAdapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          card: mango,
          data: { realm_version: 1, search_doc: { name: 'Mango' } },
        },
        {
          card: vangogh,
          data: { realm_version: 1, search_doc: { name: 'Van Gogh' } },
        },
        {
          card: vangogh,
          data: { realm_version: 2, search_doc: { name: 'Mango' } },
        },
        {
          card: ringo,
          data: { realm_version: 1, search_doc: { name: 'Mango' } },
        },
        {
          card: ringo,
          data: { realm_version: 2, search_doc: { name: 'Ringo' } },
        },
      ],
    );

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { name: 'Mango' },
        },
      },
      loader,
      { useWorkInProgressIndex: true },
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.strictEqual(
      meta.page.realmVersion,
      2,
      'the realm version queried is correct',
    );
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  'can perform query against "production" version of the index': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      dbAdapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          card: mango,
          data: { realm_version: 1, search_doc: { name: 'Mango' } },
        },
        {
          card: vangogh,
          data: { realm_version: 1, search_doc: { name: 'Van Gogh' } },
        },
        {
          card: vangogh,
          data: { realm_version: 2, search_doc: { name: 'Mango' } },
        },
        {
          card: ringo,
          data: { realm_version: 1, search_doc: { name: 'Ringo' } },
        },
      ],
    );

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          eq: { name: 'Mango' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.strictEqual(
      meta.page.realmVersion,
      1,
      'the realm version queried is correct',
    );
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  'can sort search results': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        sort: [
          {
            on: type,
            by: 'name',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, ringo.id, vangogh.id],
      'results are correct',
    );
  },

  'can sort descending': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        sort: [
          {
            on: type,
            by: 'name',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [vangogh.id, ringo.id, mango.id],
      'results are correct',
    );
  },

  'nulls are sorted to the end of search results': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: null,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          sort: [
            {
              on: type,
              by: 'name',
            },
          ],
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        3,
        'the total results meta is correct',
      );
      assert.deepEqual(
        getIds(results),
        [mango.id, vangogh.id, ringo.id],
        'results are correct',
      );
    }
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          sort: [
            {
              on: type,
              by: 'name',
              direction: 'desc',
            },
          ],
        },
        loader,
      );

      assert.strictEqual(
        meta.page.total,
        3,
        'the total results meta is correct',
      );
      assert.deepEqual(
        getIds(results),
        [vangogh.id, mango.id, ringo.id],
        'results are correct',
      );
    }
  },

  'can get paginated results that are stable during index mutations': async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango } = testCards;
    let Card = mango.constructor as typeof CardDef;
    let testData: TestIndexRow[] = [];
    for (let i = 0; i < 10; i++) {
      testData.push({
        card: new Card({ id: `${testRealmURL}mango${i}` }),
        data: { search_doc: { name: `Mango-${i}` } },
      });
    }

    await setupIndex(dbAdapter, testData);

    // page 1
    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        page: { number: 0, size: 3 },
        sort: [
          {
            on: type,
            by: 'name',
            direction: 'desc',
          },
        ],
        filter: {
          on: type,
          contains: { name: 'Mango' },
        },
      },
      loader,
    );

    let {
      page: { total, realmVersion },
    } = meta;
    assert.strictEqual(total, 10, 'the total results meta is correct');
    assert.strictEqual(realmVersion, 1, 'the query realm version is correct');
    assert.deepEqual(getIds(results), [
      `${testRealmURL}mango9`,
      `${testRealmURL}mango8`,
      `${testRealmURL}mango7`,
    ]);

    {
      // page 2
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          // providing the realm version received from the 1st page's meta keeps
          // the result set stable while we page over it
          page: { number: 1, size: 3, realmVersion },
          sort: [
            {
              on: type,
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: type,
            contains: { name: 'Mango' },
          },
        },
        loader,
      );
      assert.strictEqual(
        meta.page.total,
        10,
        'the total results meta is correct',
      );
      assert.strictEqual(
        meta.page.realmVersion,
        1,
        'the query realm version is correct',
      );
      assert.deepEqual(getIds(results), [
        `${testRealmURL}mango6`,
        `${testRealmURL}mango5`,
        `${testRealmURL}mango4`,
      ]);
    }

    // mutate the index
    let batch = await new IndexWriter(dbAdapter).createBatch(
      new URL(testRealmURL),
    );
    await batch.invalidate(new URL(`${testRealmURL}mango3.json`));
    await batch.done();

    {
      // page 3
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          // providing the realm version received from the 1st page's meta keeps
          // the result set stable while we page over it
          page: { number: 2, size: 3, realmVersion },
          sort: [
            {
              on: type,
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: type,
            contains: { name: 'Mango' },
          },
        },
        loader,
      );
      assert.strictEqual(
        meta.page.total,
        10,
        'the total results meta is correct',
      );
      assert.strictEqual(
        meta.page.realmVersion,
        1,
        'the query realm version is correct',
      );
      assert.deepEqual(getIds(results), [
        `${testRealmURL}mango3`, // this is actually removed in the current index
        `${testRealmURL}mango2`,
        `${testRealmURL}mango1`,
      ]);
    }

    // assert that a new search against the current index no longer contains the
    // removed card
    {
      let { cards: results, meta } = await indexQueryEngine.search(
        new URL(testRealmURL),
        {
          sort: [
            {
              on: type,
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: type,
            contains: { name: 'Mango' },
          },
        },
        loader,
      );

      let {
        page: { total, realmVersion },
      } = meta;
      assert.strictEqual(total, 9, 'the total results meta is correct');
      assert.strictEqual(realmVersion, 2, 'the query realm version is correct');
      assert.deepEqual(getIds(results), [
        `${testRealmURL}mango9`,
        `${testRealmURL}mango8`,
        `${testRealmURL}mango7`,
        `${testRealmURL}mango6`,
        `${testRealmURL}mango5`,
        `${testRealmURL}mango4`,
        `${testRealmURL}mango2`,
        `${testRealmURL}mango1`,
        `${testRealmURL}mango0`,
      ]);
    }
  },

  "can filter using 'gt'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { gt: 25 } },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru nested fields": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
              number: 123,
            },
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
              number: 456,
            },
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
              number: 100,
            },
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: {
            'address.number': {
              gt: 100,
            },
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru a plural primitive field": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
            lotteryNumbers: [20, 50, 70],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
            lotteryNumbers: [40, 60, 80],
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
            lotteryNumbers: [10, 20, 30],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: {
            lotteryNumbers: {
              gt: 50,
            },
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru a plural composite field": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    let mangoDoc = {
      name: 'Mango',
      address: {
        street: '123 Main Street',
        city: 'Barksville',
      },
      age: 35,
    };
    let vanGoghDoc = {
      name: 'Van Gogh',
      address: {
        street: '456 Grand Blvd',
        city: 'Barksville',
      },
      age: 30,
    };
    let ringoDoc = {
      name: 'Ringo',
      address: {
        street: '100 Treat Street',
        city: 'Waggington',
      },
      age: 25,
    };
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            ...mangoDoc,
            friends: [{ ...vanGoghDoc }],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            ...vanGoghDoc,
            friends: [{ ...ringoDoc }],
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            ...ringoDoc,
            friends: [{ ...mangoDoc }],
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: {
            'friends.age': {
              gt: 25,
            },
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'gte'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { gte: 25 } },
        },
        sort: [
          {
            on: type,
            by: 'age',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'lt'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { lt: 35 } },
        },
        sort: [
          {
            on: type,
            by: 'age',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'lte'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { lte: 35 } },
        },
        sort: [
          {
            on: type,
            by: 'age',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can combine 'range' filter": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { gt: 25, lt: 35 } },
        },
        sort: [
          {
            on: type,
            by: 'age',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  },

  "cannot filter 'null' value using 'range'": async (
    assert,
    { indexQueryEngine, dbAdapter, loader, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
              street: '123 Main Street',
              city: 'Barksville',
            },
            age: 35,
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: {
              street: '456 Grand Blvd',
              city: 'Barksville',
            },
            age: 30,
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: {
              street: '100 Treat Street',
              city: 'Waggington',
            },
            age: 25,
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    assert.rejects(
      indexQueryEngine.search(
        new URL(testRealmURL),
        {
          filter: {
            on: type,
            range: { age: { gt: null } },
          },
        },
        loader,
      ),
      `'null' is not a permitted value in a 'range' filter`,
    );
  },
  'can get prerendered cards from the indexer': async (
    assert,
    { indexQueryEngine, dbAdapter, loader },
  ) => {
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}vangogh.json`,
        file_alias: `${testRealmURL}vangogh`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [
          `${testRealmURL}person/Person`,
          'https://cardstack.com/base/card-api/CardDef',
        ],
        embedded_html: {
          [`${testRealmURL}person/Person`]:
            '<div>Van Gogh (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Van Gogh (CardDef embedded template)</div>',
        },
        fitted_html: {
          [`${testRealmURL}person/Person`]:
            '<div>Van Gogh (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Van Gogh (CardDef fitted template)</div>',
        },
        atom_html: 'Van Gogh',
        search_doc: { name: 'Van Gogh' },
      },
      {
        url: `${testRealmURL}jimmy.json`,
        file_alias: `${testRealmURL}jimmy`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [
          `${testRealmURL}person/Person`,
          'https://cardstack.com/base/card-api/CardDef',
        ],

        embedded_html: {
          [`${testRealmURL}person/1`]:
            '<div>Jimmy (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Jimmy (CardDef embedded template)</div>',
        },
        fitted_html: {
          [`${testRealmURL}person/1`]:
            '<div>Jimmy (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Jimmy (CardDef fitted template)</div>',
        },
        atom_html: 'Jimmy',
        search_doc: { name: 'Jimmy' },
      },
      {
        url: `${testRealmURL}donald.json`,
        file_alias: `${testRealmURL}donald`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [
          `${testRealmURL}fancy-person/FancyPerson`,
          `${testRealmURL}person/Person`,
          'https://cardstack.com/base/card-api/CardDef',
        ],
        embedded_html: {
          [`${testRealmURL}fancy-person/FancyPerson`]:
            '<div>Donald (FancyPerson embedded template)</div>',
          [`${testRealmURL}person/Person`]:
            '<div>Donald (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef embedded template)</div>',
        },
        fitted_html: {
          [`${testRealmURL}fancy-person/FancyPerson`]:
            '<div>Donald (FancyPerson fitted template)</div>',
          [`${testRealmURL}person/Person`]:
            '<div>Donald (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef fitted template)</div>',
        },
        atom_html: 'Donald',
        search_doc: { name: 'Donald' },
      },
      {
        url: `${testRealmURL}fancy-person.gts`,
        type: 'module',
        file_alias: `${testRealmURL}fancy-person`,
        realm_version: 1,
        realm_url: testRealmURL,
        source: cardSrc,
        deps: [`${testRealmURL}person`, 'https://cardstack.com/base/card-api'],
      },
      {
        url: `${testRealmURL}person.gts`,
        type: 'module',
        file_alias: `${testRealmURL}person`,
        realm_version: 1,
        realm_url: testRealmURL,
        source: cardSrc,
        deps: ['https://cardstack.com/base/card-api'],
      },
      {
        url: `https://cardstack.com/base/card-api`,
        type: 'module',
        file_alias: `${testRealmURL}card-api`,
        realm_version: 1,
        realm_url: testRealmURL,
        source: '',
        deps: [],
      },
    ]);

    // Requesting embedded template without ON filter
    let { prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {}, // When there is no ON filter, embedded template for CardDef is used
      loader,
      {
        htmlFormat: 'embedded',
      },
    );

    assert.strictEqual(
      meta.page.total,
      3,
      'meta total results meta is correct',
    );
    assert.strictEqual(meta.page.realmVersion, 1, 'realm version is correct');
    assert.strictEqual(
      prerenderedCards.length,
      3,
      'the actual returned total results are correct',
    );

    assert.strictEqual(
      prerenderedCards[0].url,
      'http://test-realm/test/donald.json',
    );
    assert.strictEqual(
      prerenderedCards[0].html,
      '<div>Donald (CardDef embedded template)</div>',
    );

    assert.strictEqual(
      prerenderedCards[1].url,
      'http://test-realm/test/jimmy.json',
    );
    assert.strictEqual(
      prerenderedCards[1].html,
      '<div>Jimmy (CardDef embedded template)</div>',
    );

    assert.strictEqual(
      prerenderedCards[2].url,
      'http://test-realm/test/vangogh.json',
    );
    assert.strictEqual(
      prerenderedCards[2].html,
      '<div>Van Gogh (CardDef embedded template)</div>',
    );

    // Requesting embedded template with ON filter
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: {
            module: `${testRealmURL}fancy-person`,
            name: 'FancyPerson',
          },
          not: {
            eq: {
              name: 'Richard',
            },
          },
        },
      },
      loader,
      {
        htmlFormat: 'embedded',
      },
    ));

    assert.strictEqual(
      prerenderedCards.length,
      1,
      'the actual returned total results are correct (there is only one FancyPerson)',
    );

    assert.strictEqual(
      prerenderedCards[0].url,
      'http://test-realm/test/donald.json',
    );
    assert.strictEqual(
      prerenderedCards[0].html,
      '<div>Donald (FancyPerson embedded template)</div>',
    );

    //  Requesting atom template
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: {
            module: `${testRealmURL}fancy-person`,
            name: 'FancyPerson',
          },

          eq: {
            name: 'Donald',
          },
        },
      },
      loader,
      {
        htmlFormat: 'atom',
      },
    ));

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.strictEqual(
      meta.page.realmVersion,
      1,
      'the realm version is correct',
    );

    assert.strictEqual(prerenderedCards[0].url, `${testRealmURL}donald.json`);
    assert.strictEqual(prerenderedCards[0].html, 'Donald'); // Atom template
  },
} as SharedTests<{
  indexQueryEngine: IndexQueryEngine;
  dbAdapter: DBAdapter;
  loader: Loader;
  testCards: TestCards;
}>);

export default tests;

function getIds(resources: LooseCardResource[]): string[] {
  return resources.map((r) => r.id!);
}

function internalKeyToCodeRef(key: string): ResolvedCodeRef {
  let parts = key.split('/');
  let name = parts.pop()!;
  return {
    module: parts.join('/'),
    name,
  };
}

// the card type that we use is sensitive to the URL that we imported the module
// from. These url's are different between the browser and server tests. In
// order to keep the tests agnostic we'll just look up the type of a card whose
// type we know in advance.

async function personCardType(testCards: TestCards) {
  let { vangogh } = testCards;
  if (!vangogh) {
    throw new Error(
      `missing the 'vangogh' test card in the--this is the card we use to derive the Person type`,
    );
  }
  let internalKey = [...(await getTypes(vangogh))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function simpleCatalogEntryType(testCards: TestCards) {
  let { stringFieldEntry } = testCards;
  if (!stringFieldEntry) {
    throw new Error(
      `missing the 'stringFieldEntry' test card in the--this is the card we use to derive the SimpleCatalogEntry type`,
    );
  }
  let internalKey = [...(await getTypes(stringFieldEntry))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function eventType(testCards: TestCards) {
  let { mangoBirthday } = testCards;
  if (!mangoBirthday) {
    throw new Error(
      `missing the 'mangoBirthday' test card in the--this is the card we use to derive the Event type`,
    );
  }
  let internalKey = [...(await getTypes(mangoBirthday))].shift()!;
  return internalKeyToCodeRef(internalKey);
}
