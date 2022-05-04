import { module, test, skip } from 'qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import { setupRenderingTest } from 'ember-qunit';
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

  // TODO implement after we have the ability to edit a field
  skip('can maintain data consistency for async computed fields');
  skip('can recompute an async computed field when data changes');
  // as with the compiled schema instances, I think this means that
  // we instantiate a new model that the rendered component consumes
  // after data changes so we don't have to worry about cached values
});
