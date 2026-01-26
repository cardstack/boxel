import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  cleanWhiteSpace,
  testRealmURL,
  setupCardLogs,
  provideConsumeContext,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import {
  setupBaseRealm,
  StringField,
  NumberField,
  field,
  contains,
  CardDef,
  Component,
  FieldDef,
  containsMany,
  linksTo,
  linksToMany,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);

    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can render a synchronous computed field', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field fullName = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName} ${this.lastName}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.fullName /></template>
      };
    }

    let mango = new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' });
    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'Mango Abdel-Rahman');
  });

  test('can render a computed that consumes a nested property', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field summary = contains(StringField, {
        computeVia: function (this: Post) {
          return `${this.cardTitle} by ${this.author.firstName}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.summary /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post, Person },
      },
    });

    let firstPost = new Post({
      cardTitle: 'First Post',
      author: new Person({ firstName: 'Mango' }),
    });
    let root = await renderCard(loader, firstPost, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'First Post by Mango');
  });

  test('can render a computed that is a composite type', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test='firstName'><@fields.firstName /></span>
        </template>
      };
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person, {
        computeVia: function (this: Post) {
          let person = new Person();
          person.firstName = 'Mango';
          return person;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test='title'><@fields.cardTitle /></div>
          by
          <@fields.author />
        </template>
      };
    }
    let firstPost = new Post({ cardTitle: 'First Post' });
    await renderCard(loader, firstPost, 'isolated');
    assert.dom('[data-test="title"]').hasText('First Post');
    assert.dom('[data-test="firstName"]').hasText('Mango');
  });

  test('can render a containsMany computed primitive field', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field languagesSpoken = containsMany(StringField);
      @field reverseLanguagesSpoken = containsMany(StringField, {
        computeVia: function (this: Person) {
          return [...this.languagesSpoken].reverse();
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.firstName /> speaks <@fields.reverseLanguagesSpoken />
        </template>
      };
    }

    let mango = new Person({
      firstName: 'Mango',
      languagesSpoken: ['japanese', 'english'],
    });

    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'Mango speaks english japanese',
    );
  });

  test('supports an empty containsMany computed primitive field', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field languagesSpoken = containsMany(StringField);
      @field reverseLanguagesSpoken = containsMany(StringField, {
        computeVia: function (this: Person) {
          return [...this.languagesSpoken].reverse();
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.firstName /> speaks <@fields.reverseLanguagesSpoken />
        </template>
      };
    }

    let mango = new Person({ firstName: 'Mango' });
    await renderCard(loader, mango, 'isolated'); // just using to absorb asynchronicity
    assert.deepEqual(
      mango.reverseLanguagesSpoken,
      [],
      'empty containsMany field is initialized to an empty array',
    );
  });

  test('can render a containsMany computed composite field', async function (this: RenderingTestContext, assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-firstName><@fields.firstName /></div>
        </template>
      };
    }

    class Family extends CardDef {
      @field people = containsMany(Person);
      @field reversePeople = containsMany(Person, {
        computeVia: function (this: Family) {
          return [...this.people].reverse();
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.reversePeople /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Family, Person },
      },
    });

    let abdelRahmans = new Family({
      people: [
        new Person({ firstName: 'Mango' }),
        new Person({ firstName: 'Van Gogh' }),
        new Person({ firstName: 'Hassan' }),
        new Person({ firstName: 'Mariko' }),
        new Person({ firstName: 'Yume' }),
        new Person({ firstName: 'Sakura' }),
      ],
    });

    await renderCard(loader, abdelRahmans, 'isolated');
    assert.deepEqual(
      [...this.element.querySelectorAll('[data-test-firstName]')].map(
        (element) => element.textContent?.trim(),
      ),
      ['Sakura', 'Yume', 'Mariko', 'Hassan', 'Van Gogh', 'Mango'],
    );

    await renderCard(loader, abdelRahmans, 'edit');
    assert
      .dom('[data-test-contains-many="people"] [data-test-remove]')
      .exists({ count: 6 });
    assert
      .dom('[data-test-contains-many="slowPeople"] [data-test-remove]')
      .doesNotExist();
  });

  test('supports an empty containsMany computed composite field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      };
    }

    class Family extends CardDef {
      @field people = containsMany(Person);
      @field reversePeople = containsMany(Person, {
        computeVia: function (this: Family) {
          return [...this.people].reverse();
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.reversePeople /></template>
      };
    }
    let abdelRahmans = new Family();
    await renderCard(loader, abdelRahmans, 'isolated'); // just using to absorb asynchronicity
    assert.deepEqual(
      abdelRahmans.reversePeople,
      [],
      'empty containsMany field is initialized to an empty array',
    );
  });

  test('can recompute containsMany field', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field age = contains(NumberField);
    }

    class Family extends CardDef {
      @field people = containsMany(Person);
      @field totalAge = contains(NumberField, {
        computeVia: function (this: Family) {
          return this.people.reduce((sum, person) => (sum += person.age), 0);
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Family, Person },
      },
    });

    let family = new Family({
      people: [
        new Person({ firstName: 'Mango', age: 3 }),
        new Person({ firstName: 'Van Gogh', age: 6 }),
      ],
    });
    assert.strictEqual(family.totalAge, 9, 'computed is correct');
    family.people[0].age = 4;
    family.people = [...family.people];

    assert.strictEqual(family.totalAge, 10, 'computed is correct');
  });

  test('computed fields render as embedded format in the edit format', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field alias = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }

    let person = new Person({ firstName: 'Mango' });
    await renderCard(loader, person, 'edit');
    assert.dom('[data-test-field=alias] input').doesNotExist();
    assert.dom('[data-test-field=alias]').hasText('Alias Mango');
  });

  test('can render a computed linksTo relationship', async function (assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test='name'><@fields.name /></span>
        </template>
      };
    }
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field bestFriend = linksTo(Pet);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test='firstName'><@fields.firstName /></span>
          <span data-test='bestFriend'><@fields.bestFriend /></span>
        </template>
      };
    }
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Person);
      @field friend = linksTo(Pet, {
        computeVia: function (this: Post) {
          return this.author.bestFriend;
        },
      });
    }

    let friend = new Pet({ name: 'Van Gogh' });
    let author = new Person({ firstName: 'Mango', bestFriend: friend });
    let firstPost = new Post({ cardTitle: 'First Post', author });

    await renderCard(loader, firstPost, 'isolated');
    assert.dom('[data-test-field="cardInfo-name"]').hasText('First Post');
    assert
      .dom('[data-test-field="author"] [data-test="firstName"]')
      .hasText('Mango');
    assert
      .dom('[data-test-field="friend"] [data-test="name"]')
      .hasText('Van Gogh');

    await renderCard(loader, firstPost, 'edit');
    assert
      .dom(
        '[data-test-field="bestFriend"] [data-test-links-to-editor="bestFriend"]',
      )
      .exists();
    assert
      .dom('[data-test-field="friend"] [data-test-links-to-editor="friend"]')
      .doesNotExist();
  });

  test('can render a computed linksToMany relationship', async function (this: RenderingTestContext, assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test='name'><@fields.name /></span>
        </template>
      };
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pets = linksToMany(Pet);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test='firstName'><@fields.firstName /></span>
        </template>
      };
    }
    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = linksTo(Person);
      @field factCheckers = linksToMany(Pet);
      @field collaborators = linksToMany(Pet, {
        computeVia(this: Post) {
          let mango = this.author.pets.find((p) => p.name === 'Mango');
          return [mango, ...this.factCheckers];
        },
      });
    }

    let p1 = new Pet({ id: `${testRealmURL}mango`, name: 'Mango' });
    let p2 = new Pet({ name: 'Tango' });
    let f1 = new Pet({ name: 'A' });
    let f2 = new Pet({ name: 'B' });
    let f3 = new Pet({ name: 'C' });
    let author = new Person({ firstName: 'Van Gogh', pets: [p1, p2] });
    let firstPost = new Post({
      cardTitle: 'First Post',
      author,
      factCheckers: [f1, f2, f3],
    });

    await renderCard(loader, firstPost, 'isolated');
    assert.dom('[data-test-field="cardInfo-name"]').hasText('First Post');
    assert
      .dom('[data-test-field="author"] [data-test="firstName"]')
      .hasText('Van Gogh');
    assert.deepEqual(
      [
        ...this.element.querySelectorAll(
          '[data-test-field="collaborators"] [data-test="name"]',
        ),
      ].map((element) => element.textContent?.trim()),
      ['Mango', 'A', 'B', 'C'],
    );

    await renderCard(loader, firstPost, 'edit');
    assert
      .dom('[data-test-links-to-many="factCheckers"] [data-test-remove-card]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-links-to-many="collaborators"] [data-test-remove-card]')
      .doesNotExist();
  });

  test('computed field invalidates when contained card property changes at runtime', async function (this: RenderingTestContext, assert) {
    class Author extends FieldDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-author-name><@fields.firstName />
            <@fields.lastName /></span>
        </template>
      };
    }

    class Post extends CardDef {
      @field cardTitle = contains(StringField);
      @field author = contains(Author);
      @field summary = contains(StringField, {
        computeVia: function (this: Post) {
          return `${this.cardTitle} by ${this.author.firstName} ${this.author.lastName}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-summary><@fields.summary /></div>
          <div data-test-author><@fields.author /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post, Author },
      },
    });

    let author = new Author({ firstName: 'John', lastName: 'Doe' });
    let post = new Post({
      cardTitle: 'My First Post',
      author,
    });

    // Initial render
    await renderCard(loader, post, 'isolated');
    assert.dom('[data-test-summary]').hasText('My First Post by John Doe');
    assert.dom('[data-test-author-name]').hasText('John Doe');

    // Change the contained card's property at runtime
    author.firstName = 'Jane';

    await settled();

    // The computed field should automatically recalculate and UI should re-render
    assert.dom('[data-test-summary]').hasText('My First Post by Jane Doe');
    assert.dom('[data-test-author-name]').hasText('Jane Doe');
  });

  test('computed field re-renders when containsMany property changes at runtime', async function (this: RenderingTestContext, assert) {
    class Tag extends FieldDef {
      @field name = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-tag-name><@fields.name /></span>
        </template>
      };
    }

    class Article extends CardDef {
      @field cardTitle = contains(StringField);
      @field tags = containsMany(Tag);
      @field tagSummary = contains(StringField, {
        computeVia: function (this: Article) {
          if (this.tags.length === 0) {
            return `${this.cardTitle} (no tags)`;
          }
          let tagNames = this.tags.map((tag) => tag.name).join(', ');
          return `${this.cardTitle} [${tagNames}]`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-tag-summary><@fields.tagSummary /></div>
          <div data-test-tags><@fields.tags /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Article, Tag },
      },
    });

    let tag1 = new Tag({ name: 'tech' });
    let tag2 = new Tag({ name: 'web' });
    let article = new Article({
      cardTitle: 'My Article',
      tags: [tag1, tag2],
    });

    // Initial render
    await renderCard(loader, article, 'isolated');
    assert.dom('[data-test-tag-summary]').hasText('My Article [tech, web]');
    assert.dom('[data-test-tags] [data-test-tag-name]').exists({ count: 2 });

    // Change a property of one of the contained cards at runtime
    tag1.name = 'technology';

    await settled();

    // The computed field should automatically recalculate and UI should re-render
    assert
      .dom('[data-test-tag-summary]')
      .hasText('My Article [technology, web]');
    assert.dom('[data-test-tags] [data-test-tag-name]').exists({ count: 2 });

    // Modify the containsMany array itself
    let tag3 = new Tag({ name: 'javascript' });
    article.tags.push(tag3);

    await settled();

    // The computed field should reflect the new tag
    assert
      .dom('[data-test-tag-summary]')
      .hasText('My Article [technology, web, javascript]');
    assert.dom('[data-test-tags] [data-test-tag-name]').exists({ count: 3 });
  });

  test('computed field re-renders when linksToMany property changes at runtime', async function (this: RenderingTestContext, assert) {
    class Category extends CardDef {
      @field name = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test-category-name><@fields.name /></span>
        </template>
      };
    }

    class Blog extends CardDef {
      @field cardTitle = contains(StringField);
      @field categories = linksToMany(Category);
      @field categorySummary = contains(StringField, {
        computeVia: function (this: Blog) {
          if (this.categories.length === 0) {
            return `${this.cardTitle} (no categories)`;
          }
          let categoryNames = this.categories.map((cat) => cat.name).join(', ');
          return `${this.cardTitle} [${categoryNames}]`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-category-summary><@fields.categorySummary /></div>
          <div data-test-categories><@fields.categories /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Blog, Category },
      },
    });

    let cat1 = new Category({ name: 'programming' });
    let cat2 = new Category({ name: 'design' });
    let blog = new Blog({
      cardTitle: 'My Blog',
      categories: [cat1, cat2],
    });

    // Initial render
    await renderCard(loader, blog, 'isolated');
    assert
      .dom('[data-test-category-summary]')
      .hasText('My Blog [programming, design]');
    assert
      .dom('[data-test-categories] [data-test-category-name]')
      .exists({ count: 2 });

    // Change a property of one of the linked cards at runtime
    cat1.name = 'software-engineering';

    await settled();

    // The computed field should automatically recalculate and UI should re-render
    assert
      .dom('[data-test-category-summary]')
      .hasText('My Blog [software-engineering, design]');
    assert
      .dom('[data-test-categories] [data-test-category-name]')
      .exists({ count: 2 });

    // Modify the linksToMany array itself
    let cat3 = new Category({ name: 'tutorials' });
    blog.categories.push(cat3);

    await settled();

    // The computed field should reflect the new category
    assert
      .dom('[data-test-category-summary]')
      .hasText('My Blog [software-engineering, design, tutorials]');
    assert
      .dom('[data-test-categories] [data-test-category-name]')
      .exists({ count: 3 });
  });
});
