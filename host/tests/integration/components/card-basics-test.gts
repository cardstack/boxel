import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { fillIn } from '@ember/test-helpers';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, primitive } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import IntegerCard from 'runtime-spike/lib/integer';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('primitive field type checking', async function (assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);

      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@model.firstName}} {{@model.title}} {{@model.number}}</template>
      }
    }
    let card = new Person();
    card.firstName = 'arthur';
    card.number = 42;
    let readName: string = card.firstName;
    assert.strictEqual(readName, 'arthur');
    let readNumber: number = card.number;
    assert.strictEqual(readNumber, 42);
  });

  test('access @model for primitive and composite fields', async function (assert) {

    class Person {
      @field firstName = contains(StringCard);
      @field subscribers = contains(IntegerCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@model.title}} by {{@model.author.firstName}}, {{@model.author.subscribers}} subscribers</template>
      }
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', author: { firstName: 'Arthur', subscribers: 5 } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post by Arthur, 5 subscribers');
  });

  test('render primitive field', async function (assert) {
    class EmphasizedString {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test="name">{{@model}}</em></template>
      }
    }

    class StrongInteger {
      static [primitive]: number;
      static embedded = class Embedded extends Component<typeof this> {
        <template><strong data-test="integer">{{@model}}</strong></template>
      }
    }

    class Person {
      @field firstName = contains(EmphasizedString);
      @field number = contains(StrongInteger);

      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /><@fields.number /></template>
      }
    }

    class Arthur extends Person {
      static data = { firstName: 'Arthur', number: 10 }
    }

    await renderCard(Arthur, 'embedded');
    assert.dom('[data-test="name"]').containsText('Arthur');
    assert.dom('[data-test="integer"]').containsText('10');
  });

  test('render whole composite field', async function (assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field title = contains(StringCard);
      @field number = contains(IntegerCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.title/> <@fields.firstName /> <@fields.number /></template>
      }
    }

    class Post {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><div data-test><@fields.author /></div></template>
      }
    }

    class HelloWorld extends Post {
      static data = { author: { firstName: 'Arthur', title: 'Mr', number: 10 } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test]').containsText('Mr Arthur 10');
  });

  test('render nested composite field', async function (assert) {
    class TestString {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em data-test="string">{{@model}}</em></template>
      }
    }

    class TestInteger {
      static [primitive]: number;
      static embedded = class Embedded extends Component<typeof this> {
        <template><strong data-test="integer">{{@model}}</strong></template>
      }
    }

    class Person {
      @field firstName = contains(TestString);
      @field number = contains(TestInteger);
    }

    class Post {
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.author.firstName /><@fields.author.number /></template>
      }
    }

    class HelloWorld extends Post {
      static data = { author: { firstName: 'Arthur', number: 10 } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test="string"]').containsText('Arthur');
    assert.dom('[data-test="integer"]').containsText('10');
  });

  test('render default isolated template', async function (assert) {
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

  test('can adopt a card', async function (assert) {
    class Animal {
      @field species = contains(testString('species'));
    }
    class Person extends Animal {
      @field firstName = contains(testString('first-name'));
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /><@fields.species/></template>
      }
    }

    class Hassan extends Person {
      static data = { firstName: 'Hassan', species: 'Homo Sapiens' }
    }

    await renderCard(Hassan, 'embedded');
    assert.dom('[data-test="first-name"]').containsText('Hassan');
    assert.dom('[data-test="species"]').containsText('Homo Sapiens');
  });

  test('can edit fields', async function (assert) {
    class Person {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post {
      @field title = contains(StringCard);
      @field reviews = contains(IntegerCard);
      @field author = contains(Person);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <fieldset>
            <label data-test-field="title">Title <@fields.title /></label>
            <label data-test-field="reviews">Reviews <@fields.reviews /></label>
            <label data-test-field="author">Author <@fields.author /></label>
          </fieldset>
        </template>
      }
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1 data-test-title><@fields.title /></h1>
          <h2 data-test-author><@fields.author /></h2>
          <span data-test-reviews><@fields.reviews /></span>
        </template>
      }
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', reviews: 1, author: { firstName: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test-title]').hasText('First Post');

    await renderCard(HelloWorld, 'edit');
    assert.dom('[data-test-field="title"] input').hasValue('First Post');
    assert.dom('[data-test-field="reviews"] input').hasValue('1');
    assert.dom('[data-test-field="author"] input').hasValue('Arthur');

    await fillIn('[data-test-field="title"] input', 'New Title');
    await fillIn('[data-test-field="reviews"] input', '5');
    await fillIn('[data-test-field="author"] input', 'Carl Stack');

    await renderCard(HelloWorld, 'isolated');
    assert.dom('[data-test-title]').hasText('New Title');
    assert.dom('[data-test-reviews]').hasText('5');
    // TODO: editing contained card fields
    // assert.dom('[data-test-author]').hasText('Carl Stack');
  });
});

function testString(label: string) {
  return class TestString {
    static [primitive]: string;
    static embedded = class Embedded extends Component<typeof this> {
      <template><em data-test={{label}}>{{@model}}</em></template>
    }
  }
}
