import { module, test, skip } from 'qunit';
import { TestRealm, TestRealmAdapter, testRealmURL } from '../helpers';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { SearchIndex } from '@cardstack/runtime-common/search-index';
import { Loader } from '@cardstack/runtime-common/loader';

let paths = new RealmPaths(testRealmURL);

module('Unit | search-index', function (hooks) {
  hooks.before(function () {
    Loader.destroy();
  });

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
        module: `${testRealmURL}person`,
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
      module: `${testRealmURL}person`,
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
      module: `${testRealmURL}fancy-person`,
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: `${testRealmURL}person`,
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
      module: `${testRealmURL}person`,
      name: 'FancyPerson',
    });
    assert.deepEqual(definition?.super, {
      type: 'exportedCard',
      module: `${testRealmURL}person`,
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
        module: `${testRealmURL}person`,
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
        module: `${testRealmURL}person`,
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
          module: `${testRealmURL}person`,
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

  const testModuleRealm = 'http://localhost:4201/test/';
  module('query', function (hooks) {
    const sampleCards = {
      'card-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: { firstName: 'Cardy' },
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}article`,
              name: 'Article',
            },
          },
        },
      },
      'card-2.json': {
        data: {
          type: 'card',
          attributes: { author: { firstName: 'Cardy' } },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        },
      },
      'cards/1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: { firstName: 'Carl', lastName: 'Stack' },
            createdAt: new Date(2022, 7, 1),
            views: 10,
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}post`, name: 'Post' },
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
              firstName: 'Carl',
              lastName: 'Deck',
              email: 'carl@stack.com',
            },
            createdAt: new Date(2022, 7, 22),
            views: 5,
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}article`,
              name: 'Article',
            },
          },
        },
      },
      'books/1.json': {
        data: {
          type: 'card',
          attributes: {
            author: { firstName: 'Mango', lastName: 'Abdel-Rahman' },
            editions: 1,
            pubDate: '2022-07-01',
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        },
      },
      'books/2.json': {
        data: {
          type: 'card',
          attributes: {
            author: { firstName: 'Van Gogh', lastName: 'Abdel-Rahman' },
            editions: 0,
            pubDate: '2023-08-01',
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        },
      },
      'books/3.json': {
        data: {
          type: 'card',
          attributes: {
            author: { firstName: 'Jackie', lastName: 'Aguilar' },
            editions: 2,
            pubDate: '2022-08-01',
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}book`, name: 'Book' },
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
          on: { module: `${testModuleRealm}post`, name: 'Post' },
          eq: { title: 'Card 1', description: 'Sample post' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}card-1`, `${paths.url}cards/1`]
      );
    });

    test(`can search for cards by using a computed field`, async function (assert) {
      let matching = await indexer.search({
        filter: {
          on: { module: `${testModuleRealm}post`, name: 'Post' },
          eq: { 'author.fullName': 'Carl Stack' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}cards/1`]
      );
    });

    test('can combine multiple filters', async function (assert) {
      let matching = await indexer.search({
        filter: {
          on: {
            module: `${testModuleRealm}post`,
            name: 'Post',
          },
          every: [
            { eq: { title: 'Card 1' } },
            { not: { eq: { 'author.firstName': 'Cardy' } } },
          ],
        },
      });
      assert.strictEqual(matching.length, 1);
      assert.strictEqual(matching[0]?.id, `${testRealmURL}cards/1`);
    });

    test('can handle a filter with double negatives', async function (assert) {
      let matching = await indexer.search({
        filter: {
          on: { module: `${testModuleRealm}post`, name: 'Post' },
          not: { not: { not: { eq: { 'author.email': 'carl@stack.com' } } } },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}card-1`, `${paths.url}cards/1`]
      );
    });

    test('can filter by card type', async function (assert) {
      let matching = await indexer.search({
        filter: {
          type: { module: `${testModuleRealm}article`, name: 'Article' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}card-1`, `${paths.url}cards/2`],
        'found cards of type Article'
      );

      matching = await indexer.search({
        filter: { type: { module: `${testModuleRealm}post`, name: 'Post' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}card-1`, `${paths.url}cards/1`, `${paths.url}cards/2`],
        'found cards of type Post'
      );
    });

    skip(`can filter on a card's own fields using gt`);

    test(`gives a good error when query refers to missing card`, async function (assert) {
      try {
        await indexer.search({
          filter: {
            on: {
              module: `${testModuleRealm}nonexistent`,
              name: 'Nonexistent',
            },
            eq: { nonExistentField: 'hello' },
          },
        });
        throw new Error('failed to throw expected exception');
      } catch (err: any) {
        assert.strictEqual(
          err.message,
          `Your filter refers to nonexistent type: import { Nonexistent } from "${testModuleRealm}nonexistent"`
        );
      }
    });

    test(`gives a good error when query refers to missing field`, async function (assert) {
      try {
        await indexer.search({
          filter: {
            on: { module: `${testModuleRealm}post`, name: 'Post' },
            eq: {
              'author.firstName': 'Cardy',
              'author.nonExistentField': 'hello',
            },
          },
        });
        throw new Error('failed to throw expected exception');
      } catch (err: any) {
        assert.strictEqual(
          err.message,
          `Your filter refers to nonexistent field \"nonExistentField\" on type ${testModuleRealm}person/Person`
        );
      }
    });

    test(`can filter on a nested field using 'eq'`, async function (assert) {
      let matching = await indexer.search({
        filter: {
          on: { module: `${testModuleRealm}post`, name: 'Post' },
          eq: { 'author.firstName': 'Carl' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}cards/1`, `${paths.url}cards/2`]
      );
    });

    test('can negate a filter', async function (assert) {
      let matching = await indexer.search({
        filter: {
          on: { module: `${testModuleRealm}article`, name: 'Article' },
          every: [{ not: { eq: { 'author.email': 'carl@stack.com' } } }],
        },
      });
      assert.strictEqual(matching.length, 1);
      assert.strictEqual(matching[0]?.id, `${testRealmURL}card-1`);
    });

    test('can combine multiple types', async function (assert) {
      let matching = await indexer.search({
        filter: {
          any: [
            {
              on: { module: `${testModuleRealm}article`, name: 'Article' },
              eq: { 'author.firstName': 'Cardy' },
            },
            {
              on: { module: `${testModuleRealm}book`, name: 'Book' },
              eq: { 'author.firstName': 'Cardy' },
            },
          ],
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}card-1`, `${paths.url}card-2`]
      );
    });

    // sorting
    test('can sort in alphabetical order', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'author.firstName',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}card-2`, // Cardy
          `${paths.url}books/3`, // Jackie
          `${paths.url}books/1`, // Mango
          `${paths.url}books/2`, // Van Gogh
        ]
      );
    });

    test('can sort in reverse alphabetical order', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'author.lastName',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            direction: 'desc',
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}card-2`, // lastName is null
          `${paths.url}books/3`,
          `${paths.url}books/1`,
          `${paths.url}books/2`,
        ]
      );
    });

    test('can sort by multiple string field conditions in given directions', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'author.lastName',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
          },
          {
            by: 'author.firstName',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            direction: 'desc',
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}books/2`, // Van Gogh Ab
          `${paths.url}books/1`, // Mango Ab
          `${paths.url}books/3`, // Jackie Ag
          `${paths.url}card-2`, // Cardy --> lastName is null
        ]
      );
    });

    test('can sort by integer value', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'editions',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}books/2`, // 0
          `${paths.url}books/1`, // 1
          `${paths.url}books/3`, // 2
          `${paths.url}card-2`, // null
        ]
      );
    });

    test('can sort by date', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'pubDate',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}books/1`, // 2022-07-01
          `${paths.url}books/3`, // 2022-08-01
          `${paths.url}books/2`, // 2023-08-01
          `${paths.url}card-2`, // null
        ]
      );
    });

    test('can sort by mixed field types', async function (assert) {
      let matching = await indexer.search({
        sort: [
          {
            by: 'author.lastName',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            direction: 'desc',
          },
          {
            by: 'editions',
            on: { module: `${testModuleRealm}book`, name: 'Book' },
          },
        ],
        filter: { type: { module: `${testModuleRealm}book`, name: 'Book' } },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [
          `${paths.url}card-2`, // both fields are null
          `${paths.url}books/3`, // 2
          `${paths.url}books/2`, // 0
          `${paths.url}books/1`, // 1
        ]
      );
    });

    skip(`can sort on multiple paths in combination with 'any' filter`);
    skip(`can sort on multiple paths in combination with 'every' filter`);
  });
});
