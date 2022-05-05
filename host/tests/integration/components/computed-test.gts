import { module, test } from 'qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, containsMany, field, Component, Card } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import { setupRenderingTest } from 'ember-qunit';
import { fillIn } from '@ember/test-helpers';
import waitUntil from '@ember/test-helpers/wait-until';
import find from '@ember/test-helpers/dom/find';
import { cleanWhiteSpace } from '../../helpers';

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);

  test('can render a synchronous computed field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field lastName = contains(StringCard);
      @field fullName = contains(StringCard, { computeVia: function(this: Person) { return `${this.firstName} ${this.lastName}`; }});
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.fullName/></template>
      }
    }

    let mango = new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' });
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Mango Abdel-Rahman');
  });

  test('can render a synchronous computed field (using a string in `computeVia`)', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field lastName = contains(StringCard);
      @field fullName = contains(StringCard, { computeVia: 'getFullName'});
      getFullName() {
        return `${this.firstName} ${this.lastName}`;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.fullName/></template>
      }
    }

    let mango = new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' });
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Mango Abdel-Rahman');
  });

  test('can render a computed that consumes a nested property', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      @field summary = contains(StringCard, { computeVia: function(this: Post) { return `${this.title} by ${this.author.firstName}`; }});
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.summary/></template>
      }
    }

    let firstPost = new Post({ title: 'First Post', author: { firstName: 'Mango' } });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post by Mango');
  });

  test('can render a computed that is a composite type', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person, { computeVia:
        function(this: Post) {
          let person = new Person();
          person.firstName = 'Mango';
          return person;
        }
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> by <@fields.author/></template>
      }
    }
    let firstPost = new Post({ title: 'First Post' });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post by Mango');
  });

  test('can render an asynchronous computed field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field slowName = contains(StringCard, { computeVia: 'computeSlowName'})
      async computeSlowName() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.slowName/></template>
      }
    }

    let mango = new Person({ firstName: 'Mango' });
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Mango');
  });

  test('can render an asynchronous computed field (using an async function in `computeVia`)', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field slowName = contains(StringCard, { computeVia: async function(this: Person) {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }});
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.slowName/></template>
      }
    }

    let mango = new Person({ firstName: 'Mango'});
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Mango');
  });

  test('can indirectly render an asynchronous computed field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field slowName = contains(StringCard, { computeVia: 'computeSlowName'})
      @field slowNameAlias = contains(StringCard, { computeVia: function(this: Person) { return this.slowName; } });
      async computeSlowName() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.slowNameAlias/></template>
      }
    }

    let mango = new Person({ firstName: 'Mango' });
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Mango');
  });

  test('can render a nested asynchronous computed field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field slowName = contains(StringCard, { computeVia: 'computeSlowName'})
      async computeSlowName() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> by {{@model.author.slowName}}</template>
      }
    }

    let firstPost = new Post({ title: 'First Post', author: { firstName: 'Mango' } });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post by Mango');
  });

  test('can render an asynchronous computed composite field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person, { computeVia: 'computeSlowAuthor'});
      async computeSlowAuthor() {
        await new Promise(resolve => setTimeout(resolve, 10));
        let person = new Person();
        person.firstName = 'Mango';
        return person;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> by <@fields.author/></template>
      }
    }
    let firstPost = new Post({ title: 'First Post' });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post by Mango');
  });

  test('can render a containsMany computed primitive field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field languagesSpoken = containsMany(StringCard);
      @field slowLanguagesSpoken = containsMany(StringCard, { computeVia: 'computeSlowLanguagesSpoken'});
      async computeSlowLanguagesSpoken() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.languagesSpoken;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.firstName/> speaks <@fields.slowLanguagesSpoken/></template>
      }
    }

    let mango = new Person({
      firstName: 'Mango',
      languagesSpoken: ['english', 'japanese']
    });

    await renderCard(mango, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango speaks english japanese');
  });

  test('can render a containsMany computed composite field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Family extends Card {
      @field people = containsMany(Person);
      @field slowPeople = containsMany(Person, { computeVia: 'computeSlowPeople'});
      async computeSlowPeople() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.people;
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.slowPeople/></template>
      }
    }
    let abdelRahmans = new Family({
      people: [
        { firstName: 'Mango'},
        { firstName: 'Van Gogh'},
        { firstName: 'Hassan'},
        { firstName: 'Mariko'},
        { firstName: 'Yume'},
        { firstName: 'Sakura'},
      ]
    });

    await renderCard(abdelRahmans, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango Van Gogh Hassan Mariko Yume Sakura');
  });

  test('cannot set a computed field', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field fastName = contains(StringCard, { computeVia: function(this: Person) { return this.firstName; } });
      @field slowName = contains(StringCard, { computeVia: 'computeSlowName'})
      async computeSlowName() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }
    }

    let card = new Person();
    assert.throws(() => card.fastName = 'Mango', /Cannot set property fastName/, 'cannot set synchronous computed field');
    assert.throws(() => card.slowName = 'Mango', /Cannot set property slowName/, 'cannot set asynchronous computed field');
  });

  test('computed fields render as embedded in the edit format', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field alias = contains(StringCard, { computeVia: function(this: Person) { return this.firstName; } });
    }

    let person = new Person({ firstName: 'Mango' });
    await renderCard(person, 'edit');
    assert.dom('[data-test-field=alias]').containsText('Mango');
    assert.dom('[data-test-field=alias] input').doesNotExist('input field not rendered for computed')
  });

  test('can maintain data consistency for async computed fields', async function(assert) {
    class Location extends Card {
      @field city = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.city/></template>
      }
    }
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field slowName = contains(StringCard, { computeVia: 'computeSlowName'})
      @field homeTown = contains(Location);
      @field slowHomeTown = contains(Location, { computeVia: 'computeSlowHomeTown'})
      async computeSlowName() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.firstName;
      }
      async computeSlowHomeTown() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.homeTown;
      }
      static edit = class Edit extends Component<typeof this> {
        <template>
          <div data-test-field="firstName"><@fields.firstName /></div>
          <div data-test-field="homeTown"><@fields.homeTown.city /></div>
          <div data-test-field="slowName"><@fields.slowName /></div>
          <div data-test-field="slowHomeTown"><@fields.slowHomeTown/></div>
          <div data-test-dep-field="firstName">{{@model.firstName}}</div>
          <div data-test-dep-field="homeTown">{{@model.homeTown.city}}</div>
        </template>
      }
    }

    let person = new Person({ firstName: 'Mango', homeTown: { city: 'Bronxville' } });


    await renderCard(person, 'edit');
    assert.dom('[data-test-field="slowName"]').containsText('Mango');
    await fillIn('[data-test-field="firstName"] input', 'Van Gogh');
    // We want to ensure data consistency, so that when the template rerenders,
    // the template is always showing consistent field values
    await waitUntil(() =>
      find('[data-test-dep-field="firstName"]')?.textContent?.includes('Van Gogh')
    );
    assert.dom('[data-test-field="slowName"]').containsText('Van Gogh');

    assert.dom('[data-test-field="slowHomeTown"]').containsText('Bronxville');
    await fillIn('[data-test-field="homeTown"] input', 'Scarsdale');
    await waitUntil(() =>
      find('[data-test-dep-field="homeTown"]')?.textContent?.includes('Scarsdale')
    );
    assert.dom('[data-test-field="slowHomeTown"]').containsText('Scarsdale');
  });
});
