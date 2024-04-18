import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  IndexerDBClient,
} from '@cardstack/runtime-common';

import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import queryTests from '@cardstack/runtime-common/tests/query-test';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';
import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL, p } from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let date: typeof import('https://cardstack.com/base/date');
let number: typeof import('https://cardstack.com/base/number');
let boolean: typeof import('https://cardstack.com/base/boolean');
let codeRef: typeof import('https://cardstack.com/base/code-ref');
let { sqlSchema, resolvedBaseRealmURL } = ENV;

module('Unit | query', function (hooks) {
  let adapter: SQLiteAdapter;
  let client: IndexerDBClient;
  let loader: Loader;
  let testCards: { [name: string]: CardDef } = {};

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    loader = virtualNetwork.createLoader();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    shimExternals(virtualNetwork);

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
    }
    class Person extends CardDef {
      @field name = contains(StringField);
      @field nickNames = containsMany(StringField);
      @field address = contains(Address);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
      @field age = contains(NumberField);
      @field isHairy = contains(BooleanField);
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
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('deleted cards are not included in results', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can filter by type', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can filter using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can filter using 'eq' thru nested fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'eq' to match multiple fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'eq' to find 'null' values`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'eq' to match against number type`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'eq' to match against boolean type`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can filter eq from a code ref query value', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can filter eq from a date query value', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can search with a 'not' filter`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can handle a filter with double negatives', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use a 'contains' filter`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'contains' to match multiple fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use a 'contains' filter to match 'null'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'every' to combine multiple filters`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can use 'any' to combine multiple filters`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`gives a good error when query refers to missing card`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`it can filter on a plural primitive field using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('it can match a null in a plural field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('it can match a leaf plural field nested in a plural composite field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('it can match thru a plural nested composite field that is field of a singular composite field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test(`can return a single result for a card when there are multiple matches within a result's search doc`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can perform query against WIP version of the index', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can perform query against "production" version of the index', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can sort search results', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can sort descending', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });

  test('can get paginated results that are stable during index mutations', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards,
    });
  });
});
