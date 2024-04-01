import { module, test, skip } from 'qunit';

import {
  type CodeRef,
  Loader,
  VirtualNetwork,
  baseRealm,
  IndexerDBClient,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/SQLiteAdapter';
import { shimExternals } from '@cardstack/host/lib/externals';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL, setupIndex, serializeCard } from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let { sqlSchema, resolvedBaseRealmURL } = ENV;

module('Unit | query', function (hooks) {
  let adapter: SQLiteAdapter;
  let client: IndexerDBClient;
  let loader: Loader;
  let testCards: { [name: string]: CardDef } = {};

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    loader = virtualNetwork.createLoader();
    loader.addURLMapping(new URL(baseRealm.url), new URL(resolvedBaseRealmURL));
    shimExternals(virtualNetwork);

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let {
      field,
      contains,
      containsMany,
      linksToMany,
      CardDef,
      FieldDef,
      setCardAsSavedForTest,
    } = cardApi;
    let { default: StringField } = string;
    class Address extends FieldDef {
      @field street = contains(StringField);
      @field city = contains(StringField);
    }
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field address = contains(Address);
      @field friends = linksToMany(() => Person);
    }
    class FancyPerson extends Person {
      @field favoriteColor = contains(StringField);
    }
    class Cat extends CardDef {
      @field name = contains(StringField);
    }

    loader.shimModule(`${testRealmURL}person`, { Person });
    loader.shimModule(`${testRealmURL}fancy-person`, { FancyPerson });
    loader.shimModule(`${testRealmURL}cat`, { Cat });

    let ringo = new Person({
      id: `${testRealmURL}ringo`,
      name: 'Ringo',
      address: new Address({
        street: '100 Treat Street',
        city: 'Waggington',
      }),
    });
    let vangogh = new Person({
      id: `${testRealmURL}vangogh`,
      name: 'Van Gogh',
      address: new Address({
        street: '456 Grand Blvd',
        city: 'Barksville',
        friends: [ringo],
      }),
    });
    let mango = new FancyPerson({
      id: `${testRealmURL}mango`,
      name: 'Mango',
      address: new Address({
        street: '123 Main Street',
        city: 'Barksville',
      }),
      friends: [vangogh, ringo],
    });
    let paper = new Cat({ id: `${testRealmURL}paper`, name: 'Paper' });
    testCards = {
      mango,
      vangogh,
      ringo,
      paper,
    };
    for (let card of Object.values(testCards)) {
      setCardAsSavedForTest(card);
    }

    adapter = new SQLiteAdapter(sqlSchema);
    client = new IndexerDBClient(adapter);
    await client.ready();
  });

  hooks.afterEach(async function () {
    await client.teardown();
  });

  test('can get all cards with empty filter', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(client, [mango, vangogh, paper]);

    let { cards, meta } = await client.search({}, loader);
    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      cards,
      [
        await serializeCard(mango),
        await serializeCard(paper),
        await serializeCard(vangogh),
      ],
      'results are correct',
    );
  });

  test('deleted cards are not included in results', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(client, [
      { card: mango, data: { is_deleted: false } },
      { card: vangogh, data: { is_deleted: null } },
      { card: paper, data: { is_deleted: true } },
    ]);

    let { meta } = await client.search({}, loader);
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
  });

  test('can filter by type', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(client, [mango, vangogh, paper]);

    let { cards, meta } = await client.search(
      {
        filter: {
          type: { module: `${testRealmURL}person`, name: 'Person' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      cards,
      [await serializeCard(mango), await serializeCard(vangogh)],
      'results are correct',
    );
  });

  test(`can filter using 'eq'`, async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(client, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
      // this card's "name" field doesn't match our filter since our filter
      // specified "name" fields of Person cards
      { card: paper, data: { search_doc: { name: 'Mango' } } },
    ]);

    let { cards, meta } = await client.search(
      {
        filter: {
          eq: { name: 'Mango' },
          on: { module: `${testRealmURL}person`, name: 'Person' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(
      cards,
      [await serializeCard(mango)],
      'results are correct',
    );
  });

  test(`can filter using 'eq' thru nested fields`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { 'address.city': 'Barksville' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      cards,
      [await serializeCard(mango), await serializeCard(vangogh)],
      'results are correct',
    );
  });

  test(`can use 'eq' to find 'null' values`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { name: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(
      cards,
      [await serializeCard(ringo)],
      'results are correct',
    );
  });

  test(`gives a good error when query refers to missing card`, async function (assert) {
    await setupIndex(client, []);

    try {
      await client.search(
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
      await client.search(
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
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await setupIndex(client, []);

    try {
      await client.search(
        {
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
        `Your filter refers to nonexistent field "nonExistentField" on type {"module":"${testRealmURL}person","name":"Person"}`,
      );
    }
  });

  skip(`it can filter on a plural primitive field using 'eq'`, async function (_assert) {});

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(client, [
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
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            friends: null,
          },
        },
      },
    ]);

    {
      let { cards, meta } = await client.search(
        {
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
      assert.deepEqual(
        cards,
        [await serializeCard(mango)],
        'results are correct',
      );
    }
    {
      let { cards, meta } = await client.search(
        {
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
        cards,
        [await serializeCard(mango), await serializeCard(vangogh)],
        'results are correct',
      );
    }
  });

  // test nested field where plural is sandwiched by singular fields
  // test filter on a nested plural within a plural composite?
});
