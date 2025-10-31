import { RenderingTestContext, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import { CardStoreWithErrors } from '@cardstack/host/services/render-service';

import type * as CardAPIModule from 'https://cardstack.com/base/card-api';

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
        <template>
          <@fields.fullName />
        </template>
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
      @field title = contains(StringField);
      @field author = contains(Person);
      @field summary = contains(StringField, {
        computeVia: function (this: Post) {
          return `${this.title} by ${this.author.firstName}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.summary />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post, Person },
      },
    });

    let firstPost = new Post({
      title: 'First Post',
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
      @field title = contains(StringField);
      @field author = contains(Person, {
        computeVia: function (this: Post) {
          let person = new Person();
          person.firstName = 'Mango';
          return person;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test='title'><@fields.title /></div> by <@fields.author />
        </template>
      };
    }
    let firstPost = new Post({ title: 'First Post' });
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
        <template>
          <@fields.reversePeople />
        </template>
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
        <template>
          <@fields.firstName />
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
        <template>
          <@fields.reversePeople />
        </template>
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

  test('computed fields render as disabled in the edit format', async function (assert) {
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
    assert.dom('[data-test-field=alias] input').hasValue('Mango');
    assert.dom('[data-test-field=alias] input').hasAttribute('disabled');
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
      @field title = contains(StringField);
      @field author = contains(Person);
      @field friend = linksTo(Pet, {
        computeVia: function (this: Post) {
          return this.author.bestFriend;
        },
      });
    }

    let friend = new Pet({ name: 'Van Gogh' });
    let author = new Person({ firstName: 'Mango', bestFriend: friend });
    let firstPost = new Post({ title: 'First Post', author });

    await renderCard(loader, firstPost, 'isolated');
    assert.dom('[data-test-field="cardTitle"]').hasText('First Post');
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
      @field title = contains(StringField);
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
      title: 'First Post',
      author,
      factCheckers: [f1, f2, f3],
    });

    await renderCard(loader, firstPost, 'isolated');
    assert.dom('[data-test-field="cardTitle"]').hasText('First Post');
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
      @field title = contains(StringField);
      @field author = contains(Author);
      @field summary = contains(StringField, {
        computeVia: function (this: Post) {
          return `${this.title} by ${this.author.firstName} ${this.author.lastName}`;
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
      title: 'My First Post',
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
      @field title = contains(StringField);
      @field tags = containsMany(Tag);
      @field tagSummary = contains(StringField, {
        computeVia: function (this: Article) {
          if (this.tags.length === 0) {
            return `${this.title} (no tags)`;
          }
          let tagNames = this.tags.map((tag) => tag.name).join(', ');
          return `${this.title} [${tagNames}]`;
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
      title: 'My Article',
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
      @field title = contains(StringField);
      @field categories = linksToMany(Category);
      @field categorySummary = contains(StringField, {
        computeVia: function (this: Blog) {
          if (this.categories.length === 0) {
            return `${this.title} (no categories)`;
          }
          let categoryNames = this.categories.map((cat) => cat.name).join(', ');
          return `${this.title} [${categoryNames}]`;
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
      title: 'My Blog',
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

  module('lazy link loading', function (hooks) {
    // Ensure the lazy link loader path is exercised while keeping global state isolated
    let originalLazilyLoadLinks: unknown;

    hooks.beforeEach(function () {
      originalLazilyLoadLinks = (globalThis as any).__lazilyLoadLinks;
      (globalThis as any).__lazilyLoadLinks = true;
    });

    hooks.afterEach(function () {
      if (originalLazilyLoadLinks === undefined) {
        delete (globalThis as any).__lazilyLoadLinks;
      } else {
        (globalThis as any).__lazilyLoadLinks = originalLazilyLoadLinks;
      }
    });

    test('render-service resolves computed dependency on lazily loaded link', async function (assert) {
      class Team extends CardDef {
        @field name = contains(StringField);
        @field shortName = contains(StringField, {
          computeVia: function (this: Team) {
            return this.name ? this.name.slice(0, 2).toUpperCase() : undefined;
          },
        });
      }

      class SprintTask extends CardDef {
        @field name = contains(StringField);
        @field team = linksTo(() => Team);
        @field shortId = contains(StringField, {
          computeVia: function (this: SprintTask) {
            if (!this.id) {
              return;
            }
            let idPart = this.id.split('/').pop();
            if (!idPart) {
              return;
            }
            let team = this.team;
            if (!team) {
              return;
            }
            if (!team.shortName) {
              return;
            }
            return `${team.shortName}-${idPart.slice(0, 4).toUpperCase()}`;
          },
        });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <span data-test-short-id>{{@model.shortId}}</span>
          </template>
        };
      }

      let moduleURL = '../task-cards';
      let remoteRealmURL = 'https://remote.example/';
      let teamId = `${remoteRealmURL}Team/alpha`;
      let taskId = `${testRealmURL}SprintTask/task-1`;

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: remoteRealmURL,
        contents: {
          'task-cards.gts': { Team, SprintTask },
          'Team/alpha.json': {
            data: {
              type: 'card',
              id: teamId,
              attributes: { name: 'Alpha Team' },
              meta: {
                adoptsFrom: {
                  module: '../task-cards',
                  name: 'Team',
                },
              },
            },
          },
        },
      });

      let { realm } = await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'task-cards.gts': { Team, SprintTask },
          'SprintTask/task-1.json': {
            data: {
              type: 'card',
              id: taskId,
              attributes: { name: 'Deliver release' },
              relationships: {
                team: {
                  links: {
                    self: teamId,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: moduleURL,
                  name: 'SprintTask',
                },
              },
            },
          },
        },
      });

      let cardApi = (await loader.import(
        `${baseRealm.url}card-api`,
      )) as typeof CardAPIModule;
      let { createFromSerialized } = cardApi;

      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(taskId),
      );
      assert.ok(result, 'received card document result');
      assert.strictEqual(result?.type, 'doc', 'card document is present');

      if (result && result.type === 'doc') {
        let store = new CardStoreWithErrors(
          loader.fetch.bind(loader) as typeof fetch,
        );

        let sprintTask = await createFromSerialized<typeof SprintTask>(
          result.doc.data,
          result.doc,
          new URL(taskId),
          { store },
        );

        let root = await renderCard(loader, sprintTask, 'isolated');
        await store.loaded();

        assert
          .dom('[data-test-short-id]', root)
          .hasText('AL-TASK', 'computed shortId resolves after loading link');
      } else {
        assert.ok(false, 'expected card document to be available');
      }
    });
  });
});
