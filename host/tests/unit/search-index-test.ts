import { module, test, skip } from 'qunit';
import { TestRealm, TestRealmAdapter, testRealmURL } from '../helpers';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { SearchIndex } from '@cardstack/runtime-common/search-index';

let paths = new RealmPaths(testRealmURL);

module('Unit | search-index', function () {
  test('full indexing discovers card instances', async function (assert) {
    let adapter = new TestRealmAdapter({
      'empty.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
    });
    let realm = TestRealm.createWithAdapter(adapter);
    let indexer = realm.searchIndex;
    await indexer.run();
    let cards = await indexer.search({});
    assert.deepEqual(cards, [
      {
        id: `${testRealmURL}empty`,
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'Card',
          },
          lastModified: adapter.lastModified.get(`${testRealmURL}empty.json`),
        },
      },
    ]);
  });

  test('full indexing identifies the exported cards in a module', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let refs = await indexer.exportedCardsOf('person.gts');
    assert.deepEqual(refs, [
      {
        type: 'exportedCard',
        module: `${testRealmURL}person.gts`,
        name: 'FancyPerson',
      },
    ]);
  });

  test('full indexing discovers card source where super class card comes from outside local realm', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();

    let definition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'person.gts',
      name: 'Person',
    });
    assert.deepEqual(definition?.id, {
      type: 'exportedCard',
      module: `${testRealmURL}person.gts`,
      name: 'Person',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: 'https://cardstack.com/base/card-api',
      name: 'Card',
    });
    assert.deepEqual(definition?.fields.get('firstName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
    assert.deepEqual(definition?.fields.get('lastName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
  });

  test('full indexing discovers card source where super class card comes from different module in the local realm', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
      'fancy-person.gts': `
        import { contains, field } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';
        import { Person } from './person';

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'fancy-person.gts',
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.id, {
      type: 'exportedCard',
      module: `${testRealmURL}fancy-person.gts`,
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: `${testRealmURL}person`, // this does not have the ".gts" extension because we import it as just "./person"
      name: 'Person',
    });

    assert.deepEqual(definition?.fields.get('lastName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });

    assert.deepEqual(definition?.fields.get('favoriteColor'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
  });

  test('full indexing discovers card source where super class card comes same module', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'person.gts',
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.id, {
      type: 'exportedCard',
      module: `${testRealmURL}person.gts`,
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: `${testRealmURL}person.gts`,
      name: 'Person',
    });
    assert.deepEqual(definition?.fields.get('lastName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
    assert.deepEqual(definition?.fields.get('favoriteColor'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
  });

  test('full indexing discovers internal cards that are consumed by an exported card', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'ancestorOf',
      card: {
        type: 'exportedCard',
        module: 'person.gts',
        name: 'FancyPerson',
      },
    });
    assert.deepEqual(definition?.id, {
      type: 'ancestorOf',
      card: {
        type: 'exportedCard',
        module: `${testRealmURL}person.gts`,
        name: 'FancyPerson',
      },
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: 'https://cardstack.com/base/card-api',
      name: 'Card',
    });
    assert.deepEqual(definition?.fields.get('firstName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
    assert.strictEqual(
      definition?.fields.get('favoriteColor'),
      undefined,
      'favoriteColor field does not exist on card'
    );
  });

  test('full indexing ignores card source where super class in a different module is not actually a card', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class NotACard {};

        export class Person extends NotACard {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
      'fancy-person.gts': `
        import { contains, field } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';
        import { Person } from './person';

        export class FancyPerson extends Person {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf({
        type: 'exportedCard',
        module: 'fancy-person.gts',
        name: 'FancyPerson',
      }),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  test('full indexing ignores card source where the super class is in the same module and not actually a card', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class NotACard {}

        export class FancyPerson extends NotACard {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf({
        type: 'exportedCard',
        module: 'person.gts',
        name: 'FancyPerson',
      }),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  test('full indexing ignores cards that are not exported from their module', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf({
        type: 'exportedCard',
        module: 'person.gts',
        name: 'Person',
      }),
      undefined,
      'Person is not actually a card (that is exported)'
    );
  });

  test('full indexing ignores card source where super class is in a different realm, but the realm says that the export is not actually a card', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, NotACard } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class FancyPerson extends NotACard {
          @field favoriteColor = contains(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    assert.strictEqual(
      await indexer.typeOf({
        type: 'exportedCard',
        module: 'person.gts',
        name: 'FancyPerson',
      }),
      undefined,
      'FancyPerson is not actually a card'
    );
  });

  test('full indexing discovers internal field cards that are consumed by an exported card', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class NewFieldCard extends Card {}

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(NewFieldCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'fieldOf',
      card: {
        type: 'exportedCard',
        module: 'person.gts',
        name: 'Person',
      },
      field: 'lastName',
    });
    assert.deepEqual(definition?.id, {
      type: 'fieldOf',
      card: {
        type: 'exportedCard',
        module: `${testRealmURL}person.gts`,
        name: 'Person',
      },
      field: 'lastName',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: 'https://cardstack.com/base/card-api',
      name: 'Card',
    });
    assert.strictEqual(definition?.fields.size, 0);

    let cardDefinition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'person.gts',
      name: 'Person',
    });
    assert.deepEqual(cardDefinition?.fields.get('firstName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
    assert.deepEqual(cardDefinition?.fields.get('lastName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'fieldOf',
        card: {
          type: 'exportedCard',
          module: `${testRealmURL}person.gts`,
          name: 'Person',
        },
        field: 'lastName',
      },
    });
  });

  test('full indexing ignores fields that are not actually fields', async function (assert) {
    let realm = TestRealm.create({
      'person.gts': `
        import { contains, field, Card, notAFieldDecorator, notAFieldType } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        class NotAFieldCard {}

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(NotAFieldCard);
          @notAFieldDecorator notAField = contains(StringCard);
          @field alsoNotAField = notAFieldType(StringCard);
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'person.gts',
      name: 'Person',
    });
    assert.deepEqual(definition?.fields.get('firstName'), {
      fieldType: 'contains',
      fieldCard: {
        type: 'exportedCard',
        module: 'https://cardstack.com/base/string',
        name: 'default',
      },
    });
    assert.strictEqual(
      definition?.fields.get('lastName'),
      undefined,
      'lastName field does not exist'
    );
    assert.strictEqual(
      definition?.fields.get('notAField'),
      undefined,
      'notAField field does not exist'
    );
    assert.strictEqual(
      definition?.fields.get('alsoNotAField'),
      undefined,
      'alsoNotAField field does not exist'
    );
  });

  test('parses first-class template syntax', async function (assert) {
    let realm = TestRealm.create({
      'my-card.gts': `
        import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';

        export class Person extends Card {
          @field firstName = contains(StringCard);

          static isolated = class Isolated extends Component<typeof this> {
            <template><div class="hi"><@fields.firstName /></div></template>
          }
        }
      `,
    });
    let indexer = realm.searchIndex;
    await indexer.run();
    let definition = await indexer.typeOf({
      type: 'exportedCard',
      module: 'my-card.gts',
      name: 'Person',
    });
    assert.ok(definition, 'got definition');
  });

  test('search index does not contain entries that match patterns in ignore files', async function (assert) {
    const cardSource = `
      import { Card } from 'https://cardstack.com/base/card-api';
      export class Post extends Card {}
    `;

    let realm = TestRealm.create({
      'sample-post.json': '',
      'posts/1.json': '',
      'posts/nested.gts': cardSource,
      'posts/ignore-me.gts': cardSource,
      'posts/2.json': '',
      'post.gts': cardSource,
      'dir/card.gts': cardSource,
      '.gitignore': `
*.json
dir/
posts/ignore-me.gts
      `,
    });

    let indexer = realm.searchIndex;
    await indexer.run();

    {
      let def = await indexer.typeOf({
        type: 'exportedCard',
        module: 'posts/ignore-me.gts',
        name: 'Post',
      });
      assert.strictEqual(
        def,
        undefined,
        'definition does not exist because file is ignored'
      );
    }
    {
      let def = await indexer.typeOf({
        type: 'exportedCard',
        module: 'dir/card.gts',
        name: 'Post',
      });
      assert.strictEqual(
        def,
        undefined,
        'definition does not exist because file is ignored'
      );
    }
    {
      let card = await indexer.card(new URL(`${testRealmURL}sample-post.json`));
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored'
      );
    }
    {
      let card = await indexer.card(new URL(`${testRealmURL}cards/2.json`));
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored'
      );
    }
    {
      let def = await indexer.typeOf({
        type: 'exportedCard',
        module: 'post.gts',
        name: 'Post',
      });
      assert.ok(def, 'definition exists');
    }
    {
      let def = await indexer.typeOf({
        type: 'exportedCard',
        module: 'posts/nested.gts',
        name: 'Post',
      });
      assert.ok(def, 'definition exists');
    }
  });

  test("search index incremental update doesn't process ignored files", async function (assert) {
    const cardSource = `
      import { Card } from 'https://cardstack.com/base/card-api';
      export class Post extends Card {}
    `;

    let realm = TestRealm.create({
      'posts/ignore-me.gts': cardSource,
      '.gitignore': `
posts/ignore-me.gts
      `,
    });

    let indexer = realm.searchIndex;
    await indexer.run();
    await indexer.update(new URL(`${testRealmURL}posts/ignore-me.gts`));

    let def = await indexer.typeOf({
      type: 'exportedCard',
      module: 'posts/ignore-me.gts',
      name: 'Post',
    });
    assert.strictEqual(
      def,
      undefined,
      'definition does not exist because file is ignored'
    );
  });

  module('query', function (hooks) {
    const sampleCards = {
      'cards.gts': `
        import { contains, field, Card } from 'https://cardstack.com/base/card-api';
        import StringCard from 'https://cardstack.com/base/string';
        import IntegerCard from 'https://cardstack.com/base/integer';

        export class Person extends Card {
          @field name = contains(StringCard);
          @field email = contains(StringCard);
        }

        export class Post extends Card {
          @field title = contains(StringCard);
          @field description = contains(StringCard);
          @field author = contains(Person);
          @fields views = contains(IntegerCard);
        }
      `,
      'card-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: {
              name: 'Cardy',
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'Card',
            },
          },
        },
      },
      'cards/1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: {
              name: 'Carl Stack',
            },
            createdAt: new Date(2022, 7, 1),
            views: 10,
          },
          meta: {
            adoptsFrom: {
              module: `${paths.url}/Post`,
              name: 'Card',
            },
          },
        },
      },
      'cards/2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 2',
            description: 'Sample post',
            author: {
              name: 'Carl Stack',
              email: 'carl@stack.com',
            },
            createdAt: new Date(2022, 7, 22),
            views: 5,
          },
          meta: {
            adoptsFrom: {
              module: `${paths.url}/Post`,
              name: 'Card',
            },
          },
        },
      },
    };

    let indexer: SearchIndex;

    hooks.beforeEach(async function () {
      let realm = TestRealm.create(sampleCards);
      indexer = realm.searchIndex;
      await indexer.run();
    });

    test(`can search for cards by using the 'eq' filter`, async function (assert) {
      let matching = await indexer.search({
        filter: {
          eq: {
            'attributes.title': 'Card 1',
            'attributes.description': 'Sample post',
          },
        },
      });
      assert.strictEqual(matching.length, 2, 'found two cards');
      assert.strictEqual(matching[0]?.id, `${testRealmURL}card-1`);
      assert.strictEqual(matching[1]?.id, `${testRealmURL}cards/1`);
    });

    test('can combine multiple filters', async function (assert) {
      let matching = await indexer.search({
        filter: {
          eq: {
            'attributes.title': 'Card 1',
          },
          not: {
            eq: {
              'attributes.author.name': 'Cardy',
            },
          },
        },
      });
      assert.strictEqual(matching.length, 1);
      assert.strictEqual(matching[0]?.id, `${testRealmURL}cards/1`);
    });

    // Tests from hub/**/**/card-service-test.ts
    skip('can filter by card type');
    skip(`can filter on a card's own fields using gt`);
    skip(`gives a good error when query refers to missing card`);
    skip(`gives a good error when query refers to missing field`);

    test(`can filter on a nested field using 'eq'`, async function (assert) {
      let matching = await indexer.search({
        filter: {
          eq: {
            'attributes.author.name': 'Carl Stack',
          },
        },
      });
      assert.strictEqual(matching.length, 2);
      assert.strictEqual(matching[0]?.id, `${testRealmURL}cards/1`);
      assert.strictEqual(matching[1]?.id, `${testRealmURL}cards/2`);
    });

    test('can negate a filter', async function (assert) {
      let matching = await indexer.search({
        filter: {
          not: {
            eq: {
              'attributes.author.email': 'carl@stack.com',
            },
          },
        },
      });
      assert.strictEqual(matching.length, 2);
      assert.strictEqual(matching[0]?.id, `${testRealmURL}card-1`);
      assert.strictEqual(matching[1]?.id, `${testRealmURL}cards/1`);
    });

    skip('can combine multiple types');
    skip('can sort in alphabetical order');
    skip('can sort in reverse alphabetical order');
    skip('can sort in multiple string field conditions');
    skip('can sort by multiple string field conditions in given directions');
    skip('can sort by integer value');
    skip('can sort by date');
    skip('can sort by mixed field types');
    skip(`can sort on multiple paths in combination with 'any' filter`);
    skip(`can sort on multiple paths in combination with 'every' filter`);
  });
});
