import { module, test } from 'qunit';
import { waitFor } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import ImportModule from 'runtime-spike/components/import-module';

module('Integration | import-module', function (hooks) {
  setupRenderingTest(hooks);

  test('yields a successfully loaded module', async function (assert) {
    await renderComponent(
      <template>
        <ImportModule @url="http://localhost:4200/test-modules/good.js">
          <:ready as |module|>
            <h1 data-test-ready>{{module.message}}</h1>
          </:ready>
        </ImportModule>
      </template>
    )

    await waitFor('[data-test-ready]');
    assert.dom('h1').containsText('I loaded OK');
  });

  test('yields module loading errors', async function (assert) {
    await renderComponent(
      <template>
        <ImportModule @url="http://localhost:4200/test-modules/bad.js">
          <:error as |err|>
            <div data-test-type>{{err.type}}</div>
            <div data-test-message>{{err.message}}</div>
          </:error>
        </ImportModule>
      </template>
    )

    await waitFor('[data-test-type]');
    assert.dom('[data-test-type]').containsText('runtime');
    assert.dom('[data-test-message]').containsText('SyntaxError');
  });
});