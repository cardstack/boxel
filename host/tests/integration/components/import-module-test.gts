import { module, test } from 'qunit';
import { waitFor } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import ImportModule from 'runtime-spike/components/import-module';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';


module('Integration | import-module', function (hooks) {
  setupRenderingTest(hooks);
  hooks.before(async function () {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    // testem will serve on a different port than ember cli, so use this mapping
    Loader.addURLMapping(new URL("http://module-host"), new URL(window.origin));
  });

  test('yields a successfully loaded module', async function (assert) {
    await renderComponent(
      <template>
        <ImportModule @url="http://module-host/test-modules/good.js">
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
        <ImportModule @url="http://module-host/test-modules/bad.js">
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