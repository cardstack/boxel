import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
// import { renderComponent } from '../../helpers/render-component';
import { contains, field, Component } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('primitive field type checking', async function (assert) {
    class Person {
      @field name = contains(StringCard);
      @field title = contains(StringCard);

      static isolated = class Isolated extends Component<typeof this> {
        <template>{{@model.name}} {{@model.title}}</template>
      }
    }
    let card = new Person();
    card.name = 'arthur';
    let readName: string = card.name;
    assert.strictEqual(readName, 'arthur');
  });

  // test('render a simple card', async function (assert) {

  //   class Person {
  //     @field name = contains(stringCard);

  //     // static {
  //     //   isolatedView(this, class Embedded extends Component<Signature> {
  //     //     <template>{{@model.name}}</template>
  //     //   })
  //     // }
  //   }

  //   class Post {
  //     @field title = contains(stringCard);
  //     @field author = contains(Person);

  //     static isolated = class Isolated extends Component<Signature> {
  //       // TODO change this to {{@field.title}}
  //       <template>{{@model.title}} by {{@model.author.name}}</template>
  //     }
  //   }

  //   class HelloWorld extends Post {
  //     static data = { title: 'the title' }
  //   }

  //   await renderCard(HelloWorld, 'isolated');

  //   assert.strictEqual(this.element.textContent!.trim(), 'the title');
  // });
});
