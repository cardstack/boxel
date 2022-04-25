import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { fillIn } from '@ember/test-helpers';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, primitive } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import on from 'runtime-spike/modifiers/on';

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

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test]').containsText('Arthur');
  });

  test('render edit field', async function (assert) {
    class TestString {
      static [primitive]: string;
      static edit = class Edit extends Component<typeof this> {
        <template>
          {{!-- template-lint-disable require-input-label --}}
          <input value={{@model}} {{on "input" @set}} />
        </template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-value>{{@model}}</div>
        </template>
      }
    }

    class Person {
      @field firstName = contains(TestString);
    }

    class Post {
      @field title = contains(TestString);
      @field author = contains(Person);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <label data-test-field="title">
            Title
            <@fields.title />
          </label>
          <label data-test-field="author">
            Author
            <@fields.author.firstName />
          </label>
        </template>
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.title />
        </template>
      }
    }

    class HelloWorld extends Post {
      static data = { title: 'My Post', author: { firstName: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test-value]').hasText('My Post');

    await renderCard(HelloWorld, 'edit');
    assert.dom('[data-test-field="title"]').containsText('Title');
    assert.dom('[data-test-field="title"] input').hasValue('My Post');
    assert.dom('[data-test-field="author"]').containsText('Author');
    assert.dom('[data-test-field="author"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Title');
    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test-value]').hasText('New Title');
  });

  test('render default isolated template', async function (assert) {
    function testString(label: string) {
      return class TestString {
        static [primitive]: string;
        static embedded = class Embedded extends Component<typeof this> {
          <template><em data-test={{label}}>{{@model}}</em></template>
        }
      }
    }

    class Person {
      @field firstName = contains(testString('first-name'));

      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post {
      @field title = contains(testString('title'));
      @field author = contains(Person);
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', author: { firstName: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');

    assert.dom('[data-test="first-name"]').containsText('Arthur');
    assert.dom('[data-test="title"]').containsText('First Post');
  });

  test('render default edit template', async function (assert) {
    class TestString {
      static [primitive]: string;
      static edit = class Edit extends Component<typeof this> {
        <template>
          {{!-- template-lint-disable require-input-label --}}
          <input value={{@model}} />
        </template>
      }
    }

    class Person {
      @field firstName = contains(TestString);
    }

    class Post {
      @field title = contains(TestString);
      @field author = contains(Person);
    }

    class HelloWorld extends Post {
      static data = { title: 'My Post', author: { firstName: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'edit');
    assert.dom('[data-test-field="title"]').containsText('title');
    assert.dom('[data-test-field="title"] input').hasValue('My Post');
    assert.dom('[data-test-field="author"]').containsText('author firstName'); // TODO: fix nested labels
    assert.dom('[data-test-field="author"] input').hasValue('Arthur');
  });
});
