import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import SignInScreen from '../../src/screens/sign-in.gts';

const noop = () => {};

module('Integration | sign-in screen', function (hooks) {
  setupRenderingTest(hooks);

  test('it is titled for the app, with the Google subtitle', async function (assert) {
    await render(
      <template>
        <SignInScreen
          @google={{true}}
          @googleSubtitle={{true}}
          @onSubmit={{noop}}
          @onGoogle={{noop}}
          @onForgotPassword={{noop}}
          @onRegister={{noop}}
        />
      </template>,
    );

    assert
      .dom('[data-test-secure-sign-in-title]')
      .hasText('Sign in to your Boxel Account');
    assert.dom('[data-test-secure-sign-in-subtitle]').exists();
  });

  test('a page names itself and says what signing in grants', async function (assert) {
    await render(
      <template>
        <SignInScreen
          @title='Authorize Boxel CLI'
          @google={{true}}
          @googleSubtitle={{true}}
          @onSubmit={{noop}}
          @onGoogle={{noop}}
          @onForgotPassword={{noop}}
          @onRegister={{noop}}
        >
          <:intro>
            <p data-test-intro>Signing in gives the CLI access.</p>
          </:intro>
          <:default>
            <input aria-label='Password' data-test-fields />
          </:default>
        </SignInScreen>
      </template>,
    );

    assert
      .dom('[data-test-secure-sign-in-title]')
      .hasText('Authorize Boxel CLI');
    assert.dom('[data-test-intro]').exists();
    assert
      .dom('[data-test-secure-sign-in-subtitle]')
      .doesNotExist('the intro stands in place of the Google subtitle');
    assert.dom('[data-test-login-form] [data-test-fields]').exists();
    assert.dom('[data-test-google-login-btn]').exists();
    assert.dom('[data-test-login-btn]').exists();
  });
});
