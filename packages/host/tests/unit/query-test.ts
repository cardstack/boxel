import format from 'date-fns/format';
import { module, test } from 'qunit';

import {
  type CodeRef,
  type LooseCardResource,
  Loader,
  VirtualNetwork,
  baseRealm,
  IndexerDBClient,
  internalKeyFor,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/SQLiteAdapter';
import { shimExternals } from '@cardstack/host/lib/externals';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupIndex,
  serializeCard,
  p,
  type TestIndexRow,
} from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let date: typeof import('https://cardstack.com/base/date');
let codeRef: typeof import('https://cardstack.com/base/code-ref');
let { sqlSchema, resolvedBaseRealmURL } = ENV;

function getIds(resources: LooseCardResource[]): string[] {
  return resources.map((r) => r.id!);
}

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
    date = await loader.import(`${baseRealm.url}date`);
    codeRef = await loader.import(`${baseRealm.url}code-ref`);

    let {
      field,
      contains,
      containsMany,
      linksToMany,
      linksTo,
      CardDef,
      FieldDef,
      setCardAsSavedForTest,
    } = cardApi;
    let { default: StringField } = string;
    let { default: CodeRefField } = codeRef;
    let { default: DateField } = date;
    class Address extends FieldDef {
      @field street = contains(StringField);
      @field city = contains(StringField);
    }
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field address = contains(Address);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
    }
    class FancyPerson extends Person {
      @field favoriteColor = contains(StringField);
    }
    class Cat extends CardDef {
      @field name = contains(StringField);
    }
    class SimpleCatalogEntry extends CardDef {
      @field title = contains(StringField);
      @field ref = contains(CodeRefField);
    }
    class Event extends CardDef {
      @field title = contains(StringField);
      @field venue = contains(StringField);
      @field date = contains(DateField);
    }

    loader.shimModule(`${testRealmURL}person`, { Person });
    loader.shimModule(`${testRealmURL}fancy-person`, { FancyPerson });
    loader.shimModule(`${testRealmURL}cat`, { Cat });
    loader.shimModule(`${testRealmURL}catalog-entry`, { SimpleCatalogEntry });
    loader.shimModule(`${testRealmURL}event`, { Event });

    let stringFieldEntry = new SimpleCatalogEntry({
      title: 'String Field',
      ref: {
        module: `${baseRealm.url}string`,
        name: 'default',
      },
    });
    let numberFieldEntry = new SimpleCatalogEntry({
      title: 'Number Field',
      ref: {
        module: `${baseRealm.url}number`,
        name: 'default',
      },
    });

    let ringo = new Person({
      name: 'Ringo',
      address: new Address({
        street: '100 Treat Street',
        city: 'Waggington',
      }),
    });
    let vangogh = new Person({
      name: 'Van Gogh',
      address: new Address({
        street: '456 Grand Blvd',
        city: 'Barksville',
      }),
      bestFriend: ringo,
      friends: [ringo],
    });
    let mango = new FancyPerson({
      name: 'Mango',
      address: new Address({
        street: '123 Main Street',
        city: 'Barksville',
      }),
      bestFriend: vangogh,
      friends: [vangogh, ringo],
    });
    let paper = new Cat({ name: 'Paper' });

    let mangoBirthday = new Event({
      title: "Mango's Birthday",
      venue: 'Dog Park',
      date: p('2024-10-30'),
    });
    let vangoghBirthday = new Event({
      title: "Van Gogh's Birthday",
      venue: 'Backyard',
      date: p('2024-11-19'),
    });

    testCards = {
      mango,
      vangogh,
      ringo,
      paper,
      mangoBirthday,
      vangoghBirthday,
      stringFieldEntry,
      numberFieldEntry,
    };
    for (let [name, card] of Object.entries(testCards)) {
      card.id = `${testRealmURL}${name}`;
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {},
      loader,
    );
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

    let { meta } = await client.search(new URL(testRealmURL), {}, loader);
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
  });

  test('can filter by type', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(client, [mango, vangogh, paper]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          type: { module: `${testRealmURL}person`, name: 'Person' },
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
      new URL(testRealmURL),
      {
        filter: {
          eq: { name: 'Mango' },
          on: { module: `${testRealmURL}person`, name: 'Person' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
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
      new URL(testRealmURL),
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
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  });

  test(`can use 'eq' to match multiple fields`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { name: 'Van Gogh', nickNames: 'Farty' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
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
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { name: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [ringo.id], 'results are correct');
  });

  test('can filter eq from a code ref query value', async function (assert) {
    let { stringFieldEntry, numberFieldEntry } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: {
            module: `${testRealmURL}catalog-entry`,
            name: 'SimpleCatalogEntry',
          },
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
      getIds(cards),
      [stringFieldEntry.id],
      'results are correct',
    );
  });

  test('can filter eq from a date query value', async function (assert) {
    let { mangoBirthday, vangoghBirthday } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: {
            module: `${testRealmURL}event`,
            name: 'Event',
          },
          eq: {
            date: '2024-10-30',
          },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mangoBirthday.id], 'results are correct');
  });

  test(`can search with a 'not' filter`, async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          not: { eq: { name: 'Mango' } },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [ringo.id, vangogh.id],
      'results are correct',
    );
  });

  test('can handle a filter with double negatives', async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          not: { not: { not: { eq: { name: 'Mango' } } } },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [ringo.id, vangogh.id],
      'results are correct',
    );
  });

  test(`can use a 'contains' filter`, async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          contains: { name: 'ngo' },
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
  });

  test(`can use 'contains' to match multiple fields`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          contains: { name: 'ngo', nickNames: 'Baby' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test(`can use a 'contains' filter to match 'null'`, async function (assert) {
    let { mango, vangogh } = testCards;
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
            name: null,
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          contains: { name: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  });

  test(`can use 'every' to combine multiple filters`, async function (assert) {
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
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
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
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test(`can use 'any' to combine multiple filters`, async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          any: [
            {
              eq: { name: 'Mango' },
            },
            {
              not: { eq: { name: 'Ringo' } },
            },
          ],
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
  });

  test(`gives a good error when query refers to missing card`, async function (assert) {
    await setupIndex(client, []);

    try {
      await client.search(
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
      await client.search(
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
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await setupIndex(client, []);

    try {
      await client.search(
        new URL(testRealmURL),
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

  test(`it can filter on a plural primitive field using 'eq'`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { nickNames: 'Farty' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  });

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
    let { mango, vangogh } = testCards;
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
    ]);

    {
      let { cards, meta } = await client.search(
        new URL(testRealmURL),
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
      assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
    }
    {
      let { cards, meta } = await client.search(
        new URL(testRealmURL),
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
        getIds(cards),
        [mango.id, vangogh.id],
        'results are correct',
      );
    }
  });

  test('it can match a null in a plural field', async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { nickNames: null },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  });

  test('it can match a leaf plural field nested in a plural composite field', async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { 'friends.nickNames': 'Baby' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test('it can match thru a plural nested composite field that is field of a singular composite field', async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { 'bestFriend.friends.name': 'Lucky' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [vangogh.id], 'results are correct');
  });

  test(`can return a single result for a card when there are multiple matches within a result's search doc`, async function (assert) {
    let { mango } = testCards;
    await setupIndex(client, [
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
          eq: { 'friends.bestFriend.name': 'Mango' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test('can perform query against WIP version of the index', async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      client,
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          eq: { name: 'Mango' },
          on: { module: `${testRealmURL}person`, name: 'Person' },
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
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  });

  test('can perform query against "production" version of the index', async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(
      client,
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

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        filter: {
          eq: { name: 'Mango' },
          on: { module: `${testRealmURL}person`, name: 'Person' },
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
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test('can sort search results', async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        sort: [
          {
            on: { module: `${testRealmURL}person`, name: 'Person' },
            by: 'name',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, ringo.id, vangogh.id],
      'results are correct',
    );
  });

  test('can sort descending', async function (assert) {
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
            name: 'Ringo',
          },
        },
      },
    ]);

    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        sort: [
          {
            on: { module: `${testRealmURL}person`, name: 'Person' },
            by: 'name',
            direction: 'desc',
          },
        ],
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 3, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [vangogh.id, ringo.id, mango.id],
      'results are correct',
    );
  });

  test('can get paginated results that are stable during index mutations', async function (assert) {
    let { mango } = testCards;
    let Card = mango.constructor as typeof CardDef;
    let testData: TestIndexRow[] = [];
    for (let i = 0; i < 10; i++) {
      testData.push({
        card: new Card({ id: `${testRealmURL}mango${i}` }),
        data: { search_doc: { name: `Mango-${i}` } },
      });
    }

    await setupIndex(client, testData);

    // page 1
    let { cards, meta } = await client.search(
      new URL(testRealmURL),
      {
        page: { number: 0, size: 3 },
        sort: [
          {
            on: { module: `${testRealmURL}person`, name: 'Person' },
            by: 'name',
            direction: 'desc',
          },
        ],
        filter: {
          on: { module: `${testRealmURL}person`, name: 'Person' },
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
    assert.deepEqual(getIds(cards), [
      `${testRealmURL}mango9`,
      `${testRealmURL}mango8`,
      `${testRealmURL}mango7`,
    ]);

    {
      // page 2
      let { cards, meta } = await client.search(
        new URL(testRealmURL),
        {
          // providing the realm version received from the 1st page's meta keeps
          // the result set stable while we page over it
          page: { number: 1, size: 3, realmVersion },
          sort: [
            {
              on: { module: `${testRealmURL}person`, name: 'Person' },
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
      assert.deepEqual(getIds(cards), [
        `${testRealmURL}mango6`,
        `${testRealmURL}mango5`,
        `${testRealmURL}mango4`,
      ]);
    }

    // mutate the index
    let batch = await client.createBatch(new URL(testRealmURL));
    await batch.deleteEntry(new URL(`${testRealmURL}mango3.json`));
    await batch.done();

    {
      // page 3
      let { cards, meta } = await client.search(
        new URL(testRealmURL),
        {
          // providing the realm version received from the 1st page's meta keeps
          // the result set stable while we page over it
          page: { number: 2, size: 3, realmVersion },
          sort: [
            {
              on: { module: `${testRealmURL}person`, name: 'Person' },
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
      assert.deepEqual(getIds(cards), [
        `${testRealmURL}mango3`, // this is actually removed in the current index
        `${testRealmURL}mango2`,
        `${testRealmURL}mango1`,
      ]);
    }

    // assert that a new search against the current index no longer contains the
    // removed card
    {
      let { cards, meta } = await client.search(
        new URL(testRealmURL),
        {
          sort: [
            {
              on: { module: `${testRealmURL}person`, name: 'Person' },
              by: 'name',
              direction: 'desc',
            },
          ],
          filter: {
            on: { module: `${testRealmURL}person`, name: 'Person' },
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
      assert.deepEqual(getIds(cards), [
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
  });
});
