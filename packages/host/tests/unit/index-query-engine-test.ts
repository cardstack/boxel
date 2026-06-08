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
  rri,
  type RealmResourceIdentifier,
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
  let virtualNetwork: VirtualNetwork;

  hooks.before(async function () {
    dbAdapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    virtualNetwork = new VirtualNetwork();
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
    loader = new Loader(fetch, virtualNetwork.resolveImport, {
      virtualNetwork,
    });

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

    loader.shimModule(`${testRealmURL}address`, { Address });
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
      card.id = rri(`${testRealmURL}${name}`);
      setCardAsSavedForTest(card);
    }

    let api = await loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);

    async function buildDefinition(cardDef: typeof CardDef) {
      let { fields, fieldDefs } = getFieldDefinitions(api, cardDef);
      return {
        codeRef: identifyCard(cardDef),
        displayName: cardDef.displayName,
        fields,
        fieldDefs,
      } as Definition;
    }

    await dbAdapter.reset();
    let mockDefinitionLookup = {
      async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
        let key = internalKeyFor(codeRef, undefined, virtualNetwork);
        switch (key) {
          case `${testRealmURL}address/Address`:
            return await buildDefinition(Address as unknown as typeof CardDef);
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
      async lookupCachedDefinition(): Promise<undefined> {
        return undefined;
      },
      async invalidate(_realmURL: string): Promise<string[]> {
        // no-op for tests
        return [];
      },
      async clearRealmDefinitions(_realmURL: string): Promise<void> {
        // no-op for tests
      },
      async getCachedDefinitions(): Promise<undefined> {
        return undefined;
      },
      async populateDefinitionCacheEntry(): Promise<undefined> {
        return undefined;
      },
      async getCachedDefinitionsBatch(): Promise<Record<string, never>> {
        return {};
      },
      registerRealm() {},
      async clearAllDefinitions(): Promise<void> {
        // no-op for tests
      },
      forRealm() {
        return this;
      },
    };
    indexQueryEngine = new IndexQueryEngine(
      dbAdapter,
      mockDefinitionLookup,
      virtualNetwork,
    );
  });

  test('can get all cards with empty filter', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let { cards: results, meta } = await indexQueryEngine.searchCards(
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

    let { meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {},
    );
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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

  // The projection-parametrized `search()` underlying both `searchCards`
  // (dataOnly) and `searchPrerendered` (render). The wrapper tests are the
  // parity goldens; these exercise the shared method directly.
  test('search() projects the same row set and total across dataOnly and render', async function (assert) {
    let { mango, vangogh } = testCards;
    let personCard = await personCardType(testCards);
    let personKey = internalKeyFor(personCard, undefined, virtualNetwork);
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}vangogh.json`,
        file_alias: `${testRealmURL}vangogh`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        pristine_doc: await serializeCard(vangogh),
        embedded_html: { [personKey]: '<div>Van Gogh (embedded)</div>' },
        search_doc: { name: 'Van Gogh' },
      },
      {
        url: `${testRealmURL}mango.json`,
        file_alias: `${testRealmURL}mango`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        pristine_doc: await serializeCard(mango),
        // no embedded_html — this row has no HTML for the embedded format
        search_doc: { name: 'Mango' },
      },
    ]);

    let opts = { includeErrors: true as const };
    let dataOnly = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      opts,
      { kind: 'dataOnly' },
    );
    let render = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      opts,
      {
        kind: 'render',
        htmlFormat: 'embedded',
      },
    );

    assert.strictEqual(
      dataOnly.meta.page.total,
      render.meta.page.total,
      'page.total matches across projections',
    );
    assert.deepEqual(
      dataOnly.results.map((r) => r.url).sort(),
      render.results.map((r) => r.url).sort(),
      'the projection varies only the SELECT list, never the row set',
    );
  });

  test('search() render projection carries pristine_doc only on no-HTML fallback rows', async function (assert) {
    let { mango, vangogh } = testCards;
    let personCard = await personCardType(testCards);
    let personKey = internalKeyFor(personCard, undefined, virtualNetwork);
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}vangogh.json`, // HAS embedded html
        file_alias: `${testRealmURL}vangogh`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        pristine_doc: await serializeCard(vangogh),
        embedded_html: { [personKey]: '<div>Van Gogh (embedded)</div>' },
        search_doc: { name: 'Van Gogh' },
      },
      {
        url: `${testRealmURL}mango.json`, // NO embedded html → live fallback
        file_alias: `${testRealmURL}mango`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, 'https://cardstack.com/base/card-api/CardDef'],
        pristine_doc: await serializeCard(mango),
        search_doc: { name: 'Mango' },
      },
    ]);

    let { results } = await indexQueryEngine.search(
      new URL(testRealmURL),
      {},
      { includeErrors: true },
      { kind: 'render', htmlFormat: 'embedded' },
    );
    let byUrl = Object.fromEntries(results.map((r) => [r.url, r]));

    let vg = byUrl[`${testRealmURL}vangogh.json`];
    assert.ok(vg.html, 'the HTML-backed row has html');
    assert.notOk(vg.pristine_doc, 'the HTML-backed row omits pristine_doc');

    let mg = byUrl[`${testRealmURL}mango.json`];
    assert.notOk(mg.html, 'the no-HTML row has null html');
    assert.ok(
      mg.pristine_doc,
      'the no-HTML fallback row carries its live pristine_doc',
    );
  });

  test('search() render projection keeps sort order and conditional pristine_doc together', async function (assert) {
    let { mango, vangogh, paper } = testCards;
    let personCard = await personCardType(testCards);
    let personKey = internalKeyFor(personCard, undefined, virtualNetwork);
    let cardDef = 'https://cardstack.com/base/card-api/CardDef';
    await setupIndex(dbAdapter, [
      {
        url: `${testRealmURL}a.json`,
        file_alias: `${testRealmURL}a`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, cardDef],
        last_modified: '300',
        pristine_doc: await serializeCard(mango),
        embedded_html: { [personKey]: '<div>A</div>' }, // HTML-backed
        search_doc: { name: 'A' },
      },
      {
        url: `${testRealmURL}b.json`,
        file_alias: `${testRealmURL}b`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, cardDef],
        last_modified: '100',
        pristine_doc: await serializeCard(vangogh), // no embedded_html → fallback
        search_doc: { name: 'B' },
      },
      {
        url: `${testRealmURL}c.json`,
        file_alias: `${testRealmURL}c`,
        type: 'instance',
        realm_version: 1,
        realm_url: testRealmURL,
        types: [personKey, cardDef],
        last_modified: '200',
        pristine_doc: await serializeCard(paper),
        embedded_html: { [personKey]: '<div>C</div>' }, // HTML-backed
        search_doc: { name: 'C' },
      },
    ]);

    let { results } = await indexQueryEngine.search(
      new URL(testRealmURL),
      { sort: [{ by: 'lastModified', direction: 'desc' }] },
      { includeErrors: true },
      { kind: 'render', htmlFormat: 'embedded' },
    );

    assert.deepEqual(
      results.map((r) => r.url),
      [
        `${testRealmURL}a.json`,
        `${testRealmURL}c.json`,
        `${testRealmURL}b.json`,
      ],
      'the outer-wrapped query orders by lastModified desc',
    );
    let byUrl = Object.fromEntries(results.map((r) => [r.url, r]));
    assert.notOk(
      byUrl[`${testRealmURL}a.json`].pristine_doc,
      'HTML-backed row omits pristine_doc even under a sort',
    );
    assert.ok(
      byUrl[`${testRealmURL}b.json`].pristine_doc,
      'no-HTML fallback row keeps pristine_doc under a sort',
    );
  });

  test('can filter by type', async function (assert) {
    let { mango, vangogh, paper } = testCards;

    await setupIndex(dbAdapter, [mango, vangogh, paper]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
      let { cards: results, meta } = await indexQueryEngine.searchCards(
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
      let { cards: results, meta } = await indexQueryEngine.searchCards(
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
      let { cards: results, meta } = await indexQueryEngine.searchCards(
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
            ref: internalKeyFor(
              (stringFieldEntry as any).ref,
              undefined,
              virtualNetwork,
            ),
          },
        },
      },
      {
        card: numberFieldEntry,
        data: {
          search_doc: {
            cardTitle: numberFieldEntry.cardTitle,
            ref: internalKeyFor(
              (numberFieldEntry as any).ref,
              undefined,
              virtualNetwork,
            ),
          },
        },
      },
    ]);

    let type = await SimpleSpecType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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

  test(`can filter using 'in'`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
      { card: ringo, data: { search_doc: { name: 'Ringo' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          in: { name: ['Mango', 'Ringo'] },
          on: type,
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

  test(`can filter using 'in' with a single value`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          in: { name: ['Mango'] },
          on: type,
        },
      },
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [mango.id], 'results are correct');
  });

  test(`can filter using 'in' with an empty array`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          in: { name: [] },
          on: type,
        },
      },
    );

    assert.strictEqual(meta.page.total, 0, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [], 'results are correct');
  });

  test(`can filter using 'in' with null values`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: null } } },
      { card: ringo, data: { search_doc: { name: 'Ringo' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          in: { name: ['Mango', null] },
          on: type,
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

  test(`can filter using 'in' thru nested fields`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: {
            name: 'Mango',
            address: { city: 'Barksville' },
          },
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: {
            name: 'Van Gogh',
            address: { city: 'Barksville' },
          },
        },
      },
      {
        card: ringo,
        data: {
          search_doc: {
            name: 'Ringo',
            address: { city: 'Waggington' },
          },
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          in: { 'address.city': ['Waggington'] },
        },
      },
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [ringo.id], 'results are correct');
  });

  test(`can negate an 'in' filter with 'not'`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { search_doc: { name: 'Mango' } } },
      { card: vangogh, data: { search_doc: { name: 'Van Gogh' } } },
      { card: ringo, data: { search_doc: { name: 'Ringo' } } },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          not: { in: { name: ['Mango', 'Ringo'] } },
        },
      },
    );

    assert.strictEqual(meta.page.total, 1, 'the total results meta is correct');
    assert.deepEqual(getIds(results), [vangogh.id], 'results are correct');
  });

  test(`can filter using 'in' with the id field`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: { search_doc: { id: mango.id, name: 'Mango' } },
      },
      {
        card: vangogh,
        data: { search_doc: { id: vangogh.id, name: 'Van Gogh' } },
      },
      {
        card: ringo,
        data: { search_doc: { id: ringo.id, name: 'Ringo' } },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards: results, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          in: { id: [mango.id, ringo.id] },
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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

    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: {
            module: `${testRealmURL}nonexistent` as RealmResourceIdentifier,
            name: 'Nonexistent',
          },
          eq: { nonExistentField: 'hello' },
        },
      },
    );

    assert.strictEqual(cards.length, 0, 'no cards are returned');
    assert.strictEqual(meta.page.total, 0, 'total count is zero');
  });

  test(`gives a good error when query refers to missing field`, async function (assert) {
    await setupIndex(dbAdapter, []);
    let type = await personCardType(testCards);

    try {
      await indexQueryEngine.searchCards(new URL(testRealmURL), {
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
      let { cards: results, meta } = await indexQueryEngine.searchCards(
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
      let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results, meta } = await indexQueryEngine.searchCards(
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
    let { cards: results } = await indexQueryEngine.searchCards(
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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          range: { age: { gt: 25 } },
        },
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          type,
          range: { age: { gt: 25 } },
        },
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          type,
          eq: { name: 'Mango' },
        },
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          type,
          contains: { 'address.city': 'Barks' },
        },
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
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
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: personType,
          type: catType,
          range: { age: { gt: 25 } },
        },
      },
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
    let { cards, meta } = await indexQueryEngine.searchCards(
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
    );

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
      indexQueryEngine.searchCards(new URL(testRealmURL), {
        filter: {
          on: type,
          range: { age: { gt: null } },
        },
      }),
      `'null' is not a permitted value in a 'range' filter`,
    );
  });

  test(`'matches' filter returns rows whose markdown contains the query (case-insensitive)`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          markdown:
            'Mango is a friendly puppy who loves to play fetch in the park.',
        },
      },
      {
        card: vangogh,
        data: {
          markdown: 'Van Gogh is a calm dog with a painterly coat.',
        },
      },
      {
        card: ringo,
        data: { markdown: 'Ringo plays the drums and enjoys long naps.' },
      },
    ]);

    let lower = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: 'mango' },
    });
    assert.strictEqual(lower.meta.page.total, 1, 'one row matches "mango"');
    assert.deepEqual(getIds(lower.cards), [mango.id]);

    let upper = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: 'MANGO' },
    });
    assert.strictEqual(
      upper.meta.page.total,
      1,
      'upper-case query still matches',
    );

    let none = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: 'xylophone' },
    });
    assert.strictEqual(none.meta.page.total, 0, 'no rows match a missing term');
  });

  test(`'matches' escapes LIKE wildcards so user input matches literally`, async function (assert) {
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: { markdown: 'Summer sale: 50% off today only.' },
      },
      {
        card: vangogh,
        data: { markdown: 'Fifty kittens lined up on the fence.' },
      },
    ]);

    let percent = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: '50%' },
    });
    assert.strictEqual(
      percent.meta.page.total,
      1,
      '"50%" matches the literal "50%" row only',
    );
    assert.deepEqual(getIds(percent.cards), [mango.id]);

    let underscore = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: '_nothing_' },
    });
    assert.strictEqual(
      underscore.meta.page.total,
      0,
      'underscore is treated literally, not as a single-char wildcard',
    );
  });

  test(`'matches' does not match rows whose markdown is null`, async function (assert) {
    // Include a non-null row that matches the query so the null-only case
    // is distinguishable from "query hits no rows at all".
    let { mango, vangogh } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { markdown: 'Mango likes fetch.' } },
      { card: vangogh, data: { markdown: null } },
    ]);

    let { meta, cards } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      { filter: { matches: 'mango' } },
    );
    assert.strictEqual(
      meta.page.total,
      1,
      'only the non-null row matching "mango" is returned',
    );
    assert.deepEqual(getIds(cards), [mango.id]);
  });

  test(`'matches' empty query matches nothing`, async function (assert) {
    let { mango, ringo } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { markdown: 'Mango likes fetch.' } },
      { card: ringo, data: { markdown: 'Ringo likes drums.' } },
    ]);

    let { meta: emptyMeta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      { filter: { matches: '' } },
    );
    assert.strictEqual(
      emptyMeta.page.total,
      0,
      'empty query does not match every row',
    );

    let { meta: wsMeta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      { filter: { matches: '   ' } },
    );
    assert.strictEqual(
      wsMeta.page.total,
      0,
      'whitespace-only query does not match every row',
    );
  });

  test(`'matches' parameterizes the query safely (injection attempt)`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { markdown: 'Mango likes fetch.' } },
      { card: vangogh, data: { markdown: 'Van Gogh likes naps.' } },
      { card: ringo, data: { markdown: 'Ringo likes drums.' } },
    ]);

    let { meta } = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: `'; DROP TABLE boxel_index; --` },
    });
    assert.strictEqual(
      meta.page.total,
      0,
      'malicious input is treated as literal LIKE text, not SQL',
    );

    let sanity = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: 'mango' },
    });
    assert.strictEqual(
      sanity.meta.page.total,
      1,
      'boxel_index table is intact after injection attempt',
    );
  });

  test(`'matches' tolerates unicode and special characters in the query`, async function (assert) {
    let { mango } = testCards;
    await setupIndex(dbAdapter, [
      { card: mango, data: { markdown: 'Mango likes fetch.' } },
    ]);

    let { meta } = await indexQueryEngine.searchCards(new URL(testRealmURL), {
      filter: { matches: 'café 🦮 "$1 $2"' },
    });
    assert.strictEqual(
      meta.page.total,
      0,
      'special characters do not throw; no rows match',
    );
  });

  test(`'matches' composes inside 'every' with eq/contains/range/cardType`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: { name: 'Mango', age: 35 },
          markdown: 'Mango is the name here.',
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: { name: 'Van Gogh', age: 30 },
          markdown: 'Van Gogh is here.',
        },
      },
      {
        card: ringo,
        data: {
          search_doc: { name: 'Ringo', age: 25 },
          markdown: 'Ringo is here.',
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          every: [
            { type },
            { matches: 'mango' },
            { eq: { name: 'Mango' } },
            { contains: { name: 'Mang' } },
            { range: { age: { gt: 10 } } },
          ],
        },
      },
    );

    assert.strictEqual(
      meta.page.total,
      1,
      `every-composition narrows to the one row matching all predicates`,
    );
    assert.deepEqual(getIds(cards), [mango.id], 'correct row returned');
  });

  test(`'matches' composes inside 'any' alongside other filters`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: { name: 'Mango' },
          markdown: 'Mango is here.',
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: { name: 'Van Gogh' },
          markdown: 'Van Gogh is here.',
        },
      },
      {
        card: ringo,
        data: {
          search_doc: { name: 'Ringo' },
          markdown: 'Ringo is here.',
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: {
          on: type,
          any: [{ matches: 'ringo' }, { eq: { name: 'Mango' } }],
        },
      },
    );

    assert.strictEqual(
      meta.page.total,
      2,
      `union of the 'matches' branch and the 'eq' branch`,
    );
    assert.deepEqual(
      getIds(cards),
      [mango.id, ringo.id],
      'results are correct',
    );
  });

  test(`'matches' composes inside 'not'`, async function (assert) {
    let { mango, vangogh, ringo } = testCards;
    await setupIndex(dbAdapter, [
      {
        card: mango,
        data: {
          search_doc: { name: 'Mango' },
          markdown: 'Mango is here.',
        },
      },
      {
        card: vangogh,
        data: {
          search_doc: { name: 'Van Gogh' },
          markdown: 'Van Gogh is here.',
        },
      },
      {
        card: ringo,
        data: {
          search_doc: { name: 'Ringo' },
          markdown: 'Ringo is here.',
        },
      },
    ]);

    let type = await personCardType(testCards);
    let { cards, meta } = await indexQueryEngine.searchCards(
      new URL(testRealmURL),
      {
        filter: { on: type, not: { matches: 'mango' } },
      },
    );

    assert.strictEqual(
      meta.page.total,
      2,
      `'not' drops the one row that matched 'mango'`,
    );
    assert.deepEqual(
      getIds(cards),
      [ringo.id, vangogh.id],
      'non-mango person rows returned',
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
    let personKey = internalKeyFor(personCard, undefined, virtualNetwork);
    let fancyPersonCard = await fancyPersonCardType(testCards);
    let fancyPersonKey = internalKeyFor(
      fancyPersonCard,
      undefined,
      virtualNetwork,
    );
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
    let personKey = internalKeyFor(personCard, undefined, virtualNetwork);
    let fancyPersonCard = await fancyPersonCardType(testCards);
    let fancyPersonKey = internalKeyFor(
      fancyPersonCard,
      undefined,
      virtualNetwork,
    );
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
    module: parts.join('/') as RealmResourceIdentifier,
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
