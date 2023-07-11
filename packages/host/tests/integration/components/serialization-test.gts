import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderCard } from '../../helpers/render-component';
import parseISO from 'date-fns/parseISO';
import {
  p,
  cleanWhiteSpace,
  shimModule,
  setupCardLogs,
  saveCard,
} from '../../helpers';
import { Loader } from '@cardstack/runtime-common/loader';
import {
  baseRealm,
  NotLoaded,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { fillIn, RenderingTestContext } from '@ember/test-helpers';
import { shimExternals } from '@cardstack/host/lib/externals';
import { isAddress } from 'ethers';
import { type Card as CardType } from 'https://cardstack.com/base/card-api';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let cardRef: typeof import('https://cardstack.com/base/card-ref');
let date: typeof import('https://cardstack.com/base/date');
let datetime: typeof import('https://cardstack.com/base/datetime');
let number: typeof import('https://cardstack.com/base/number');
let string: typeof import('https://cardstack.com/base/string');
let bigInteger: typeof import('https://cardstack.com/base/big-integer');
let ethereumAddress: typeof import('https://cardstack.com/base/ethereum-address');

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );
  const realmURL = `https://test-realm/`;

  hooks.beforeEach(async function () {
    Loader.destroy();
    shimExternals();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );

    cardApi = await Loader.import(`${baseRealm.url}card-api`);
    string = await Loader.import(`${baseRealm.url}string`);
    number = await Loader.import(`${baseRealm.url}number`);
    date = await Loader.import(`${baseRealm.url}date`);
    datetime = await Loader.import(`${baseRealm.url}datetime`);
    cardRef = await Loader.import(`${baseRealm.url}card-ref`);
    bigInteger = await Loader.import(`${baseRealm.url}big-integer`);
    ethereumAddress = await Loader.import(`${baseRealm.url}ethereum-address`);
  });

  test('can deserialize field', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.title />
          created
          <@fields.created />
          published
          <@fields.published />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Post });

    // initialize card data as serialized to force us to deserialize instead of using cached data
    let resource = {
      attributes: {
        title: 'First Post',
        created: '2022-04-22',
        published: '2022-04-27T16:02',
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'Post',
        },
      },
    };
    let firstPost = await createFromSerialized(
      resource,
      { data: resource },
      undefined
    );
    let root = await renderCard(firstPost, 'isolated');

    // the template value 'Apr 22, 2022' can only be realized when the card has
    // correctly deserialized it's static data property
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'First Post created Apr 22, 2022 published Apr 27, 2022, 4:02 PM'
    );
  });

  test('can deserialize a card that has an ID', async function (assert) {
    let { field, contains, Card, createFromSerialized, isSaved } = cardApi;
    let { default: StringCard } = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    // deserialize a card with an ID to mark it as "saved"
    let resource = {
      id: `${realmURL}Person/mango`,
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'Person',
        },
      },
    };
    let savedCard = (await createFromSerialized(
      resource,
      { data: resource },
      undefined
    )) as CardType;

    assert.strictEqual(
      savedCard.id,
      `${realmURL}Person/mango`,
      'instance id is set'
    );
    assert.strictEqual(
      isSaved(savedCard),
      true,
      'API recognizes card as saved'
    );

    let unsavedCard = new Person();
    assert.strictEqual(
      isSaved(unsavedCard),
      false,
      'API recognizes card as unsaved'
    );
  });

  test('can serialize a card that has an ID', async function (assert) {
    let { field, contains, Card, serializeCard } = cardApi;
    let { default: StringCard } = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    let mango = new Person({
      id: `${realmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.deepEqual(serializeCard(mango, { includeUnrenderedFields: true }), {
      data: {
        id: `${realmURL}Person/mango`,
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can update an instance from serialized data', async function (assert) {
    let { field, contains, Card, updateFromSerialized, isSaved } = cardApi;
    let { default: StringCard } = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    let card = new Person({
      id: `${realmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.strictEqual(isSaved(card), false, 'card is not saved');

    let result = await updateFromSerialized(card, {
      data: {
        id: `${realmURL}Person/vanGogh`,
        attributes: {
          firstName: 'Van Gogh',
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });

    assert.strictEqual(isSaved(card), true, 'card is saved');
    assert.strictEqual(result, card, 'returns the same instance provided');
    assert.strictEqual(
      card.id,
      `${realmURL}Person/vanGogh`,
      'ID can be updated for unsaved instance'
    );
    assert.strictEqual(card.firstName, 'Van Gogh', 'the field can be updated');
  });

  test('throws when updating the id of a saved instance from serialized data', async function (assert) {
    let { field, contains, Card, updateFromSerialized, createFromSerialized } =
      cardApi;
    let { default: StringCard } = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    // deserialize a card with an ID to mark it as "saved"
    let resource = {
      id: `${realmURL}Person/mango`,
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'Person',
        },
      },
    };
    let savedCard = await createFromSerialized(
      resource,
      { data: resource },
      undefined
    );

    try {
      await updateFromSerialized(savedCard, {
        data: {
          id: `${realmURL}Person/vanGogh`,
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      });
      throw new Error('expected error not thrown');
    } catch (err: any) {
      assert.ok(
        err.message.match(/cannot change the id for saved instance/),
        'exception thrown when updating the ID of a saved card'
      );
    }
  });

  test('deserialized card ref fields are not strict equal to serialized card ref', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-ref><@fields.ref /></div>
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { DriverCard });

    let ref = { module: `http://localhost:4202/test/person`, name: 'Person' };
    let resource = {
      attributes: {
        ref,
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'DriverCard',
        },
      },
    };
    let driver = await createFromSerialized<typeof DriverCard>(
      resource,
      { data: resource },
      undefined
    );
    assert.ok(
      driver.ref !== ref,
      'the card ref value is not strict equals to its serialized counter part'
    );
    assert.deepEqual(
      driver.ref,
      ref,
      'the card ref value is deep equal to its serialized counter part'
    );
  });

  test('serialized card ref fields are not strict equal to their deserialized card ref values', async function (assert) {
    let { field, contains, Card, Component, serializeCard } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-ref><@fields.ref /></div>
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { DriverCard });

    let ref = { module: `http://localhost:4202/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });
    let serializedRef = serializeCard(driver, { includeUnrenderedFields: true })
      .data.attributes?.ref;
    assert.ok(
      serializedRef !== ref,
      'the card ref value is not strict equals to its serialized counter part'
    );
    assert.deepEqual(
      serializedRef,
      ref,
      'the card ref value is deep equal to its serialized counter part'
    );
  });

  test('can serialize field', async function (assert) {
    let { field, contains, Card, serializeCard } = cardApi;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
    }
    await shimModule(`${realmURL}test-cards`, { Post });

    // initialize card data as deserialized to force us to serialize instead of using cached data
    let firstPost = new Post({
      created: p('2022-04-22'),
      published: parseISO('2022-04-27T16:30+00:00'),
    });
    let serialized = serializeCard(firstPost, {
      includeUnrenderedFields: true,
    });
    assert.strictEqual(serialized.data.attributes?.created, '2022-04-22');
    assert.strictEqual(
      serialized.data.attributes?.published,
      '2022-04-27T16:30:00.000Z'
    );
  });

  test('can deserialize a date field with null value', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.title />
          created
          <@fields.created />
          published
          <@fields.published />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Post });
    let resource = {
      attributes: {
        title: 'First Post',
        created: null,
        published: null,
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'Post',
        },
      },
    };
    let firstPost = await createFromSerialized(
      resource,
      { data: resource },
      undefined
    );
    let root = await renderCard(firstPost, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'First Post created [no date] published [no date-time]'
    );
  });

  test('can serialize a linksTo relationship', async function (assert) {
    let { field, contains, linksTo, Card, serializeCard } = cardApi;
    let { default: StringCard } = string;

    class Toy extends Card {
      @field description = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });

    let spookyToiletPaper = new Toy({
      description: 'Toilet paper ghost: Poooo!',
    });
    let mango = new Pet({
      firstName: 'Mango',
      favoriteToy: spookyToiletPaper,
    });
    let hassan = new Person({
      firstName: 'Hassan',
      pet: mango,
    });
    await saveCard(spookyToiletPaper, `${realmURL}Toy/spookyToiletPaper`);
    await saveCard(mango, `${realmURL}Pet/mango`);

    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${realmURL}Pet/mango`,
            },
            data: {
              id: `${realmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
        {
          id: `${realmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            favoriteToy: {
              links: {
                self: `${realmURL}Toy/spookyToiletPaper`,
              },
              data: {
                id: `${realmURL}Toy/spookyToiletPaper`,
                type: 'card',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Pet',
            },
          },
        },
      ],
    });
  });

  test('can deserialize a linksTo relationship', async function (assert) {
    let {
      field,
      contains,
      linksTo,
      Card,
      createFromSerialized,
      relationshipMeta,
      isSaved,
    } = cardApi;
    let { default: StringCard } = string;

    class Toy extends Card {
      @field description = contains(StringCard);
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field favoriteToy = linksTo(Toy);
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${realmURL}Pet/mango`,
            },
            data: {
              id: `${realmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
        {
          id: `${realmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            favoriteToy: {
              links: {
                self: `${realmURL}Toy/spookyToiletPaper`,
              },
              data: {
                id: `${realmURL}Toy/spookyToiletPaper`,
                type: 'card',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Pet',
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );

    assert.ok(card instanceof Person, 'card is an instance of person');
    assert.strictEqual(card.firstName, 'Hassan');
    let { pet } = card;
    if (pet instanceof Pet) {
      assert.strictEqual(isSaved(pet), true, 'Pet card is saved');
      assert.strictEqual(pet.firstName, 'Mango');
      let { favoriteToy } = pet;
      if (favoriteToy instanceof Toy) {
        assert.strictEqual(isSaved(favoriteToy), true, 'Toy card is saved');
        assert.strictEqual(
          favoriteToy.description,
          'Toilet paper ghost: Poooo!'
        );
      } else {
        assert.ok(false, '"favoriteToy" field value is not an instance of Toy');
      }
    } else {
      assert.ok(false, '"pet" field value is not an instance of Pet');
    }

    let relationship = relationshipMeta(card, 'pet');
    if (Array.isArray(relationship)) {
      assert.ok(
        false,
        'relationshipMeta should not be an array for linksTo relationship'
      );
    } else {
      if (relationship?.type === 'loaded') {
        let relatedCard = relationship.card;
        assert.strictEqual(
          relatedCard instanceof Pet,
          true,
          'related card is a Pet'
        );
        assert.strictEqual(relatedCard?.id, `${realmURL}Pet/mango`);
      } else {
        assert.ok(false, 'relationship type was not "loaded"');
      }
    }

    assert.strictEqual(
      relationshipMeta(card, 'firstName'),
      undefined,
      'relationshipMeta returns undefined for non-relationship field'
    );
  });

  test('can deserialize a linksTo relationship that does not include all the related resources', async function (assert) {
    let {
      field,
      contains,
      linksTo,
      Card,
      createFromSerialized,
      relationshipMeta,
      serializeCard,
    } = cardApi;
    let { default: StringCard } = string;

    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${realmURL}Pet/mango`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    };
    let hassan = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );

    try {
      hassan.pet;
      throw new Error(`expected error not thrown`);
    } catch (err: any) {
      assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
      assert.ok(
        err.message.match(
          /The field Person\.pet refers to the card instance https:\/\/test-realm\/Pet\/mango which is not loaded/,
          'NotLoaded error describes field not loaded'
        )
      );
    }

    let relationship = relationshipMeta(hassan, 'pet');
    if (Array.isArray(relationship)) {
      assert.ok(
        false,
        'relationshipMeta should not be an array for linksTo relationship'
      );
    } else {
      if (relationship?.type === 'not-loaded') {
        assert.strictEqual(relationship.reference, `${realmURL}Pet/mango`);
      } else {
        assert.ok(false, 'relationship type was not "not-loaded"');
      }
    }

    let payload = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${realmURL}Pet/mango`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can serialize an empty linksTo relationship', async function (assert) {
    let { field, contains, linksTo, Card, serializeCard } = cardApi;
    let { default: StringCard } = string;

    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet });

    let hassan = new Person({ firstName: 'Hassan' });

    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });

    let mango = new Person({ firstName: 'Mango', pet: null });
    serialized = serializeCard(mango, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          pet: {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can deserialize an empty linksTo relationship', async function (assert) {
    let { field, contains, linksTo, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;

    class Pet extends Card {
      @field firstName = contains(StringCard);
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );
    assert.ok(card instanceof Person, 'card is a Person');
    assert.strictEqual(card.firstName, 'Hassan');
    assert.strictEqual(card.pet, null, 'relationship is null');
  });

  test('can deserialize coexisting linksTo, contains, and containsMany fields in a card', async function (assert) {
    let {
      field,
      contains,
      containsMany,
      linksTo,
      Card,
      createFromSerialized,
      relationshipMeta,
      isSaved,
    } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    class Toy extends Card {
      @field description = contains(StringCard);
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field owner = linksTo(Person);
      @field favoriteToy = contains(Toy);
      @field toys = containsMany(Toy);
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Jackie',
          toys: [{ description: 'treat ball' }, { description: 'tug toy' }],
          favoriteToy: { description: 'treat ball' },
        },
        relationships: {
          owner: {
            links: {
              self: `${realmURL}Person/burcu`,
            },
            data: {
              id: `${realmURL}Person/burcu`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Pet',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Person/burcu`,
          type: 'card',
          attributes: {
            firstName: 'Burcu',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Pet>(doc.data, doc, undefined);

    assert.ok(card instanceof Pet, 'card is an instance of pet');
    assert.strictEqual(card.firstName, 'Jackie');

    let { owner, favoriteToy, toys } = card;
    if (owner instanceof Person) {
      assert.strictEqual(isSaved(owner), true, 'Person card is saved');
      assert.strictEqual(owner.firstName, 'Burcu');
    } else {
      assert.ok(false, '"owner" field value is not an instance of Person');
    }
    assert.strictEqual(toys.length, 2);
    toys.map((toy, i) => {
      if (toy instanceof Toy) {
        assert.strictEqual(isSaved(toy), false, `Toy ${i} card is not saved`);
      } else {
        assert.ok(false, '"toys" field value is not an instance of Toy');
      }
    });
    if (favoriteToy instanceof Toy) {
      assert.strictEqual(isSaved(favoriteToy), false, 'Toy card is not saved');
      assert.strictEqual(favoriteToy.description, 'treat ball');
    } else {
      assert.ok(false, '"favoriteToy" field value is not an instance of Toy');
    }

    let relationship = relationshipMeta(card, 'owner');
    if (Array.isArray(relationship)) {
      assert.ok(
        false,
        'relationshipMeta should not be an array for linksTo relationship'
      );
    } else {
      if (relationship?.type === 'loaded') {
        let relatedCard = relationship.card;
        assert.strictEqual(
          relatedCard instanceof Person,
          true,
          'related card is a Person'
        );
        assert.strictEqual(relatedCard?.id, `${realmURL}Person/burcu`);
      } else {
        assert.ok(false, 'relationship type was not "loaded"');
      }
    }

    ['firstName', 'toys', 'favoriteToy'].map((fieldName) =>
      assert.strictEqual(
        relationshipMeta(card, fieldName),
        undefined,
        `relationshipMeta returns undefined for non-relationship field ${fieldName}`
      )
    );
  });

  test('can serialize a linksTo relationship that points to own card class', async function (assert) {
    let { field, contains, linksTo, Card, serializeCard } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field friend = linksTo(() => Person);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    let mango = new Person({ firstName: 'Mango' });
    let hassan = new Person({ firstName: 'Hassan', friend: mango });
    await saveCard(mango, `${realmURL}Person/mango`);
    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          friend: {
            links: {
              self: `${realmURL}Person/mango`,
            },
            data: {
              id: `${realmURL}Person/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Person/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            friend: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    });
  });

  test('can deserialize a linksTo relationship that points to own card class', async function (assert) {
    let { field, contains, linksTo, Card, createFromSerialized, isSaved } =
      cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field friend = linksTo(() => Person);
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          friend: {
            links: {
              self: `${realmURL}Person/mango`,
            },
            data: {
              id: `${realmURL}Person/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Person/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            friend: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );
    assert.ok(card instanceof Person, 'card is a Person');
    assert.strictEqual(card.firstName, 'Hassan');
    let { friend } = card;
    assert.ok(friend instanceof Person, 'friend is a Person');
    assert.ok(isSaved(friend), 'card is saved');
    assert.strictEqual(friend.firstName, 'Mango');
  });

  test('throws when serializing a linksTo relationship to an unsaved card', async function (assert) {
    let { field, contains, linksTo, Card, serializeCard } = cardApi;
    let { default: StringCard } = string;

    class Pet extends Card {
      @field firstName = contains(StringCard);
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet });

    let mango = new Pet({ firstName: 'Mango' });
    let hassan = new Person({ firstName: 'Hassan', pet: mango });

    try {
      serializeCard(hassan, { includeUnrenderedFields: true });
      throw new Error(`expected error not thrown`);
    } catch (err: any) {
      assert.ok(
        err.message.match(
          /field 'pet' cannot be serialized with an unsaved card/
        ),
        'cannot serialize a linksTo relationship to an unsaved card'
      );
    }
  });

  test('can serialize a contains field that has a nested linksTo field', async function (assert) {
    let {
      field,
      contains,
      linksTo,
      Card,
      serializeCard,
      createFromSerialized,
    } = cardApi;
    let { default: StringCard } = string;

    class Toy extends Card {
      @field description = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = contains(Pet);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });

    let spookyToiletPaper = new Toy({
      description: 'Toilet paper ghost: Poooo!',
    });
    let mango = new Pet({
      firstName: 'Mango',
      favoriteToy: spookyToiletPaper,
    });
    let hassan = new Person({
      firstName: 'Hassan',
      pet: mango,
    });
    await saveCard(spookyToiletPaper, `${realmURL}Toy/spookyToiletPaper`);
    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          pet: {
            firstName: 'Mango',
          },
        },
        relationships: {
          'pet.favoriteToy': {
            links: {
              self: `${realmURL}Toy/spookyToiletPaper`,
            },
            data: {
              type: 'card',
              id: `${realmURL}Toy/spookyToiletPaper`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
      ],
    });

    let card = await createFromSerialized(
      serialized.data,
      serialized,
      undefined
    );
    if (card instanceof Person) {
      assert.strictEqual(card.firstName, 'Hassan');
      let { pet } = card;
      if (pet instanceof Pet) {
        assert.strictEqual(pet.firstName, 'Mango');
        let { favoriteToy } = pet;
        if (favoriteToy instanceof Toy) {
          assert.strictEqual(
            favoriteToy.description,
            'Toilet paper ghost: Poooo!'
          );
        } else {
          assert.ok(false, 'card is not instance of Toy');
        }
      } else {
        assert.ok(false, 'card is not instance of Pet');
      }
    } else {
      assert.ok(false, 'card is not instance of Person');
    }
  });

  test('can serialize a containsMany field that has a nested linksTo field', async function (assert) {
    let {
      field,
      contains,
      containsMany,
      linksTo,
      Card,
      serializeCard,
      createFromSerialized,
    } = cardApi;
    let { default: StringCard } = string;

    class Toy extends Card {
      @field description = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringCard, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pets = containsMany(Pet);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });

    let spookyToiletPaper = new Toy({
      description: 'Toilet paper ghost: Poooo!',
    });
    let mango = new Pet({
      firstName: 'Mango',
      favoriteToy: spookyToiletPaper,
    });
    let hassan = new Person({
      firstName: 'Hassan',
      pets: [mango],
    });
    await saveCard(spookyToiletPaper, `${realmURL}Toy/spookyToiletPaper`);
    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          pets: [
            {
              firstName: 'Mango',
            },
          ],
        },
        relationships: {
          'pets.0.favoriteToy': {
            links: {
              self: `${realmURL}Toy/spookyToiletPaper`,
            },
            data: {
              type: 'card',
              id: `${realmURL}Toy/spookyToiletPaper`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
      ],
    });

    let card = await createFromSerialized(
      serialized.data,
      serialized,
      undefined
    );
    if (card instanceof Person) {
      assert.strictEqual(card.firstName, 'Hassan');
      let { pets } = card;
      if (Array.isArray(pets)) {
        assert.strictEqual(pets.length, 1, 'correct number of pets');
        let [pet] = pets;
        if (pet instanceof Pet) {
          assert.strictEqual(pet.firstName, 'Mango');
          let { favoriteToy } = pet;
          if (favoriteToy instanceof Toy) {
            assert.strictEqual(
              favoriteToy.description,
              'Toilet paper ghost: Poooo!'
            );
          } else {
            assert.ok(false, 'card is not instance of Toy');
          }
        } else {
          assert.ok(false, 'card is not instance of Pet');
        }
      } else {
        assert.ok(false, 'Person.pets is not an array');
      }
    } else {
      assert.ok(false, 'card is not instance of Person');
    }
  });

  test('can maintain object identity when deserializing linksTo relationship', async function (assert) {
    let { field, contains, linksTo, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field parent = linksTo(() => Person);
      @field favorite = linksTo(() => Person);
    }
    await shimModule(`${realmURL}test-cards`, { Person });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        id: `${realmURL}Person/mango`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          parent: {
            links: {
              self: `${realmURL}Person/hassan`,
            },
          },
          favorite: {
            links: {
              self: `${realmURL}Person/hassan`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Person/hassan`,
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    };
    let mango = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );
    if (mango instanceof Person) {
      let { parent, favorite } = mango;
      assert.strictEqual(
        parent,
        favorite,
        'relationship values share object equality'
      );
      parent.firstName = 'Mariko';
      assert.strictEqual(
        favorite.firstName,
        'Mariko',
        'instances that have object equality can be mutated'
      );
    } else {
      assert.ok(false, 'mango is not a Person');
    }
  });

  test('can serialize a date field with null value', async function (assert) {
    let { field, contains, Card, serializeCard } = cardApi;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
    }
    await shimModule(`${realmURL}test-cards`, { Post });

    let firstPost = new Post({ created: null, published: null });
    let serialized = serializeCard(firstPost, {
      includeUnrenderedFields: true,
    });
    assert.strictEqual(serialized.data.attributes?.created, null);
    assert.strictEqual(serialized.data.attributes?.published, null);
  });

  test('can deserialize a nested field', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          birthdate
          <@fields.author.birthdate />
          last login
          <@fields.author.lastLogin />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Post, Person });

    let doc = {
      data: {
        attributes: {
          title: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            lastLogin: '2022-04-27T16:58',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    };
    let firstPost = await createFromSerialized<typeof Post>(
      doc.data,
      doc,
      undefined
    );
    let root = await renderCard(firstPost, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'birthdate Oct 30, 2019 last login Apr 27, 2022, 4:58 PM'
    );
  });

  test('can deserialize a composite field', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test><@fields.firstName />
            born on:
            <@fields.birthdate />
            last logged in:
            <@fields.lastLogin /></div>
        </template>
      };
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.author />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Post, Person });

    let doc = {
      data: {
        attributes: {
          title: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            lastLogin: '2022-04-27T17:00',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    };
    let firstPost = await createFromSerialized<typeof Post>(
      doc.data,
      doc,
      undefined
    );
    await renderCard(firstPost, 'isolated');
    assert
      .dom('[data-test]')
      .hasText(
        'Mango born on: Oct 30, 2019 last logged in: Apr 27, 2022, 5:00 PM'
      );
  });

  test('can serialize a composite field', async function (assert) {
    let { field, contains, serializeCard, Card } = cardApi;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    class Post extends Card {
      @field author = contains(Person);
      @field title = contains(StringCard, {
        computeVia: function (this: Post) {
          return this.author?.title ?? 'Post';
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person, Post });

    let firstPost = new Post({
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        lastLogin: parseISO('2022-04-27T16:30+00:00'),
      }),
    });

    let serialized = serializeCard(firstPost, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(serialized.data.attributes, {
      author: {
        birthdate: '2019-10-30',
        firstName: 'Mango',
        lastLogin: '2022-04-27T16:30:00.000Z',
      },
    });
    // this means the field card for the value is the same as the field's card
    assert.deepEqual(serialized.data.meta.fields, undefined);
  });

  test('can serialize a polymorphic composite field', async function (assert) {
    let { field, contains, serializeCard, Card } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Employee extends Person {
      @field department = contains(StringCard);
    }

    class Post extends Card {
      @field author = contains(Person);
    }

    await shimModule(`${realmURL}test-cards`, { Person, Employee, Post });

    let firstPost = new Post({
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        lastLogin: parseISO('2022-04-27T16:30+00:00'),
        department: 'wagging',
      }),
    });

    let serialized = serializeCard(firstPost, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(serialized.data.attributes?.author, {
      birthdate: '2019-10-30',
      firstName: 'Mango',
      lastLogin: '2022-04-27T16:30:00.000Z',
      department: 'wagging',
    });
    assert.deepEqual(serialized.data.meta?.fields?.author, {
      adoptsFrom: {
        module: `${realmURL}test-cards`,
        name: 'Employee',
      },
    });
  });

  test('can serialize a composite field that has been edited', async function (assert) {
    let { field, contains, serializeCard, Card, Component } = cardApi;
    let { default: StringCard } = string;
    let { default: NumberCard } = number;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.firstName />
        </template>
      };
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field reviews = contains(NumberCard);
      @field author = contains(Person);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <fieldset>
            <label data-test-field='title'>Title <@fields.title /></label>
            <label data-test-field='reviews'>Reviews <@fields.reviews /></label>
            <label data-test-field='author'>Author <@fields.author /></label>
          </fieldset>

          <div data-test-output='title'>{{@model.title}}</div>
          <div data-test-output='reviews'>{{@model.reviews}}</div>
          <div
            data-test-output='author.firstName'
          >{{@model.author.firstName}}</div>
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Post, Person });

    let helloWorld = new Post({
      title: 'First Post',
      reviews: 1,
      author: new Person({
        firstName: 'Arthur',
      }),
    });
    await renderCard(helloWorld, 'edit');
    await fillIn('[data-test-field="firstName"] input', 'Carl Stack');

    assert.deepEqual(
      serializeCard(helloWorld, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'First Post',
            reviews: 1,
            author: {
              firstName: 'Carl Stack',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Post',
            },
          },
        },
      }
    );
  });

  test('can serialize a computed field', async function (assert) {
    let { field, contains, serializeCard, Card } = cardApi;
    let { default: DateCard } = date;
    class Person extends Card {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard, {
        computeVia: function (this: Person) {
          return new Date(
            this.birthdate.getFullYear() + 1,
            this.birthdate.getMonth(),
            this.birthdate.getDate()
          );
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person });
    let mango = new Person({ birthdate: p('2019-10-30') });
    let serialized = serializeCard(mango, {
      includeComputeds: true,
      includeUnrenderedFields: true,
    });
    assert.strictEqual(serialized.data.attributes?.firstBirthday, '2020-10-30');
  });

  module('computed linksTo', function () {
    test('can serialize a computed linksTo field', async function (assert) {
      let { field, contains, linksTo, serializeCard, Card } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Person });
      let mango = new Pet({ name: 'Mango' });
      let hassan = new Person({ firstName: 'Hassan', pet: mango });
      await saveCard(mango, `${realmURL}Pet/mango`);
      await saveCard(hassan, `${realmURL}Person/hassan`);
      let burcu = new Person({ firstName: 'Burcu', friend: hassan });
      let serialized = serializeCard(burcu, {
        includeComputeds: true,
        includeUnrenderedFields: true,
      });
      assert.deepEqual(serialized.data, {
        type: 'card',
        attributes: { firstName: 'Burcu', title: null },
        relationships: {
          pet: { links: { self: null } },
          friend: {
            links: { self: `${realmURL}Person/hassan` },
            data: { id: `${realmURL}Person/hassan`, type: 'card' },
          },
          friendPet: {
            links: { self: `${realmURL}Pet/mango` },
            data: { id: `${realmURL}Pet/mango`, type: 'card' },
          },
        },
        meta: {
          adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
        },
      });

      assert.deepEqual(serialized.included, [
        {
          id: `${realmURL}Pet/mango`,
          type: 'card',
          attributes: { name: 'Mango', title: null },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${realmURL}Person/hassan`,
          type: 'card',
          attributes: { firstName: 'Hassan', title: null },
          relationships: {
            pet: {
              links: { self: `${realmURL}Pet/mango` },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
            friend: { links: { self: null } },
            friendPet: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      ]);
    });

    test('can deserialize a computed linksTo field', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        Card,
        createFromSerialized,
        relationshipMeta,
        isSaved,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            pet: { links: { self: null } },
            friend: {
              links: { self: `${realmURL}Person/hassan` },
              data: { id: `${realmURL}Person/hassan`, type: 'card' },
            },
            friendPet: {
              links: { self: `${realmURL}Pet/mango` },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${realmURL}Person/hassan`,
            type: 'card',
            attributes: { firstName: 'Hassan' },
            relationships: {
              pet: {
                links: { self: `${realmURL}Pet/mango` },
                data: { id: `${realmURL}Pet/mango`, type: 'card' },
              },
              friend: { links: { self: null } },
              friendPet: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      assert.ok(card instanceof Person, 'card is an instance of person');
      assert.strictEqual(card.firstName, 'Burcu');
      let { friendPet } = card;
      if (friendPet instanceof Pet) {
        assert.strictEqual(isSaved(friendPet), true, 'Pet card is saved');
        assert.strictEqual(friendPet.name, 'Mango');
      } else {
        assert.ok(false, '"friendPet" field value is not an instance of Pet');
      }

      let relationship = relationshipMeta(card, 'friendPet');
      if (Array.isArray(relationship)) {
        assert.ok(
          false,
          'relationshipMeta should not be an array for linksTo relationship'
        );
      } else {
        if (relationship?.type === 'loaded') {
          let relatedCard = relationship.card;
          assert.strictEqual(
            relatedCard instanceof Pet,
            true,
            'related card is a Pet'
          );
          assert.strictEqual(relatedCard?.id, `${realmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded"');
        }
      }
    });

    test('can serialize an empty computed linksTo field', async function (assert) {
      let { field, contains, linksTo, Card, serializeCard } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Person });
      let person = new Person({ firstName: 'Burcu' });
      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            pet: { links: { self: null } },
            friend: { links: { self: null } },
            friendPet: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty computed linksTo field', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        Card,
        createFromSerialized,
        relationshipMeta,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            pet: { links: { self: null } },
            friend: { links: { self: null } },
            friendPet: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );
      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Burcu');
      assert.strictEqual(card.friendPet, null, 'relationship is null');

      let relationship = relationshipMeta(card, 'friendPet');
      assert.deepEqual(relationship, { type: 'loaded', card: null });
    });

    test('can deserialize a computed linksTo relationship that does not include all the related resources', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        Card,
        createFromSerialized,
        relationshipMeta,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            pet: { links: { self: null } },
            friend: { links: { self: `${realmURL}Person/hassan` } },
            friendPet: { links: { self: `${realmURL}Pet/mango` } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      try {
        card.friendPet;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.ok(
          err.message.match(
            /The field Person\.friendPet refers to the card instance https:\/\/test-realm\/Pet\/mango which is not loaded/,
            'NotLoaded error describes field not loaded'
          )
        );
      }
      let friendRel = relationshipMeta(card, 'friend');
      assert.deepEqual(friendRel, {
        type: 'not-loaded',
        reference: `${realmURL}Person/hassan`,
      });

      let friendPetRel = relationshipMeta(card, 'friendPet');
      assert.deepEqual(friendPetRel, {
        type: 'not-loaded',
        reference: `${realmURL}Pet/mango`,
      });
    });
  });

  test('can deserialize a containsMany field', async function (assert) {
    let { field, containsMany, Card, Component, createFromSerialized } =
      cardApi;
    let { default: DateCard } = date;
    class Schedule extends Card {
      @field dates = containsMany(DateCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.dates />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Schedule });

    let doc = {
      data: {
        attributes: {
          dates: ['2022-4-1', '2022-4-4'],
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Schedule',
          },
        },
      },
    };
    let classSchedule = await createFromSerialized<typeof Schedule>(
      doc.data,
      doc,
      undefined
    );
    let root = await renderCard(classSchedule, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'Apr 1, 2022 Apr 4, 2022'
    );
  });

  test("can deserialize a containsMany's nested field", async function (this: RenderingTestContext, assert) {
    let {
      field,
      contains,
      containsMany,
      Card,
      Component,
      createFromSerialized,
    } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Appointment extends Card {
      @field date = contains(DateCard);
      @field location = contains(StringCard);
      @field title = contains(StringCard);
      static embedded = class Isolated extends Component<typeof this> {
        <template>
          <div data-test='appointment'><@fields.title />
            on
            <@fields.date />
            at
            <@fields.location /></div>
        </template>
      };
    }
    class Schedule extends Card {
      @field appointments = containsMany(Appointment);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.appointments />
        </template>
      };
    }
    await shimModule(`${realmURL}test-cards`, { Schedule, Appointment });

    let doc = {
      data: {
        attributes: {
          appointments: [
            { date: '2022-4-1', location: 'Room 332', title: 'Biology' },
            { date: '2022-4-4', location: 'Room 102', title: 'Civics' },
          ],
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Schedule',
          },
        },
      },
    };
    let classSchedule = await createFromSerialized<typeof Schedule>(
      doc.data,
      doc,
      undefined
    );
    await renderCard(classSchedule, 'isolated');
    assert.deepEqual(
      [...this.element.querySelectorAll('[data-test="appointment"]')].map(
        (element) => cleanWhiteSpace(element.textContent!)
      ),
      [
        'Biology on Apr 1, 2022 at Room 332',
        'Civics on Apr 4, 2022 at Room 102',
      ]
    );
  });

  test('can serialize a containsMany field', async function (assert) {
    let { field, containsMany, serializeCard, Card } = cardApi;
    let { default: DateCard } = date;
    class Schedule extends Card {
      @field dates = containsMany(DateCard);
    }
    await shimModule(`${realmURL}test-cards`, { Schedule });

    let classSchedule = new Schedule({ dates: [p('2022-4-1'), p('2022-4-4')] });
    assert.deepEqual(
      serializeCard(classSchedule, { includeUnrenderedFields: true }).data
        .attributes?.dates,
      ['2022-04-01', '2022-04-04']
    );
  });

  test("can serialize a containsMany's nested field", async function (assert) {
    let { field, contains, containsMany, serializeCard, Card } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Appointment extends Card {
      @field date = contains(DateCard);
      @field location = contains(StringCard);
      @field title = contains(StringCard);
    }
    class Schedule extends Card {
      @field appointments = containsMany(Appointment);
    }
    await shimModule(`${realmURL}test-cards`, { Schedule, Appointment });

    let classSchedule = new Schedule({
      appointments: [
        new Appointment({
          date: p('2022-4-1'),
          location: 'Room 332',
          title: 'Biology',
        }),
        new Appointment({
          date: p('2022-4-4'),
          location: 'Room 102',
          title: 'Civics',
        }),
      ],
    });

    let serialized = serializeCard(classSchedule, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(serialized.data.attributes?.appointments, [
      {
        date: '2022-04-01',
        location: 'Room 332',
        title: 'Biology',
      },
      {
        date: '2022-04-04',
        location: 'Room 102',
        title: 'Civics',
      },
    ]);
    assert.deepEqual(serialized.data.meta?.fields?.appointments, undefined); // this means the field card for the value is the same as the field's card
  });

  test('can serialize a card with primitive fields', async function (assert) {
    let { field, contains, serializeCard, Card, recompute } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
    }
    await shimModule(`${realmURL}test-cards`, { Post });

    let firstPost = new Post({
      title: 'First Post',
      created: p('2022-04-22'),
      published: parseISO('2022-04-27T16:30+00:00'),
    });
    await recompute(firstPost);
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(
      payload,
      {
        data: {
          type: 'card',
          attributes: {
            title: 'First Post',
            created: '2022-04-22',
            published: '2022-04-27T16:30:00.000Z',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Post',
            },
          },
        },
      },
      'A model can be serialized once instantiated'
    );
  });

  test('can serialize a card with composite field', async function (assert) {
    let { field, contains, serializeCard, Card } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Animal extends Card {
      @field species = contains(StringCard);
    }
    class Person extends Animal {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }
    await shimModule(`${realmURL}test-cards`, { Post, Person, Animal });

    let firstPost = new Post({
      title: 'First Post',
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        species: 'canis familiaris',
      }),
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          title: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            species: 'canis familiaris',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    });
  });

  test('can serialize a card that has a polymorphic field value', async function (assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } =
      cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
    }

    class Employee extends Person {
      @field department = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    await shimModule(`${realmURL}test-cards`, { Person, Employee, Post });

    let firstPost = new Post({
      title: 'First Post',
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        department: 'wagging',
      }),
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          title: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            department: 'wagging',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Post',
          },
          fields: {
            author: {
              adoptsFrom: {
                module: `${realmURL}test-cards`,
                name: 'Employee',
              },
            },
          },
        },
      },
    });

    let post2 = await createFromSerialized<typeof Post>(
      payload.data,
      payload,
      new URL(realmURL)
    ); // success is not blowing up
    assert.strictEqual(post2.author.firstName, 'Mango');
    let { author } = post2;
    if (author instanceof Employee) {
      assert.strictEqual(author.department, 'wagging');
    } else {
      assert.ok(false, 'Not an employee');
    }
  });

  test('can serialize a card that has a nested polymorphic field value', async function (assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } =
      cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field loves = contains(Card);
    }

    class Pet extends Card {
      @field firstName = contains(StringCard);
    }

    class Employee extends Person {
      @field department = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    await shimModule(`${realmURL}test-cards`, { Person, Employee, Post, Pet });

    let firstPost = new Post({
      title: 'First Post',
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        department: 'wagging',
        loves: new Pet({
          firstName: 'Van Gogh',
        }),
      }),
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          title: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            department: 'wagging',
            loves: {
              firstName: 'Van Gogh',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Post',
          },
          fields: {
            author: {
              adoptsFrom: {
                module: `${realmURL}test-cards`,
                name: 'Employee',
              },
              fields: {
                loves: {
                  adoptsFrom: {
                    module: `${realmURL}test-cards`,
                    name: 'Pet',
                  },
                },
              },
            },
          },
        },
      },
    });

    let post2 = await createFromSerialized<any>(
      payload.data,
      payload,
      new URL(realmURL)
    ); // success is not blowing up
    assert.strictEqual(post2.author.firstName, 'Mango');
    assert.strictEqual(post2.author.loves.firstName, 'Van Gogh');
    let { author } = post2;
    if (author instanceof Employee) {
      assert.strictEqual(author.department, 'wagging');
    } else {
      assert.ok(false, 'Not an employee');
    }

    let { loves } = author;
    if (loves instanceof Pet) {
      assert.strictEqual(loves.firstName, 'Van Gogh');
    } else {
      assert.ok(false, 'Not a pet');
    }
  });

  test('can serialize a polymorphic containsMany field', async function (assert) {
    let {
      field,
      contains,
      containsMany,
      serializeCard,
      Card,
      createFromSerialized,
    } = cardApi;
    let { default: NumberCard } = number;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    class Employee extends Person {
      @field department = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Employee) {
          return this.department;
        },
      });
    }

    class Customer extends Person {
      @field billAmount = contains(NumberCard);
    }

    class Group extends Card {
      @field people = containsMany(Person);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return 'Group';
        },
      });
    }

    await shimModule(`${realmURL}test-cards`, {
      Person,
      Employee,
      Customer,
      Group,
    });

    let group = new Group({
      people: [
        new Employee({
          firstName: 'Mango',
          department: 'begging',
        }),
        new Customer({
          firstName: 'Van Gogh',
          billAmount: 100,
        }),
      ],
    });

    let payload = serializeCard(group, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          people: [
            {
              firstName: 'Mango',
              department: 'begging',
            },
            {
              firstName: 'Van Gogh',
              billAmount: 100,
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Group',
          },
          fields: {
            people: [
              {
                adoptsFrom: {
                  module: `${realmURL}test-cards`,
                  name: 'Employee',
                },
              },
              {
                adoptsFrom: {
                  module: `${realmURL}test-cards`,
                  name: 'Customer',
                },
              },
            ],
          },
        },
      },
    });

    let group2 = await createFromSerialized<any>(
      payload.data,
      payload,
      new URL(realmURL)
    );
    let { people } = group2;
    assert.ok(Array.isArray(people), 'people is an array');
    assert.strictEqual(people.length, 2, 'array length is correct');
    assert.strictEqual(people[0].firstName, 'Mango');
    assert.strictEqual(people[1].firstName, 'Van Gogh');

    let [first, second] = people;
    if (first instanceof Employee) {
      assert.strictEqual(first.department, 'begging');
    } else {
      assert.ok(false, 'Not an employee');
    }
    if (second instanceof Customer) {
      assert.strictEqual(second.billAmount, 100);
    } else {
      assert.ok(false, 'Not a customer');
    }
  });

  test('can deserialize polymorphic containsMany with nested polymorphic values', async function (assert) {
    let {
      field,
      contains,
      containsMany,
      serializeCard,
      Card,
      createFromSerialized,
    } = cardApi;
    let { default: NumberCard } = number;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    class Role extends Card {
      @field roleName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Role) {
          return this.roleName;
        },
      });
    }

    class DogWalker extends Role {
      @field poopBagCount = contains(NumberCard);
    }

    class Employee extends Person {
      @field roles = containsMany(Role);
    }

    class Group extends Card {
      @field people = containsMany(Person);
      @field title = contains(StringCard, {
        computeVia: function (this: Group) {
          return 'Group';
        },
      });
    }

    await shimModule(`${realmURL}test-cards`, {
      Person,
      Role,
      DogWalker,
      Employee,
      Group,
    });

    let group = new Group({
      people: [
        new Employee({
          firstName: 'Mango',
          roles: [
            new Role({ roleName: 'treat eater' }),
            new DogWalker({ roleName: 'dog walker', poopBagCount: 4 }),
          ],
        }),
      ],
    });

    let payload = serializeCard(group, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        type: 'card',
        attributes: {
          people: [
            {
              firstName: 'Mango',
              roles: [
                {
                  roleName: 'treat eater',
                },
                {
                  roleName: 'dog walker',
                  poopBagCount: 4,
                },
              ],
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Group',
          },
          fields: {
            people: [
              {
                adoptsFrom: {
                  module: `${realmURL}test-cards`,
                  name: 'Employee',
                },
                fields: {
                  roles: [
                    {},
                    {
                      adoptsFrom: {
                        module: `${realmURL}test-cards`,
                        name: 'DogWalker',
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    let group2 = await createFromSerialized<any>(
      payload.data,
      payload,
      new URL(realmURL)
    );
    let { people } = group2;
    assert.ok(Array.isArray(people), 'people is an array');
    assert.strictEqual(people.length, 1, 'array length is correct');
    assert.strictEqual(people[0].firstName, 'Mango');

    let [first] = people;
    assert.ok(first instanceof Employee, 'Employee instance is correct');

    let { roles } = first;
    assert.ok(Array.isArray(roles), 'roles is an array');
    assert.strictEqual(roles.length, 2, 'array length is correct');
    assert.strictEqual(roles[0].roleName, 'treat eater');
    assert.strictEqual(roles[1].roleName, 'dog walker');

    let [role1, role2] = roles;
    assert.ok(role1 instanceof Role, 'Role instance is correct');
    if (role2 instanceof DogWalker) {
      assert.strictEqual(role2.poopBagCount, 4);
    } else {
      assert.ok(false, 'Not a DogWalker');
    }
  });

  test('can deserialize a linksTo field that contains a polymorphic field', async function (assert) {
    let { field, contains, linksTo, Card, createFromSerialized, isSaved } =
      cardApi;
    let { default: StringCard } = string;

    class Toy extends Card {
      @field description = contains(StringCard);
    }
    class Pet extends Card {
      @field firstName = contains(StringCard);
      @field favorite = contains(Card);
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field pet = linksTo(Pet);
    }
    await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${realmURL}Pet/mango`,
            },
            data: {
              id: `${realmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${realmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
            favorite: {
              description: 'Toilet paper ghost: Poooo!',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Pet',
            },
            fields: {
              favorite: {
                adoptsFrom: {
                  module: `${realmURL}test-cards`,
                  name: 'Toy',
                },
              },
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined
    );

    assert.ok(card instanceof Person, 'card is an instance of person');
    assert.strictEqual(card.firstName, 'Hassan');
    let { pet } = card;
    if (pet instanceof Pet) {
      assert.strictEqual(isSaved(pet), true, 'Pet card is saved');
      assert.strictEqual(pet.firstName, 'Mango');
      let { favorite } = pet;
      if (favorite instanceof Toy) {
        assert.strictEqual(favorite.description, 'Toilet paper ghost: Poooo!');
      } else {
        assert.ok(false, '"favorite" field value is not an instance of Toy');
      }
    } else {
      assert.ok(false, '"pet" field value is not an instance of Pet');
    }
  });

  test('can deserialize a card from a resource object', async function (assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } =
      cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    await shimModule(`${realmURL}person`, { Person });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: './person',
            name: 'Person',
          },
        },
      },
    };
    let person = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      new URL(realmURL)
    );
    assert.strictEqual(person.firstName, 'Mango');
    assert.deepEqual(
      serializeCard(person, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `./person`,
              name: 'Person',
            },
          },
        },
      },
      'card serialization is correct'
    );
  });

  test('can deserialize a card from a resource object with composite fields', async function (assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } =
      cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    await shimModule(`${realmURL}person`, { Person });
    await shimModule(`${realmURL}post`, { Post });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          title: 'Things I Want to Chew',
          author: {
            firstName: 'Mango',
          },
        },
        meta: {
          adoptsFrom: {
            module: './post',
            name: 'Post',
          },
        },
      },
    };
    let post = await createFromSerialized<typeof Post>(
      doc.data,
      doc,
      new URL(realmURL)
    );
    assert.strictEqual(post.title, 'Things I Want to Chew');
    assert.strictEqual(post.author.firstName, 'Mango');
    assert.deepEqual(
      serializeCard(post, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'Things I Want to Chew',
            author: {
              firstName: 'Mango',
            },
          },
          meta: {
            adoptsFrom: {
              module: `./post`,
              name: 'Post',
            },
          },
        },
      },
      'card serialization is correct'
    );
  });

  test('can deserialize a card with contains many of a compound card field', async function (assert) {
    let {
      field,
      contains,
      containsMany,
      serializeCard,
      Card,
      createFromSerialized,
    } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }
    class Blog extends Card {
      @field posts = containsMany(Post);
      @field _metadata = contains(StringCard, {
        computeVia: function (this: Blog) {
          return 'Blog';
        },
      });
    }
    await shimModule(`${realmURL}person`, { Person });
    await shimModule(`${realmURL}post`, { Post });
    await shimModule(`${realmURL}blog`, { Blog });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          posts: [
            {
              title: 'Things I Want to Chew',
              author: {
                firstName: 'Mango',
              },
            },
            {
              title: 'When Mango Steals My Bone',
              author: {
                firstName: 'Van Gogh',
              },
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: './blog',
            name: 'Blog',
          },
        },
      },
    };
    let blog = await createFromSerialized<typeof Blog>(
      doc.data,
      doc,
      new URL(realmURL)
    );
    let posts = blog.posts;
    assert.strictEqual(posts.length, 2, 'number of posts is correct');
    assert.strictEqual(posts[0].title, 'Things I Want to Chew');
    assert.strictEqual(posts[0].author.firstName, 'Mango');
    assert.strictEqual(posts[1].title, 'When Mango Steals My Bone');
    assert.strictEqual(posts[1].author.firstName, 'Van Gogh');

    assert.deepEqual(
      serializeCard(blog, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            posts: [
              {
                title: 'Things I Want to Chew',
                author: {
                  firstName: 'Mango',
                },
              },
              {
                title: 'When Mango Steals My Bone',
                author: {
                  firstName: 'Van Gogh',
                },
              },
            ],
            title: null,
          },
          meta: {
            adoptsFrom: {
              module: `./blog`,
              name: 'Blog',
            },
          },
        },
      },
      'card serialization is correct'
    );
  });

  test('can serialize a card with computed field', async function (assert) {
    let { field, contains, serializeCard, Card } = cardApi;
    let { default: DateCard } = date;
    let { default: StringCard } = string;
    class Person extends Card {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard, {
        computeVia: function (this: Person) {
          return new Date(
            this.birthdate.getFullYear() + 1,
            this.birthdate.getMonth(),
            this.birthdate.getDate()
          );
        },
      });
      @field title = contains(StringCard, {
        computeVia: function (this: Person) {
          return 'Person';
        },
      });
    }
    await shimModule(`${realmURL}test-cards`, { Person });

    let mango = new Person({ birthdate: p('2019-10-30') });
    await renderCard(mango, 'isolated');
    let withoutComputeds = serializeCard(mango, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(withoutComputeds, {
      data: {
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });

    let withComputeds = serializeCard(mango, {
      includeComputeds: true,
      includeUnrenderedFields: true,
    });
    assert.deepEqual(withComputeds, {
      data: {
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
          firstBirthday: '2020-10-30',
          title: 'Person',
        },
        meta: {
          adoptsFrom: {
            module: `${realmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  module('linksToMany', function () {
    test('can serialize a linksToMany relationship', async function (assert) {
      let { field, contains, linksToMany, Card, serializeCard } = cardApi;
      let { default: StringCard } = string;

      class Pet extends Card {
        @field firstName = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet });

      let mango = new Pet({
        firstName: 'Mango',
      });
      let vanGogh = new Pet({
        firstName: 'Van Gogh',
      });
      let hassan = new Person({
        firstName: 'Hassan',
        pets: [mango, vanGogh],
      });

      await saveCard(mango, `${realmURL}Pet/mango`);
      await saveCard(vanGogh, `${realmURL}Pet/vanGogh`);

      let serialized = serializeCard(hassan);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            'pets.0': {
              links: {
                self: `${realmURL}Pet/mango`,
              },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
            'pets.1': {
              links: {
                self: `${realmURL}Pet/vanGogh`,
              },
              data: { id: `${realmURL}Pet/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${realmURL}Pet/vanGogh`,
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });
    });

    test('can deserialize a linksToMany relationship', async function (assert) {
      let {
        field,
        contains,
        linksToMany,
        Card,
        createFromSerialized,
        relationshipMeta,
        isSaved,
      } = cardApi;
      let { default: StringCard } = string;

      class Pet extends Card {
        @field firstName = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            'pets.0': {
              links: {
                self: `${realmURL}Pet/mango`,
              },
            },
            'pets.1': {
              links: {
                self: `${realmURL}Pet/vanGogh`,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${realmURL}Pet/vanGogh`,
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      assert.ok(card instanceof Person, 'card is an instance of person');
      assert.strictEqual(card.firstName, 'Hassan');

      let { pets } = card;
      assert.ok(Array.isArray(pets), 'pets is an array');
      assert.strictEqual(pets.length, 2, 'pets has 2 items');
      let [mango, vanGogh] = pets;
      if (mango instanceof Pet) {
        assert.strictEqual(isSaved(mango), true, 'Pet[0] card is saved');
        assert.strictEqual(mango.firstName, 'Mango');
      } else {
        assert.ok(false, '"pets[0]" is not an instance of Pet');
      }
      if (vanGogh instanceof Pet) {
        assert.strictEqual(isSaved(vanGogh), true, 'Pet[1] card is saved');
        assert.strictEqual(vanGogh.firstName, 'Van Gogh');
      } else {
        assert.ok(false, '"pets[1]" is not an instance of Pet');
      }

      let relationships = relationshipMeta(card, 'pets');
      if (relationships !== undefined && Array.isArray(relationships)) {
        let [mangoRelationship, vanGoghRelationship] = relationships;

        if (mangoRelationship?.type === 'loaded') {
          let relatedCard = mangoRelationship.card;
          assert.strictEqual(
            relatedCard instanceof Pet,
            true,
            'related card is a Pet'
          );
          assert.strictEqual(relatedCard?.id, `${realmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for mango');
        }
        if (vanGoghRelationship?.type === 'loaded') {
          let relatedCard = vanGoghRelationship.card;
          assert.strictEqual(
            relatedCard instanceof Pet,
            true,
            'related card is a Pet'
          );
          assert.strictEqual(relatedCard?.id, `${realmURL}Pet/vanGogh`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for vanGogh');
        }
        assert.strictEqual(
          relationshipMeta(card, 'firstName'),
          undefined,
          'relationshipMeta returns undefined for non-relationship field'
        );
      } else {
        assert.ok(false, 'relationshipMeta returned an unexpected value');
      }
    });

    test('can serialize a linkstoMany relationship with nested linksTo field', async function (assert) {
      let {
        field,
        contains,
        linksToMany,
        linksTo,
        Card,
        serializeCard,
        createFromSerialized,
      } = cardApi;
      let { default: StringCard } = string;

      class Toy extends Card {
        @field description = contains(StringCard);
      }
      class Pet extends Card {
        @field firstName = contains(StringCard);
        @field favoriteToy = linksTo(Toy);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet, Toy });

      let spookyToiletPaper = new Toy({
        description: 'Toilet paper ghost: Poooo!',
      });
      let mango = new Pet({
        firstName: 'Mango',
        favoriteToy: spookyToiletPaper,
      });
      let hassan = new Person({
        firstName: 'Hassan',
        pets: [mango],
      });

      await saveCard(spookyToiletPaper, `${realmURL}Toy/spookyToiletPaper`);
      await saveCard(mango, `${realmURL}Pet/mango`);

      let serialized = serializeCard(hassan);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            'pets.0': {
              links: {
                self: `${realmURL}Pet/mango`,
              },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Toy/spookyToiletPaper`,
            type: 'card',
            attributes: { description: 'Toilet paper ghost: Poooo!' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Toy' },
            },
          },
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            relationships: {
              favoriteToy: {
                links: {
                  self: `${realmURL}Toy/spookyToiletPaper`,
                },
                data: {
                  id: `${realmURL}Toy/spookyToiletPaper`,
                  type: 'card',
                },
              },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });

      let card = await createFromSerialized(
        serialized.data,
        serialized,
        undefined
      );
      if (card instanceof Person) {
        assert.strictEqual(card.firstName, 'Hassan');
        let { pets } = card;
        if (Array.isArray(pets)) {
          assert.strictEqual(pets.length, 1, 'correct number of pets');
          let [pet] = pets;
          if (pet instanceof Pet) {
            assert.strictEqual(pet.firstName, 'Mango');
            let { favoriteToy } = pet;
            if (favoriteToy instanceof Toy) {
              assert.strictEqual(
                favoriteToy.description,
                'Toilet paper ghost: Poooo!'
              );
            } else {
              assert.ok(false, 'card is not instance of Toy');
            }
          } else {
            assert.ok(false, 'card is not instance of Pet');
          }
        } else {
          assert.ok(false, 'Person.pets is not an array');
        }
      } else {
        assert.ok(false, 'card is not instance of Person');
      }
    });

    test('can serialize an empty linksToMany relationship', async function (assert) {
      let { field, contains, linksToMany, Card, serializeCard } = cardApi;
      let { default: StringCard } = string;

      class Pet extends Card {
        @field firstName = contains(StringCard);
        @field title = contains(StringCard, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
        @field title = contains(StringCard, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet });

      let hassan = new Person({ firstName: 'Hassan' });

      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      });

      let mango = new Person({ firstName: 'Mango', pets: null });
      serialized = serializeCard(mango);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Mango' },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty linksToMany relationship', async function (assert) {
      let { field, contains, linksToMany, Card, createFromSerialized } =
        cardApi;
      let { default: StringCard } = string;

      class Pet extends Card {
        @field firstName = contains(StringCard);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet });

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );
      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Hassan');
      assert.deepEqual(card.pets, [], 'relationship is an empty array');
    });

    test('can deserialize a linksToMany relationship that does not include all the related resources', async function (assert) {
      let {
        field,
        contains,
        linksToMany,
        Card,
        createFromSerialized,
        relationshipMeta,
        serializeCard,
      } = cardApi;
      let { default: StringCard } = string;

      class Pet extends Card {
        @field firstName = contains(StringCard);
        @field title = contains(StringCard, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
        @field title = contains(StringCard, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Person, Pet });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            'pets.0': { links: { self: `${realmURL}Pet/mango` } },
            'pets.1': { links: { self: `${realmURL}Pet/vanGogh` } },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let hassan = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      try {
        hassan.pets;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.strictEqual(
          err.message,
          'The field Person.pets refers to the card instance https://test-realm/Pet/vanGogh which is not loaded'
        );
      }

      let relationships = relationshipMeta(hassan, 'pets');
      if (!Array.isArray(relationships)) {
        assert.ok(
          false,
          'relationshipMeta should be an array for linksToMany relationship'
        );
      } else {
        let [mango, vanGogh] = relationships;
        if (mango?.type === 'loaded') {
          assert.strictEqual(mango.card?.id, `${realmURL}Pet/mango`);
        } else {
          assert.ok(
            false,
            `relationship type for ${realmURL}Pet/mango was not "loaded"`
          );
        }
        if (vanGogh?.type === 'not-loaded') {
          assert.strictEqual(vanGogh.reference, `${realmURL}Pet/vanGogh`);
        } else {
          assert.ok(
            false,
            `relationship type for ${realmURL}Pet/vanGogh was not "not-loaded"`
          );
        }
      }

      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Hassan' },
          relationships: {
            'pets.0': {
              links: {
                self: `${realmURL}Pet/mango`,
              },
              data: { type: 'card', id: `${realmURL}Pet/mango` },
            },
            'pets.1': {
              links: {
                self: `${realmURL}Pet/vanGogh`,
              },
              data: { type: 'card', id: `${realmURL}Pet/vanGogh` },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Person',
            },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });
    });

    test('can serialize a linksToMany relationship that points to own card class', async function (assert) {
      let { field, contains, linksToMany, Card, serializeCard } = cardApi;
      let { default: StringCard } = string;

      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friends = linksToMany(() => Person);
        @field title = contains(StringCard, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Person });

      let mango = new Person({ firstName: 'Mango' });
      let vanGogh = new Person({ firstName: 'Van Gogh' });
      let hassan = new Person({
        firstName: 'Hassan',
        friends: [mango, vanGogh],
      });
      await saveCard(mango, `${realmURL}Person/mango`);
      await saveCard(vanGogh, `${realmURL}Person/vanGogh`);
      await saveCard(hassan, `${realmURL}Person/hassan`);
      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          id: `${realmURL}Person/hassan`,
          attributes: { firstName: 'Hassan' },
          relationships: {
            'friends.0': {
              links: { self: `${realmURL}Person/mango` },
              data: { id: `${realmURL}Person/mango`, type: 'card' },
            },
            'friends.1': {
              links: { self: `${realmURL}Person/vanGogh` },
              data: { id: `${realmURL}Person/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Person/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
            },
          },
          {
            id: `${realmURL}Person/vanGogh`,
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
            },
          },
        ],
      });
    });

    test('can deserialize a linksToMany relationship that points to own card class', async function (assert) {
      let {
        field,
        contains,
        linksToMany,
        Card,
        createFromSerialized,
        isSaved,
      } = cardApi;
      let { default: StringCard } = string;

      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friends = linksToMany(() => Person);
        @field title = contains(StringCard, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Person });

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          id: `${realmURL}Person/hassan`,
          attributes: { firstName: 'Hassan' },
          relationships: {
            'friends.0': {
              links: { self: `${realmURL}Person/mango` },
              data: { id: `${realmURL}Person/mango`, type: 'card' },
            },
            'friends.1': {
              links: { self: `${realmURL}Person/vanGogh` },
              data: { id: `${realmURL}Person/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Person/mango`,
            type: 'card',
            attributes: { firstName: 'Mango' },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
            },
          },
          {
            id: `${realmURL}Person/vanGogh`,
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            relationships: {
              'friends.0': {
                links: { self: `${realmURL}Person/hassan` },
                data: { id: `${realmURL}Person/hassan`, type: 'card' },
              },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        new URL(`${realmURL}Person/hassan`)
      );
      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Hassan');

      let [mango, vanGogh] = card.friends;
      assert.ok(mango instanceof Person, `${mango.id} is a Person`);
      assert.ok(isSaved(mango), `${mango.id} is saved`);
      assert.strictEqual(mango.firstName, 'Mango');

      assert.ok(vanGogh instanceof Person, `${vanGogh.id} is a Person`);
      assert.ok(isSaved(vanGogh), `${vanGogh.id} is saved`);
      assert.strictEqual(vanGogh.firstName, 'Van Gogh');

      let [hassan] = vanGogh.friends;
      assert.ok(hassan instanceof Person, `${hassan.id} is a Person`);
      assert.ok(isSaved(hassan), `${hassan.id} is saved`);
      assert.strictEqual(hassan.firstName, 'Hassan');
    });
  });

  module('computed linksToMany', function () {
    test('can serialize a computed linksToMany relationship', async function (assert) {
      let { field, contains, linksTo, linksToMany, serializeCard, Card } =
        cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Friend extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Friend, Person });
      let mango = new Pet({ name: 'Mango' });
      let vanGogh = new Pet({ name: 'Van Gogh' });
      let hassan = new Friend({ firstName: 'Hassan', pets: [mango, vanGogh] });
      await saveCard(mango, `${realmURL}Pet/mango`);
      await saveCard(vanGogh, `${realmURL}Pet/van-gogh`);
      await saveCard(hassan, `${realmURL}Friend/hassan`);
      let burcu = new Person({ firstName: 'Burcu', friend: hassan });
      let serialized = serializeCard(burcu, {
        includeComputeds: true,
        includeUnrenderedFields: true,
      });
      assert.deepEqual(serialized.data, {
        type: 'card',
        attributes: { firstName: 'Burcu', title: null },
        relationships: {
          friend: {
            links: { self: `${realmURL}Friend/hassan` },
            data: { id: `${realmURL}Friend/hassan`, type: 'card' },
          },
          'friendPets.0': {
            links: { self: `${realmURL}Pet/mango` },
            data: { id: `${realmURL}Pet/mango`, type: 'card' },
          },
          'friendPets.1': {
            links: { self: `${realmURL}Pet/van-gogh` },
            data: { id: `${realmURL}Pet/van-gogh`, type: 'card' },
          },
        },
        meta: {
          adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
        },
      });

      assert.deepEqual(serialized.included, [
        {
          id: `${realmURL}Pet/mango`,
          type: 'card',
          attributes: { name: 'Mango', title: null },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${realmURL}Pet/van-gogh`,
          type: 'card',
          attributes: { name: 'Van Gogh', title: null },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${realmURL}Friend/hassan`,
          type: 'card',
          attributes: { firstName: 'Hassan', title: null },
          relationships: {
            'pets.0': {
              links: { self: `${realmURL}Pet/mango` },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
            'pets.1': {
              links: { self: `${realmURL}Pet/van-gogh` },
              data: { id: `${realmURL}Pet/van-gogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Friend' },
          },
        },
      ]);
    });

    test('can deserialize a computed linksToMany relationship', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        linksToMany,
        createFromSerialized,
        Card,
        isSaved,
        relationshipMeta,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Friend extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Friend, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            friend: {
              links: { self: `${realmURL}Friend/hassan` },
              data: { id: `${realmURL}Friend/hassan`, type: 'card' },
            },
            'friendPets.0': {
              links: { self: `${realmURL}Pet/mango` },
              data: { id: `${realmURL}Pet/mango`, type: 'card' },
            },
            'friendPets.1': {
              links: { self: `${realmURL}Pet/van-gogh` },
              data: { id: `${realmURL}Pet/van-gogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango', title: null },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${realmURL}Pet/van-gogh`,
            type: 'card',
            attributes: { name: 'Van Gogh', title: null },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${realmURL}Friend/hassan`,
            type: 'card',
            attributes: { firstName: 'Hassan', title: null },
            relationships: {
              'pets.0': {
                links: { self: `${realmURL}Pet/mango` },
                data: { id: `${realmURL}Pet/mango`, type: 'card' },
              },
              'pets.1': {
                links: { self: `${realmURL}Pet/van-gogh` },
                data: { id: `${realmURL}Pet/van-gogh`, type: 'card' },
              },
            },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Friend' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );
      assert.ok(card instanceof Person, 'card is an instance of person');
      assert.strictEqual(card.firstName, 'Burcu');
      let { friendPets } = card;
      assert.ok(Array.isArray(friendPets), 'pets is an array');
      assert.strictEqual(friendPets.length, 2, 'pets has 2 items');
      let [mango, vanGogh] = friendPets;
      if (mango instanceof Pet) {
        assert.strictEqual(isSaved(mango), true, 'Pet[0] card is saved');
        assert.strictEqual(mango.name, 'Mango');
      } else {
        assert.ok(false, '"pets[0]" is not an instance of Pet');
      }
      if (vanGogh instanceof Pet) {
        assert.strictEqual(isSaved(vanGogh), true, 'Pet[1] card is saved');
        assert.strictEqual(vanGogh.name, 'Van Gogh');
      } else {
        assert.ok(false, '"pets[1]" is not an instance of Pet');
      }

      let relationship = relationshipMeta(card, 'friendPets');
      assert.deepEqual(relationship, [
        { type: 'loaded', card: mango },
        { type: 'loaded', card: vanGogh },
      ]);
    });

    test('can serialize an empty computed linksToMany relationship', async function (assert) {
      let { field, contains, linksTo, linksToMany, serializeCard, Card } =
        cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Friend extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Friend, Person });
      let person = new Person({ firstName: 'Burcu' });
      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            friend: { links: { self: null } },
            friendPets: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty computed linksToMany relationship', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        linksToMany,
        createFromSerialized,
        Card,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Friend extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Friend, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            friend: { links: { self: null } },
            friendPets: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Burcu');
      assert.deepEqual(card.friendPets, [], 'relationship is an empty array');
    });

    test('can deserialize a computed linksToMany relationship that does not include all the related resources', async function (assert) {
      let {
        field,
        contains,
        linksTo,
        linksToMany,
        Card,
        createFromSerialized,
        relationshipMeta,
        serializeCard,
      } = cardApi;
      let { default: StringCard } = string;
      class Pet extends Card {
        @field name = contains(StringCard);
      }
      class Friend extends Card {
        @field firstName = contains(StringCard);
        @field pets = linksToMany(Pet);
      }
      class Person extends Card {
        @field firstName = contains(StringCard);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await shimModule(`${realmURL}test-cards`, { Pet, Friend, Person });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            friend: { links: { self: `${realmURL}Friend/hassan` } },
            'friendPets.0': { links: { self: `${realmURL}Pet/mango` } },
            'friendPets.1': { links: { self: `${realmURL}Pet/vanGogh` } },
          },
          meta: {
            adoptsFrom: { module: `${realmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${realmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango' },
            meta: {
              adoptsFrom: { module: `${realmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined
      );

      try {
        card.friend;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.ok(
          err.message.match(
            /The field Person\.friend refers to the card instance https:\/\/test-realm\/Friend\/hassan which is not loaded/,
            'NotLoaded error describes field not loaded'
          )
        );
      }

      try {
        card.friendPets;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.ok(
          err.message.match(
            /The field Person\.friendPets refers to the card instance https:\/\/test-realm\/Pet\/vanGogh which is not loaded/,
            'NotLoaded error describes field not loaded'
          )
        );
      }

      let relationships = relationshipMeta(card, 'friendPets');
      if (!Array.isArray(relationships)) {
        assert.ok(false, 'relationshipMeta should be an array');
      } else {
        let [mango, vanGogh] = relationships;
        if (mango?.type === 'loaded') {
          assert.strictEqual(mango.card?.id, `${realmURL}Pet/mango`);
        } else {
          assert.ok(
            false,
            `relationship type for ${realmURL}Pet/mango was not "loaded"`
          );
        }
        if (vanGogh?.type === 'not-loaded') {
          assert.strictEqual(vanGogh.reference, `${realmURL}Pet/vanGogh`);
        } else {
          assert.ok(
            false,
            `relationship type for ${realmURL}Pet/vanGogh was not "not-loaded"`
          );
        }
      }

      let serialized = serializeCard(card, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized.data.relationships, {
        friend: { links: { self: 'https://test-realm/Friend/hassan' } },
        'friendPets.0': {
          links: { self: `${realmURL}Pet/mango` },
          data: { type: 'card', id: `${realmURL}Pet/mango` },
        },
        'friendPets.1': {
          links: { self: `${realmURL}Pet/vanGogh` },
          data: { type: 'card', id: `${realmURL}Pet/vanGogh` },
        },
      });
    });
  });

  module('base cards', function () {
    // this module checks the custom serialization and deserialization behaviour of base cards
    // which have custom serialize and deserialize

    module('BigIntegerCard', function () {
      function isBigInt(input: any) {
        return typeof input == 'bigint';
      }
      test('can deserialize field', async function (assert) {
        let { field, contains, Card, createFromSerialized } = cardApi;
        let { default: StringCard } = string;
        let { default: BigIntegerCard } = bigInteger;
        class Sample extends Card {
          @field title = contains(StringCard);
          @field someBigInt = contains(BigIntegerCard);
          @field someNull = contains(BigIntegerCard);
          @field someString = contains(BigIntegerCard);
          @field someNumber = contains(BigIntegerCard);
          @field someNegativeNumber = contains(BigIntegerCard);
          @field someDecimal = contains(BigIntegerCard);
          @field someZeroString = contains(BigIntegerCard);
        }
        await shimModule(`${realmURL}test-cards`, { Sample });

        let resource = {
          attributes: {
            title: 'BigInt Test Cases',
            someBigInt: '9223372036854775808',
            someNull: null,
            someString: 'some text',
            someNumber: 42,
            someDecimal: 0.0001,
            someNegativeNumber: -42,
            someZeroString: '0',
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Sample',
            },
          },
        };
        let sample = await createFromSerialized<typeof Sample>(
          resource,
          { data: resource },
          undefined
        );

        assert.strictEqual(isBigInt(sample.someBigInt), true);
        assert.strictEqual(isBigInt(sample.someNumber), true);
        assert.strictEqual(isBigInt(sample.someNegativeNumber), true);
        assert.strictEqual(isBigInt(sample.someZeroString), true);

        // failed to deserialize
        assert.strictEqual(sample.someNull, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.someDecimal, null);
      });

      test('can serialize field', async function (assert) {
        let { field, contains, Card, serializeCard } = cardApi;
        let { default: StringCard } = string;
        let { default: BigIntegerCard } = bigInteger;
        class Sample extends Card {
          @field title = contains(StringCard);
          @field someBigInt = contains(BigIntegerCard);
          @field someNull = contains(BigIntegerCard);
        }

        await shimModule(`${realmURL}test-cards`, { Sample });

        let sample = new Sample({
          someBigInt: BigInt('9223372036854775808'),
          someNull: null,
        });

        let serialized = serializeCard(sample, {
          includeUnrenderedFields: true,
        });

        assert.strictEqual(
          typeof serialized?.data?.attributes?.someBigInt === 'string',
          true
        );
        assert.strictEqual(
          typeof serialized?.data?.attributes?.someBigInt !== 'number',
          true
        );
        assert.strictEqual(
          serialized?.data?.attributes?.someBigInt,
          '9223372036854775808'
        );
        assert.strictEqual(serialized?.data?.attributes?.someNull, null);
      });

      test('queryable value', async function (assert) {
        let { getQueryableValue } = cardApi;
        let { default: BigIntegerCard } = bigInteger;
        assert.strictEqual(
          getQueryableValue(BigIntegerCard, BigInt('9223372036854775808')),
          '9223372036854775808'
        );
        assert.strictEqual(getQueryableValue(BigIntegerCard, null), undefined);
        assert.strictEqual(
          getQueryableValue(BigIntegerCard, undefined),
          undefined
        );
      });

      test('can perform bigint operations with computed', async function (assert) {
        let { field, contains, Card, serializeCard } = cardApi;
        let { default: StringCard } = string;
        let { default: BigIntegerCard } = bigInteger;

        class Sample extends Card {
          @field title = contains(StringCard);
          @field someBigInt = contains(BigIntegerCard);
          @field anotherBigInt = contains(BigIntegerCard);
          @field someNull = contains(BigIntegerCard);
          @field someComputed = contains(BigIntegerCard, {
            computeVia: function (this: Sample) {
              return this.someBigInt + this.anotherBigInt;
            },
          });
          //TODO: This doesn't seem to work
          // Promise rejected during "can perform bigint operations with computed": Cannot mix BigInt and other types, use explicit conversions
          // @field someComputedWithNull = contains(BigIntegerCard, {
          //   computeVia: function (this: Sample) {
          //     return this.someBigInt + this.someNull;
          //   },
          // });
        }
        await shimModule(`${realmURL}test-cards`, { Sample });

        let sample = new Sample({
          someBigInt: BigInt('1'),
          anotherBigInt: BigInt('2'),
          someNull: null,
        });

        let serialized = serializeCard(sample, {
          includeComputeds: true,
          includeUnrenderedFields: true,
        });

        assert.strictEqual(
          serialized?.data?.attributes?.someComputed,
          (BigInt('1') + BigInt('2')).toString()
        );
      });
    });

    module('EthereumAddressCard', function () {
      function isEthAddress(address: string): boolean {
        return isAddress(address);
      }
      test('can deserialize field', async function (assert) {
        let { field, contains, Card, createFromSerialized } = cardApi;
        let { default: StringCard } = string;
        let { default: EthereumAddressCard } = ethereumAddress;
        class Sample extends Card {
          @field title = contains(StringCard);
          @field someAddress = contains(EthereumAddressCard);
          @field nonChecksummedAddress = contains(EthereumAddressCard);
          @field checksummedAddressThatDontLookLikeOne =
            contains(EthereumAddressCard);
          @field faultyAddress = contains(EthereumAddressCard);
          @field bitcoinAddress = contains(EthereumAddressCard);
          @field someString = contains(EthereumAddressCard);
          @field someNull = contains(EthereumAddressCard);
        }
        await shimModule(`${realmURL}test-cards`, { Sample });

        let resource = {
          attributes: {
            title: 'Ethereum Test Cases',
            someAddress: '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
            checksummedAddressThatDontLookLikeOne:
              '0x27b1fdb04752bbc536007a920d24acb045561c26',
            nonChecksummedAddress: '0x3bc8e82b5856b2f2bdc7f6693f79db9648c0aaaa',
            faultyAddress: '0x159ADe032073d930E85f95AbBAB9995110c43C7', //missing a character
            bitcoinAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
            someString: 'hello world',
            someNull: null,
          },
          meta: {
            adoptsFrom: {
              module: `${realmURL}test-cards`,
              name: 'Sample',
            },
          },
        };
        let sample = await createFromSerialized<typeof Sample>(
          resource,
          { data: resource },
          undefined
        );

        assert.strictEqual(isEthAddress(sample.someAddress), true);
        assert.strictEqual(
          isEthAddress(sample.checksummedAddressThatDontLookLikeOne),
          true
        );

        // failed to deserialize
        assert.strictEqual(sample.faultyAddress, null);
        assert.strictEqual(sample.nonChecksummedAddress, null);
        assert.strictEqual(sample.bitcoinAddress, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.someNull, null);
      });

      test('can serialize field', async function (assert) {
        let { field, contains, Card, serializeCard } = cardApi;
        let { default: StringCard } = string;
        let { default: EthereumAddressCard } = ethereumAddress;
        class Sample extends Card {
          @field title = contains(StringCard);
          @field someAddress = contains(EthereumAddressCard);
          @field nonChecksummedAddress = contains(EthereumAddressCard);
          @field someNull = contains(EthereumAddressCard);
        }

        await shimModule(`${realmURL}test-cards`, { Sample });

        let sample = new Sample({
          someAddress: '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
          nonChecksummedAddress: '0x3bc8e82b5856b2f2bdc7f6693f79db9648c0aaaa',
          someNull: null,
        });

        let serialized = serializeCard(sample, {
          includeUnrenderedFields: true,
        });

        assert.strictEqual(
          typeof serialized?.data?.attributes?.someAddress === 'string',
          true
        );
        assert.strictEqual(
          typeof serialized?.data?.attributes?.someAddress !== 'number',
          true
        );
        assert.strictEqual(
          serialized?.data?.attributes?.someAddress,
          '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b'
        );
        assert.strictEqual(
          serialized?.data?.attributes?.nonChecksummedAddress,
          '0x3bc8e82b5856b2f2bdc7f6693f79db9648c0aaaa'
        );
        assert.strictEqual(serialized?.data?.attributes?.someNull, null);
      });

      test('queryable value', async function (assert) {
        let { getQueryableValue } = cardApi;
        let { default: EthereumAddressCard } = ethereumAddress;
        assert.strictEqual(
          getQueryableValue(
            EthereumAddressCard,
            '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b'
          ),
          '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b'
        );
        assert.strictEqual(
          getQueryableValue(EthereumAddressCard, null),
          undefined
        );
        assert.strictEqual(
          getQueryableValue(EthereumAddressCard, undefined),
          undefined
        );
      });
    });
  });
});
