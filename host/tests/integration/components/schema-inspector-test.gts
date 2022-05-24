import { module, test } from 'qunit';
import Component from '@glimmer/component';
import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import SchemaInspector from 'runtime-spike/components/schema-inspector';
import { renderComponent } from '../../helpers/render-component';

module('Integration | schema-inspector', function (hooks) {
  setupRenderingTest(hooks);

  test('renders card chooser', async function (assert) {
    let testModule = await import('../modules/test-module')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').exists({ count: 2}, 'Found 2 cards');
    assert.dom('.card-chooser').containsText('Person');
    assert.dom('.card-chooser').containsText('Post');

    assert.dom('.card-chooser').doesNotContainText('notACard');
    assert.dom('.card-chooser').doesNotContainText('alsoNotACard');

    assert.dom('.selected-card').doesNotContainText('Person');
    assert.dom('.selected-card').doesNotContainText('Post');
  });

  test('clicking on a card button will select the card', async function (assert) {
    let testModule = await import('../modules/test-module')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    await click('.card-button[data-test-card-name="Person"]');
    assert.dom('.selected-card').containsText('Person');

    await click('.card-button[data-test-card-name="Post"]');
    assert.dom('.selected-card').containsText('Post');
  });
});