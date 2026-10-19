import type { RenderingTestContext } from '@ember/test-helpers';
import { click, settled } from '@ember/test-helpers';

import {
  field,
  contains,
  CardDef,
  Component,
  FieldDef,
  containsMany,
  linksTo,
  linksToMany,
  CardInfoField,
  Theme,
  meta,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  realmURL,
  type Permissions,
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
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

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
    async () => await loader.import('@cardstack/base/card-api'),
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
      skipBootIndex: true,
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
      skipBootIndex: true,
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
      skipBootIndex: true,
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
      skipBootIndex: true,
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
      skipBootIndex: true,
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
      skipBootIndex: true,
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

  test('a computed read several times in one render runs its computeVia once per data change', async function (assert) {
    let totalCalls = 0;
    class Ledger extends CardDef {
      @field amounts = containsMany(NumberField);
      @field total = contains(NumberField, {
        computeVia: function (this: Ledger) {
          totalCalls++;
          return this.amounts.reduce((sum, amount) => sum + amount, 0);
        },
      });
      @field doubled = contains(NumberField, {
        computeVia: function (this: Ledger) {
          return this.total + this.total;
        },
      });
      @field summary = contains(StringField, {
        computeVia: function (this: Ledger) {
          return `${this.total} (${this.doubled})`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-total><@fields.total /></div>
          <div data-test-total-again>{{@model.total}}</div>
          <div data-test-doubled><@fields.doubled /></div>
          <div data-test-summary><@fields.summary /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Ledger },
      },
    });

    let ledger = new Ledger({ amounts: [1, 2] });
    await renderCard(loader, ledger, 'isolated');
    assert.dom('[data-test-total]').hasText('3');
    assert.dom('[data-test-total-again]').hasText('3');
    assert.dom('[data-test-doubled]').hasText('6');
    assert.dom('[data-test-summary]').hasText('3 (6)');
    assert.strictEqual(
      totalCalls,
      1,
      'the render evaluates the computed once, however many reads reach it',
    );

    ledger.amounts = [1, 2, 4];
    await settled();
    assert.dom('[data-test-total]').hasText('7');
    assert.dom('[data-test-total-again]').hasText('7');
    assert.dom('[data-test-doubled]').hasText('14');
    assert.dom('[data-test-summary]').hasText('7 (14)');
    assert.strictEqual(
      totalCalls,
      2,
      'the re-render after one data change evaluates the computed once more',
    );
  });

  test('iterating a computed containsMany in a render runs its computeVia once', async function (assert) {
    let daysCalls = 0;
    class Day extends FieldDef {
      @field label = contains(StringField);
      @field minutes = contains(NumberField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-day><@fields.label /> <@fields.minutes /></span>
        </template>
      };
    }
    class Timesheet extends CardDef {
      @field minutesByDay = containsMany(NumberField);
      @field days = containsMany(Day, {
        computeVia: function (this: Timesheet) {
          daysCalls++;
          return this.minutesByDay.map(
            (minutes, index) => new Day({ label: `Day ${index + 1}`, minutes }),
          );
        },
      });
      @field totalMinutes = contains(NumberField, {
        computeVia: function (this: Timesheet) {
          return this.days.reduce((sum, day) => sum + day.minutes, 0);
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-days><@fields.days /></div>
          <ul>
            {{#each @fields.days as |Day|}}
              <li data-test-each-day><Day /></li>
            {{/each}}
          </ul>
          <div data-test-total-minutes><@fields.totalMinutes /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Timesheet, Day },
      },
    });

    let timesheet = new Timesheet({ minutesByDay: [480, 450, 510, 300] });
    await renderCard(loader, timesheet, 'isolated');
    assert.dom('[data-test-days] [data-test-day]').exists({ count: 4 });
    assert.dom('[data-test-each-day]').exists({ count: 4 });
    assert.dom('[data-test-total-minutes]').hasText('1740');
    assert.strictEqual(
      daysCalls,
      1,
      'every row, the iteration and the derived total share one evaluation',
    );
  });

  test('iterating a computed containsMany on a store-loaded card runs its computeVia once per render', async function (assert) {
    let daysCalls = 0;
    class Day extends FieldDef {
      @field label = contains(StringField);
      @field minutes = contains(NumberField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-day><@fields.label /> <@fields.minutes /></span>
        </template>
      };
    }
    class Timesheet extends CardDef {
      @field minutesByDay = containsMany(NumberField);
      @field days = containsMany(Day, {
        computeVia: function (this: Timesheet) {
          daysCalls++;
          return this.minutesByDay.map(
            (minutes, index) => new Day({ label: `Day ${index + 1}`, minutes }),
          );
        },
      });
      @field totalMinutes = contains(NumberField, {
        computeVia: function (this: Timesheet) {
          return this.days.reduce((sum, day) => sum + day.minutes, 0);
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-days><@fields.days /></div>
          <ul>
            {{#each @fields.days as |Day|}}
              <li data-test-each-day><Day /></li>
            {{/each}}
          </ul>
          <div data-test-total-minutes><@fields.totalMinutes /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Timesheet, Day },
        'Timesheet/week.json': {
          data: {
            type: 'card',
            attributes: { minutesByDay: [480, 450, 510, 300] },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}test-cards`,
                name: 'Timesheet',
              },
            },
          },
        },
      },
    });

    let store = getService('store');
    let timesheet = (await store.get(
      `${testRealmURL}Timesheet/week`,
    )) as Timesheet;
    await store.loaded();
    assert.ok(
      timesheet[meta]?.realmURL,
      'the instance carries the realm meta a served card has',
    );

    daysCalls = 0;
    await renderCard(loader, timesheet, 'isolated');
    assert.dom('[data-test-days] [data-test-day]').exists({ count: 4 });
    assert.dom('[data-test-each-day]').exists({ count: 4 });
    assert.dom('[data-test-total-minutes]').hasText('1740');
    assert.strictEqual(
      daysCalls,
      1,
      'every row, the iteration and the derived total share one evaluation',
    );
  });

  test('every place that reads a memoized computed re-renders when its dependency changes', async function (this: RenderingTestContext, assert) {
    class Author extends FieldDef {
      @field firstName = contains(StringField);
    }
    class Post extends CardDef {
      @field author = contains(Author);
      @field byline = contains(StringField, {
        computeVia: function (this: Post) {
          return `by ${this.author.firstName}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <header data-test-header-byline><@fields.byline /></header>
          <footer data-test-footer-byline>{{@model.byline}}</footer>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Post, Author },
      },
    });

    let author = new Author({ firstName: 'Mango' });
    let post = new Post({ author });
    await renderCard(loader, post, 'isolated');
    assert.dom('[data-test-header-byline]').hasText('by Mango');
    assert.dom('[data-test-footer-byline]').hasText('by Mango');

    author.firstName = 'Van Gogh';
    await settled();
    assert.dom('[data-test-header-byline]').hasText('by Van Gogh');
    assert.dom('[data-test-footer-byline]').hasText('by Van Gogh');
  });

  test('a computed read in the same turn as a write reflects the write', async function (assert) {
    let totalCalls = 0;
    class Ledger extends CardDef {
      @field label = contains(StringField);
      @field amounts = containsMany(NumberField);
      @field total = contains(NumberField, {
        computeVia: function (this: Ledger) {
          totalCalls++;
          return this.amounts.reduce((sum, amount) => sum + amount, 0);
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Ledger) {
          return `${this.label}: ${this.total}`;
        },
      });
    }

    let ledger = new Ledger({ label: 'Petty cash', amounts: [1, 2] });
    assert.strictEqual(ledger.total, 3);
    assert.strictEqual(ledger.total, 3);
    assert.strictEqual(
      totalCalls,
      1,
      'repeated reads with no write between them evaluate once',
    );

    ledger.amounts.push(4);
    assert.strictEqual(
      ledger.total,
      7,
      'an in-place array mutation is seen by the next read in the same turn',
    );

    ledger.amounts = [10];
    assert.strictEqual(
      ledger.total,
      10,
      'a field assignment is seen by the next read in the same turn',
    );

    ledger.label = 'Float';
    assert.strictEqual(
      ledger.title,
      'Float: 10',
      'a computed derived from a memoized one sees a write to its other dependency',
    );
  });

  test('a computed that reads realm meta sees a meta assignment in the same turn', async function (assert) {
    class Note extends CardDef {
      @field home = contains(StringField, {
        computeVia: function (this: Note) {
          return this[realmURL]?.href ?? 'nowhere';
        },
      });
    }

    let note = new Note();
    note[meta] = {
      ...note[meta],
      realmURL: 'http://example.com/first/',
    } as (typeof note)[typeof meta];
    assert.strictEqual(note.home, 'http://example.com/first/');

    note[meta] = {
      ...note[meta],
      realmURL: 'http://example.com/second/',
    } as (typeof note)[typeof meta];
    assert.strictEqual(
      note.home,
      'http://example.com/second/',
      'the read after the assignment is not served the memoized value',
    );
  });

  test('a field computed that reads its realm sees the realm it is attached to in the same turn', async function (assert) {
    class Place extends FieldDef {
      @field home = contains(StringField, {
        computeVia: function (this: Place) {
          return this[realmURL]?.href ?? 'nowhere';
        },
      });
    }
    class Trip extends CardDef {
      @field place = contains(Place);
    }

    let trip = new Trip();
    trip[meta] = {
      ...trip[meta],
      realmURL: 'http://example.com/trips/',
    } as (typeof trip)[typeof meta];

    let place = new Place();
    assert.strictEqual(place.home, 'nowhere');
    trip.place = place;
    assert.strictEqual(
      trip.place.home,
      'http://example.com/trips/',
      'the read after the field is attached is not served the detached value',
    );
  });

  test('a computed whose computeVia throws throws on every read in the turn', async function (assert) {
    class Gauge extends CardDef {
      @field reading = contains(NumberField);
      @field level = contains(NumberField, {
        computeVia: function (this: Gauge) {
          if (this.reading < 0) {
            throw new Error('negative reading');
          }
          return this.reading * 2;
        },
      });
    }

    let failing = new Gauge({ reading: -1 });
    assert.throws(() => failing.level, /negative reading/);
    assert.throws(
      () => failing.level,
      /negative reading/,
      'a failed first evaluation is not served as a value',
    );

    let gauge = new Gauge({ reading: 1 });
    assert.strictEqual(gauge.level, 2);
    gauge.reading = -1;
    assert.throws(() => gauge.level, /negative reading/);
    assert.throws(
      () => gauge.level,
      /negative reading/,
      'a failed recompute does not fall back to the last good value',
    );
  });

  test('CardDef.cardTheme resolves from cardInfo.theme', async function (assert) {
    class Article extends CardDef {
      static displayName = 'Article';
    }
    await setupIntegrationTestRealm({
      skipBootIndex: true,
      mockMatrixUtils,
      contents: { 'test-cards.gts': { Article } },
    });
    let theme = new Theme({
      cardInfo: new CardInfoField({ name: 'Ocean Blue' }),
    });
    let instance = new Article({
      cardInfo: new CardInfoField({ theme }),
    });

    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-preview]');
    assert
      .dom('[data-test-edit-preview="cardTheme"]')
      .containsText('Ocean Blue');
  });
});
