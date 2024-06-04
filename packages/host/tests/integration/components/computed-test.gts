import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { RealmSessionContextName, baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '@cardstack/host/services/loader-service';

import type { BaseInstanceType } from 'https://cardstack.com/base/card-api';

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
  recompute,
  linksTo,
  linksToMany,
  newContains,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';

let loader: Loader;

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    provideConsumeContext(RealmSessionContextName, {
      canWrite: true,
    });

    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });
  setupLocalIndexing(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can render a synchronous computed field', async function (assert) {
    class Person extends CardDef {
      @newContains(StringField) declare firstName: BaseInstanceType<
        typeof StringField
      >;

      @newContains(StringField) declare lastName: BaseInstanceType<
        typeof StringField
      >;

      @newContains(StringField)
      get fullName(): BaseInstanceType<typeof StringField> {
        return `${this.firstName} ${this.lastName}`;
      }

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

  test('can render a synchronous computed field (using a string in `computeVia`)', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field fullName = contains(StringField, { computeVia: 'getFullName' });
      getFullName() {
        return `${this.firstName} ${this.lastName}`;
      }
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
      loader,
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
      loader,
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
      loader,
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
    await recompute(family, { recomputeAllFields: true });
    assert.strictEqual(family.totalAge, 9, 'computed is correct');
    family.people[0].age = 4;
    family.people = [...family.people];

    await recompute(family, { recomputeAllFields: true });
    assert.strictEqual(family.totalAge, 10, 'computed is correct');
  });

  test('computed fields render as embedded in the edit format', async function (assert) {
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
    assert.dom('[data-test-field=alias]').containsText('Mango');
    assert
      .dom('[data-test-field=alias] input')
      .doesNotExist('input field not rendered for computed');
  });

  test('can render a computed linksTo relationship', async function (assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
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
    assert.dom('[data-test-field="title"]').hasText('Title First Post');
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
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test='name'><@fields.name /></span>
        </template>
      };
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field pets = linksToMany(Pet);
      static embedded = class Embedded extends Component<typeof this> {
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
        computeVia: 'findCollaborators',
      });
      findCollaborators(this: Post) {
        let mango = this.author.pets.find((p) => p.name === 'Mango');
        return [mango, ...this.factCheckers];
      }
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
    assert.dom('[data-test-field="title"]').hasText('Title First Post');
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
});
