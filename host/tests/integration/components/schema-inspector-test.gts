import { module, test } from 'qunit';
import Component from '@glimmer/component';
import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import SchemaInspector from 'runtime-spike/components/schema-inspector';
import { renderComponent } from '../../helpers/render-component';
import { cleanWhiteSpace } from '../../helpers';

module('Integration | schema-inspector', function (hooks) {
  setupRenderingTest(hooks);

  test('renders card chooser', async function (assert) {
    let testModule = await import('../modules/multiple-cards')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').exists({ count: 2}, 'Found 2 cards');
    assert.dom('.selected-card').containsText('Person', 'the first card is selected by default');
  });

  test('clicking on a card button will select the card', async function (assert) {
    let testModule = await import('../modules/multiple-cards')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    await click('.card-button[data-test-card-name="Post"]');
    assert.dom('.selected-card').containsText('Post');
  });

  test('when there is just one exported card no chooser is shown', async function (assert) {
    let testModule = await import('../modules/single-card')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').doesNotExist();
    assert.dom('.selected-card').containsText('Person');
  });

  test('when there are no cards in a module a message is displayed saying as much', async function (assert) {
    let testModule = await import('../modules/no-cards')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').doesNotExist();
    assert.dom('.selected-card').doesNotExist();
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'No cards found in this module');
  });

  test('clicking on create shows the card edit form', async function(assert) {
    let testModule = await import('../modules/single-card')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    await click('[data-test-create-card]');
    assert.dom('[data-test-field="firstName"] input').exists();
    assert.dom('[data-test-field="lastName"] input').exists();
  });

  test('clicking on cancel dismisses the card edit form', async function(assert) {
    let testModule = await import('../modules/single-card')
    await renderComponent(
      class TestDriver extends Component {
        <template>
          <SchemaInspector @module={{testModule}} />
        </template>
      }
    )

    await click('[data-test-create-card]');
    await click('[data-test-cancel-create]')
    assert.dom('[data-test-field="firstName"] input').doesNotExist();
    assert.dom('[data-test-field="lastName"] input').doesNotExist();
  });
});