import { module, test } from 'qunit';

import {
  baseCardRef,
  IndexerDBClient,
  internalKeyFor,
  Loader,
  VirtualNetwork,
  baseRealm,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/SQLiteAdapter';
import { shimExternals } from '@cardstack/host/lib/externals';

import { testRealmURL, setupIndex } from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
// let number: typeof import('https://cardstack.com/base/number');
// let date: typeof import('https://cardstack.com/base/date');
// let datetime: typeof import('https://cardstack.com/base/datetime');
// let boolean: typeof import('https://cardstack.com/base/boolean');
// let queryableValue: typeof queryableValueType;
let { sqlSchema, resolvedBaseRealmURL } = ENV;

module('Unit | query', function (hooks) {
  let adapter: SQLiteAdapter;
  let client: IndexerDBClient;
  let loader: Loader;

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    loader = virtualNetwork.createLoader();
    loader.addURLMapping(new URL(baseRealm.url), new URL(resolvedBaseRealmURL));
    shimExternals(virtualNetwork);

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    // number = await loader.import(`${baseRealm.url}number`);
    // date = await loader.import(`${baseRealm.url}date`);
    // datetime = await loader.import(`${baseRealm.url}datetime`);
    // boolean = await loader.import(`${baseRealm.url}boolean`);
    // queryableValue = cardApi.queryableValue;

    adapter = new SQLiteAdapter(sqlSchema);
    client = new IndexerDBClient(adapter);
    await client.ready();
  });

  hooks.afterEach(async function () {
    await client.teardown();
  });

  test('can filter by type', async function (assert) {
    let { field, contains, CardDef, serializeCard } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field name = contains(StringField);
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

    let mango = new FancyPerson({ id: `${testRealmURL}mango`, name: 'Mango' });
    let vango = new Person({ id: `${testRealmURL}vangogh`, name: 'Van Gogh' });
    let paper = new Cat({ id: `${testRealmURL}paper`, name: 'Paper' });
    let serializedMango = serializeCard(mango).data;
    let serializedVango = serializeCard(vango).data;
    let serializedPaper = serializeCard(paper).data;

    // note the types are hand crafted to match the deserialized instances.
    // there is a mechanism to generate the types from the indexed instances but
    // that is not what we are testing here
    await setupIndex(
      client,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          card_url: `${testRealmURL}mango.json`,
          pristine_doc: serializedMango,
          types: [
            baseCardRef,
            { module: `${testRealmURL}person`, name: 'Person' },
            { module: `${testRealmURL}fancy-person`, name: 'FancyPerson' },
          ].map((ref) => internalKeyFor(ref, undefined)),
        },
        {
          card_url: `${testRealmURL}vangogh.json`,
          pristine_doc: serializedVango,
          types: [
            baseCardRef,
            { module: `${testRealmURL}person`, name: 'Person' },
          ].map((ref) => internalKeyFor(ref, undefined)),
        },
        {
          card_url: `${testRealmURL}paper.json`,
          pristine_doc: serializedPaper,
          types: [
            baseCardRef,
            { module: `${testRealmURL}cat`, name: 'Cat' },
          ].map((ref) => internalKeyFor(ref, undefined)),
        },
      ],
    );

    let { cards, meta } = await client.search(
      {
        filter: {
          type: { module: `${testRealmURL}person`, name: 'Person' },
        },
      },
      loader,
    );

    assert.strictEqual(meta.page.total, 2, 'the total results meta is correct');
    cards.sort((a, b) => a.id!.localeCompare(b.id!));
    assert.deepEqual(
      cards,
      [serializedMango, serializedVango],
      'results are correct',
    );
  });
});
