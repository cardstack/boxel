import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import { Card, Signature, SchemaClass, contains } from 'runtime-spike/lib/card-api';
import Component from '@glint/environment-ember-loose/glimmer-component';
import stringField from 'runtime-spike/lib/string-field';

class SimpleSchema extends SchemaClass {
  @contains(stringField) title: string | undefined;
}

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('render a simple card', async function (assert) {

    let helloWorld = new Card({
      data: {
        title: 'the title'
      },
      schema: SimpleSchema,
      isolated: class Isolated extends Component<Signature> {
        // TODO change this to {{@field.title}}
        <template>{{@model.title}}</template>
      }
    });

    let helloWorldIsolated = await helloWorld.inFormat('isolated');    

    await renderComponent(<template><helloWorldIsolated.component /></template>);

    assert.strictEqual(this.element.textContent!.trim(), 'the title');
  });
});
