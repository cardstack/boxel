import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import { Card, Signature } from 'runtime-spike/lib/card-api';
import Component from '@glint/environment-ember-loose/glimmer-component';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);

  test('render a simple card', async function (assert) {

    let helloWorld = new Card({
      data: {
        title: 'the title'
      },
      isolated: class Isolated extends Component<Signature> {
        <template>{{@model.title}}</template>
      }
    });

    let helloWorldIsolated = await helloWorld.inFormat('isolated');    

    await renderComponent(<template><helloWorldIsolated.component /></template>);

    assert.strictEqual(this.element.textContent!.trim(), 'the title');
  });
});
