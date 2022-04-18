import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component, primitive } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';

module('Integration | card-basics2', function (hooks) {
  setupRenderingTest(hooks);

  test('access @field for primitive and composite fields', async function (assert) {
    class EmphasizedString {
      static [primitive]: string;
      static embedded = class Embedded extends Component<typeof this> {
        <template><em>{{@model}}</em></template>
      }
    }

    class Person {
      @field name = contains(EmphasizedString);

      static embedded = class Embedded extends Component<typeof this> {
        <template>{{@field.name}}</template>
      }
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@field.title}} by {{@field.author.name}}</template>
      }
    }

    class HelloWorld extends Post {
      static data = { title: 'First Post', author: { name: 'Arthur' } }
    }

    await renderCard(HelloWorld, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post by Arthur');
  });

});
