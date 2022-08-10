import { module, test } from 'qunit';
import { waitFor } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import ImportModule from 'runtime-spike/components/import-module';
import config from 'runtime-spike/config/environment';
import { Loader } from '@cardstack/runtime-common/loader';

// It appears that we are unable to load modules from localhost:4200 when tests
// run from the CLI. So instead we are explicitly running an http-server on 4203 in
// the CLI for these tests. Sadly we can't put these modules into our realm server,
// since the realm serve currently refuses to host broken modules (which will be
// addressed in the future).
const host = config.isCli ? 'http://localhost:4203/' : 'http://localhost:4200/';
Loader.addURLMapping(new URL("http://module-host/"), new URL(host));

module('Integration | import-module', function (hooks) {
  setupRenderingTest(hooks);

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