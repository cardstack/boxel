import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  fetcher,
  maybeHandleScopedCSSRequest,
  rri,
  matchInstanceAgainstFilter,
  isClientEvaluable,
  makeInstanceComparator,
  type CardAPIForMatching,
  type Filter,
  type Sort,
  type CodeRef,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL, p } from '../helpers';

let { resolvedBaseRealmURL } = ENV;

module('Unit | instance-filter-matcher', function (hooks) {
  let loader: Loader;
  let api: CardAPIForMatching;
  let personRef: CodeRef;
  let fancyPersonRef: CodeRef;
  let catRef: CodeRef;
  let eventRef: CodeRef;
  let cards: Record<string, CardDef> = {};

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
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

    let cardApi = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let string = await loader.import<any>(`${baseRealm.url}string`);
    let number = await loader.import<any>(`${baseRealm.url}number`);
    let boolean = await loader.import<any>(`${baseRealm.url}boolean`);
    let date = await loader.import<any>(`${baseRealm.url}date`);

    api = {
      getQueryableValue: cardApi.getQueryableValue,
      formatQueryValue: cardApi.formatQueryValue,
      peekAtField: cardApi.peekAtField,
      isNonPresentLink: cardApi.isNonPresentLink,
      getCardMeta: cardApi.getCardMeta as CardAPIForMatching['getCardMeta'],
      primitive: cardApi.primitive,
      virtualNetwork,
    };

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      FieldDef,
      setCardAsSavedForTest,
    } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;
    let { default: BooleanField } = boolean;
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
      @field age = contains(NumberField);
      @field isHairy = contains(BooleanField);
    }
    class FancyPerson extends Person {
      @field favoriteColor = contains(StringField);
    }
    class Cat extends CardDef {
      @field name = contains(StringField);
    }
    class Event extends CardDef {
      @field cardTitle = contains(StringField);
      @field venue = contains(StringField);
      @field date = contains(DateField);
    }

    loader.shimModule(`${testRealmURL}person`, { Person });
    loader.shimModule(`${testRealmURL}fancy-person`, { FancyPerson });
    loader.shimModule(`${testRealmURL}cat`, { Cat });
    loader.shimModule(`${testRealmURL}event`, { Event });

    personRef = { module: rri(`${testRealmURL}person`), name: 'Person' };
    fancyPersonRef = {
      module: rri(`${testRealmURL}fancy-person`),
      name: 'FancyPerson',
    };
    catRef = { module: rri(`${testRealmURL}cat`), name: 'Cat' };
    eventRef = { module: rri(`${testRealmURL}event`), name: 'Event' };

    let ringo = new Person({
      name: 'Ringo',
      nickNames: ['Ring', 'Star'],
      address: new Address({ street: '100 Treat Street', city: 'Waggington' }),
      age: 5,
      isHairy: true,
    });
    let vangogh = new Person({
      name: 'Van Gogh',
      nickNames: ['Vango'],
      address: new Address({ street: '456 Grand Blvd', city: 'Barksville' }),
      age: 7,
      isHairy: false,
      bestFriend: ringo,
      friends: [ringo],
    });
    let mango = new FancyPerson({
      name: 'Mango',
      nickNames: ['Mang', 'Go'],
      address: new Address({ street: '123 Main Street', city: 'Barksville' }),
      age: 3,
      isHairy: true,
      favoriteColor: 'orange',
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

    cards = { ringo, vangogh, mango, paper, mangoBirthday, vangoghBirthday };
    for (let [name, card] of Object.entries(cards)) {
      card.id = rri(`${testRealmURL}${name}`);
      setCardAsSavedForTest(card);
    }
  });

  function match(card: CardDef, filter: Filter) {
    return matchInstanceAgainstFilter(card, filter, api);
  }

  // -- eq ---------------------------------------------------------------------

  test('eq on a string field', function (assert) {
    let { mango, ringo } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, eq: { name: 'Mango' } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { name: 'Mango' } }),
      'no-match',
    );
  });

  test('eq on a nested contains field', function (assert) {
    let { mango, ringo } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, eq: { 'address.city': 'Barksville' } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { 'address.city': 'Barksville' } }),
      'no-match',
    );
  });

  test('eq on number and boolean fields', function (assert) {
    let { mango, ringo } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, eq: { age: 3 } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { age: 3 } }),
      'no-match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, eq: { isHairy: true } }),
      'match',
    );
    assert.strictEqual(
      match(cards.vangogh, { on: personRef, eq: { isHairy: true } }),
      'no-match',
    );
  });

  test('eq null matches an unset linksTo field', function (assert) {
    let { ringo, mango } = cards;
    // ringo has no bestFriend set; mango does.
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { bestFriend: null } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, eq: { bestFriend: null } }),
      'no-match',
    );
  });

  test('eq across a linksTo field path', function (assert) {
    let { mango } = cards;
    // mango.bestFriend == vangogh
    assert.strictEqual(
      match(mango, { on: personRef, eq: { 'bestFriend.name': 'Van Gogh' } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, eq: { 'bestFriend.name': 'Ringo' } }),
      'no-match',
    );
  });

  test('an unset interior linksTo resolves to NULL at the leaf', function (assert) {
    let { ringo } = cards;
    // ringo.bestFriend is unset (present-and-null, not not-loaded). The server
    // traverses `bestFriend -> name` to SQL NULL, so `eq null` matches and a
    // non-null eq does not. Distinct from the not-loaded case, which is
    // unresolvable.
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { 'bestFriend.name': null } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, eq: { 'bestFriend.name': 'Van Gogh' } }),
      'no-match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, in: { 'bestFriend.name': [null] } }),
      'match',
    );
  });

  // -- in ---------------------------------------------------------------------

  test('in matches when the value is in the set', function (assert) {
    let { mango, paper } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, in: { name: ['Mango', 'Ringo'] } }),
      'match',
    );
    assert.strictEqual(
      match(paper, { on: catRef, in: { name: ['Mango', 'Ringo'] } }),
      'no-match',
    );
  });

  test('in with an empty set matches nothing', function (assert) {
    let { mango } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, in: { name: [] } }),
      'no-match',
    );
  });

  // -- contains ---------------------------------------------------------------

  test('contains is a case-insensitive substring match', function (assert) {
    let { mango, ringo } = cards;
    assert.strictEqual(
      match(mango, { on: personRef, contains: { name: 'ang' } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, contains: { name: 'MANG' } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, contains: { name: 'ang' } }),
      'no-match',
    );
  });

  test('contains matches existentially over a containsMany field', function (assert) {
    let { mango, ringo } = cards;
    // mango.nickNames = ['Mang', 'Go']
    assert.strictEqual(
      match(mango, { on: personRef, contains: { nickNames: 'go' } }),
      'match',
    );
    assert.strictEqual(
      match(ringo, { on: personRef, contains: { nickNames: 'go' } }),
      'no-match',
    );
  });

  // -- range ------------------------------------------------------------------

  test('range on a number field', function (assert) {
    let { mango, vangogh } = cards;
    assert.strictEqual(
      match(vangogh, { on: personRef, range: { age: { gt: 5 } } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, range: { age: { gt: 5 } } }),
      'no-match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, range: { age: { gte: 3, lte: 5 } } }),
      'match',
    );
  });

  test('range on a date field', function (assert) {
    let { mangoBirthday, vangoghBirthday } = cards;
    assert.strictEqual(
      match(vangoghBirthday, {
        on: eventRef,
        range: { date: { gt: '2024-11-01' } },
      }),
      'match',
    );
    assert.strictEqual(
      match(mangoBirthday, {
        on: eventRef,
        range: { date: { gt: '2024-11-01' } },
      }),
      'no-match',
    );
  });

  // -- type / on --------------------------------------------------------------

  test('a pure type filter walks the adoptsFrom chain', function (assert) {
    let { mango, paper } = cards;
    // mango is a FancyPerson, which adopts from Person
    assert.strictEqual(match(mango, { type: personRef }), 'match');
    assert.strictEqual(match(mango, { type: fancyPersonRef }), 'match');
    assert.strictEqual(match(paper, { type: personRef }), 'no-match');
    assert.strictEqual(match(paper, { type: catRef }), 'match');
  });

  test('a type gate tolerates equivalent module spellings', function (assert) {
    let { mango } = cards;
    // The instance's class is identified under the realm's real URL. Express
    // the filter's type ref under an equivalent virtual-alias spelling: an
    // exact-string comparison misses it, so the gate would wrongly reject a
    // server-returned card. The server tolerates this via `internalKeyFor`;
    // the client matcher must resolve both spellings before comparing.
    api.virtualNetwork.addURLMapping(
      new URL('https://virtual-alias.example/test/'),
      new URL(testRealmURL),
    );
    let aliasedPersonRef: CodeRef = {
      module: rri('https://virtual-alias.example/test/person'),
      name: 'Person',
    };
    assert.strictEqual(
      match(mango, { type: aliasedPersonRef }),
      'match',
      'pure type filter matches across spellings',
    );
    assert.strictEqual(
      match(mango, { on: aliasedPersonRef, eq: { name: 'Mango' } }),
      'match',
      'on-gate matches across spellings',
    );
  });

  test('an on-scoped predicate gates by type', function (assert) {
    let { mango, vangogh } = cards;
    assert.strictEqual(
      match(mango, { on: fancyPersonRef, eq: { favoriteColor: 'orange' } }),
      'match',
    );
    // vangogh is a plain Person, not a FancyPerson, so the gate fails.
    assert.strictEqual(
      match(vangogh, { on: fancyPersonRef, eq: { favoriteColor: 'orange' } }),
      'no-match',
    );
  });

  // -- boolean composition ----------------------------------------------------

  test('every requires all sub-filters', function (assert) {
    let { mango } = cards;
    assert.strictEqual(
      match(mango, {
        on: personRef,
        every: [{ eq: { name: 'Mango' } }, { eq: { age: 3 } }],
      }),
      'match',
    );
    assert.strictEqual(
      match(mango, {
        on: personRef,
        every: [{ eq: { name: 'Mango' } }, { eq: { age: 99 } }],
      }),
      'no-match',
    );
  });

  test('any requires at least one sub-filter', function (assert) {
    let { mango } = cards;
    assert.strictEqual(
      match(mango, {
        on: personRef,
        any: [{ eq: { name: 'Nobody' } }, { eq: { age: 3 } }],
      }),
      'match',
    );
    assert.strictEqual(
      match(mango, {
        on: personRef,
        any: [{ eq: { name: 'Nobody' } }, { eq: { age: 99 } }],
      }),
      'no-match',
    );
  });

  test('not negates its child', function (assert) {
    let { mango, ringo } = cards;
    assert.strictEqual(
      match(ringo, { on: personRef, not: { eq: { name: 'Mango' } } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, not: { eq: { name: 'Mango' } } }),
      'no-match',
    );
  });

  test('deeply nested every/any/not tree', function (assert) {
    let { mango } = cards;
    let filter: Filter = {
      on: personRef,
      every: [
        { any: [{ eq: { name: 'Mango' } }, { eq: { name: 'Ringo' } }] },
        { not: { eq: { age: 99 } } },
        { range: { age: { lt: 10 } } },
      ],
    };
    assert.strictEqual(match(mango, filter), 'match');
  });

  test('existential match over a linksToMany path', function (assert) {
    let { mango } = cards;
    // mango.friends = [vangogh, ringo]
    assert.strictEqual(
      match(mango, { on: personRef, eq: { 'friends.name': 'Ringo' } }),
      'match',
    );
    assert.strictEqual(
      match(mango, { on: personRef, eq: { 'friends.name': 'Nobody' } }),
      'no-match',
    );
  });

  // -- unresolvable -----------------------------------------------------------

  test('a not-loaded linksTo target is reported as unresolvable', async function (assert) {
    let cardApi = await loader.import<any>(`${baseRealm.url}card-api`);
    let doc = {
      data: {
        id: `${testRealmURL}lonely`,
        type: 'card' as const,
        attributes: { name: 'Lonely' },
        relationships: {
          bestFriend: { links: { self: `${testRealmURL}ghost` } },
        },
        meta: { adoptsFrom: personRef },
      },
    };
    let lonely = (await cardApi.createFromSerialized(
      doc.data,
      doc,
      new URL(testRealmURL),
    )) as CardDef;

    assert.strictEqual(
      match(lonely, { on: personRef, eq: { 'bestFriend.name': 'Van Gogh' } }),
      'unresolvable',
      'a predicate over an unloaded link is unresolvable, never no-match',
    );
    // not() over an unresolvable predicate stays unresolvable — the integration
    // layer must not remove the card on this basis.
    assert.strictEqual(
      match(lonely, {
        on: personRef,
        not: { eq: { 'bestFriend.name': 'Van Gogh' } },
      }),
      'unresolvable',
    );
    // A resolvable predicate on the same card still works.
    assert.strictEqual(
      match(lonely, { on: personRef, eq: { name: 'Lonely' } }),
      'match',
    );
  });

  // -- isClientEvaluable ------------------------------------------------------

  test('isClientEvaluable rejects matches and unsupported operators', function (assert) {
    assert.false(isClientEvaluable({ matches: 'hello' }));
    assert.false(
      isClientEvaluable({
        on: personRef,
        every: [{ eq: { name: 'x' } }, { matches: 'y' }],
      }),
    );
    assert.false(isClientEvaluable({ on: personRef, any: [{ matches: 'y' }] }));
    assert.false(isClientEvaluable({ not: { matches: 'y' } }));
  });

  test('isClientEvaluable accepts every supported operator', function (assert) {
    assert.true(isClientEvaluable({ on: personRef, eq: { name: 'x' } }));
    assert.true(isClientEvaluable({ on: personRef, in: { name: ['x'] } }));
    assert.true(isClientEvaluable({ on: personRef, contains: { name: 'x' } }));
    assert.true(
      isClientEvaluable({ on: personRef, range: { age: { gt: 1 } } }),
    );
    assert.true(isClientEvaluable({ type: personRef }));
    assert.true(
      isClientEvaluable({
        on: personRef,
        every: [
          { any: [{ eq: { name: 'x' } }, { not: { eq: { age: 1 } } }] },
          { range: { age: { lt: 9 } } },
        ],
      }),
    );
  });

  // -- comparator -------------------------------------------------------------

  test('comparator orders by a single on-field key with direction', function (assert) {
    let { mango, vangogh, ringo } = cards;
    let sort: Sort = [{ on: personRef, by: 'name', direction: 'asc' }];
    let sorted = [vangogh, ringo, mango].sort(
      makeInstanceComparator(sort, api),
    );
    assert.deepEqual(
      sorted.map((c) => (c as any).name),
      ['Mango', 'Ringo', 'Van Gogh'],
    );

    let desc: Sort = [{ on: personRef, by: 'name', direction: 'desc' }];
    let sortedDesc = [mango, ringo, vangogh].sort(
      makeInstanceComparator(desc, api),
    );
    assert.deepEqual(
      sortedDesc.map((c) => (c as any).name),
      ['Van Gogh', 'Ringo', 'Mango'],
    );
  });

  test('comparator orders by multiple keys', function (assert) {
    let { mango, vangogh, ringo } = cards;
    // city asc, then name desc. mango & vangogh share 'Barksville'.
    let sort: Sort = [
      { on: personRef, by: 'address.city', direction: 'asc' },
      { on: personRef, by: 'name', direction: 'desc' },
    ];
    let sorted = [ringo, mango, vangogh].sort(
      makeInstanceComparator(sort, api),
    );
    assert.deepEqual(
      sorted.map((c) => (c as any).name),
      ['Van Gogh', 'Mango', 'Ringo'],
      'Barksville (Van Gogh, Mango by name desc) then Waggington (Ringo)',
    );
  });

  test('comparator falls back to card URL as a deterministic tiebreak', function (assert) {
    let { mango, ringo } = cards;
    // No sort keys → order purely by id (cardURL) ascending.
    let sorted = [ringo, mango].sort(makeInstanceComparator(undefined, api));
    assert.deepEqual(
      sorted.map((c) => c.id),
      [mango.id, ringo.id],
      'mango sorts before ringo by URL',
    );
  });
});
