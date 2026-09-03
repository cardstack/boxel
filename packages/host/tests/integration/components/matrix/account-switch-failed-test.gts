import { click, render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import AccountSwitchFailed from '@cardstack/host/components/matrix/account-switch-failed';

import { setupRenderingTest } from '../../../helpers/setup';

const noop = () => {};

module(
  'Integration | Component | matrix/account-switch-failed',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders the failure message and a back-to-home link', async function (assert) {
      await render(
        <template><AccountSwitchFailed @onBackToHome={{noop}} /></template>,
      );

      assert.dom('[data-test-account-switch-failed]').exists();
      assert
        .dom('[data-test-account-switch-failed]')
        .containsText("Couldn't switch accounts");
      assert
        .dom('[data-test-account-switch-failed]')
        .containsText("haven't been signed out");
      assert
        .dom('[data-test-account-switch-back-home]')
        .hasText('Back to home');
    });

    test('invokes onBackToHome when the link is clicked', async function (assert) {
      let calls = 0;
      let onBackToHome = () => {
        calls++;
      };

      await render(
        <template>
          <AccountSwitchFailed @onBackToHome={{onBackToHome}} />
        </template>,
      );
      await click('[data-test-account-switch-back-home]');

      assert.strictEqual(calls, 1, 'onBackToHome fired exactly once');
    });
  },
);
