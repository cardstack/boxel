import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  IndexQueryEngine,
  fetcher,
  maybeHandleScopedCSSRequest,
  parseQuery,
  internalKeyFor,
  identifyCard,
  SupportedMimeType,
  getFieldDefinitions,
  type ResolvedCodeRef,
  type Definition,
} from '@cardstack/runtime-common';
import { DefinitionsCache } from '@cardstack/runtime-common/definitions-cache';

import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import indexQueryEngineTests from '@cardstack/runtime-common/tests/index-query-engine-test';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';
import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import {
  type JSONAPISingleResourceDocument,
  type CardDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { testRealmURL, p, getDbAdapter } from '../helpers';

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
  let definitionsCache: DefinitionsCache;

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
    loader.shimModule(`${testRealmURL}spec`, { SimpleSpec });
    loader.shimModule(`${testRealmURL}event`, { Event });

    let stringFieldEntry = new SimpleSpec({
      title: 'String Field',
      ref: {
        module: `${baseRealm.url}string`,
        name: 'default',
      },
    });
    let numberFieldEntry = new SimpleSpec({
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

    let api = await loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);

    async function serveDefinition(cardDef: typeof CardDef) {
      let doc: JSONAPISingleResourceDocument = { data: { type: 'definition' } };
      doc.data.attributes = {
        codeRef: identifyCard(cardDef),
        displayName: cardDef.displayName,
        fields: getFieldDefinitions(api, cardDef),
      } as Definition;
      return new Response(JSON.stringify(doc), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      });
    }

    // mock the realm server serving definitions
    virtualNetwork.mount(async (req) => {
      if (req.method === 'HEAD') {
        return new Response(null, {
          headers: { 'X-Boxel-Realm-Url': testRealmURL },
        });
      }
      if (req.url.includes('/_definition?')) {
        let query = new URL(req.url).search.slice(1);
        let { codeRef } = parseQuery(query) as { codeRef: ResolvedCodeRef };
        let key = internalKeyFor(codeRef, undefined);
        switch (key) {
          case `${testRealmURL}person/Person`:
            return await serveDefinition(Person);
          case `${testRealmURL}fancy-person/FancyPerson`:
            return await serveDefinition(FancyPerson);
          case `${testRealmURL}cat/Cat`:
            return await serveDefinition(Cat);
          case `${testRealmURL}spec/SimpleSpec`:
            return await serveDefinition(SimpleSpec);
          case `${testRealmURL}event/Event`:
            return await serveDefinition(Event);
          default:
            return null;
        }
      }
      return null;
    });

    await dbAdapter.reset();
    definitionsCache = new DefinitionsCache(virtualNetwork.fetch);
    indexQueryEngine = new IndexQueryEngine(dbAdapter, definitionsCache);
  });

  test('can get all cards with empty filter', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('deleted cards are not included in results', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('error docs are not included in results', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can filter by type', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'eq'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'eq' thru nested fields`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'eq' to match multiple fields`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'eq' to find 'null' values`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'eq' to match against number type`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'eq' to match against boolean type`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can filter eq from a code ref query value', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can filter eq from a date query value', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can search with a 'not' filter`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can handle a filter with double negatives', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use a 'contains' filter`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`contains filter is case insensitive`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'contains' to match multiple fields`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use a 'contains' filter to match 'null'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'every' to combine multiple filters`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can use 'any' to combine multiple filters`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`gives a good error when query refers to missing card`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`it can filter on a plural primitive field using 'eq'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`it can filter on a nested field within a plural composite field using 'eq'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('it can match a null in a plural field', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('it can match a leaf plural field nested in a plural composite field', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('it can match thru a plural nested composite field that is field of a singular composite field', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can return a single result for a card when there are multiple matches within a result's search doc`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can perform query against WIP version of the index', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can perform query against "production" version of the index', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can sort search results', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can sort descending', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('nulls are sorted to the end of search results', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'gt'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'gte'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'gt' thru nested fields`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'gt' thru a plural primitive field`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'gt' thru a plural composite field`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'lt'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can filter using 'lte'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`can combine 'range' filter`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test(`cannot filter 'null' value using 'range'`, async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can sort using a general field that is not an attribute of a card', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can get prerendered cards from the indexer', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });

  test('can get prerendered cards in an error state from the indexer', async function (assert) {
    await runSharedTest(indexQueryEngineTests, assert, {
      indexQueryEngine,
      dbAdapter,
      definitionsCache,
      testCards,
    });
  });
});
