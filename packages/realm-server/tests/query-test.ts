import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import {
  type Loader,
  IndexerDBClient,
  VirtualNetwork,
  baseRealm,
} from '@cardstack/runtime-common';
import { runSharedTest, p } from '@cardstack/runtime-common/helpers';
import { testRealmURL } from '@cardstack/runtime-common/helpers/const';
import PgAdapter from '../pg-adapter';
import { shimExternals } from '../lib/externals';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import queryTests from '@cardstack/runtime-common/tests/query-test';

let cardApi: typeof import('https://cardstack.com/base/card-api');

async function makeTestCards(loader: Loader) {
  let { Address, Person, FancyPerson, Cat, SimpleCatalogEntry, Event } =
    await loader.import<Record<string, typeof CardDef>>(
      'http://localhost:4202/node-test/query-test-cards',
    );
  cardApi = await loader.import(`${baseRealm.url}card-api`);

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

  let testCards: { [cardName: string]: CardDef } = {
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
    cardApi.setCardAsSavedForTest(card);
  }
  return testCards;
}

module('query', function (hooks) {
  let adapter: PgAdapter;
  let client: IndexerDBClient;
  let loader: Loader;

  hooks.beforeEach(async function () {
    prepareTestDB();
    let virtualNetwork = new VirtualNetwork();
    loader = virtualNetwork.createLoader();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
    shimExternals(virtualNetwork);

    adapter = new PgAdapter();
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
      testCards: await makeTestCards(loader),
    });
  });

  test('deleted cards are not included in results', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can filter by type', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can filter using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can filter using 'eq' thru nested fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'eq' to match multiple fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'eq' to find 'null' values`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'eq' to match against number type`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'eq' to match against boolean type`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can filter eq from a code ref query value', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can filter eq from a date query value', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can search with a 'not' filter`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can handle a filter with double negatives', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use a 'contains' filter`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'contains' to match multiple fields`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use a 'contains' filter to match 'null'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'every' to combine multiple filters`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can use 'any' to combine multiple filters`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`gives a good error when query refers to missing card`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`it can filter on a plural primitive field using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('it can match a null in a plural field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('it can match a leaf plural field nested in a plural composite field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('it can match thru a plural nested composite field that is field of a singular composite field', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test(`can return a single result for a card when there are multiple matches within a result's search doc`, async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can perform query against WIP version of the index', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can perform query against "production" version of the index', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can sort search results', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can sort descending', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });

  test('can get paginated results that are stable during index mutations', async function (assert) {
    await runSharedTest(queryTests, assert, {
      client,
      loader,
      testCards: await makeTestCards(loader),
    });
  });
});
