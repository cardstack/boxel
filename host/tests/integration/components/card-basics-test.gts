import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, primitive } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('primitive field type checking', async function (assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);

      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@model.firstName}} {{@model.title}}</template>
      }
    }
    let card = new Person();
    card.firstName = 'arthur';
    let readName: string = card.firstName;
    assert.strictEqual(readName, 'arthur');
  });

  test('access @model for primitive and composite fields', async function (assert) {

    class Person {
      @field firstName = contains(StringCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@model.title}} by {{@model.author.firstName}}</template>
      }
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', author: { firstName: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post by Arthur');
  });

  test('render primitive field', async function (assert) {
    class EmphasizedString {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test="name">{{@model}}</em></template>
      }
    }

    class Person {
      @field firstName = contains(EmphasizedString);

      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Arthur extends Person {
      static data = { firstName: 'Arthur' }
    }

    await renderCard(Arthur, 'embedded');
    assert.dom('[data-test="name"]').containsText('Arthur');
  });

  test('render whole composite field', async function (assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.title/> <@fields.firstName /></template>
      }
    }

    class Post {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><div data-test><@fields.author /></div></template>
      }
    }

    class HelloWorld extends Post {
      static data = { author: { firstName: 'Arthur', title: 'Mr' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test]').containsText('Mr Arthur');
  });

  test('render nested composite field', async function (assert) {
    class TestString {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test>{{@model}}</em></template>
      }
    }

    class Person {
      @field firstName = contains(TestString);
    }

    class Post {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.author.firstName /></template>
      }
    }

    class HelloWorld extends Post {
      static data = { author: { firstName: 'Arthur' } }
    }

    assert.dom('[data-test]').containsText('Arthur');
  });

  test('render default templates', async function (assert) {
    class Person {
      @field name = contains(StringCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', author: { name: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post Arthur');
  });
});
