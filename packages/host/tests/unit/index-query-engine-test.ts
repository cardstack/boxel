import format from 'date-fns/format';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  IndexQueryEngine,
  fetcher,
  maybeHandleScopedCSSRequest,
  internalKeyFor,
  identifyCard,
  getFieldDefinitions,
  type ResolvedCodeRef,
  type Definition,
  type LooseCardResource,
  FilterRefersToNonexistentTypeError,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';
import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  p,
  getDbAdapter,
  setupIndex,
  getTypes,
  serializeCard,
} from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let date: typeof import('https://cardstack.com/base/date');
let number: typeof import('https://cardstack.com/base/number');
let boolean: typeof import('https://cardstack.com/base/boolean');
let codeRef: typeof import('https://cardstack.com/base/code-ref');
let { resolvedBaseRealmURL } = ENV;

module('Unit | query', function (hooks) {
  let dbAdapter: SQLiteAdapter;
  let indexQueryEngine: IndexQueryEngine;
  let loader: Loader;
  let testCards: { [name: string]: CardDef } = {};

  hooks.before(async function () {
    dbAdapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${ENV.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    shimExternals(virtualNetwork);
    let fetch = fetcher(virtualNetwork.fetch, [
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
    ]);
    loader = new Loader(fetch, virtualNetwork.resolveImport);

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    date = await loader.import(`${baseRealm.url}date`);
    number = await loader.import(`${baseRealm.url}number`);
    boolean = await loader.import(`${baseRealm.url}boolean`);
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
    let { default: NumberField } = number;
    let { default: BooleanField } = boolean;
    class Address extends FieldDef {
      @field street = contains(StringField);
      @field city = contains(StringField);
      @field number = contains(NumberField);
    }
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field address = contains(Address);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
      @field age = contains(NumberField);
      @field isHairy = contains(BooleanField);
      @field lotteryNumbers = containsMany(NumberField);
    }
    class FancyPerson extends Person {
      @field favoriteColor = contains(StringField);
    }
    class Cat extends CardDef {
      @field name = contains(StringField);
    }
    class SimpleSpec extends CardDef {
      @field cardTitle = contains(StringField);
      @field ref = contains(CodeRefField);
    }
    class Event extends CardDef {
      @field cardTitle = contains(StringField);
      @field venue = contains(StringField);
      @field date = contains(DateField);
    }

    loader.shimModule(`${testRealmURL}person`, { Person });
    loader.shimModule(`${testRealmURL}fancy-person`, { FancyPerson });
    loader.shimModule(`${testRealmURL}cat`, { Cat });
    loader.shimModule(`${testRealmURL}spec`, { SimpleSpec });
    loader.shimModule(`${testRealmURL}event`, { Event });

    let stringFieldEntry = new SimpleSpec({
      cardTitle: 'String Field',
      ref: {
        module: `${baseRealm.url}string`,
        name: 'default',
      },
    });
    let numberFieldEntry = new SimpleSpec({
      cardTitle: 'Number Field',
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
      cardTitle: "Mango's Birthday",
      venue: 'Dog Park',
      date: p('2024-10-30'),
    });
    let vangoghBirthday = new Event({
      cardTitle: "Van Gogh's Birthday",
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

    let api = await loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);

    async function buildDefinition(cardDef: typeof CardDef) {
      return {
        codeRef: identifyCard(cardDef),
        displayName: cardDef.displayName,
        fields: getFieldDefinitions(api, cardDef),
      } as Definition;
    }

    await dbAdapter.reset();
    let mockDefinitionLookup = {
      async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
        let key = internalKeyFor(codeRef, undefined);
        switch (key) {
          case `${testRealmURL}person/Person`:
            return await buildDefinition(Person);
          case `${testRealmURL}fancy-person/FancyPerson`:
            return await buildDefinition(FancyPerson);
          case `${testRealmURL}cat/Cat`:
            return await buildDefinition(Cat);
          case `${testRealmURL}spec/SimpleSpec`:
            return await buildDefinition(SimpleSpec);
          case `${testRealmURL}event/Event`:
            return await buildDefinition(Event);
          default:
            throw new FilterRefersToNonexistentTypeError(codeRef, {
              cause: `Definition for ${stringify(codeRef)} not found`,
            });
        }
      },
      async invalidate(_realmURL: string): Promise<void> {
        // no-op for tests
      },
      async clearRealmCache(_realmURL: string): Promise<void> {
        // no-op for tests
      },
      registerRealm() {},
      forRealm() {
        return this;
      },
    };
    indexQueryEngine = new IndexQueryEngine(dbAdapter, mockDefinitionLookup);
  });

  test('can get all cards with empty filter', async function (assert) {
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
  });

  test('deleted cards are not included in results', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { is_deleted: false } },
      { card: vangogh, data: { is_deleted: null } },
      { card: paper, data: { is_deleted: true } },
    ]);

    let { meta } = await indexQueryEngine.search(new URL(testRealmURL), {});
    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
  });

  test('error docs are not included in results', async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}1.json`,
        type: 'instance',
        has_error: true,
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
  });

  test('can filter by type', async function (assert) {
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
  });

  test(`can filter using 'eq'`, async function (assert) {
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
  });

  test(`can filter using 'eq' thru nested fields`, async function (assert) {
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
  });

  test(`can use 'eq' to match multiple fields`, async function (assert) {
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
  });

  test(`can use 'eq' to find 'null' values`, async function (assert) {
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
  });

  test(`can use 'eq' to match against number type`, async function (assert) {
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
  });

  test(`can use 'eq' to match against boolean type`, async function (assert) {
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
  });

  test('can filter eq from a code ref query value', async function (assert) {
    let { stringFieldEntry, numberFieldEntry } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: stringFieldEntry,
        data: {
          search_doc: {
            cardTitle: stringFieldEntry.cardTitle,
            ref: internalKeyFor((stringFieldEntry as any).ref, undefined),
          },
        },
      },
      {
        card: numberFieldEntry,
        data: {
          search_doc: {
            cardTitle: numberFieldEntry.cardTitle,
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
  });

  test('can filter eq from a date query value', async function (assert) {
    let { mangoBirthday, vangoghBirthday } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mangoBirthday,
        data: {
          search_doc: {
            cardTitle: mangoBirthday.cardTitle,
            venue: (mangoBirthday as any).venue,
            date: format((mangoBirthday as any).date, 'yyyy-MM-dd'),
          },
        },
      },
      {
        card: vangoghBirthday,
        data: {
          search_doc: {
            cardTitle: vangoghBirthday.cardTitle,
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
  });

  test(`can search with a 'not' filter`, async function (assert) {
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
  });

  test('can handle a filter with double negatives', async function (assert) {
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
  });

  test(`can use a 'contains' filter`, async function (assert) {
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
  });

  test(`contains filter is case insensitive`, async function (assert) {
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
  });

  test(`can use 'contains' to match multiple fields`, async function (assert) {
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
  });

  test(`can use a 'contains' filter to match 'null'`, async function (assert) {
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
  });

  test(`can use 'every' to combine multiple filters`, async function (assert) {
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
  });

  test(`can use 'any' to combine multiple filters`, async function (assert) {
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
  });

  test(`returns empty results when query refers to missing card`, async function (assert) {
    await setupIndex(dbAdapter, []);

    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: {
          module: `${testRealmURL}nonexistent`,
          name: 'Nonexistent',
        },
        eq: { nonExistentField: 'hello' },
      },
    });

    assert.strictEqual(cards.length, 0, 'no cards are returned');
    assert.strictEqual(meta.page.total, 0, 'total count is zero');
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
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
  });

  test(`it can filter on a plural primitive field using 'eq'`, async function (assert) {
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
  });

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
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
  });

  test('it can match a null in a plural field', async function (assert) {
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
  });

  test('it can match a leaf plural field nested in a plural composite field', async function (assert) {
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
  });

  test('it can match thru a plural nested composite field that is field of a singular composite field', async function (assert) {
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

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  });

  test(`can return a single result for a card when there are multiple matches within a result's search doc`, async function (assert) {
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

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  });

  test('can perform query against WIP version of the index', async function (assert) {
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
  });

  test('can perform query against "production" version of the index', async function (assert) {
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
  });

  test('can sort search results', async function (assert) {
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
  });

  test('can sort descending', async function (assert) {
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
  });

  test('nulls are sorted to the end of search results', async function (assert) {
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
            name: null,
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
    let { cards: results } = await indexQueryEngine.search(
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

    assert.deepEqual(
      getIds(results),
      [mango.id, ringo.id, vangogh.id],
      'results are correct',
    );
  });

  test(`can filter using 'gt'`, async function (assert) {
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
  });

  test(`range filter works when both 'type' and 'on' are provided`, async function (assert) {
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
        type,
        range: { age: { gt: 25 } },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  });

  test(`eq filter works when both 'type' and 'on' are provided`, async function (assert) {
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        type,
        eq: { name: 'Mango' },
      },
    });

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(cards), [mango.id], 'results are correct');
  });

  test(`contains filter works when both 'type' and 'on' are provided`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: {
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
              city: 'Waggington',
            },
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        type,
        contains: { 'address.city': 'Barks' },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are correct',
    );
  });

  test(`not filter works when both 'type' and 'on' are provided`, async function (assert) {
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
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: type,
        type,
        not: {
          eq: { name: 'Mango' },
        },
      },
      sort: [
        {
          on: type,
          by: 'name',
          direction: 'asc',
        },
      ],
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [ringo.id, vangogh.id],
      'results are correct',
    );
  });

  test(`'on' takes precedence over 'type' when they differ`, async function (assert) {
    let { mango, vangogh, ringo, paper } = testCards;
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
      {
        card: paper,
        data: {
          search_doc: {
            name: 'Paper',
            age: 99,
          },
        },
      },
    ]);

    let personType = await personCardType(testCards);
    let catType = internalKeyToCodeRef([...(await getTypes(paper))].shift()!);
    let { cards, meta } = await indexQueryEngine.search(new URL(testRealmURL), {
      filter: {
        on: personType,
        type: catType,
        range: { age: { gt: 25 } },
      },
    });

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    assert.deepEqual(
      getIds(cards),
      [mango.id, vangogh.id],
      'results are drawn from the on type and ignore conflicting type',
    );
  });

  test(`can filter using 'gte'`, async function (assert) {
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
  });

  test(`can filter using 'gt' thru nested fields`, async function (assert) {
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
  });

  test(`can filter using 'gt' thru a plural primitive field`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            lotteryNumbers: [20, 50, 70],
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            lotteryNumbers: [40, 60, 80],
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
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
  });

  test(`can filter using 'gt' thru a plural composite field`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    let mangoDoc = {
      name: 'Mango',
      age: 35,
    };
    let vanGoghDoc = {
      name: 'Van Gogh',
      age: 30,
    };
    let ringoDoc = {
      name: 'Ringo',
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
  });

  test(`can filter using 'lt'`, async function (assert) {
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
  });

  test(`can filter using 'lte'`, async function (assert) {
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
  });

  test(`can combine 'range' filter`, async function (assert) {
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
  });

  test(`cannot filter 'null' value using 'range'`, async function (assert) {
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
  });

  test('can sort using a general field that is not an attribute of a card', async function (assert) {
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
  });

  test('can get prerendered cards from the indexer', async function (assert) {
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
        head_html: '<title>Jimmy</title>',
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

    //  Requesting head template
    ({ prerenderedCards, meta } = await indexQueryEngine.searchPrerendered(
      new URL(testRealmURL),
      {
        filter: {
          on: personCard,
          eq: {
            name: 'Jimmy',
          },
        },
      },
      {
        htmlFormat: 'head',
      },
    ));

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.strictEqual(prerenderedCards[0].url, `${testRealmURL}jimmy.json`);
    assert.strictEqual(prerenderedCards[0].html, '<title>Jimmy</title>'); // head template
    assert.deepEqual(prerenderedCards[0].usedRenderType, personCard);

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
  });

  test('can get prerendered cards in an error state from the indexer', async function (assert) {
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
        type: 'instance',
        has_error: true,
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
        type: 'instance',
        has_error: true,
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
    assert.true(prerenderedCards[0].isError, 'card is in error state');
    assert.strictEqual(
      prerenderedCards[1].url,
      'http://test-realm/test/jimmy.json',
    );
    assert.strictEqual(
      prerenderedCards[1].html,
      '<div>Jimmy (FancyPerson embedded template)</div>',
    );
    assert.notOk(prerenderedCards[1].isError, 'card is not in an error state');
  });
});

// Helper functions for test implementations
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

async function personCardType(testCards: { [name: string]: CardDef }) {
  let { vangogh } = testCards;
  if (!vangogh) {
    throw new Error(
      `missing the 'vangogh' test card in the--this is the card we use to derive the Person type`,
    );
  }
  let internalKey = [...(await getTypes(vangogh))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function fancyPersonCardType(testCards: { [name: string]: CardDef }) {
  let { mango } = testCards;
  if (!mango) {
    throw new Error(
      `missing the 'mango' test card in the--this is the card we use to derive the FancyPerson type`,
    );
  }
  let internalKey = [...(await getTypes(mango))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function SimpleSpecType(testCards: { [name: string]: CardDef }) {
  let { stringFieldEntry } = testCards;
  if (!stringFieldEntry) {
    throw new Error(
      `missing the 'stringFieldEntry' test card in the--this is the card we use to derive the SimpleSpec type`,
    );
  }
  let internalKey = [...(await getTypes(stringFieldEntry))].shift()!;
  return internalKeyToCodeRef(internalKey);
}

async function eventType(testCards: { [name: string]: CardDef }) {
  let { mangoBirthday } = testCards;
  if (!mangoBirthday) {
    throw new Error(
      `missing the 'mangoBirthday' test card in the--this is the card we use to derive the Event type`,
    );
  }
  let internalKey = [...(await getTypes(mangoBirthday))].shift()!;
  return internalKeyToCodeRef(internalKey);
}
