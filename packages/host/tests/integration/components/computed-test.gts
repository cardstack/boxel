import { waitUntil, fillIn, RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  cleanWhiteSpace,
  testRealmURL,
  shimModule,
  setupCardLogs,
} from '../../helpers';
import { renderCard } from '../../helpers/render-component';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let number: typeof import('https://cardstack.com/base/number');

let loader: Loader;

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);
  });

  test('can render a synchronous computed field', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
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

  test('can render a synchronous computed field (using a string in `computeVia`)', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
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
    let { field, contains, CardDef, Component, FieldDef } = cardApi;
    let { default: StringField } = string;
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
    await shimModule(`${testRealmURL}test-cards`, { Post, Person }, loader);

    let firstPost = new Post({
      title: 'First Post',
      author: new Person({ firstName: 'Mango' }),
    });
    let root = await renderCard(loader, firstPost, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'First Post by Mango');
  });

  test('can render a computed that is a composite type', async function (assert) {
    let { field, contains, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
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

  test('can render an asynchronous computed field', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field slowName = contains(StringField, {
        computeVia: 'computeSlowName',
      });
      async computeSlowName() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.firstName;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.slowName />
        </template>
      };
    }

    let mango = new Person({ firstName: 'Mango' });
    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'Mango');
  });

  test('can render an asynchronous computed field (using an async function in `computeVia`)', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field slowName = contains(StringField, {
        computeVia: async function (this: Person) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.slowName />
        </template>
      };
    }

    let mango = new Person({ firstName: 'Mango' });
    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'Mango');
  });

  test('can indirectly render an asynchronous computed field', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field slowName = contains(StringField, {
        computeVia: 'computeSlowName',
      });
      @field slowNameAlias = contains(StringField, {
        computeVia: function (this: Person) {
          return this.slowName;
        },
      });
      async computeSlowName() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.firstName;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.slowNameAlias />
        </template>
      };
    }

    let mango = new Person({ firstName: 'Mango' });
    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'Mango');
  });

  test('can render a async computed that depends on an async computed: consumer field is first', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field verySlowName = contains(StringField, {
        computeVia: async function (this: Person) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return this.slowName;
        },
      });
      @field slowName = contains(StringField, {
        computeVia: async function (this: Person) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.verySlowName />
        </template>
      };
    }
    let mango = new Person({ firstName: 'Mango' });
    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(root.textContent!.trim(), 'Mango');
  });

  test('can render a nested asynchronous computed field', async function (assert) {
    let { field, contains, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field slowName = contains(StringField, {
        computeVia: 'computeSlowName',
      });
      async computeSlowName() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.firstName;
      }
    }

    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.title /> by {{@model.author.slowName}}
        </template>
      };
    }
    await shimModule(`${testRealmURL}test-cards`, { Post, Person }, loader);

    let firstPost = new Post({
      title: 'First Post',
      author: new Person({ firstName: 'Mango' }),
    });
    let root = await renderCard(loader, firstPost, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'First Post by Mango',
    );
  });

  test('can render an asynchronous computed composite field', async function (assert) {
    let { field, contains, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
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
      @field author = contains(Person, { computeVia: 'computeSlowAuthor' });
      async computeSlowAuthor() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        let person = new Person();
        person.firstName = 'Mango';
        return person;
      }
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
    let { field, contains, containsMany, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field languagesSpoken = containsMany(StringField);
      @field slowLanguagesSpoken = containsMany(StringField, {
        computeVia: 'computeSlowLanguagesSpoken',
      });
      async computeSlowLanguagesSpoken() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.languagesSpoken;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.firstName /> speaks <@fields.slowLanguagesSpoken />
        </template>
      };
    }

    let mango = new Person({
      firstName: 'Mango',
      languagesSpoken: ['english', 'japanese'],
    });

    let root = await renderCard(loader, mango, 'isolated');
    assert.strictEqual(
      cleanWhiteSpace(root.textContent!),
      'Mango speaks english japanese',
    );
  });

  test('supports an empty containsMany computed primitive field', async function (assert) {
    let { field, contains, containsMany, CardDef, Component } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field languagesSpoken = containsMany(StringField);
      @field slowLanguagesSpoken = containsMany(StringField, {
        computeVia: 'computeSlowLanguagesSpoken',
      });
      async computeSlowLanguagesSpoken() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.languagesSpoken;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.firstName /> speaks <@fields.slowLanguagesSpoken />
        </template>
      };
    }

    let mango = new Person({ firstName: 'Mango' });
    await renderCard(loader, mango, 'isolated'); // just using to absorb asynchronicity
    assert.deepEqual(
      mango.slowLanguagesSpoken,
      [],
      'empty containsMany field is initialized to an empty array',
    );
  });

  test('can render a containsMany computed composite field', async function (this: RenderingTestContext, assert) {
    let { field, contains, containsMany, CardDef, FieldDef, Component } =
      cardApi;
    let { default: StringField } = string;
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
      @field slowPeople = containsMany(Person, {
        computeVia: 'computeSlowPeople',
      });
      async computeSlowPeople() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.people;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.slowPeople />
        </template>
      };
    }
    await shimModule(`${testRealmURL}test-cards`, { Family, Person }, loader);

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
      ['Mango', 'Van Gogh', 'Hassan', 'Mariko', 'Yume', 'Sakura'],
    );
  });

  test('supports an empty containsMany computed composite field', async function (assert) {
    let { field, contains, containsMany, FieldDef, CardDef, Component } =
      cardApi;
    let { default: StringField } = string;
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
      @field slowPeople = containsMany(Person, {
        computeVia: 'computeSlowPeople',
      });
      async computeSlowPeople() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.people;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.slowPeople />
        </template>
      };
    }
    let abdelRahmans = new Family();
    await renderCard(loader, abdelRahmans, 'isolated'); // just using to absorb asynchronicity
    assert.deepEqual(
      abdelRahmans.slowPeople,
      [],
      'empty containsMany field is initialized to an empty array',
    );
  });

  test('can recompute containsMany field', async function (assert) {
    let { field, contains, containsMany, FieldDef, CardDef, recompute } =
      cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field age = contains(NumberField);
    }

    class Family extends CardDef {
      @field people = containsMany(Person);
      @field totalAge = contains(NumberField, {
        computeVia: 'computeTotalAge',
      });
      async computeTotalAge() {
        let totalAge = this.people.reduce(
          (sum, person) => (sum += person.age),
          0,
        );
        return totalAge;
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { Family, Person }, loader);

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
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
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

  test('can maintain data consistency for async computed fields', async function (assert) {
    let { field, contains, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
    class Location extends FieldDef {
      @field city = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-location><@fields.city /></span>
        </template>
      };
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field slowName = contains(StringField, {
        computeVia: 'computeSlowName',
      });
      @field homeTown = contains(Location);
      @field slowHomeTown = contains(Location, {
        computeVia: 'computeSlowHomeTown',
      });
      async computeSlowName() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.firstName;
      }
      async computeSlowHomeTown() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.homeTown;
      }
      static edit = class Edit extends Component<typeof this> {
        <template>
          <div data-test-field='firstName'><@fields.firstName /></div>
          <div data-test-field='homeTown'><@fields.homeTown.city /></div>
          <div data-test-field='slowName'><@fields.slowName /></div>
          <div data-test-field='slowHomeTown'><@fields.slowHomeTown /></div>
          <div data-test-dep-field='firstName'>{{@model.firstName}}</div>
          <div data-test-dep-field='homeTown'>{{@model.homeTown.city}}</div>
        </template>
      };
    }
    await shimModule(`${testRealmURL}test-cards`, { Location, Person }, loader);

    let person = new Person({
      firstName: 'Mango',
      homeTown: new Location({ city: 'Bronxville' }),
    });

    await renderCard(loader, person, 'edit');
    assert.dom('[data-test-field="slowName"]').containsText('Mango');
    await fillIn('[data-test-field="firstName"] input', 'Van Gogh');
    // We want to ensure data consistency, so that when the template rerenders,
    // the template is always showing consistent field values
    await waitUntil(() =>
      document
        .querySelector('[data-test-dep-field="firstName"]')
        ?.textContent?.includes('Van Gogh'),
    );
    assert.dom('[data-test-field="slowName"]').containsText('Van Gogh');
    assert
      .dom('[data-test-field="slowHomeTown"] [data-test-location]')
      .containsText('Bronxville');

    await fillIn('[data-test-field="homeTown"] input', 'Scarsdale');
    await waitUntil(() =>
      document
        .querySelector('[data-test-dep-field="homeTown"]')
        ?.textContent?.includes('Scarsdale'),
    );
    assert
      .dom('[data-test-field="slowHomeTown"] [data-test-location]')
      .containsText('Scarsdale');
  });

  test('can render a computed linksTo relationship', async function (assert) {
    let { field, contains, linksTo, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
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

  test('can render an asynchronous computed linksTo field', async function (assert) {
    let { field, contains, linksTo, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
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
        computeVia: 'computeFriend',
      });
      async computeFriend(this: Post) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.author.bestFriend;
      }
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
  });

  test('can render a computed linksToMany relationship', async function (this: RenderingTestContext, assert) {
    let { field, contains, linksTo, linksToMany, CardDef, Component } = cardApi;
    let { default: StringField } = string;
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

  test('can render an asynchronous computed linksToMany field', async function (this: RenderingTestContext, assert) {
    let { field, contains, linksTo, linksToMany, CardDef, Component } = cardApi;
    let { default: StringField } = string;
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
      async findCollaborators(this: Post) {
        await new Promise((resolve) => setTimeout(resolve, 10));
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
  });
});
