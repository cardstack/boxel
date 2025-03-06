import { fillIn, RenderingTestContext } from '@ember/test-helpers';

import parseISO from 'date-fns/parseISO';

import { isAddress } from 'ethers';
import { module, test } from 'qunit';

import {
  baseRealm,
  NotLoaded,
  type LooseSingleCardDocument,
  PermissionsContextName,
  type Permissions,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type CardService from '@cardstack/host/services/card-service';

import { type CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  p,
  cleanWhiteSpace,
  setupCardLogs,
  saveCard,
  provideConsumeContext,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  lookupLoaderService,
} from '../../helpers';

import {
  setupBaseRealm,
  contains,
  CardDef,
  Component,
  DateField,
  DatetimeField,
  createFromSerialized,
  serializeCard,
  StringField,
  field,
  NumberField,
  isSaved,
  Base64ImageField,
  updateFromSerialized,
  CodeRefField,
  linksTo,
  relationshipMeta,
  FieldDef,
  containsMany,
  linksToMany,
  recompute,
  BigIntegerField,
  getQueryableValue,
  EthereumAddressField,
} from '../../helpers/base-realm';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { Captain } from '../../cards/captain';

let loader: Loader;

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  hooks.beforeEach(async function () {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);

    loader = lookupLoaderService().loader;
  });
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can deserialize field', async function (assert) {
    class Post extends CardDef {
      @field title = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
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
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    // initialize card data as serialized to force us to deserialize instead of using cached data
    let resource = {
      attributes: {
        title: 'First Post',
        created: '2022-04-22',
        published: '2022-04-27T16:02',
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post',
        },
      },
    };
    let firstPost = await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    );
    let root = await renderCard(loader, firstPost, 'isolated');

    // the template value 'Apr 22, 2022' can only be realized when the card has
    // correctly deserialized it's static data property
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'First Post created Apr 22, 2022 published Apr 27, 2022, 4:02 PM',
    );
  });

  test('can deserialize a card where the card instance has fields that are not found in the definition', async function (assert) {
    class Item extends CardDef {
      @field priceRenamed = contains(NumberField); // Simulating the scenario where someone renamed the price field to priceRenamed and did not also update the field in the instance data
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.priceRenamed />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Item },
      },
    });

    // initialize card data as serialized to force us to deserialize instead of using cached data
    let resource = {
      attributes: {
        price: 100,
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Item',
        },
      },
    };

    let post = await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    ); // Deserializing should be fault tolerant and not throw an error if the instance data does not match the card definition

    let root = await renderCard(loader, post, 'isolated');

    assert.strictEqual(cleanWhiteSpace(root.textContent!), '');
  });

  test('can deserialize a card that has an ID', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    // deserialize a card with an ID to mark it as "saved"
    let resource = {
      id: `${testRealmURL}Person/mango`,
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person',
        },
      },
    };
    let savedCard = (await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    )) as CardDefType;

    assert.strictEqual(
      savedCard.id,
      `${testRealmURL}Person/mango`,
      'instance id is set',
    );
    assert.strictEqual(
      isSaved(savedCard),
      true,
      'API recognizes card as saved',
    );

    let unsavedCard = new Person();
    assert.strictEqual(
      isSaved(unsavedCard),
      false,
      'API recognizes card as unsaved',
    );
  });

  test('can serialize a card that has an ID', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let mango = new Person({
      id: `${testRealmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.deepEqual(serializeCard(mango, { includeUnrenderedFields: true }), {
      data: {
        id: `${testRealmURL}Person/mango`,
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can omit specified field type from serialized data', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field picture = contains(Base64ImageField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let mango = new Person({
      firstName: 'Mango',
      picture: new Base64ImageField({
        model: 'data:image/png;base64,iVBORw0K',
      }),
    });

    let normalSerialize = serializeCard(mango);
    let serializedWithoutOmittedField = serializeCard(mango, {
      omitFields: [Base64ImageField],
    });

    assert.notDeepEqual(
      normalSerialize,
      serializedWithoutOmittedField,
      'picture field was omitted',
    );

    delete normalSerialize.data.attributes?.picture;

    assert.deepEqual(
      normalSerialize,
      serializedWithoutOmittedField,
      'picture field was omitted',
    );
  });

  test('can update an instance from serialized data', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let card = new Person({
      id: `${testRealmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.strictEqual(isSaved(card), false, 'card is not saved');

    let result = await updateFromSerialized(card, {
      data: {
        id: `${testRealmURL}Person/vanGogh`,
        attributes: {
          firstName: 'Van Gogh',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });

    assert.strictEqual(isSaved(card), true, 'card is saved');
    assert.strictEqual(result, card, 'returns the same instance provided');
    assert.strictEqual(
      card.id,
      `${testRealmURL}Person/vanGogh`,
      'ID can be updated for unsaved instance',
    );
    assert.strictEqual(card.firstName, 'Van Gogh', 'the field can be updated');
  });

  test('throws when updating the id of a saved instance from serialized data', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    // deserialize a card with an ID to mark it as "saved"
    let resource = {
      id: `${testRealmURL}Person/mango`,
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Person',
        },
      },
    };
    let savedCard = await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    );

    try {
      await updateFromSerialized(savedCard, {
        data: {
          id: `${testRealmURL}Person/vanGogh`,
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      });
      throw new Error('expected error not thrown');
    } catch (err: any) {
      assert.ok(
        err.message.match(/cannot change the id for saved instance/),
        'exception thrown when updating the ID of a saved card',
      );
    }
  });

  test('deserialized card ref fields are not strict equal to serialized card ref', async function (assert) {
    class DriverCard extends CardDef {
      @field ref = contains(CodeRefField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-ref><@fields.ref /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { DriverCard },
      },
    });

    let ref = { module: `http://localhost:4202/test/person`, name: 'Person' };
    let resource = {
      attributes: {
        ref,
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'DriverCard',
        },
      },
    };
    let driver = await createFromSerialized<typeof DriverCard>(
      resource,
      { data: resource },
      undefined,
    );
    assert.ok(
      driver.ref !== ref,
      'the card ref value is not strict equals to its serialized counter part',
    );
    assert.deepEqual(
      driver.ref,
      ref,
      'the card ref value is deep equal to its serialized counter part',
    );
  });

  test('serialized card ref fields are not strict equal to their deserialized card ref values', async function (assert) {
    class DriverCard extends CardDef {
      @field ref = contains(CodeRefField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-ref><@fields.ref /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { DriverCard },
      },
    });

    let ref = { module: `http://localhost:4202/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });
    let serializedRef = serializeCard(driver, { includeUnrenderedFields: true })
      .data.attributes?.ref;
    assert.ok(
      serializedRef !== ref,
      'the card ref value is not strict equals to its serialized counter part',
    );
    assert.deepEqual(
      serializedRef,
      ref,
      'the card ref value is deep equal to its serialized counter part',
    );
  });

  test('can serialize field', async function (assert) {
    class Post extends CardDef {
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

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
      '2022-04-27T16:30:00.000Z',
    );
  });

  test('can deserialize a date field with null value', async function (assert) {
    class Post extends CardDef {
      @field title = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
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

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    let resource = {
      attributes: {
        title: 'First Post',
        created: null,
        published: null,
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post',
        },
      },
    };
    let firstPost = await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    );
    let root = await renderCard(loader, firstPost, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'First Post created [no date] published [no date-time]',
    );
  });

  test('can serialize a linksTo relationship', async function (assert) {
    class Toy extends CardDef {
      @field title = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, { computeVia: () => 'Pet' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

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
    await saveCard(
      spookyToiletPaper,
      `${testRealmURL}Toy/spookyToiletPaper`,
      loader,
    );
    await saveCard(mango, `${testRealmURL}Pet/mango`, loader);

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
              self: `${testRealmURL}Pet/mango`,
            },
            data: {
              id: `${testRealmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            favoriteToy: {
              links: {
                self: `${testRealmURL}Toy/spookyToiletPaper`,
              },
              data: {
                id: `${testRealmURL}Toy/spookyToiletPaper`,
                type: 'card',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Pet',
            },
          },
        },
      ],
    });
  });

  test('can deserialize a linksTo relationship', async function (assert) {
    class Toy extends CardDef {
      @field description = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${testRealmURL}Pet/mango`,
            },
            data: {
              id: `${testRealmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            favoriteToy: {
              links: {
                self: `${testRealmURL}Toy/spookyToiletPaper`,
              },
              data: {
                id: `${testRealmURL}Toy/spookyToiletPaper`,
                type: 'card',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Pet',
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
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
          'Toilet paper ghost: Poooo!',
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
        'relationshipMeta should not be an array for linksTo relationship',
      );
    } else {
      if (relationship?.type === 'loaded') {
        let relatedCard = relationship.card;
        assert.strictEqual(
          relatedCard instanceof Pet,
          true,
          'related card is a Pet',
        );
        assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/mango`);
      } else {
        assert.ok(false, 'relationship type was not "loaded"');
      }
    }

    assert.strictEqual(
      relationshipMeta(card, 'firstName'),
      undefined,
      'relationshipMeta returns undefined for non-relationship field',
    );
  });

  test('can deserialize a linksTo relationship that does not include all the related resources', async function (assert) {
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, { computeVia: () => 'Pet' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${testRealmURL}Pet/mango`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    };
    let hassan = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );

    try {
      hassan.pet;
      throw new Error(`expected error not thrown`);
    } catch (err: any) {
      assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
      assert.strictEqual(
        'The field Person.pet refers to the card instance http://test-realm/test/Pet/mango which is not loaded',
        err.message,
        'NotLoaded error describes field not loaded',
      );
    }

    let relationship = relationshipMeta(hassan, 'pet');
    if (Array.isArray(relationship)) {
      assert.ok(
        false,
        'relationshipMeta should not be an array for linksTo relationship',
      );
    } else {
      if (relationship?.type === 'not-loaded') {
        assert.strictEqual(relationship.reference, `${testRealmURL}Pet/mango`);
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
              self: `${testRealmURL}Pet/mango`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can serialize an empty linksTo relationship', async function (assert) {
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

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
            module: `${testRealmURL}test-cards`,
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
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can deserialize an empty linksTo relationship', async function (assert) {
    class Pet extends CardDef {
      @field firstName = contains(StringField);
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );
    assert.ok(card instanceof Person, 'card is a Person');
    assert.strictEqual(card.firstName, 'Hassan');
    assert.strictEqual(card.pet, null, 'relationship is null');
  });

  test('can deserialize coexisting linksTo, contains, and containsMany fields in a card', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }
    class Toy extends FieldDef {
      @field description = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field owner = linksTo(Person);
      @field favoriteToy = contains(Toy);
      @field toys = containsMany(Toy);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });
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
              self: `${testRealmURL}Person/burcu`,
            },
            data: {
              id: `${testRealmURL}Person/burcu`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Pet',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Person/burcu`,
          type: 'card',
          attributes: {
            firstName: 'Burcu',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
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
    toys.map((toy) => {
      if (!(toy instanceof Toy)) {
        assert.ok(false, '"toys" field value is not an instance of Toy');
      }
    });
    if (favoriteToy instanceof Toy) {
      assert.strictEqual(favoriteToy.description, 'treat ball');
    } else {
      assert.ok(false, '"favoriteToy" field value is not an instance of Toy');
    }

    let relationship = relationshipMeta(card, 'owner');
    if (Array.isArray(relationship)) {
      assert.ok(
        false,
        'relationshipMeta should not be an array for linksTo relationship',
      );
    } else {
      if (relationship?.type === 'loaded') {
        let relatedCard = relationship.card;
        assert.strictEqual(
          relatedCard instanceof Person,
          true,
          'related card is a Person',
        );
        assert.strictEqual(relatedCard?.id, `${testRealmURL}Person/burcu`);
      } else {
        assert.ok(false, 'relationship type was not "loaded"');
      }
    }

    ['firstName', 'toys', 'favoriteToy'].map((fieldName) =>
      assert.strictEqual(
        relationshipMeta(card, fieldName),
        undefined,
        `relationshipMeta returns undefined for non-relationship field ${fieldName}`,
      ),
    );
  });

  test('can serialize a linksTo relationship that points to own card class', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field friend = linksTo(() => Person);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let mango = new Person({ firstName: 'Mango' });
    let hassan = new Person({ firstName: 'Hassan', friend: mango });
    await saveCard(mango, `${testRealmURL}Person/mango`, loader);
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
              self: `${testRealmURL}Person/mango`,
            },
            data: {
              id: `${testRealmURL}Person/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Person/mango`,
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
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    });
  });

  test('can deserialize a linksTo relationship that points to own card class', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field friend = linksTo(() => Person);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          friend: {
            links: {
              self: `${testRealmURL}Person/mango`,
            },
            data: {
              id: `${testRealmURL}Person/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Person/mango`,
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
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    };
    let card = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );
    assert.ok(card instanceof Person, 'card is a Person');
    assert.strictEqual(card.firstName, 'Hassan');
    let { friend } = card;
    assert.ok(friend instanceof Person, 'friend is a Person');
    assert.ok(isSaved(friend), 'card is saved');
    assert.strictEqual(friend.firstName, 'Mango');
  });

  test('throws when serializing a linksTo relationship to an unsaved card', async function (assert) {
    class Pet extends CardDef {
      @field firstName = contains(StringField);
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

    let mango = new Pet({ firstName: 'Mango' });
    let hassan = new Person({ firstName: 'Hassan', pet: mango });

    try {
      serializeCard(hassan, { includeUnrenderedFields: true });
      throw new Error(`expected error not thrown`);
    } catch (err: any) {
      assert.ok(
        err.message.match(
          /field 'pet' cannot be serialized with an unsaved card/,
        ),
        'cannot serialize a linksTo relationship to an unsaved card',
      );
    }
  });

  test('can serialize a contains field that has a nested linksTo field', async function (assert) {
    class Toy extends CardDef {
      @field title = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, { computeVia: () => 'Pet' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = contains(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

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
    await saveCard(
      spookyToiletPaper,
      `${testRealmURL}Toy/spookyToiletPaper`,
      loader,
    );
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
              self: `${testRealmURL}Toy/spookyToiletPaper`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}Toy/spookyToiletPaper`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
      ],
    });

    let card = await createFromSerialized(
      serialized.data,
      serialized,
      undefined,
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
            'Toilet paper ghost: Poooo!',
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

  test('can serialize a contains field that only has a nested linksTo field', async function (assert) {
    class Toy extends CardDef {
      @field title = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Pet extends FieldDef {
      @field favoriteToy = linksTo(Toy);
      @field description = contains(StringField, { computeVia: () => 'Pet' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = contains(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      description: 'Toilet paper ghost: Poooo!',
    });
    let mango = new Pet({
      favoriteToy: spookyToiletPaper,
    });
    let hassan = new Person({
      firstName: 'Hassan',
      pet: mango,
    });
    await saveCard(
      spookyToiletPaper,
      `${testRealmURL}Toy/spookyToiletPaper`,
      loader,
    );
    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          pet: {},
        },
        relationships: {
          'pet.favoriteToy': {
            links: {
              self: `${testRealmURL}Toy/spookyToiletPaper`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}Toy/spookyToiletPaper`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
      ],
    });

    let card = await createFromSerialized(
      serialized.data,
      serialized,
      undefined,
    );
    if (card instanceof Person) {
      assert.strictEqual(card.firstName, 'Hassan');
      let { pet } = card;
      if (pet instanceof Pet) {
        let { favoriteToy } = pet;
        if (favoriteToy instanceof Toy) {
          assert.strictEqual(
            favoriteToy.description,
            'Toilet paper ghost: Poooo!',
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
    class Toy extends CardDef {
      @field description = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, { computeVia: () => 'Pet' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pets = containsMany(Pet);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

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
    await saveCard(
      spookyToiletPaper,
      `${testRealmURL}Toy/spookyToiletPaper`,
      loader,
    );
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
              self: `${testRealmURL}Toy/spookyToiletPaper`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}Toy/spookyToiletPaper`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Toy/spookyToiletPaper`,
          type: 'card',
          attributes: {
            description: 'Toilet paper ghost: Poooo!',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
      ],
    });

    let card = await createFromSerialized(
      serialized.data,
      serialized,
      undefined,
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
              'Toilet paper ghost: Poooo!',
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
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field parent = linksTo(() => Person);
      @field favorite = linksTo(() => Person);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        id: `${testRealmURL}Person/mango`,
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          parent: {
            links: {
              self: `${testRealmURL}Person/hassan`,
            },
          },
          favorite: {
            links: {
              self: `${testRealmURL}Person/hassan`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Person/hassan`,
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
      ],
    };
    let mango = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );
    if (mango instanceof Person) {
      let { parent, favorite } = mango;
      assert.strictEqual(
        parent,
        favorite,
        'relationship values share object equality',
      );
      parent.firstName = 'Mariko';
      assert.strictEqual(
        favorite.firstName,
        'Mariko',
        'instances that have object equality can be mutated',
      );
    } else {
      assert.ok(false, 'mango is not a Person');
    }
  });

  test('can serialize a date field with null value', async function (assert) {
    class Post extends CardDef {
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    let firstPost = new Post({ created: null, published: null });
    let serialized = serializeCard(firstPost, {
      includeUnrenderedFields: true,
    });
    assert.strictEqual(serialized.data.attributes?.created, null);
    assert.strictEqual(serialized.data.attributes?.published, null);
  });

  test('can deserialize a nested field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field lastLogin = contains(DatetimeField);
    }

    class Post extends CardDef {
      @field title = contains(StringField);
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

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    };
    let firstPost = await createFromSerialized<typeof Post>(
      doc.data,
      doc,
      undefined,
    );
    let root = await renderCard(loader, firstPost, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'birthdate Oct 30, 2019 last login Apr 27, 2022, 4:58 PM',
    );
  });

  test('can deserialize a composite field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field lastLogin = contains(DatetimeField);
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

    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.author />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    };
    let firstPost = await createFromSerialized<typeof Post>(
      doc.data,
      doc,
      undefined,
    );
    await renderCard(loader, firstPost, 'isolated');
    assert
      .dom('[data-test]')
      .hasText(
        'Mango born on: Oct 30, 2019 last logged in: Apr 27, 2022, 5:00 PM',
      );
  });

  test('can serialize a composite field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field lastLogin = contains(DatetimeField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    class Post extends CardDef {
      @field author = contains(Person);
      @field title = contains(StringField, {
        computeVia: function (this: Post) {
          return this.author?.title ?? 'Post';
        },
      });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let firstPost = new Post({
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        lastLogin: parseISO('2022-04-27T16:30+00:00'),
      }),
      description: 'Post by Mango',
      thumbnailURL: './post.jpg',
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
      description: 'Post by Mango',
      thumbnailURL: './post.jpg',
    });
    // this means the field card for the value is the same as the field's card
    assert.deepEqual(serialized.data.meta.fields, undefined);
  });

  test('can serialize a polymorphic composite field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field lastLogin = contains(DatetimeField);
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Employee, Person, Post },
      },
    });

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
        module: `${testRealmURL}test-cards`,
        name: 'Employee',
      },
    });
  });

  test('can serialize a composite field that has been edited', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.firstName />
        </template>
      };
    }

    class Post extends CardDef {
      @field title = contains(StringField);
      @field reviews = contains(NumberField);
      @field author = contains(Person);
      @field description = contains(StringField, { computeVia: () => 'Post' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
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
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let helloWorld = new Post({
      title: 'First Post',
      reviews: 1,
      author: new Person({
        firstName: 'Arthur',
      }),
    });
    await renderCard(loader, helloWorld, 'edit');
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
              module: `${testRealmURL}test-cards`,
              name: 'Post',
            },
          },
        },
      },
    );
  });

  test('can serialize a computed field', async function (assert) {
    class Person extends CardDef {
      @field birthdate = contains(DateField);
      @field firstBirthday = contains(DateField, {
        computeVia: function (this: Person) {
          return new Date(
            this.birthdate.getFullYear() + 1,
            this.birthdate.getMonth(),
            this.birthdate.getDate(),
          );
        },
      });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });
    let mango = new Person({ birthdate: p('2019-10-30') });
    let serialized = serializeCard(mango, {
      includeComputeds: true,
      includeUnrenderedFields: true,
    });
    assert.strictEqual(serialized.data.attributes?.firstBirthday, '2020-10-30');
  });

  module('computed linksTo', function () {
    test('can serialize a computed linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
        @field description = contains(StringField, { computeVia: () => 'Pet' });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => '../pet.svg',
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
        @field description = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => '../../person.svg',
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let mango = new Pet({ name: 'Mango' });
      let hassan = new Person({ firstName: 'Hassan', pet: mango });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(hassan, `${testRealmURL}Person/hassan`, loader);
      let burcu = new Person({ firstName: 'Burcu', friend: hassan });
      let serialized = serializeCard(burcu, {
        includeComputeds: true,
        includeUnrenderedFields: true,
      });
      assert.deepEqual(serialized.data, {
        type: 'card',
        attributes: {
          firstName: 'Burcu',
          title: null,
          description: 'Person',
          thumbnailURL: '../../person.svg',
        },
        relationships: {
          pet: { links: { self: null } },
          friend: {
            links: { self: `${testRealmURL}Person/hassan` },
            data: { id: `${testRealmURL}Person/hassan`, type: 'card' },
          },
          friendPet: {
            links: { self: `${testRealmURL}Pet/mango` },
            data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
          },
        },
        meta: {
          adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
        },
      });

      assert.deepEqual(serialized.included, [
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          attributes: {
            name: 'Mango',
            title: null,
            description: 'Pet',
            thumbnailURL: '../pet.svg',
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${testRealmURL}Person/hassan`,
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            title: null,
            description: 'Person',
            thumbnailURL: '../../person.svg',
          },
          relationships: {
            pet: {
              links: { self: `${testRealmURL}Pet/mango` },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
            friend: { links: { self: null } },
            friendPet: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      ]);
    });

    test('can deserialize a computed linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            pet: { links: { self: null } },
            friend: {
              links: { self: `${testRealmURL}Person/hassan` },
              data: { id: `${testRealmURL}Person/hassan`, type: 'card' },
            },
            friendPet: {
              links: { self: `${testRealmURL}Pet/mango` },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango' },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Person/hassan`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Hassan',
              thumbnailURL: null,
            },
            relationships: {
              pet: {
                links: { self: `${testRealmURL}Pet/mango` },
                data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
              },
              friend: { links: { self: null } },
              friendPet: { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Person',
              },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
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
          'relationshipMeta should not be an array for linksTo relationship',
        );
      } else {
        if (relationship?.type === 'loaded') {
          let relatedCard = relationship.card;
          assert.strictEqual(
            relatedCard instanceof Pet,
            true,
            'related card is a Pet',
          );
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded"');
        }
      }
    });

    test('can serialize an empty computed linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let person = new Person({ firstName: 'Burcu' });
      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Burcu',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          relationships: {
            pet: { links: { self: null } },
            friend: { links: { self: null } },
            friendPet: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty computed linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
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
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );
      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Burcu');
      assert.strictEqual(card.friendPet, null, 'relationship is null');

      let relationship = relationshipMeta(card, 'friendPet');
      assert.deepEqual(relationship, { type: 'loaded', card: null });
    });

    test('can deserialize a computed linksTo relationship that does not include all the related resources', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        @field pet = linksTo(Pet);
        @field friendPet = linksTo(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pet;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            pet: { links: { self: null } },
            friend: { links: { self: `${testRealmURL}Person/hassan` } },
            friendPet: { links: { self: `${testRealmURL}Pet/mango` } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );

      try {
        card.friendPet;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.strictEqual(
          `The field Person.friendPet refers to the card instance ${testRealmURL}Pet/mango which is not loaded`,
          err.message,
          'NotLoaded error describes field not loaded',
        );
      }
      let friendRel = relationshipMeta(card, 'friend');
      assert.deepEqual(friendRel, {
        type: 'not-loaded',
        reference: `${testRealmURL}Person/hassan`,
      });

      let friendPetRel = relationshipMeta(card, 'friendPet');
      assert.deepEqual(friendPetRel, {
        type: 'not-loaded',
        reference: `${testRealmURL}Pet/mango`,
      });
    });
  });

  test('can deserialize a containsMany field', async function (assert) {
    class Schedule extends CardDef {
      @field dates = containsMany(DateField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.dates />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Schedule },
      },
    });

    let doc = {
      data: {
        attributes: {
          dates: ['2022-4-1', '2022-4-4'],
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Schedule',
          },
        },
      },
    };
    let classSchedule = await createFromSerialized<typeof Schedule>(
      doc.data,
      doc,
      undefined,
    );
    let root = await renderCard(loader, classSchedule, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'Apr 1, 2022 Apr 4, 2022',
    );
  });

  test("can deserialize a containsMany's nested field", async function (this: RenderingTestContext, assert) {
    class Appointment extends FieldDef {
      @field date = contains(DateField);
      @field location = contains(StringField);
      @field title = contains(StringField);
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
    class Schedule extends CardDef {
      @field appointments = containsMany(Appointment);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.appointments />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Appointment, Schedule },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Schedule',
          },
        },
      },
    };
    let classSchedule = await createFromSerialized<typeof Schedule>(
      doc.data,
      doc,
      undefined,
    );
    await renderCard(loader, classSchedule, 'isolated');
    assert.deepEqual(
      [...this.element.querySelectorAll('[data-test="appointment"]')].map(
        (element) => cleanWhiteSpace(element.textContent!),
      ),
      [
        'Biology on Apr 1, 2022 at Room 332',
        'Civics on Apr 4, 2022 at Room 102',
      ],
    );
  });

  test('can serialize a containsMany field', async function (assert) {
    class Schedule extends CardDef {
      @field dates = containsMany(DateField);
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Schedule },
      },
    });

    let classSchedule = new Schedule({ dates: [p('2022-4-1'), p('2022-4-4')] });
    assert.deepEqual(
      serializeCard(classSchedule, { includeUnrenderedFields: true }).data
        .attributes?.dates,
      ['2022-04-01', '2022-04-04'],
    );
  });

  test("can serialize a containsMany's nested field", async function (assert) {
    class Appointment extends FieldDef {
      @field date = contains(DateField);
      @field location = contains(StringField);
      @field title = contains(StringField);
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Schedule extends CardDef {
      @field appointments = containsMany(Appointment);
      @field description = contains(StringField, {
        computeVia: () => 'Schedule',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Appointment, Schedule },
      },
    });

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
    class Post extends CardDef {
      @field title = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    let firstPost = new Post({
      title: 'First Post',
      created: p('2022-04-22'),
      published: parseISO('2022-04-27T16:30+00:00'),
      description: 'Introductory post',
      thumbnailURL: './intro.png',
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
            description: 'Introductory post',
            thumbnailURL: './intro.png',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Post',
            },
          },
        },
      },
      'A model can be serialized once instantiated',
    );
  });

  test('can serialize a card with composite field', async function (assert) {
    class Animal extends FieldDef {
      @field species = contains(StringField);
      @field description = contains(StringField, {
        computeVia: () => 'Animal',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends Animal {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField);
    }
    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, { computeVia: () => 'Post' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Animal, Person, Post },
      },
    });

    let firstPost = new Post({
      title: 'First Post',
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        species: 'canis familiaris',
        description: 'A dog',
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
            description: 'A dog',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
        },
      },
    });
  });

  test('can serialize a card that has a polymorphic field value', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, { computeVia: () => 'Post' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Employee, Person, Post },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
          fields: {
            author: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
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
      new URL(testRealmURL),
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
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field loves = contains(FieldDef);
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, { computeVia: () => 'Post' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Employee, Person, Pet, Post },
      },
    });

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
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
          fields: {
            author: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Employee',
              },
              fields: {
                loves: {
                  adoptsFrom: {
                    module: `${testRealmURL}test-cards`,
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
      new URL(testRealmURL),
    ); // success is not blowing up
    assert.strictEqual(post2.author.firstName, 'Mango');
    assert.strictEqual(post2.author.loves.firstName, 'Van Gogh');
    let { author } = post2;
    assert.ok(author instanceof Employee, 'author is an Employee');
    assert.strictEqual(author.department, 'wagging');

    let { loves } = author;
    assert.ok(loves instanceof Pet, 'author.loves is a Pet');
    assert.strictEqual(loves.firstName, 'Van Gogh');
  });

  test('can serialize a polymorphic containsMany field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Employee) {
          return this.department;
        },
      });
    }

    class Customer extends Person {
      @field billAmount = contains(NumberField);
    }

    class Group extends CardDef {
      @field people = containsMany(Person);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return 'Group';
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'A group of people',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Employee, Customer, Group },
      },
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
            module: `${testRealmURL}test-cards`,
            name: 'Group',
          },
          fields: {
            people: [
              {
                adoptsFrom: {
                  module: `${testRealmURL}test-cards`,
                  name: 'Employee',
                },
              },
              {
                adoptsFrom: {
                  module: `${testRealmURL}test-cards`,
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
      new URL(testRealmURL),
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
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Role extends FieldDef {
      @field roleName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Role) {
          return this.roleName;
        },
      });
      @field description = contains(StringField, { computeVia: () => 'Role' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class DogWalker extends Role {
      @field poopBagCount = contains(NumberField);
    }

    class Employee extends Person {
      @field roles = containsMany(Role);
    }

    class Group extends CardDef {
      @field people = containsMany(Person);
      @field title = contains(StringField, { computeVia: () => 'Group' });
      @field description = contains(StringField, {
        computeVia: () => 'A group of people',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Role, DogWalker, Employee, Group },
      },
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
            module: `${testRealmURL}test-cards`,
            name: 'Group',
          },
          fields: {
            people: [
              {
                adoptsFrom: {
                  module: `${testRealmURL}test-cards`,
                  name: 'Employee',
                },
                fields: {
                  roles: [
                    {},
                    {
                      adoptsFrom: {
                        module: `${testRealmURL}test-cards`,
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
      new URL(testRealmURL),
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
    class Toy extends FieldDef {
      @field description = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field favorite = contains(FieldDef);
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: {
            links: {
              self: `${testRealmURL}Pet/mango`,
            },
            data: {
              id: `${testRealmURL}Pet/mango`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          attributes: {
            firstName: 'Mango',
            favorite: {
              description: 'Toilet paper ghost: Poooo!',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Pet',
            },
            fields: {
              favorite: {
                adoptsFrom: {
                  module: `${testRealmURL}test-cards`,
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
      undefined,
    );

    assert.ok(card instanceof Person, 'card is an instance of person');
    assert.strictEqual(card.firstName, 'Hassan');
    let { pet } = card;
    assert.ok(pet instanceof Pet, '"pet" field value is an instance of Pet');
    assert.strictEqual(isSaved(pet), true, 'Pet card is saved');
    assert.strictEqual(pet.firstName, 'Mango');
    let { favorite } = pet;
    assert.ok(
      favorite instanceof Toy,
      '"favorite" field value is an instance of Toy',
    );
    assert.strictEqual(
      (favorite as Toy).description,
      'Toilet paper ghost: Poooo!',
    );
  });

  test('can deserialize a card from a resource object', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
      },
    });

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
      new URL(testRealmURL),
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
      'card serialization is correct',
    );
  });

  test('can deserialize a card from a resource object with composite fields', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, { computeVia: () => 'Post' });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'post.gts': { Post },
      },
    });

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
      new URL(testRealmURL),
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
      'card serialization is correct',
    );
  });

  test('can deserialize a card with contains many of a compound field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'A person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends FieldDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, {
        computeVia: () => 'A post',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Blog extends CardDef {
      @field posts = containsMany(Post);
      @field _metadata = contains(StringField, { computeVia: () => 'Blog' });
      @field description = contains(StringField, {
        computeVia: () => 'A blog post',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'blog.gts': { Blog },
        'person.gts': { Person },
        'post.gts': { Post },
      },
    });

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
      new URL(testRealmURL),
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
      'card serialization is correct',
    );
  });

  test('can deserialize a card with contains many of a compound field including a linksTo', async function (assert) {
    class Certificate extends CardDef {
      @field earnedOn = contains(DateField);
      @field level = contains(NumberField);
    }

    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field certificate = linksTo(Certificate);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'A person',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends FieldDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      @field description = contains(StringField, {
        computeVia: () => 'A post',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Blog extends CardDef {
      @field posts = containsMany(Post);
      @field _metadata = contains(StringField, { computeVia: () => 'Blog' });
      @field description = contains(StringField, {
        computeVia: () => 'A blog post',
      });
      @field editor = contains(Person);
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Certificate, Person, Post, Blog },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          editor: {
            firstName: 'Bob',
          },
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
        relationships: {
          'editor.certificate': {
            links: {
              self: `${testRealmURL}Certificate/0`,
            },
          },
          'posts.0.author.certificate': {
            links: {
              self: `${testRealmURL}Certificate/1`,
            },
          },
          'posts.1.author.certificate': {
            links: {
              self: `${testRealmURL}Certificate/2`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Blog',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}Certificate/0`,
          type: 'card',
          attributes: {
            level: 25,
            earnedOn: '2022-05-01',
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Certificate',
            },
          },
        },
        {
          id: `${testRealmURL}Certificate/1`,
          type: 'card',
          attributes: {
            level: 20,
            earnedOn: '2023-11-05',
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Certificate',
            },
          },
        },
        {
          id: `${testRealmURL}Certificate/2`,
          type: 'card',
          attributes: {
            level: 18,
            earnedOn: '2023-10-01',
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Certificate',
            },
          },
        },
      ],
    };
    let blog = await createFromSerialized<typeof Blog>(
      doc.data,
      doc,
      new URL(testRealmURL),
    );
    let posts = blog.posts;
    assert.strictEqual(
      blog.editor.certificate.level,
      25,
      'editor certificate is correct',
    );
    assert.strictEqual(posts.length, 2, 'number of posts is correct');
    assert.strictEqual(posts[0].title, 'Things I Want to Chew');
    assert.strictEqual(posts[0].author.firstName, 'Mango');
    assert.strictEqual(posts[0].author.certificate.level, 20);
    assert.strictEqual(posts[1].title, 'When Mango Steals My Bone');
    assert.strictEqual(posts[1].author.firstName, 'Van Gogh');
    assert.strictEqual(posts[1].author.certificate.level, 18);

    assert.deepEqual(
      serializeCard(blog, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            editor: {
              firstName: 'Bob',
            },
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
          relationships: {
            'editor.certificate': {
              data: {
                id: `${testRealmURL}Certificate/0`,
                type: 'card',
              },
              links: {
                self: `${testRealmURL}Certificate/0`,
              },
            },
            'posts.0.author.certificate': {
              data: {
                id: `${testRealmURL}Certificate/1`,
                type: 'card',
              },
              links: {
                self: `${testRealmURL}Certificate/1`,
              },
            },
            'posts.1.author.certificate': {
              data: {
                id: `${testRealmURL}Certificate/2`,
                type: 'card',
              },
              links: {
                self: `${testRealmURL}Certificate/2`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `./test-cards`,
              name: 'Blog',
            },
          },
        },
        included: [
          {
            attributes: {
              description: null,
              earnedOn: '2023-11-05',
              level: 20,
              thumbnailURL: null,
              title: null,
            },
            id: `${testRealmURL}Certificate/1`,
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Certificate',
              },
            },
            type: 'card',
          },
          {
            attributes: {
              description: null,
              earnedOn: '2023-10-01',
              level: 18,
              thumbnailURL: null,
              title: null,
            },
            id: `${testRealmURL}Certificate/2`,
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Certificate',
              },
            },
            type: 'card',
          },
          {
            attributes: {
              description: null,
              earnedOn: '2022-05-01',
              level: 25,
              thumbnailURL: null,
              title: null,
            },
            id: `${testRealmURL}Certificate/0`,
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Certificate',
              },
            },
            type: 'card',
          },
        ],
      },
      'card serialization is correct',
    );
  });

  test('can serialize a card with computed field', async function (assert) {
    class Person extends CardDef {
      @field birthdate = contains(DateField);
      @field firstBirthday = contains(DateField, {
        computeVia: function (this: Person) {
          return new Date(
            this.birthdate.getFullYear() + 1,
            this.birthdate.getMonth(),
            this.birthdate.getDate(),
          );
        },
      });
      @field title = contains(StringField, { computeVia: () => 'Person' });
      @field description = contains(StringField, {
        computeVia: () => 'A person with birthdate',
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let mango = new Person({ birthdate: p('2019-10-30') });
    await renderCard(loader, mango, 'isolated');
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
            module: `${testRealmURL}test-cards`,
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
          description: 'A person with birthdate',
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('Includes non-computed contained fields, even if the fields are unrendered', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field unRenderedField = contains(StringField);

      static isolated = class Embedded extends Component<typeof this> {
        <template>
          <div><@fields.firstName /></div>
        </template>
      };
    }
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });
    let mango = new Person({
      id: `${testRealmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.deepEqual(serializeCard(mango, { includeUnrenderedFields: true }), {
      data: {
        id: `${testRealmURL}Person/mango`,
        type: 'card',
        attributes: {
          firstName: 'Mango',
          unRenderedField: null,
          title: null,
          description: null,
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can serialize a card that is constructed by another card (test realm)', async function (assert) {
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'Captain/mango.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/captain',
                name: 'Captain',
              },
            },
          },
        },
      },
    });

    let cardService = this.owner.lookup('service:card-service') as CardService;
    let captainMango = await cardService.getCard(
      `${testRealmURL}Captain/mango`,
    );
    let mangoTheBoat = (captainMango as Captain).createEponymousBoat();

    assert.deepEqual(
      serializeCard(mangoTheBoat, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            description: null,
            name: 'Mango',
            thumbnailURL: null,
            title: null,
          },
          meta: {
            adoptsFrom: {
              module: `http://localhost:4202/test/captain`,
              name: 'Boat',
            },
          },
        },
      },
    );
  });

  test('can serialize a card that is constructed by another card (shimmed)', async function (assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
    }

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });

      createEponymousPet() {
        return new Pet({ name: this.firstName });
      }
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

    let mangoThePerson = new Person({
      id: `${testRealmURL}Person/mango`,
      firstName: 'Mango',
    });

    let mangoThePet = mangoThePerson.createEponymousPet();

    assert.deepEqual(
      serializeCard(mangoThePet, { includeUnrenderedFields: true }),
      {
        data: {
          type: 'card',
          attributes: {
            description: null,
            name: 'Mango',
            thumbnailURL: null,
            title: null,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Pet',
            },
          },
        },
      },
    );
  });

  module('linksToMany', function () {
    test('can serialize a linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
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

      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);

      let serialized = serializeCard(hassan);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            description: null,
            firstName: 'Hassan',
            thumbnailURL: null,
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
            'pets.1': {
              links: {
                self: `${testRealmURL}Pet/vanGogh`,
              },
              data: { id: `${testRealmURL}Pet/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Mango',
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Van Gogh',
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });
    });

    test('can deserialize a linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            description: null,
            firstName: 'Hassan',
            thumbnailURL: null,
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
            },
            'pets.1': {
              links: {
                self: `${testRealmURL}Pet/vanGogh`,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Mango',
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Van Gogh',
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
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
            'related card is a Pet',
          );
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for mango');
        }
        if (vanGoghRelationship?.type === 'loaded') {
          let relatedCard = vanGoghRelationship.card;
          assert.strictEqual(
            relatedCard instanceof Pet,
            true,
            'related card is a Pet',
          );
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/vanGogh`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for vanGogh');
        }
        assert.strictEqual(
          relationshipMeta(card, 'firstName'),
          undefined,
          'relationshipMeta returns undefined for non-relationship field',
        );
      } else {
        assert.ok(false, 'relationshipMeta returned an unexpected value');
      }
    });

    test('can serialize a linkstoMany relationship with nested linksTo field', async function (assert) {
      class Toy extends CardDef {
        @field description = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Toy) {
            return this.description;
          },
        });
      }
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field favoriteToy = linksTo(Toy);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet, Toy },
        },
      });

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

      await saveCard(
        spookyToiletPaper,
        `${testRealmURL}Toy/spookyToiletPaper`,
        loader,
      );
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);

      let serialized = serializeCard(hassan);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            description: null,
            firstName: 'Hassan',
            thumbnailURL: null,
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Toy/spookyToiletPaper`,
            type: 'card',
            attributes: {
              description: 'Toilet paper ghost: Poooo!',
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Toy' },
            },
          },
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Mango',
              thumbnailURL: null,
            },
            relationships: {
              favoriteToy: {
                links: {
                  self: `${testRealmURL}Toy/spookyToiletPaper`,
                },
                data: {
                  id: `${testRealmURL}Toy/spookyToiletPaper`,
                  type: 'card',
                },
              },
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });

      let card = await createFromSerialized(
        serialized.data,
        serialized,
        undefined,
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
                'Toilet paper ghost: Poooo!',
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
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field description = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });

      let hassan = new Person({ firstName: 'Hassan' });

      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      });

      let mango = new Person({ firstName: 'Mango', pets: null });
      serialized = serializeCard(mango);
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
          },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            description: null,
            firstName: 'Hassan',
            thumbnailURL: null,
          },
          relationships: {
            pets: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );
      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Hassan');
      assert.deepEqual(card.pets, [], 'relationship is an empty array');
    });

    test('can deserialize a linksToMany relationship that does not include all the related resources', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
        @field description = contains(StringField, { computeVia: () => 'Pet' });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => 'pet.svg',
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field description = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          relationships: {
            'pets.0': { links: { self: `${testRealmURL}Pet/mango` } },
            'pets.1': { links: { self: `${testRealmURL}Pet/vanGogh` } },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let hassan = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );

      try {
        hassan.pets;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.strictEqual(
          err.message,
          `The field Person.pets refers to the card instance ${testRealmURL}Pet/vanGogh which is not loaded`,
        );
      }

      let relationships = relationshipMeta(hassan, 'pets');
      if (!Array.isArray(relationships)) {
        assert.ok(
          false,
          'relationshipMeta should be an array for linksToMany relationship',
        );
      } else {
        let [mango, vanGogh] = relationships;
        if (mango?.type === 'loaded') {
          assert.strictEqual(mango.card?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(
            false,
            `relationship type for ${testRealmURL}Pet/mango was not "loaded"`,
          );
        }
        if (vanGogh?.type === 'not-loaded') {
          assert.strictEqual(vanGogh.reference, `${testRealmURL}Pet/vanGogh`);
        } else {
          assert.ok(
            false,
            `relationship type for ${testRealmURL}Pet/vanGogh was not "not-loaded"`,
          );
        }
      }

      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
              data: { type: 'card', id: `${testRealmURL}Pet/mango` },
            },
            'pets.1': {
              links: {
                self: `${testRealmURL}Pet/vanGogh`,
              },
              data: { type: 'card', id: `${testRealmURL}Pet/vanGogh` },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Person',
            },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });
    });

    test('can serialize a linksToMany relationship that points to own card class', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friends = linksToMany(() => Person);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field description = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field thumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person },
        },
      });

      let mango = new Person({ firstName: 'Mango' });
      let vanGogh = new Person({ firstName: 'Van Gogh' });
      let hassan = new Person({
        firstName: 'Hassan',
        friends: [mango, vanGogh],
      });
      await saveCard(mango, `${testRealmURL}Person/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Person/vanGogh`, loader);
      await saveCard(hassan, `${testRealmURL}Person/hassan`, loader);
      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/hassan`,
          attributes: {
            firstName: 'Hassan',
          },
          relationships: {
            'friends.0': {
              links: { self: `./mango` },
              data: { id: `${testRealmURL}Person/mango`, type: 'card' },
            },
            'friends.1': {
              links: { self: `./vanGogh` },
              data: { id: `${testRealmURL}Person/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `../test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Person/mango`,
            type: 'card',
            attributes: {
              firstName: 'Mango',
            },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `../test-cards`, name: 'Person' },
            },
          },
          {
            id: `${testRealmURL}Person/vanGogh`,
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
            },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: { module: `../test-cards`, name: 'Person' },
            },
          },
        ],
      });
    });

    test('can deserialize a linksToMany relationship that points to own card class', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friends = linksToMany(() => Person);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person },
        },
      });

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/hassan`,
          attributes: {
            description: null,
            firstName: 'Hassan',
            thumbnailURL: null,
          },
          relationships: {
            'friends.0': {
              links: { self: `${testRealmURL}Person/mango` },
              data: { id: `${testRealmURL}Person/mango`, type: 'card' },
            },
            'friends.1': {
              links: { self: `${testRealmURL}Person/vanGogh` },
              data: { id: `${testRealmURL}Person/vanGogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Person/mango`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Mango',
              thumbnailURL: null,
            },
            relationships: {
              friends: { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Person',
              },
            },
          },
          {
            id: `${testRealmURL}Person/vanGogh`,
            type: 'card',
            attributes: {
              description: null,
              firstName: 'Van Gogh',
              thumbnailURL: null,
            },
            relationships: {
              'friends.0': {
                links: { self: `${testRealmURL}Person/hassan` },
                data: { id: `${testRealmURL}Person/hassan`, type: 'card' },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Person',
              },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        new URL(`${testRealmURL}Person/hassan`),
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
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Friend extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let mango = new Pet({ name: 'Mango' });
      let vanGogh = new Pet({ name: 'Van Gogh' });
      let hassan = new Friend({ firstName: 'Hassan', pets: [mango, vanGogh] });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/van-gogh`, loader);
      await saveCard(hassan, `${testRealmURL}Friend/hassan`, loader);
      let burcu = new Person({ firstName: 'Burcu', friend: hassan });
      let serialized = serializeCard(burcu, {
        includeComputeds: true,
        includeUnrenderedFields: true,
      });
      assert.deepEqual(serialized.data, {
        type: 'card',
        attributes: {
          firstName: 'Burcu',
          title: null,
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          friend: {
            links: { self: `${testRealmURL}Friend/hassan` },
            data: { id: `${testRealmURL}Friend/hassan`, type: 'card' },
          },
          'friendPets.0': {
            links: { self: `${testRealmURL}Pet/mango` },
            data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
          },
          'friendPets.1': {
            links: { self: `${testRealmURL}Pet/van-gogh` },
            data: { id: `${testRealmURL}Pet/van-gogh`, type: 'card' },
          },
        },
        meta: {
          adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
        },
      });

      assert.deepEqual(serialized.included, [
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          attributes: {
            name: 'Mango',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${testRealmURL}Pet/van-gogh`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
          },
        },
        {
          id: `${testRealmURL}Friend/hassan`,
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          relationships: {
            'pets.0': {
              links: { self: `${testRealmURL}Pet/mango` },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
            'pets.1': {
              links: { self: `${testRealmURL}Pet/van-gogh` },
              data: { id: `${testRealmURL}Pet/van-gogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Friend' },
          },
        },
      ]);
    });

    test('can deserialize a computed linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Friend extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            friend: {
              links: { self: `${testRealmURL}Friend/hassan` },
              data: { id: `${testRealmURL}Friend/hassan`, type: 'card' },
            },
            'friendPets.0': {
              links: { self: `${testRealmURL}Pet/mango` },
              data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
            },
            'friendPets.1': {
              links: { self: `${testRealmURL}Pet/van-gogh` },
              data: { id: `${testRealmURL}Pet/van-gogh`, type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango', title: null },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/van-gogh`,
            type: 'card',
            attributes: { name: 'Van Gogh', title: null },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Friend/hassan`,
            type: 'card',
            attributes: { firstName: 'Hassan', title: null },
            relationships: {
              'pets.0': {
                links: { self: `${testRealmURL}Pet/mango` },
                data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
              },
              'pets.1': {
                links: { self: `${testRealmURL}Pet/van-gogh` },
                data: { id: `${testRealmURL}Pet/van-gogh`, type: 'card' },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Friend',
              },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
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
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Friend extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let person = new Person({ firstName: 'Burcu' });
      let serialized = serializeCard(person, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized, {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Burcu',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          relationships: {
            friend: { links: { self: null } },
            friendPets: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      });
    });

    test('can deserialize an empty computed linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Friend extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', title: null },
          relationships: {
            friend: { links: { self: null } },
            friendPets: { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );

      assert.ok(card instanceof Person, 'card is a Person');
      assert.strictEqual(card.firstName, 'Burcu');
      assert.deepEqual(card.friendPets, [], 'relationship is an empty array');
    });

    test('can deserialize a computed linksToMany relationship that does not include all the related resources', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
      }
      class Friend extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(Friend);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu' },
          relationships: {
            friend: { links: { self: `${testRealmURL}Friend/hassan` } },
            'friendPets.0': { links: { self: `${testRealmURL}Pet/mango` } },
            'friendPets.1': { links: { self: `${testRealmURL}Pet/vanGogh` } },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: { name: 'Mango' },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      };
      let card = await createFromSerialized<typeof Person>(
        doc.data,
        doc,
        undefined,
      );

      try {
        card.friend;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.strictEqual(
          err.message,
          `The field Person.friend refers to the card instance ${testRealmURL}Friend/hassan which is not loaded`,
          'NotLoaded error describes field not loaded',
        );
      }

      try {
        card.friendPets;
        throw new Error(`expected error not thrown`);
      } catch (err: any) {
        assert.ok(err instanceof NotLoaded, 'NotLoaded error thrown');
        assert.strictEqual(
          err.message,
          `The field Person.friendPets refers to the card instance ${testRealmURL}Pet/vanGogh which is not loaded`,
          'NotLoaded error describes field not loaded',
        );
      }

      let relationships = relationshipMeta(card, 'friendPets');
      if (!Array.isArray(relationships)) {
        assert.ok(false, 'relationshipMeta should be an array');
      } else {
        let [mango, vanGogh] = relationships;
        if (mango?.type === 'loaded') {
          assert.strictEqual(mango.card?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(
            false,
            `relationship type for ${testRealmURL}Pet/mango was not "loaded"`,
          );
        }
        if (vanGogh?.type === 'not-loaded') {
          assert.strictEqual(vanGogh.reference, `${testRealmURL}Pet/vanGogh`);
        } else {
          assert.ok(
            false,
            `relationship type for ${testRealmURL}Pet/vanGogh was not "not-loaded"`,
          );
        }
      }

      let serialized = serializeCard(card, {
        includeUnrenderedFields: true,
        includeComputeds: true,
      });
      assert.deepEqual(serialized.data.relationships, {
        friend: { links: { self: `${testRealmURL}Friend/hassan` } },
        'friendPets.0': {
          links: { self: `${testRealmURL}Pet/mango` },
          data: { type: 'card', id: `${testRealmURL}Pet/mango` },
        },
        'friendPets.1': {
          links: { self: `${testRealmURL}Pet/vanGogh` },
          data: { type: 'card', id: `${testRealmURL}Pet/vanGogh` },
        },
      });
    });
  });

  module('base cards', function () {
    // this module checks the custom serialization and deserialization behaviour of base cards
    // which have custom serialize and deserialize

    module('NumberField', function () {
      test('can deserialize field', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someNumber = contains(NumberField);
          @field someNegativeNumber = contains(NumberField);
          @field someNumberString = contains(NumberField);
          @field someBigInt = contains(NumberField);
          @field someNegativeBigInt = contains(NumberField);
          @field someNull = contains(NumberField);
          @field someString = contains(NumberField);
          @field someDecimal = contains(NumberField);
          @field zeroNumber = contains(NumberField);
          @field notANumber = contains(NumberField);
          @field infinity = contains(NumberField);
        }
        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let resource = {
          attributes: {
            title: 'Number Test Cases',
            someNumber: 42,
            someNegativeNumber: -1,
            someNumberString: '42',
            someBigInt: '9007199254740992',
            someNegativeBigInt: '-9007199254740992',
            someNull: null,
            someString: 'some text',
            someDecimal: 0.0001,
            zeroNumber: 0,
            notANumber: NaN,
            infinity: Infinity,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Sample',
            },
          },
        };
        let sample = await createFromSerialized<typeof Sample>(
          resource,
          { data: resource },
          undefined,
        );

        assert.strictEqual(sample.someNumber, 42);
        assert.strictEqual(sample.someNegativeNumber, -1);
        assert.strictEqual(sample.someNumberString, 42);
        assert.strictEqual(sample.someDecimal, 0.0001);
        assert.strictEqual(sample.zeroNumber, 0);

        // failed to deserialize
        assert.strictEqual(sample.someNull, null);
        assert.strictEqual(sample.someBigInt, null);
        assert.strictEqual(sample.someNegativeBigInt, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.notANumber, null);
        assert.strictEqual(sample.infinity, null);
      });

      test('can serialize field', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someNumber = contains(NumberField);
          @field someNull = contains(NumberField);
        }

        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let sample = new Sample({
          someNumber: 42,
          someNull: null,
        });

        let serialized = serializeCard(sample, {
          includeUnrenderedFields: true,
        });

        assert.strictEqual(
          typeof serialized?.data?.attributes?.someNumber === 'number',
          true,
        );
        assert.strictEqual(
          typeof serialized?.data?.attributes?.someNumber !== 'string',
          true,
        );
        assert.strictEqual(serialized?.data?.attributes?.someNumber, 42);
        assert.strictEqual(serialized?.data?.attributes?.someNull, null);
      });
    });

    module('BigIntegerField', function () {
      function isBigInt(input: any) {
        return typeof input == 'bigint';
      }
      test('can deserialize field', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someBigInt = contains(BigIntegerField);
          @field someNull = contains(BigIntegerField);
          @field someString = contains(BigIntegerField);
          @field someNumber = contains(BigIntegerField);
          @field someNegativeNumber = contains(BigIntegerField);
          @field someDecimal = contains(BigIntegerField);
          @field someZeroString = contains(BigIntegerField);
        }
        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

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
              module: `${testRealmURL}test-cards`,
              name: 'Sample',
            },
          },
        };
        let sample = await createFromSerialized<typeof Sample>(
          resource,
          { data: resource },
          undefined,
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
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someBigInt = contains(BigIntegerField);
          @field someNull = contains(BigIntegerField);
        }

        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let sample = new Sample({
          someBigInt: BigInt('9223372036854775808'),
          someNull: null,
        });

        let serialized = serializeCard(sample, {
          includeUnrenderedFields: true,
        });

        assert.strictEqual(
          typeof serialized?.data?.attributes?.someBigInt === 'string',
          true,
        );
        assert.strictEqual(
          typeof serialized?.data?.attributes?.someBigInt !== 'number',
          true,
        );
        assert.strictEqual(
          serialized?.data?.attributes?.someBigInt,
          '9223372036854775808',
        );
        assert.strictEqual(serialized?.data?.attributes?.someNull, null);
      });

      test('queryable value', async function (assert) {
        assert.strictEqual(
          getQueryableValue(BigIntegerField, BigInt('9223372036854775808')),
          '9223372036854775808',
        );
        assert.strictEqual(getQueryableValue(BigIntegerField, null), undefined);
        assert.strictEqual(
          getQueryableValue(BigIntegerField, undefined),
          undefined,
        );
      });

      test('can perform bigint operations with computed', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someBigInt = contains(BigIntegerField);
          @field anotherBigInt = contains(BigIntegerField);
          @field someNull = contains(BigIntegerField);
          @field someComputed = contains(BigIntegerField, {
            computeVia: function (this: Sample) {
              return this.someBigInt + this.anotherBigInt;
            },
          });
          //TODO: This doesn't seem to work
          // Promise rejected during "can perform bigint operations with computed": Cannot mix BigInt and other types, use explicit conversions
          // @field someComputedWithNull = contains(BigIntegerField, {
          //   computeVia: function (this: Sample) {
          //     return this.someBigInt + this.someNull;
          //   },
          // });
        }
        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

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
          (BigInt('1') + BigInt('2')).toString(),
        );
      });
    });

    module('EthereumAddressField', function () {
      function isEthAddress(address: string): boolean {
        return isAddress(address);
      }
      test('can deserialize field', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someAddress = contains(EthereumAddressField);
          @field nonChecksummedAddress = contains(EthereumAddressField);
          @field checksummedAddressThatDontLookLikeOne =
            contains(EthereumAddressField);
          @field faultyAddress = contains(EthereumAddressField);
          @field bitcoinAddress = contains(EthereumAddressField);
          @field someString = contains(EthereumAddressField);
          @field someNull = contains(EthereumAddressField);
        }
        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

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
              module: `${testRealmURL}test-cards`,
              name: 'Sample',
            },
          },
        };
        let sample = await createFromSerialized<typeof Sample>(
          resource,
          { data: resource },
          undefined,
        );

        assert.strictEqual(isEthAddress(sample.someAddress), true);
        assert.strictEqual(
          isEthAddress(sample.checksummedAddressThatDontLookLikeOne),
          true,
        );

        // failed to deserialize
        assert.strictEqual(sample.faultyAddress, null);
        assert.strictEqual(sample.nonChecksummedAddress, null);
        assert.strictEqual(sample.bitcoinAddress, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.someNull, null);
      });

      test('can serialize field', async function (assert) {
        class Sample extends CardDef {
          @field title = contains(StringField);
          @field someAddress = contains(EthereumAddressField);
          @field nonChecksummedAddress = contains(EthereumAddressField);
          @field someNull = contains(EthereumAddressField);
        }

        await setupIntegrationTestRealm({
          loader,
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

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
          true,
        );
        assert.strictEqual(
          typeof serialized?.data?.attributes?.someAddress !== 'number',
          true,
        );
        assert.strictEqual(
          serialized?.data?.attributes?.someAddress,
          '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
        );
        assert.strictEqual(
          serialized?.data?.attributes?.nonChecksummedAddress,
          '0x3bc8e82b5856b2f2bdc7f6693f79db9648c0aaaa',
        );
        assert.strictEqual(serialized?.data?.attributes?.someNull, null);
      });

      test('queryable value', async function (assert) {
        assert.strictEqual(
          getQueryableValue(
            EthereumAddressField,
            '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
          ),
          '0x00317f9aF5141dC211e9EbcdCE690cf0E98Ef53b',
        );
        assert.strictEqual(
          getQueryableValue(EthereumAddressField, null),
          undefined,
        );
        assert.strictEqual(
          getQueryableValue(EthereumAddressField, undefined),
          undefined,
        );
      });
    });
  });
});
