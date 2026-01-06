import type { RenderingTestContext } from '@ember/test-helpers';
import { fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import formatISO from 'date-fns/formatISO';
import parseISO from 'date-fns/parseISO';
import { isAddress } from 'ethers';
import { parse as parseQueryString } from 'qs';

import { module, test } from 'qunit';

import type {
  LooseCardResource,
  LooseSingleCardDocument,
  Relationship,
  Permissions,
} from '@cardstack/runtime-common';
import {
  baseRealm,
  fields,
  isSingleCardDocument,
  localId,
  meta,
  PermissionsContextName,
} from '@cardstack/runtime-common';
import { realmURL } from '@cardstack/runtime-common/constants';
import type { Loader } from '@cardstack/runtime-common/loader';

import type CardService from '@cardstack/host/services/card-service';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  p,
  cleanWhiteSpace,
  setupCardLogs,
  saveCard,
  provideConsumeContext,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  cardInfo,
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
  BigIntegerField,
  getQueryableValue,
  EthereumAddressField,
  getFields,
} from '../../helpers/base-realm';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { Captain } from '../../cards/captain';

let loader: Loader;

function assertSingularRelationship(
  assert: Assert,
  relationship: Relationship | Relationship[] | undefined,
  label: string,
): asserts relationship is Relationship {
  assert.ok(relationship, `${label} relationship exists`);
  assert.ok(
    !Array.isArray(relationship),
    `${label} relationship is not an array`,
  );
}

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  hooks.beforeEach(async function () {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);

    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can deserialize field', async function (assert) {
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.cardTitle />
          created
          <@fields.created />
          published
          <@fields.published />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    // initialize card data as serialized to force us to deserialize instead of using cached data
    let resource = {
      attributes: {
        cardTitle: 'First Post',
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

  test('deserializing card JSON sets realm URL on contained FieldDef instances', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let cardJSON = {
      data: {
        id: `${testRealmURL}Post/1`,
        type: 'card',
        attributes: {
          author: {
            firstName: 'Mango',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Post',
          },
          realmURL: testRealmURL,
          fields: {
            author: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Person',
              },
              realmURL: testRealmURL,
            },
          },
        },
      } as LooseCardResource,
    };

    let instance = (await createFromSerialized(
      cardJSON.data,
      cardJSON,
      new URL(cardJSON.data.id!),
    )) as InstanceType<typeof Post>;

    assert.strictEqual(
      instance.author[realmURL]?.href,
      testRealmURL,
      'FieldDef instances nested inside card data keep track of their realm when metadata is available',
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

  test('serializing a card does not duplicate realm URL into contained field meta', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post({
      author: new Person({ firstName: 'Mango' }),
    });
    (post as any)[meta] = {
      adoptsFrom: {
        module: `${testRealmURL}test-cards`,
        name: 'Post',
      },
      realmURL: testRealmURL,
    };

    let serialized = serializeCard(post, {
      includeUnrenderedFields: true,
    });

    assert.strictEqual(
      serialized.data.meta?.fields?.author,
      undefined,
      'contained field meta is not redundantly annotated with realm URL',
    );
  });

  test('saving a card assigns realm URL to contained field instances', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post({
      author: new Person({ firstName: 'Joe' }),
    });

    await saveCard(
      post,
      `${testRealmURL}Post/1.json`,
      loader,
      undefined,
      testRealmURL,
    );

    assert.strictEqual(
      post.author[realmURL]?.href,
      testRealmURL,
      'contained FieldDef instance receives the realm URL after saving',
    );
  });

  test('saving a card assigns realm URL to contained containsMany field instances', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field authors = containsMany(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post({
      authors: [
        new Person({ firstName: 'Joe' }),
        new Person({ firstName: 'Pat' }),
      ],
    });

    await saveCard(
      post,
      `${testRealmURL}Post/2.json`,
      loader,
      undefined,
      testRealmURL,
    );

    assert.deepEqual(
      post.authors.map((author) => author[realmURL]?.href),
      [testRealmURL, testRealmURL],
      'all contained FieldDef instances receive the realm URL after saving',
    );
  });

  test('polymorphic override keeps realm URL on deserialized field instance', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Employee extends Person {
      @field department = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Employee, Post },
      },
    });

    let resource: LooseCardResource = {
      attributes: {
        cardTitle: 'Serialized Post',
        author: {
          firstName: 'Riley',
          department: 'Engineering',
        },
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'Post',
        },
        realmURL: testRealmURL,
        fields: {
          author: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Employee',
            },
          },
        },
      },
    };

    let post = (await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    )) as InstanceType<typeof Post>;

    assert.strictEqual(
      post.author[realmURL]?.href,
      testRealmURL,
      'overridden field instance retains realm URL after deserialization',
    );
    assert.true(
      post.author instanceof Employee,
      'polymorphic override still applies',
    );
  });

  test('computed contains assigns realm URL to generated field instance', async function (assert) {
    class Person extends FieldDef {
      @field name = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person, {
        computeVia: function (this: Post) {
          return new Person({ name: 'Computed Author' });
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post();

    await saveCard(
      post,
      `${testRealmURL}Post/3.json`,
      loader,
      undefined,
      testRealmURL,
    );

    assert.strictEqual(
      post.author[realmURL]?.href,
      testRealmURL,
      'computed field instance knows the realm URL',
    );
  });

  test('computed containsMany assigns realm URL to generated field instances', async function (assert) {
    class Person extends FieldDef {
      @field name = contains(StringField);
    }

    class Post extends CardDef {
      @field authors = containsMany(Person, {
        computeVia: function (this: Post) {
          return [new Person({ name: 'Computed Author' })];
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post();

    await saveCard(
      post,
      `${testRealmURL}Post/3.json`,
      loader,
      undefined,
      testRealmURL,
    );

    assert.deepEqual(
      post.authors.map((author) => author[realmURL]?.href),
      [testRealmURL],
      'computed field instances know the realm URL',
    );
  });

  test('manually constructed field assigned after instantiation receives realm URL on save', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post();
    post.author = new Person({ firstName: 'Late Assign' });

    await saveCard(
      post,
      `${testRealmURL}Post/4.json`,
      loader,
      undefined,
      testRealmURL,
    );

    assert.strictEqual(
      post.author[realmURL]?.href,
      testRealmURL,
      'late-assigned contained field instance receives realm URL after save',
    );
  });

  test('assigning a new field instance to a saved card sets realm URL immediately', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let post = new Post({
      author: new Person({ firstName: 'Original' }),
    });

    await saveCard(
      post,
      `${testRealmURL}Post/5.json`,
      loader,
      undefined,
      testRealmURL,
    );

    post.author = new Person({ firstName: 'Replacement' });

    assert.strictEqual(
      post.author[realmURL]?.href,
      testRealmURL,
      'newly assigned field instance on a saved card immediately receives the realm URL',
    );
  });

  test('can deserialize a card that has an ID', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
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
    assert.true(isSaved(savedCard), 'API recognizes card as saved');

    let unsavedCard = new Person();
    assert.false(isSaved(unsavedCard), 'API recognizes card as unsaved');
  });

  test('can deserialize a card with a local id', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let resource = {
      lid: 'mango-local-id',
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
    let instance = (await createFromSerialized(
      resource,
      { data: resource },
      undefined,
    )) as CardDefType;

    assert.strictEqual(
      instance[localId],
      'mango-local-id',
      'instance local id is set',
    );
  });

  test('can serialize a card that has an ID', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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
          cardInfo,
        },
        meta: {
          adoptsFrom: {
            module: `../test-cards`,
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
      @field nickName = contains(StringField, {
        computeVia: function (this: Person) {
          if (!this.firstName) {
            return;
          }
          return this.firstName + '-poo';
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let card = new Person({
      id: `${testRealmURL}Person/mango`,
      firstName: 'Mango',
    });

    assert.false(isSaved(card), 'card is not saved');

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

    assert.true(isSaved(card), 'card is saved');
    assert.strictEqual(result, card, 'returns the same instance provided');
    assert.strictEqual(
      card.id,
      `${testRealmURL}Person/vanGogh`,
      'ID can be updated for unsaved instance',
    );
    assert.strictEqual(card.firstName, 'Van Gogh', 'the field can be updated');
    assert.strictEqual(
      card.nickName,
      'Van Gogh-poo',
      'the computed field is recomputed',
    );
  });

  test('throws when updating the id of a saved instance from serialized data', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    await setupIntegrationTestRealm({
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
    assert.notStrictEqual(
      driver.ref,
      ref,
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
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { DriverCard },
      },
    });

    let ref = { module: `http://localhost:4202/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });
    let serializedRef = serializeCard(driver, { includeUnrenderedFields: true })
      .data.attributes?.ref;
    assert.notStrictEqual(
      serializedRef,
      ref,
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
      @field cardTitle = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.cardTitle />
          created
          <@fields.created />
          published
          <@fields.published />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    let resource = {
      attributes: {
        cardTitle: 'First Post',
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      @field cardDescription = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      cardDescription: 'Toilet paper ghost: Poooo!',
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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
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
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo,
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
            cardInfo,
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

  test('can serialize a linksTo relationship with an unsaved card', async function (assert) {
    class Toy extends CardDef {
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      @field cardDescription = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      cardDescription: 'Toilet paper ghost: Poooo!',
    });
    let mango = new Pet({
      firstName: 'Mango',
      favoriteToy: spookyToiletPaper,
    });
    let hassan = new Person({
      firstName: 'Hassan',
      pet: mango,
    });

    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
        },
        relationships: {
          pet: {
            data: {
              lid: mango[localId],
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
          lid: spookyToiletPaper[localId],
          type: 'card',
          attributes: {
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'Toy',
            },
          },
        },
        {
          lid: mango[localId],
          type: 'card',
          attributes: {
            firstName: 'Mango',
            cardInfo,
          },
          relationships: {
            favoriteToy: {
              data: {
                lid: spookyToiletPaper[localId],
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
      @field cardDescription = contains(StringField);
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
          cardInfo: {},
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
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo: {},
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
            cardInfo: {},
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
      assert.true(isSaved(pet), 'Pet card is saved');
      assert.strictEqual(pet.firstName, 'Mango');
      let { favoriteToy } = pet;
      if (favoriteToy instanceof Toy) {
        assert.true(isSaved(favoriteToy), 'Toy card is saved');
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
        assert.true(relatedCard instanceof Pet, 'related card is a Pet');
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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

    hassan.pet; // should no longer throw NotLoaded errors

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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet },
      },
    });

    let hassan = new Person({ firstName: 'Hassan' });

    let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
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
        lid: mango[localId],
        type: 'card',
        attributes: {
          firstName: 'Mango',
          cardInfo,
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
      @field cardDescription = contains(StringField);
    }
    class Pet extends CardDef {
      @field firstName = contains(StringField);
      @field owner = linksTo(Person);
      @field favoriteToy = contains(Toy);
      @field toys = containsMany(Toy);
    }

    await setupIntegrationTestRealm({
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
          toys: [{ cardDescription: 'treat ball' }, { cardDescription: 'tug toy' }],
          favoriteToy: { cardDescription: 'treat ball' },
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
      assert.true(isSaved(owner), 'Person card is saved');
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
        assert.true(relatedCard instanceof Person, 'related card is a Person');
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
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
            cardInfo,
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

  test('can serialize an unsaved linksTo relationship that points to itself', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field friend = linksTo(() => Person);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });

    let mango = new Person({ firstName: 'Mango' });
    mango.friend = mango;
    let serialized = serializeCard(mango, { includeUnrenderedFields: true });
    assert.deepEqual(serialized, {
      data: {
        lid: mango[localId],
        type: 'card',
        attributes: {
          firstName: 'Mango',
          cardInfo,
        },
        relationships: {
          friend: {
            data: {
              lid: mango[localId],
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
    });
  });

  test('can deserialize a linksTo relationship that points to own card class', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field friend = linksTo(() => Person);
    }

    await setupIntegrationTestRealm({
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

  test('can serialize a contains field that has a nested linksTo field', async function (assert) {
    class Toy extends CardDef {
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      @field cardDescription = contains(StringField);
    }
    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = contains(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      cardDescription: 'Toilet paper ghost: Poooo!',
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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          cardInfo,
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
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      @field cardDescription = contains(StringField);
    }
    class Pet extends FieldDef {
      @field favoriteToy = linksTo(Toy);
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pet = contains(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      cardDescription: 'Toilet paper ghost: Poooo!',
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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          pet: {},
          cardInfo,
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
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo,
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
      @field cardDescription = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Toy) {
          return this.description;
        },
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field favoriteToy = linksTo(Toy);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pets = containsMany(Pet);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Pet, Toy },
      },
    });

    let spookyToiletPaper = new Toy({
      cardDescription: 'Toilet paper ghost: Poooo!',
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
        lid: hassan[localId],
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          pets: [
            {
              firstName: 'Mango',
            },
          ],
          cardInfo,
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
            cardDescription: 'Toilet paper ghost: Poooo!',
            cardInfo,
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
            data: {
              id: `${testRealmURL}Person/hassan`,
              type: 'card',
            },
          },
          favorite: {
            links: {
              self: `${testRealmURL}Person/hassan`,
            },
            data: {
              id: `${testRealmURL}Person/hassan`,
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
      @field cardTitle = contains(StringField);
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
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let doc = {
      data: {
        attributes: {
          cardTitle: 'First Post',
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
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.author />
        </template>
      };
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let doc = {
      data: {
        attributes: {
          cardTitle: 'First Post',
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    class Post extends CardDef {
      @field author = contains(Person);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Post) {
          return this.author?.title ?? 'Post';
        },
      });
      @field cardDescription = contains(StringField);
      @field cardThumbnailURL = contains(StringField);
    }

    await setupIntegrationTestRealm({
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
      cardDescription: 'Post by Mango',
      cardThumbnailURL: './post.jpg',
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
      cardDescription: 'Post by Mango',
      cardThumbnailURL: './post.jpg',
      cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field author = contains(Person);
    }

    await setupIntegrationTestRealm({
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

  test('can serialize a polymorphic primitive contains field', async function (assert) {
    class SpecialStringA extends StringField {}
    class TestCard extends CardDef {
      @field specialField = contains(StringField);
    }
    let card = new TestCard({
      specialField: 'Mango',
      [fields]: {
        specialField: SpecialStringA,
      },
    });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { TestCard, SpecialStringA },
      },
    });

    let serialized = serializeCard(card, {
      includeUnrenderedFields: true,
    });
    assert.strictEqual(
      serialized.data.attributes?.specialField,
      'Mango',
      'field value is correct',
    );
    assert.deepEqual(serialized.data.meta?.fields?.specialField, {
      adoptsFrom: {
        module: `${testRealmURL}test-cards`,
        name: 'SpecialStringA',
      },
    });
  });

  test('can serialize a polymorphic primitive containsMany field', async function (assert) {
    class SpecialStringA extends StringField {}
    class SpecialStringB extends StringField {}
    class TestCard extends CardDef {
      @field specialField = containsMany(StringField);
    }
    let card = new TestCard({
      specialField: ['Mango', 'Van Gogh'],
      [fields]: {
        'specialField.0': SpecialStringA,
        'specialField.1': SpecialStringB,
      },
    });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { TestCard, SpecialStringA, SpecialStringB },
      },
    });

    let serialized = serializeCard(card, {
      includeUnrenderedFields: true,
    });
    assert.deepEqual(
      serialized.data.attributes?.specialField,
      ['Mango', 'Van Gogh'],
      'field value is correct',
    );
    assert.deepEqual(serialized.data.meta?.fields, {
      'specialField.0': {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'SpecialStringA',
        },
      },
      'specialField.1': {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'SpecialStringB',
        },
      },
    });
  });

  test('can deserialize a polymorphic primitive contains field', async function (assert) {
    class SpecialStringA extends StringField {}
    class TestCard extends CardDef {
      @field specialField = contains(StringField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { TestCard, SpecialStringA },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        attributes: {
          specialField: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'TestCard',
          },
          fields: {
            specialField: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'SpecialStringA',
              },
            },
          },
        },
      },
    };

    let instance = await createFromSerialized<typeof TestCard>(
      doc.data,
      doc,
      undefined,
    );

    assert.strictEqual(instance.specialField, 'Mango');
    assert.deepEqual(
      instance[fields],
      { specialField: SpecialStringA },
      'field override is correct',
    );
  });

  test('can deserialize a polymorphic primitive containsMany field', async function (assert) {
    class SpecialStringA extends StringField {}
    class SpecialStringB extends StringField {}
    class TestCard extends CardDef {
      @field specialField = containsMany(StringField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { TestCard, SpecialStringA, SpecialStringB },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        attributes: {
          specialField: ['Mango', 'Van Gogh'],
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'TestCard',
          },
          fields: {
            'specialField.0': {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'SpecialStringA',
              },
            },
            'specialField.1': {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'SpecialStringB',
              },
            },
          },
        },
      },
    };

    let instance = await createFromSerialized<typeof TestCard>(
      doc.data,
      doc,
      undefined,
    );

    assert.deepEqual(instance.specialField, ['Mango', 'Van Gogh']);
    assert.deepEqual(
      instance[fields],
      { 'specialField.0': SpecialStringA, 'specialField.1': SpecialStringB },
      'field override is correct',
    );
  });

  test('can deserialize a nested polymorphic contains field', async function (assert) {
    class TravelGoal extends FieldDef {
      @field goalTitle = contains(StringField);
    }

    class TravelGoalWithProgress extends TravelGoal {
      @field progress = contains(NumberField);
    }

    class Traveler extends FieldDef {
      @field name = contains(StringField);
      @field nextTravelGoal = contains(TravelGoal);
    }

    class TripInfo extends CardDef {
      @field traveler = contains(Traveler);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'trip-info-cards.gts': {
          TravelGoal,
          TravelGoalWithProgress,
          Traveler,
          TripInfo,
        },
      },
    });

    let doc: LooseSingleCardDocument = {
      data: {
        id: `${testRealmURL}TripInfo/polymorphic`,
        attributes: {
          traveler: {
            name: 'Marcelius Wilde',
            nextTravelGoal: {
              goalTitle: "Summer '25",
              progress: 0.5,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}trip-info-cards`,
            name: 'TripInfo',
          },
          fields: {
            traveler: {
              fields: {
                nextTravelGoal: {
                  adoptsFrom: {
                    module: `${testRealmURL}trip-info-cards`,
                    name: 'TravelGoalWithProgress',
                  },
                },
              },
            },
          },
        },
      },
    };

    let instance = await createFromSerialized<typeof TripInfo>(
      doc.data,
      doc,
      undefined,
    );

    assert.strictEqual(instance.traveler.name, 'Marcelius Wilde');
    assert.true(
      instance.traveler.nextTravelGoal instanceof TravelGoalWithProgress,
      'nested field adopts overridden type',
    );
    assert.strictEqual(
      instance.traveler.nextTravelGoal.goalTitle,
      "Summer '25",
    );
    assert.strictEqual(
      (instance.traveler.nextTravelGoal as TravelGoalWithProgress).progress,
      0.5,
    );
  });

  test('can serialize a composite field that has been edited', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.firstName />
        </template>
      };
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field reviews = contains(NumberField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, { computeVia: () => 'Post' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
      static edit = class Edit extends Component<typeof this> {
        <template>
          <fieldset>
            <label data-test-field='cardTitle'>Title <@fields.cardTitle /></label>
            <label data-test-field='reviews'>Reviews <@fields.reviews /></label>
            <label data-test-field='author'>Author <@fields.author /></label>
          </fieldset>

          <div data-test-output='cardTitle'>{{@model.cardTitle}}</div>
          <div data-test-output='reviews'>{{@model.reviews}}</div>
          <div
            data-test-output='author.firstName'
          >{{@model.author.firstName}}</div>
        </template>
      };
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Post },
      },
    });

    let helloWorld = new Post({
      cardTitle: 'First Post',
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
          lid: helloWorld[localId],
          type: 'card',
          attributes: {
            cardTitle: 'First Post',
            reviews: 1,
            author: {
              firstName: 'Carl Stack',
            },
            cardInfo,
          },
          relationships: {
            'cardInfo.theme': { links: { self: null } },
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

  test('can deserialize a computed field', async function (assert) {
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
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: { birthdate: '2019-10-30' },
        meta: {
          adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
        },
      },
    };
    let instance = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );

    assert.ok(instance instanceof Person, 'card is an instance of person');
    assert.strictEqual(
      formatISO(instance.firstBirthday).split('T').shift()!,
      '2020-10-30',
      'the computed value is correct',
    );
  });

  test('cannot stomp on top of computed field with serialized data', async function (assert) {
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
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person },
      },
    });
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: { birthdate: '2019-10-30', firstBirthday: '1984-01-01' },
        meta: {
          adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
        },
      },
    };
    let instance = await createFromSerialized<typeof Person>(
      doc.data,
      doc,
      undefined,
    );

    assert.ok(instance instanceof Person, 'card is an instance of person');
    assert.strictEqual(
      formatISO(instance.firstBirthday).split('T').shift()!,
      '2020-10-30',
      'the computed value is correct',
    );
  });

  module('computed linksTo', function () {
    test('can serialize a computed linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field name = contains(StringField);
        @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
        @field cardThumbnailURL = contains(StringField, {
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
        @field cardDescription = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field cardThumbnailURL = contains(StringField, {
          computeVia: () => '../../person.svg',
        });
      }
      await setupIntegrationTestRealm({
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
        lid: burcu[localId],
        attributes: {
          firstName: 'Burcu',
          cardTitle: 'Untitled Card',
          cardDescription: 'Person',
          cardThumbnailURL: '../../person.svg',
          cardInfo,
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
            cardTitle: 'Untitled Card',
            cardDescription: 'Pet',
            cardThumbnailURL: '../pet.svg',
            cardInfo,
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
            cardTitle: 'Untitled Card',
            cardDescription: 'Person',
            cardThumbnailURL: '../../person.svg',
            cardInfo,
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
              cardDescription: null,
              firstName: 'Hassan',
              cardThumbnailURL: null,
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
        assert.true(isSaved(friendPet), 'Pet card is saved');
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
          assert.true(relatedCard instanceof Pet, 'related card is a Pet');
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
          lid: person[localId],
          type: 'card',
          attributes: {
            firstName: 'Burcu',
            cardTitle: 'Untitled Card',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
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

      card.friendPet; // Should no longer throw NotLoaded error
      let friendRel = relationshipMeta(card, 'friend');
      assert.deepEqual(friendRel, {
        type: 'not-loaded',
        reference: `${testRealmURL}Person/hassan`,
      });

      let friendPetRel = relationshipMeta(card, 'friendPet');
      assert.deepEqual(friendPetRel, {
        type: 'loaded',
        card: null,
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
      @field cardTitle = contains(StringField);
      static embedded = class Isolated extends Component<typeof this> {
        <template>
          <div data-test='appointment'><@fields.cardTitle />
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
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Appointment, Schedule },
      },
    });

    let doc = {
      data: {
        attributes: {
          appointments: [
            { date: '2022-4-1', location: 'Room 332', cardTitle: 'Biology' },
            { date: '2022-4-4', location: 'Room 102', cardTitle: 'Civics' },
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
      @field cardTitle = contains(StringField);
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Schedule extends CardDef {
      @field appointments = containsMany(Appointment);
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Schedule',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
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
          cardTitle: 'Biology',
        }),
        new Appointment({
          date: p('2022-4-4'),
          location: 'Room 102',
          cardTitle: 'Civics',
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
        cardTitle: 'Biology',
      },
      {
        date: '2022-04-04',
        location: 'Room 102',
        cardTitle: 'Civics',
      },
    ]);
    assert.deepEqual(serialized.data.meta?.fields?.appointments, undefined); // this means the field card for the value is the same as the field's card
  });

  test('can serialize a card with primitive fields', async function (assert) {
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field cardDescription = contains(StringField);
      @field cardThumbnailURL = contains(StringField);
      @field created = contains(DateField);
      @field published = contains(DatetimeField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post },
      },
    });

    let firstPost = new Post({
      cardTitle: 'First Post',
      created: p('2022-04-22'),
      published: parseISO('2022-04-27T16:30+00:00'),
      cardDescription: 'Introductory post',
      cardThumbnailURL: './intro.png',
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(
      payload,
      {
        data: {
          lid: firstPost[localId],
          type: 'card',
          attributes: {
            cardTitle: 'First Post',
            created: '2022-04-22',
            published: '2022-04-27T16:30:00.000Z',
            cardDescription: 'Introductory post',
            cardThumbnailURL: './intro.png',
            cardInfo,
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
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Animal',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Person extends Animal {
      @field firstName = contains(StringField);
      @field birthdate = contains(DateField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField);
    }
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, { computeVia: () => 'Post' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Animal, Person, Post },
      },
    });

    let firstPost = new Post({
      cardTitle: 'First Post',
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        species: 'canis familiaris',
        cardDescription: 'A dog',
      }),
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        lid: firstPost[localId],
        type: 'card',
        attributes: {
          cardTitle: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            species: 'canis familiaris',
            cardDescription: 'A dog',
          },
          cardInfo,
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
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, { computeVia: () => 'Post' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Employee, Person, Post },
      },
    });

    let firstPost = new Post({
      cardTitle: 'First Post',
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        department: 'wagging',
      }),
    });
    let payload = serializeCard(firstPost, { includeUnrenderedFields: true });
    assert.deepEqual(payload, {
      data: {
        lid: firstPost[localId],
        type: 'card',
        attributes: {
          cardTitle: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            department: 'wagging',
          },
          cardInfo,
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
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Pet extends FieldDef {
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.firstName;
        },
      });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Employee) {
          return `${this.firstName} - ${this.department}`;
        },
      });
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, { computeVia: () => 'Post' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Employee, Person, Pet, Post },
      },
    });

    let firstPost = new Post({
      cardTitle: 'First Post',
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
        lid: firstPost[localId],
        type: 'card',
        attributes: {
          cardTitle: 'First Post',
          author: {
            firstName: 'Mango',
            birthdate: '2019-10-30',
            department: 'wagging',
            loves: {
              firstName: 'Van Gogh',
            },
          },
          cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Employee extends Person {
      @field department = contains(StringField);
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return 'Group';
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A group of people',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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
        lid: group[localId],
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
          cardInfo,
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

  test('query-backed relationships include canonical search links in serialized payloads', async function (assert) {
    assert.expect(23);

    class Person extends CardDef {
      @field cardTitle = contains(StringField);
    }

    class QueryCard extends CardDef {
      @field cardTitle = contains(StringField);
      @field favorite = linksTo(Person, {
        query: {
          realm: '$thisRealm',
          filter: {
            eq: { cardTitle: '$this.title' },
          },
        },
      });
      @field matches = linksToMany(Person, {
        query: {
          realm: '$thisRealm',
          filter: {
            eq: { cardTitle: '$this.title' },
          },
          sort: [{ by: 'title', direction: 'asc' }],
          page: { size: 5 },
        },
      });
      @field emptyMatches = linksToMany(Person, {
        query: {
          realm: '$thisRealm',
          filter: {
            eq: { cardTitle: 'Missing' },
          },
          page: { size: 5 },
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, QueryCard },
        'Person/target.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Target',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Person',
              },
            },
          },
        },
        'query-card.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Target',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'QueryCard',
              },
            },
          },
        },
      },
    });

    let cardService = getService('card-service') as CardService;
    let rawDoc = await cardService.fetchJSON(`${testRealmURL}query-card`);
    assert.ok(rawDoc, 'received document');
    assert.ok(
      isSingleCardDocument(rawDoc),
      'received serialized card document',
    );
    if (!rawDoc || !isSingleCardDocument(rawDoc)) {
      // eslint-disable-next-line qunit/no-early-return
      return;
    }
    let doc = rawDoc;
    let favoriteRelationship = doc.data.relationships?.favorite;
    assertSingularRelationship(assert, favoriteRelationship, 'favorite');
    let favoriteSearchLink = favoriteRelationship.links?.search;
    assert.ok(favoriteSearchLink, 'favorite relationship exposes links.search');
    let favoriteSearchURL = new URL(favoriteSearchLink!);
    assert.strictEqual(
      favoriteSearchURL.href.split('?')[0],
      new URL('_search', testRealmURL).href,
      'favorite search link points to canonical search endpoint',
    );
    let favoriteQueryParams = parseQueryString(
      favoriteSearchURL.searchParams.toString(),
    ) as Record<string, any>;
    assert.strictEqual(
      favoriteQueryParams.filter?.eq?.title,
      'Target',
      'favorite search link encodes interpolated filter',
    );
    assert.deepEqual(
      favoriteRelationship.data,
      { type: 'card', id: `${testRealmURL}Person/target` },
      'favorite relationship retains resolved data entry',
    );

    let matchesRelationship = doc.data.relationships?.matches;
    assertSingularRelationship(assert, matchesRelationship, 'matches');
    assert.deepEqual(
      matchesRelationship.data,
      [{ type: 'card', id: `${testRealmURL}Person/target` }],
      'matches relationship exposes aggregate data entries',
    );
    let matchesSearchLink = matchesRelationship.links?.search;
    assert.ok(matchesSearchLink, 'matches relationship exposes links.search');
    let matchesSearchURL = new URL(matchesSearchLink!);
    assert.strictEqual(
      matchesSearchURL.href.split('?')[0],
      new URL('_search', testRealmURL).href,
      'matches search link points to canonical search endpoint',
    );
    let matchesQueryParams = parseQueryString(
      matchesSearchURL.searchParams.toString(),
    ) as Record<string, any>;
    assert.strictEqual(
      matchesQueryParams.page?.size,
      '5',
      'matches search link preserves pagination',
    );
    assert.strictEqual(
      matchesQueryParams.filter?.eq?.title,
      'Target',
      'matches search link encodes interpolated filter',
    );
    let firstChild = doc.data.relationships?.['matches.0'];
    assertSingularRelationship(assert, firstChild, 'matches.0');
    assert.strictEqual(
      firstChild?.links?.self,
      `./Person/target`,
      'matches indexed relationship retains links to result resource',
    );

    let emptyMatchesRelationship = doc.data.relationships?.emptyMatches;
    assertSingularRelationship(
      assert,
      emptyMatchesRelationship,
      'emptyMatches',
    );
    assert.deepEqual(
      emptyMatchesRelationship.data,
      [],
      'emptyMatches relationship encodes an empty data array when the realm returned no results',
    );
    let emptyMatchesSearchLink = emptyMatchesRelationship.links?.search;
    assert.ok(
      emptyMatchesSearchLink,
      'emptyMatches relationship still exposes links.search when no matches were returned',
    );
    let emptyMatchesSearchURL = new URL(emptyMatchesSearchLink!);
    assert.strictEqual(
      emptyMatchesSearchURL.href.split('?')[0],
      new URL('_search', testRealmURL).href,
      'emptyMatches search link points to canonical search endpoint',
    );

    // We intentionally do not assert on internal query field cache state here.
    // The serialized payload above is the observable contract we care about.
  });

  test('can serialize polymorphic containsMany fields nested within a field', async function (assert) {
    class Tag extends FieldDef {
      @field name = contains(StringField);
      @field color = contains(StringField);
    }

    class PriorityTag extends Tag {
      @field priority = contains(NumberField);
    }

    class StatusTag extends Tag {
      @field isActive = contains(NumberField);
    }

    class Category extends FieldDef {
      @field cardTitle = contains(StringField);
      @field tags = containsMany(Tag);
      @field priority = contains(NumberField);
    }

    class Article extends CardDef {
      @field cardTitle = contains(StringField);
      @field category = contains(Category);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Tag, PriorityTag, StatusTag, Category, Article },
      },
    });

    let article = new Article({
      cardTitle: 'How to Test Nested Fields',
      category: new Category({
        cardTitle: 'Programming',
        priority: 1,
        tags: [
          new PriorityTag({ name: 'javascript', color: 'yellow', priority: 5 }),
          new StatusTag({ name: 'testing', color: 'green', isActive: 1 }),
          new Tag({ name: 'serialization', color: 'blue' }),
        ],
      }),
    });

    let serialized = serializeCard(article, { includeUnrenderedFields: true });

    assert.deepEqual(serialized, {
      data: {
        lid: article[localId],
        type: 'card',
        attributes: {
          cardTitle: 'How to Test Nested Fields',
          category: {
            cardTitle: 'Programming',
            priority: 1,
            tags: [
              { name: 'javascript', color: 'yellow', priority: 5 },
              { name: 'testing', color: 'green', isActive: 1 },
              { name: 'serialization', color: 'blue' },
            ],
          },
          cardInfo,
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Article',
          },
          fields: {
            category: {
              fields: {
                tags: [
                  {
                    adoptsFrom: {
                      module: `${testRealmURL}test-cards`,
                      name: 'PriorityTag',
                    },
                  },
                  {
                    adoptsFrom: {
                      module: `${testRealmURL}test-cards`,
                      name: 'StatusTag',
                    },
                  },
                  {},
                ],
              },
            },
          },
        },
      },
    });

    // Test deserialization roundtrip
    let deserializedArticle = await createFromSerialized(
      serialized.data,
      serialized,
      undefined,
    );

    if (deserializedArticle instanceof Article) {
      assert.strictEqual(
        deserializedArticle.title,
        'How to Test Nested Fields',
      );
      let { category } = deserializedArticle;

      if (category instanceof Category) {
        assert.strictEqual(category.title, 'Programming');
        assert.strictEqual(category.priority, 1);
        assert.strictEqual(category.tags.length, 3, 'correct number of tags');

        // Check first tag (PriorityTag)
        let tag0 = category.tags[0] as PriorityTag;
        assert.ok(tag0 instanceof PriorityTag, 'first tag is PriorityTag');
        assert.strictEqual(tag0.name, 'javascript');
        assert.strictEqual(tag0.color, 'yellow');
        assert.strictEqual(tag0.priority, 5);

        // Check second tag (StatusTag)
        let tag1 = category.tags[1] as StatusTag;
        assert.ok(tag1 instanceof StatusTag, 'second tag is StatusTag');
        assert.strictEqual(tag1.name, 'testing');
        assert.strictEqual(tag1.color, 'green');
        assert.strictEqual(tag1.isActive, 1);

        // Check third tag (base Tag)
        let tag2 = category.tags[2] as Tag;
        assert.ok(tag2 instanceof Tag, 'third tag is base Tag');
        assert.strictEqual(tag2.name, 'serialization');
        assert.strictEqual(tag2.color, 'blue');
      } else {
        assert.ok(false, 'category field is not an instance of Category');
      }
    } else {
      assert.ok(false, 'deserialized card is not an instance of Article');
    }
  });

  test('can deserialize polymorphic containsMany with nested polymorphic values', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class Role extends FieldDef {
      @field roleName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Role) {
          return this.roleName;
        },
      });
      @field cardDescription = contains(StringField, { computeVia: () => 'Role' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    class DogWalker extends Role {
      @field poopBagCount = contains(NumberField);
    }

    class Employee extends Person {
      @field roles = containsMany(Role);
    }

    class Group extends CardDef {
      @field people = containsMany(Person);
      @field cardTitle = contains(StringField, { computeVia: () => 'Group' });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A group of people',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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
        lid: group[localId],
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
          cardInfo,
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
      @field cardDescription = contains(StringField);
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
              cardDescription: 'Toilet paper ghost: Poooo!',
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
    assert.true(isSaved(pet), 'Pet card is saved');
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

  test('can deserialize a heterogenous polymorphic linksToMany relationship targeting CardDef', async function (assert) {
    class DrumKitCard extends CardDef {
      @field name = contains(StringField);
    }

    class BeatMakerCard extends CardDef {
      @field cardTitle = contains(StringField);
    }

    class Listing extends CardDef {
      @field examples = linksToMany(() => CardDef);
    }

    let listingFields = getFields(Listing);
    assert.strictEqual(
      listingFields.examples.card.name,
      'CardDef',
      'Listing examples field still targets CardDef before serialization',
    );

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Listing, DrumKitCard, BeatMakerCard },
      },
    });

    assert.strictEqual(
      getFields(Listing).examples.card.name,
      'CardDef',
      'Listing examples field still targets CardDef after realm setup',
    );

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          cardInfo: {},
        },
        relationships: {
          'examples.0': {
            links: {
              self: `${testRealmURL}DrumKitCard/kit`,
            },
            data: {
              id: `${testRealmURL}DrumKitCard/kit`,
              type: 'card',
            },
          },
          'examples.1': {
            links: {
              self: `${testRealmURL}BeatMakerCard/app`,
            },
            data: {
              id: `${testRealmURL}BeatMakerCard/app`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Listing',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}DrumKitCard/kit`,
          type: 'card',
          attributes: {
            name: '808 Analog Kit',
            cardInfo: {},
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'DrumKitCard',
            },
          },
        },
        {
          id: `${testRealmURL}BeatMakerCard/app`,
          type: 'card',
          attributes: {
            cardTitle: 'Beat Maker Studio',
            cardInfo: {},
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'BeatMakerCard',
            },
          },
        },
      ],
    };

    let listing = await createFromSerialized<typeof Listing>(
      doc.data,
      doc,
      undefined,
    );

    assert.ok(listing instanceof Listing, 'listing deserialized');
    assert.strictEqual(listing.examples.length, 2, 'both examples loaded');
    assert.ok(
      listing.examples[0] instanceof DrumKitCard,
      'first entry is DrumKitCard instance',
    );
    assert.ok(
      listing.examples[1] instanceof BeatMakerCard,
      'second entry is BeatMakerCard instance',
    );
  });

  test('can deserialize a heterogenous polymorphic linksToMany relationship targeting CardDef from array format', async function (assert) {
    class DrumKitCard extends CardDef {
      @field name = contains(StringField);
    }

    class BeatMakerCard extends CardDef {
      @field cardTitle = contains(StringField);
    }

    class Listing extends CardDef {
      @field examples = linksToMany(() => CardDef);
    }

    let listingFields = getFields(Listing);
    assert.strictEqual(
      listingFields.examples.card.name,
      'CardDef',
      'Listing examples field still targets CardDef before serialization',
    );

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Listing, DrumKitCard, BeatMakerCard },
      },
    });

    assert.strictEqual(
      getFields(Listing).examples.card.name,
      'CardDef',
      'Listing examples field still targets CardDef after realm setup',
    );

    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          cardInfo: {},
        },
        relationships: {
          examples: [
            {
              links: {
                self: `${testRealmURL}DrumKitCard/kit`,
              },
            },
            {
              links: {
                self: `${testRealmURL}BeatMakerCard/app`,
              },
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'Listing',
          },
        },
      },
      included: [
        {
          id: `${testRealmURL}DrumKitCard/kit`,
          type: 'card',
          attributes: {
            name: '808 Analog Kit',
            cardInfo: {},
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'DrumKitCard',
            },
          },
        },
        {
          id: `${testRealmURL}BeatMakerCard/app`,
          type: 'card',
          attributes: {
            cardTitle: 'Beat Maker Studio',
            cardInfo: {},
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}test-cards`,
              name: 'BeatMakerCard',
            },
          },
        },
      ],
    };

    let listing = await createFromSerialized<typeof Listing>(
      doc.data,
      doc,
      undefined,
    );

    assert.ok(listing instanceof Listing, 'listing deserialized');
    assert.strictEqual(listing.examples.length, 2, 'both examples loaded');
    assert.ok(
      listing.examples[0] instanceof DrumKitCard,
      'first entry is DrumKitCard instance',
    );
    assert.ok(
      listing.examples[1] instanceof BeatMakerCard,
      'second entry is BeatMakerCard instance',
    );
  });

  test('can deserialize a card from a resource object', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
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
          lid: person[localId],
          type: 'card',
          attributes: {
            firstName: 'Mango',
            cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'Person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, { computeVia: () => 'Post' });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }

    await setupIntegrationTestRealm({
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
          cardTitle: 'Things I Want to Chew',
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
          lid: post[localId],
          type: 'card',
          attributes: {
            cardTitle: 'Things I Want to Chew',
            author: {
              firstName: 'Mango',
            },
            cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends FieldDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A post',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Blog extends CardDef {
      @field posts = containsMany(Post);
      @field _metadata = contains(StringField, { computeVia: () => 'Blog' });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A blog post',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
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
              cardTitle: 'Things I Want to Chew',
              author: {
                firstName: 'Mango',
              },
            },
            {
              cardTitle: 'When Mango Steals My Bone',
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
          lid: blog[localId],
          type: 'card',
          attributes: {
            posts: [
              {
                cardTitle: 'Things I Want to Chew',
                author: {
                  firstName: 'Mango',
                },
              },
              {
                cardTitle: 'When Mango Steals My Bone',
                author: {
                  firstName: 'Van Gogh',
                },
              },
            ],
            cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A person',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Post extends FieldDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A post',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    class Blog extends CardDef {
      @field posts = containsMany(Post);
      @field _metadata = contains(StringField, { computeVia: () => 'Blog' });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A blog post',
      });
      @field editor = contains(Person);
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
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
              cardTitle: 'Things I Want to Chew',
              author: {
                firstName: 'Mango',
              },
            },
            {
              cardTitle: 'When Mango Steals My Bone',
              author: {
                firstName: 'Van Gogh',
              },
            },
          ],
          cardInfo: {},
        },
        relationships: {
          'editor.certificate': {
            links: {
              self: `${testRealmURL}Certificate/0`,
            },
            data: {
              id: `${testRealmURL}Certificate/0`,
              type: 'card',
            },
          },
          'posts.0.author.certificate': {
            links: {
              self: `${testRealmURL}Certificate/1`,
            },
            data: {
              id: `${testRealmURL}Certificate/1`,
              type: 'card',
            },
          },
          'posts.1.author.certificate': {
            links: {
              self: `${testRealmURL}Certificate/2`,
            },
            data: {
              id: `${testRealmURL}Certificate/2`,
              type: 'card',
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
            cardThumbnailURL: null,
            cardInfo: {},
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
            cardThumbnailURL: null,
            cardInfo: {},
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
            cardThumbnailURL: null,
            cardInfo: {},
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
          lid: blog[localId],
          type: 'card',
          attributes: {
            editor: {
              firstName: 'Bob',
            },
            posts: [
              {
                cardTitle: 'Things I Want to Chew',
                author: {
                  firstName: 'Mango',
                },
              },
              {
                cardTitle: 'When Mango Steals My Bone',
                author: {
                  firstName: 'Van Gogh',
                },
              },
            ],
            cardInfo,
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
              earnedOn: '2023-11-05',
              level: 20,
              cardInfo,
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
              earnedOn: '2023-10-01',
              level: 18,
              cardInfo,
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
              earnedOn: '2022-05-01',
              level: 25,
              cardInfo,
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
      @field cardTitle = contains(StringField, { computeVia: () => 'Person' });
      @field cardDescription = contains(StringField, {
        computeVia: () => 'A person with birthdate',
      });
      @field cardThumbnailURL = contains(StringField, { computeVia: () => null });
    }
    await setupIntegrationTestRealm({
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
        lid: mango[localId],
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
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
        lid: mango[localId],
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
          firstBirthday: '2020-10-30',
          cardTitle: 'Person',
          cardDescription: 'A person with birthdate',
          cardThumbnailURL: null,
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
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
          cardInfo,
        },
        meta: {
          adoptsFrom: {
            module: `../test-cards`,
            name: 'Person',
          },
        },
      },
    });
  });

  test('can serialize a card that is constructed by another card (test realm)', async function (assert) {
    await setupIntegrationTestRealm({
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

    let store = getService('store');
    let captainMango = await store.get(`${testRealmURL}Captain/mango`);
    let mangoTheBoat = (captainMango as Captain).createEponymousBoat();

    assert.deepEqual(
      serializeCard(mangoTheBoat, { includeUnrenderedFields: true }),
      {
        data: {
          lid: mangoTheBoat[localId],
          type: 'card',
          attributes: {
            name: 'Mango',
            cardInfo,
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });

      createEponymousPet() {
        return new Pet({ name: this.firstName });
      }
    }

    await setupIntegrationTestRealm({
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
          lid: mangoThePet[localId],
          type: 'card',
          attributes: {
            name: 'Mango',
            cardInfo,
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

  test('query field relationships are omitted when serializing for persistence', async function (assert) {
    class Person extends CardDef {
      @field name = contains(StringField);
    }
    class QueryCard extends CardDef {
      @field cardTitle = contains(StringField);
      @field favorite = linksTo(() => Person, {
        query: {
          filter: {
            eq: { name: '$this.title' },
          },
        },
      });
      @field matches = linksToMany(() => Person, {
        query: {
          filter: {
            eq: { name: '$this.title' },
          },
          page: {
            size: 5,
            number: 0,
          },
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'query-card.gts': { Person, QueryCard },
      },
    });

    let card = new QueryCard({ cardTitle: 'Target' });
    let serialized = serializeCard(card, {
      includeUnrenderedFields: true,
      omitQueryFields: true,
    });

    assert.strictEqual(
      serialized.data.relationships?.favorite,
      undefined,
      'linksTo query field is not persisted',
    );
    assert.strictEqual(
      serialized.data.relationships?.matches,
      undefined,
      'linksToMany query field is not persisted',
    );
  });

  module('linksToMany', function () {
    test('can serialize a linksToMany relationship', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
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
          lid: hassan[localId],
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            cardInfo,
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
              firstName: 'Mango',
              cardInfo,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
              cardInfo,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
        ],
      });
    });

    test('can serialize a linksToMany relationship with unsaved links', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
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

      let serialized = serializeCard(hassan);
      assert.deepEqual(serialized, {
        data: {
          lid: hassan[localId],
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            cardInfo,
          },
          relationships: {
            'pets.0': {
              data: { lid: mango[localId], type: 'card' },
            },
            'pets.1': {
              data: { lid: vanGogh[localId], type: 'card' },
            },
          },
          meta: {
            adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Person' },
          },
        },
        included: [
          {
            lid: mango[localId],
            type: 'card',
            attributes: {
              firstName: 'Mango',
              cardInfo,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            lid: vanGogh[localId],
            type: 'card',
            attributes: {
              firstName: 'Van Gogh',
              cardInfo,
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
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            cardDescription: null,
            firstName: 'Hassan',
            cardThumbnailURL: null,
            cardInfo: {},
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
              data: {
                id: `${testRealmURL}Pet/mango`,
                type: 'card',
              },
            },
            'pets.1': {
              links: {
                self: `${testRealmURL}Pet/vanGogh`,
              },
              data: {
                id: `${testRealmURL}Pet/vanGogh`,
                type: 'card',
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
              cardDescription: null,
              firstName: 'Mango',
              cardThumbnailURL: null,
              cardInfo: {},
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            type: 'card',
            attributes: {
              cardDescription: null,
              firstName: 'Van Gogh',
              cardThumbnailURL: null,
              cardInfo: {},
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
        assert.true(isSaved(mango), 'Pet[0] card is saved');
        assert.strictEqual(mango.firstName, 'Mango');
      } else {
        assert.ok(false, '"pets[0]" is not an instance of Pet');
      }
      if (vanGogh instanceof Pet) {
        assert.true(isSaved(vanGogh), 'Pet[1] card is saved');
        assert.strictEqual(vanGogh.firstName, 'Van Gogh');
      } else {
        assert.ok(false, '"pets[1]" is not an instance of Pet');
      }

      let relationships = relationshipMeta(card, 'pets');
      if (relationships !== undefined && Array.isArray(relationships)) {
        let [mangoRelationship, vanGoghRelationship] = relationships;

        if (mangoRelationship?.type === 'loaded') {
          let relatedCard = mangoRelationship.card;
          assert.true(relatedCard instanceof Pet, 'related card is a Pet');
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for mango');
        }
        if (vanGoghRelationship?.type === 'loaded') {
          let relatedCard = vanGoghRelationship.card;
          assert.true(relatedCard instanceof Pet, 'related card is a Pet');
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

    test('can deserialize a linksToMany relationship from array format', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            cardDescription: null,
            firstName: 'Hassan',
            cardThumbnailURL: null,
            cardInfo: {},
          },
          relationships: {
            pets: [
              {
                links: {
                  self: `${testRealmURL}Pet/mango`,
                },
              },
              {
                links: {
                  self: `${testRealmURL}Pet/vanGogh`,
                },
              },
            ],
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
              cardDescription: null,
              firstName: 'Mango',
              cardThumbnailURL: null,
              cardInfo: {},
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            type: 'card',
            attributes: {
              cardDescription: null,
              firstName: 'Van Gogh',
              cardThumbnailURL: null,
              cardInfo: {},
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
        assert.true(isSaved(mango), 'Pet[0] card is saved');
        assert.strictEqual(mango.firstName, 'Mango');
      } else {
        assert.ok(false, '"pets[0]" is not an instance of Pet');
      }
      if (vanGogh instanceof Pet) {
        assert.true(isSaved(vanGogh), 'Pet[1] card is saved');
        assert.strictEqual(vanGogh.firstName, 'Van Gogh');
      } else {
        assert.ok(false, '"pets[1]" is not an instance of Pet');
      }

      let relationships = relationshipMeta(card, 'pets');
      if (relationships !== undefined && Array.isArray(relationships)) {
        let [mangoRelationship, vanGoghRelationship] = relationships;

        if (mangoRelationship?.type === 'loaded') {
          let relatedCard = mangoRelationship.card;
          assert.true(relatedCard instanceof Pet, 'related card is a Pet');
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/mango`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for mango');
        }
        if (vanGoghRelationship?.type === 'loaded') {
          let relatedCard = vanGoghRelationship.card;
          assert.true(relatedCard instanceof Pet, 'related card is a Pet');
          assert.strictEqual(relatedCard?.id, `${testRealmURL}Pet/vanGogh`);
        } else {
          assert.ok(false, 'relationship type was not "loaded" for vanGogh');
        }
      } else {
        assert.ok(false, 'relationshipMeta returned an unexpected value');
      }
    });

    test('can serialize a linksToMany relationship with nested linksTo field', async function (assert) {
      class Toy extends CardDef {
        @field cardDescription = contains(StringField);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Toy) {
            return this.description;
          },
        });
      }
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field favoriteToy = linksTo(Toy);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet, Toy },
        },
      });

      let spookyToiletPaper = new Toy({
        cardDescription: 'Toilet paper ghost: Poooo!',
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
          lid: hassan[localId],
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            cardInfo,
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
              cardDescription: 'Toilet paper ghost: Poooo!',
              cardInfo,
            },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Toy' },
            },
          },
          {
            id: `${testRealmURL}Pet/mango`,
            type: 'card',
            attributes: {
              firstName: 'Mango',
              cardInfo,
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
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field cardDescription = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field cardThumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });

      let hassan = new Person({ firstName: 'Hassan' });

      let serialized = serializeCard(hassan, { includeUnrenderedFields: true });
      assert.deepEqual(serialized, {
        data: {
          lid: hassan[localId],
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            cardInfo,
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
          lid: mango[localId],
          type: 'card',
          attributes: {
            firstName: 'Mango',
            cardInfo,
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
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
        },
      });

      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            cardDescription: null,
            firstName: 'Hassan',
            cardThumbnailURL: null,
            cardInfo: {},
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
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
        @field cardDescription = contains(StringField, { computeVia: () => 'Pet' });
        @field cardThumbnailURL = contains(StringField, {
          computeVia: () => 'pet.svg',
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field cardDescription = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field cardThumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
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
            cardInfo,
          },
          relationships: {
            'pets.0': {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
              data: {
                id: `${testRealmURL}Pet/mango`,
                type: 'card',
              },
            },
            'pets.1': {
              links: {
                self: `${testRealmURL}Pet/vanGogh`,
              },
              data: {
                id: `${testRealmURL}Pet/vanGogh`,
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
              cardInfo,
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

      hassan.pets; // no longer throws NotLoaded

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
          lid: hassan[localId],
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            cardInfo,
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
              cardInfo,
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
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field cardDescription = contains(StringField, {
          computeVia: () => 'Person',
        });
        @field cardThumbnailURL = contains(StringField, {
          computeVia: () => 'person.svg',
        });
      }
      await setupIntegrationTestRealm({
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
            cardInfo,
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
              cardInfo,
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
              cardInfo,
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
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
      }
      await setupIntegrationTestRealm({
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
            cardDescription: null,
            firstName: 'Hassan',
            cardThumbnailURL: null,
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
              cardDescription: null,
              firstName: 'Mango',
              cardThumbnailURL: null,
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
              cardDescription: null,
              firstName: 'Van Gogh',
              cardThumbnailURL: null,
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
        lid: burcu[localId],
        type: 'card',
        attributes: {
          firstName: 'Burcu',
          cardTitle: 'Untitled Card',
          cardDescription: null,
          cardThumbnailURL: null,
          cardInfo,
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
            cardTitle: 'Untitled Card',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
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
            cardTitle: 'Untitled Card',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
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
            cardTitle: 'Untitled Card',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
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
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', cardTitle: null },
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
            attributes: { name: 'Mango', cardTitle: null },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Pet/van-gogh`,
            type: 'card',
            attributes: { name: 'Van Gogh', cardTitle: null },
            meta: {
              adoptsFrom: { module: `${testRealmURL}test-cards`, name: 'Pet' },
            },
          },
          {
            id: `${testRealmURL}Friend/hassan`,
            type: 'card',
            attributes: { firstName: 'Hassan', cardTitle: null },
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
        assert.true(isSaved(mango), 'Pet[0] card is saved');
        assert.strictEqual(mango.name, 'Mango');
      } else {
        assert.ok(false, '"pets[0]" is not an instance of Pet');
      }
      if (vanGogh instanceof Pet) {
        assert.true(isSaved(vanGogh), 'Pet[1] card is saved');
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
          lid: person[localId],
          type: 'card',
          attributes: {
            firstName: 'Burcu',
            cardTitle: 'Untitled Card',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
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
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Friend, Person, Pet },
        },
      });
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { firstName: 'Burcu', cardTitle: null },
          relationships: {
            friend: { links: { self: null } },
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
        @field ownPets = linksToMany(Pet);
        @field friendPets = linksToMany(Pet, {
          computeVia: function (this: Person) {
            return this.friend?.pets;
          },
        });
      }
      await setupIntegrationTestRealm({
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
            'ownPets.0': {
              links: { self: `${testRealmURL}Pet/mango` },
              data: {
                id: `${testRealmURL}Pet/mango`,
                type: 'card',
              },
            },
            'ownPets.1': {
              links: { self: `${testRealmURL}Pet/vanGogh` },
              data: {
                id: `${testRealmURL}Pet/vanGogh`,
                type: 'card',
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

      card.friend; // No longer throws NotLoaded
      card.friendPets; // No longer throws NotLoaded
      card.ownPets; // No longer throws NotLoaded

      let relationships = relationshipMeta(card, 'ownPets');
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
        friendPets: { links: { self: null } },
        'ownPets.0': {
          links: { self: `${testRealmURL}Pet/mango` },
          data: { type: 'card', id: `${testRealmURL}Pet/mango` },
        },
        'ownPets.1': {
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
          @field cardTitle = contains(StringField);
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
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let resource = {
          attributes: {
            cardTitle: 'Number Test Cases',
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
          @field cardTitle = contains(StringField);
          @field someNumber = contains(NumberField);
          @field someNull = contains(NumberField);
        }

        await setupIntegrationTestRealm({
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
          typeof serialized?.data?.attributes?.someNumber,
          'number',
        );
        assert.notStrictEqual(
          typeof serialized?.data?.attributes?.someNumber,
          'string',
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
          @field cardTitle = contains(StringField);
          @field someBigInt = contains(BigIntegerField);
          @field someNull = contains(BigIntegerField);
          @field someString = contains(BigIntegerField);
          @field someNumber = contains(BigIntegerField);
          @field someNegativeNumber = contains(BigIntegerField);
          @field someDecimal = contains(BigIntegerField);
          @field someZeroString = contains(BigIntegerField);
        }
        await setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let resource = {
          attributes: {
            cardTitle: 'BigInt Test Cases',
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

        assert.true(isBigInt(sample.someBigInt));
        assert.true(isBigInt(sample.someNumber));
        assert.true(isBigInt(sample.someNegativeNumber));
        assert.true(isBigInt(sample.someZeroString));

        // failed to deserialize
        assert.strictEqual(sample.someNull, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.someDecimal, null);
      });

      test('can serialize field', async function (assert) {
        class Sample extends CardDef {
          @field cardTitle = contains(StringField);
          @field someBigInt = contains(BigIntegerField);
          @field someNull = contains(BigIntegerField);
        }

        await setupIntegrationTestRealm({
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
          typeof serialized?.data?.attributes?.someBigInt,
          'string',
        );
        assert.notStrictEqual(
          typeof serialized?.data?.attributes?.someBigInt,
          'number',
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
          @field cardTitle = contains(StringField);
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
          @field cardTitle = contains(StringField);
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
          mockMatrixUtils,
          contents: {
            'test-cards.gts': { Sample },
          },
        });

        let resource = {
          attributes: {
            cardTitle: 'Ethereum Test Cases',
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

        assert.true(isEthAddress(sample.someAddress));
        assert.true(isEthAddress(sample.checksummedAddressThatDontLookLikeOne));

        // failed to deserialize
        assert.strictEqual(sample.faultyAddress, null);
        assert.strictEqual(sample.nonChecksummedAddress, null);
        assert.strictEqual(sample.bitcoinAddress, null);
        assert.strictEqual(sample.someString, null);
        assert.strictEqual(sample.someNull, null);
      });

      test('can serialize field', async function (assert) {
        class Sample extends CardDef {
          @field cardTitle = contains(StringField);
          @field someAddress = contains(EthereumAddressField);
          @field nonChecksummedAddress = contains(EthereumAddressField);
          @field someNull = contains(EthereumAddressField);
        }

        await setupIntegrationTestRealm({
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
          typeof serialized?.data?.attributes?.someAddress,
          'string',
        );
        assert.notStrictEqual(
          typeof serialized?.data?.attributes?.someAddress,
          'number',
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
