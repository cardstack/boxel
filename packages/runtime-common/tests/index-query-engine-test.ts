import format from 'date-fns/format';
import stringify from 'safe-stable-stringify';
import {
  baseRealm,
  IndexQueryEngine,
  internalKeyFor,
  type CodeRef,
  type LooseCardResource,
  type ResolvedCodeRef,
  DBAdapter,
} from '../index';
import { serializeCard } from '../helpers/indexer';
import { testRealmURL } from '../helpers/const';
import { type SharedTests } from '../helpers';
import { setupIndex, getTypes } from '../helpers/indexer';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface TestCards {
  [name: string]: CardDef;
}

const tests = Object.freeze({
  'can get all cards with empty filter': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
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
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { is_deleted: false } },
      { card: vangogh, data: { is_deleted: null } },
      { card: paper, data: { is_deleted: true } },
    ]);

    let { meta } = await indexQueryEngine.search(new URL(testRealmURL), {});
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
  },

  'error docs are not included in results': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
          message: 'test error',
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
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let { mango, vangogh, paper } = testCards;

    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.search(
      new URL(testRealmURL),
      { filter: { type } },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can filter using 'eq' thru nested fields": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "can use 'eq' to find 'null' values": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [ringo.id], 'results are correct');
  },

  "can use 'eq' to match against number type": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'eq' to match against boolean type": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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

    let type = await SimpleSpecType(testCards);
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
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'contains' to match multiple fields": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use a 'contains' filter to match 'null'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "can use 'every' to combine multiple filters": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  "can use 'any' to combine multiple filters": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter },
  ) => {
    await setupIndex(dbAdapter, []);

    try {
      await indexQueryEngine.search(new URL(testRealmURL), {
        filter: {
          on: {
            module: `${testRealmURL}nonexistent`,
            name: 'Nonexistent',
          },
          eq: { nonExistentField: 'hello' },
        },
      });
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to a nonexistent type: import { Nonexistent } from "${testRealmURL}nonexistent"`,
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
      await indexQueryEngine.search(new URL(testRealmURL), {
        filter: {
          on: cardRef,
          eq: { name: 'Simba' },
        },
      });
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to a nonexistent type: ${stringify(cardRef)}`,
      );
    }
  },

  'gives a good error when query refers to missing field': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    await setupIndex(dbAdapter, []);
    let type = await personCardType(testCards);

    try {
      await indexQueryEngine.search(new URL(testRealmURL), {
        filter: {
          on: type,
          eq: {
            name: 'Cardy',
            nonExistentField: 'hello',
          },
        },
      });
      throw new Error('failed to throw expected exception');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        `Your filter refers to a nonexistent field "nonExistentField" on type ${stringify(
          type,
        )}`,
      );
    }
  },

  "it can filter on a plural primitive field using 'eq'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  "it can filter on a nested field within a plural composite field using 'eq'":
    async (assert, { indexQueryEngine, dbAdapter, testCards }) => {
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
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  },

  'it can match a leaf plural field nested in a plural composite field': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  'it can match thru a plural nested composite field that is field of a singular composite field':
    async (assert, { indexQueryEngine, dbAdapter, testCards }) => {
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
      );

      assert.strictEqual(
        meta.page.total,
        1,
        'the total results meta is correct',
      );
      assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
    },

  "can return a single result for a card when there are multiple matches within a result's search doc":
    async (assert, { indexQueryEngine, dbAdapter, testCards }) => {
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
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      dbAdapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      {
        working: [
          {
            card: mango,
            data: { realm_version: 1, search_doc: { name: 'Mango' } },
          },
          {
            card: vangogh,
            data: { realm_version: 2, search_doc: { name: 'Mango' } },
          },
          {
            card: ringo,
            data: { realm_version: 2, search_doc: { name: 'Ringo' } },
          },
        ],
        production: [
          {
            card: mango,
            data: { realm_version: 1, search_doc: { name: 'Mango' } },
          },
          {
            card: vangogh,
            data: { realm_version: 1, search_doc: { name: 'Van Gogh' } },
          },
          {
            card: ringo,
            data: { realm_version: 1, search_doc: { name: 'Mango' } },
          },
        ],
      },
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
      { useWorkInProgressIndex: true },
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(results),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  'can perform query against "production" version of the index': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      dbAdapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      {
        working: [
          {
            card: mango,
            data: { realm_version: 1, search_doc: { name: 'Mango' } },
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
        production: [
          {
            card: mango,
            data: { realm_version: 1, search_doc: { name: 'Mango' } },
          },
          {
            card: vangogh,
            data: { realm_version: 1, search_doc: { name: 'Van Gogh' } },
          },
          {
            card: ringo,
            data: { realm_version: 1, search_doc: { name: 'Ringo' } },
          },
        ],
      },
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
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  },

  'can sort search results': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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
    { indexQueryEngine, dbAdapter, testCards },
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

  "can filter using 'gt'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        range: { age: { gt: 25 } },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru nested fields": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        range: {
          'address.number': {
            gt: 100,
          },
        },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru a plural primitive field": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        range: {
          lotteryNumbers: {
            gt: 50,
          },
        },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  },

  "can filter using 'gt' thru a plural composite field": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        range: {
          'friends.age': {
            gt: 25,
          },
        },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'gte'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
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
    });

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'lt'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
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
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can filter using 'lte'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
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
    });

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id, ringo.id],
      'results are correct',
    );
  },

  "can combine 'range' filter": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
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
    });

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  },

  "cannot filter 'null' value using 'range'": async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
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
      indexQueryEngine.search(new URL(testRealmURL), {
        filter: {
          on: type,
          range: { age: { gt: null } },
        },
      }),
      `'null' is not a permitted value in a 'range' filter`,
    );
  },
  'can sort using a general field that is not an attribute of a card': async (
    assert,
    { indexQueryEngine, dbAdapter },
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
        last_modified: '1',
        resource_created_at: '1',
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
        last_modified: '3',
        resource_created_at: '3',
      },
      {
        url: `${testRealmURL}donald.json`,
        file_alias: `${testRealmURL}donald`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [
          `${testRealmURL}person/Person`,
          'https://cardstack.com/base/card-api/CardDef',
        ],
        last_modified: '2',
        resource_created_at: '2',
      },
    ]);

    let { prerenderedCards: results } =
      await indexQueryEngine.searchPrerendered(
        new URL(testRealmURL),
        {
          sort: [
            {
              by: 'lastModified',
              direction: 'desc',
            },
          ],
        },
        {
          htmlFormat: 'embedded',
        },
      );

    assert.deepEqual(
      results.map((r: { url: string }) => r.url),
      [
        `${testRealmURL}jimmy.json`,
        `${testRealmURL}donald.json`,
        `${testRealmURL}vangogh.json`,
      ],
      'results are correct',
    );

    let { prerenderedCards: results2 } =
      await indexQueryEngine.searchPrerendered(
        new URL(testRealmURL),
        {
          sort: [
            {
              by: 'lastModified',
              direction: 'asc',
            },
          ],
        },
        {
          htmlFormat: 'embedded',
        },
      );

    assert.deepEqual(
      results2.map((r: { url: string }) => r.url),
      [
        `${testRealmURL}vangogh.json`,
        `${testRealmURL}donald.json`,
        `${testRealmURL}jimmy.json`,
      ],
      'results are correct',
    );

    let { prerenderedCards: results3 } =
      await indexQueryEngine.searchPrerendered(
        new URL(testRealmURL),
        {
          sort: [
            {
              by: 'createdAt',
              direction: 'desc',
            },
          ],
        },
        {
          htmlFormat: 'embedded',
        },
      );

    assert.deepEqual(
      results3.map((r: { url: string }) => r.url),
      [
        `${testRealmURL}jimmy.json`,
        `${testRealmURL}donald.json`,
        `${testRealmURL}vangogh.json`,
      ],
      'results are correct',
    );
  },
  'can get prerendered cards from the indexer': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let personCard = await personCardType(testCards);
    let personKey = internalKeyFor(personCard, undefined);
    let fancyPersonCard = await fancyPersonCardType(testCards);
    let fancyPersonKey = internalKeyFor(fancyPersonCard, undefined);
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}vangogh.json`,
        file_alias: `${testRealmURL}vangogh`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        embedded_html: {
          [personKey]: '<div>Van Gogh (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Van Gogh (CardDef embedded template)</div>',
        },
        fitted_html: {
          [personKey]: '<div>Van Gogh (Person fitted template)</div>',
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
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],

        embedded_html: {
          [personKey]: '<div>Jimmy (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Jimmy (CardDef embedded template)</div>',
        },
        fitted_html: {
          [personKey]: '<div>Jimmy (Person fitted template)</div>',
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
          fancyPersonKey,
          personKey,
          'https://cardstack.com/base/card-api/CardDef',
        ],
        embedded_html: {
          [fancyPersonKey]: '<div>Donald (FancyPerson embedded template)</div>',
          [personKey]: '<div>Donald (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef embedded template)</div>',
        },
        fitted_html: {
          [fancyPersonKey]: '<div>Donald (FancyPerson fitted template)</div>',
          [personKey]: '<div>Donald (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef fitted template)</div>',
        },
        atom_html: 'Donald',
        search_doc: { name: 'Donald' },
      },
    ]);

    // Requesting embedded template without ON filter
    let { prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {}, // When there is no ON filter, embedded template for CardDef is used
      {
        htmlFormat: 'embedded',
      },
    );

    assert.strictEqual(
      meta.page.total,
      3,
      'meta total results meta is correct',
    );
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
      '<div>Donald (FancyPerson embedded template)</div>',
    );
    assert.deepEqual(prerenderedCards[0].usedRenderType, fancyPersonCard);

    assert.strictEqual(
      prerenderedCards[1].url,
      'http://test-realm/test/jimmy.json',
    );
    assert.strictEqual(
      prerenderedCards[1].html,
      '<div>Jimmy (Person embedded template)</div>',
    );
    assert.deepEqual(prerenderedCards[1].usedRenderType, personCard);

    assert.strictEqual(
      prerenderedCards[2].url,
      'http://test-realm/test/vangogh.json',
    );
    assert.strictEqual(
      prerenderedCards[2].html,
      '<div>Van Gogh (Person embedded template)</div>',
    );
    assert.deepEqual(prerenderedCards[2].usedRenderType, personCard);

    // Requesting embedded template with ON filter
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: fancyPersonCard,
          not: {
            eq: {
              name: 'Richard',
            },
          },
        },
      },
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
    assert.deepEqual(prerenderedCards[0].usedRenderType, fancyPersonCard);

    //  Requesting atom template
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: fancyPersonCard,

          eq: {
            name: 'Donald',
          },
        },
      },
      {
        htmlFormat: 'atom',
      },
    ));

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.strictEqual(prerenderedCards[0].url, `${testRealmURL}donald.json`);
    assert.strictEqual(prerenderedCards[0].html, 'Donald'); // Atom template
    assert.deepEqual(prerenderedCards[0].usedRenderType, fancyPersonCard);

    // Define renderType argument
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: fancyPersonCard,
          not: {
            eq: {
              name: 'Richard',
            },
          },
        },
      },
      {
        htmlFormat: 'embedded',
        renderType: personCard,
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
      '<div>Donald (Person embedded template)</div>',
    );
    assert.deepEqual(prerenderedCards[0].usedRenderType, personCard);
  },

  'can get prerendered cards in an error state from the indexer': async (
    assert,
    { indexQueryEngine, dbAdapter, testCards },
  ) => {
    let personCard = await personCardType(testCards);
    let personKey = internalKeyFor(personCard, undefined);
    let fancyPersonCard = await fancyPersonCardType(testCards);
    let fancyPersonKey = internalKeyFor(fancyPersonCard, undefined);
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}vangogh.json`,
        file_alias: `${testRealmURL}vangogh`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        embedded_html: {
          [personKey]: '<div>Van Gogh (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Van Gogh (CardDef embedded template)</div>',
        },
        fitted_html: {
          [personKey]: '<div>Van Gogh (Person fitted template)</div>',
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
          fancyPersonKey,
          personKey,
          'https://cardstack.com/base/card-api/CardDef',
        ],

        embedded_html: {
          [fancyPersonKey]: '<div>Jimmy (FancyPerson embedded template)</div>',
          [personKey]: '<div>Jimmy (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Jimmy (CardDef embedded template)</div>',
        },
        fitted_html: {
          [fancyPersonKey]: '<div>Jimmy (FancyPerson fitted template)</div>',
          [personKey]: '<div>Jimmy (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Jimmy (CardDef fitted template)</div>',
        },
        atom_html: 'Jimmy',
        search_doc: { name: 'Jimmy' },
      },
      {
        url: `${testRealmURL}donald.json`,
        file_alias: `${testRealmURL}donald`,
        type: 'error',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: [
          fancyPersonKey,
          personKey,
          'https://cardstack.com/base/card-api/CardDef',
        ],
        embedded_html: {
          [fancyPersonKey]: '<div>Donald (FancyPerson embedded template)</div>',
          [personKey]: '<div>Donald (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef embedded template)</div>',
        },
        fitted_html: {
          [fancyPersonKey]: '<div>Donald (FancyPerson fitted template)</div>',
          [personKey]: '<div>Donald (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Donald (CardDef fitted template)</div>',
        },
        atom_html: 'Donald',
        search_doc: { name: 'Donald' },
      },
      {
        url: `${testRealmURL}paper.json`,
        file_alias: `${testRealmURL}paper`,
        type: 'error',
        realm_version: 1,
        realm_url: testRealmURL,
        deps: [],
        types: null, // here we are asserting that we can handle a `null` types column
        embedded_html: {
          [fancyPersonKey]: '<div>Paper (FancyPerson embedded template)</div>',
          [personKey]: '<div>Paper (Person embedded template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Paper (CardDef embedded template)</div>',
        },
        fitted_html: {
          [fancyPersonKey]: '<div>Paper (FancyPerson fitted template)</div>',
          [personKey]: '<div>Paper (Person fitted template)</div>',
          'https://cardstack.com/base/card-api/CardDef':
            '<div>Paper (CardDef fitted template)</div>',
        },
        atom_html: 'Paper',
        search_doc: { name: 'Paper' },
      },
    ]);

    let { prerenderedCards } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: fancyPersonCard,
          not: {
            eq: {
              name: 'Richard',
            },
          },
        },
      },
      {
        htmlFormat: 'embedded',
        includeErrors: true,
      },
    );

    assert.strictEqual(
      prerenderedCards.length,
      2,
      'the actual returned total results are correct',
    );

    assert.strictEqual(
      prerenderedCards[0].url,
      'http://test-realm/test/donald.json',
    );
    assert.strictEqual(
      prerenderedCards[0].html,
      '<div>Donald (FancyPerson embedded template)</div>',
    );
    assert.strictEqual(
      prerenderedCards[0].isError,
      true,
      'card is in error state',
    );
    assert.strictEqual(
      prerenderedCards[1].url,
      'http://test-realm/test/jimmy.json',
    );
    assert.strictEqual(
      prerenderedCards[1].html,
      '<div>Jimmy (FancyPerson embedded template)</div>',
    );
    assert.notOk(prerenderedCards[1].isError, 'card is not in an error state');
  },
} as SharedTests<{
  indexQueryEngine: IndexQueryEngine;
  dbAdapter: DBAdapter;
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

async function fancyPersonCardType(testCards: TestCards) {
  let { mango } = testCards;
  if (!mango) {
    throw new Error(
      `missing the 'mango' test card in the--this is the card we use to derive the FancyPerson type`,
    );
  }
  let internalKey = [...(await getTypes(mango))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function SimpleSpecType(testCards: TestCards) {
  let { stringFieldEntry } = testCards;
  if (!stringFieldEntry) {
    throw new Error(
      `missing the 'stringFieldEntry' test card in the--this is the card we use to derive the SimpleSpec type`,
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
