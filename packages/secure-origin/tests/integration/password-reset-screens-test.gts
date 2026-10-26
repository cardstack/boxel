import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  ForgotPasswordForm,
  ResetEmailSent,
  ResetPasswordDone,
  ResetPasswordForm,
} from '../../src/screens/password-reset.gts';

const noop = () => {};

module('Integration | password reset screens', function (hooks) {
  setupRenderingTest(hooks);

  test("each step's title is the page's heading", async function (assert) {
    await render(
      <template>
        <ForgotPasswordForm
          @onEmailInput={{noop}}
          @onSubmit={{noop}}
          @onSignIn={{noop}}
        />
        <ResetEmailSent @email='someone@example.test' @onResend={{noop}} />
        <ResetPasswordForm @forgotPasswordURL='#' @onSubmit={{noop}} />
        <ResetPasswordDone @onSignIn={{noop}} />
      </template>,
    );

    assert.dom('h1[data-test-secure-title]').exists({ count: 4 });
    assert.dom('[role="heading"]').doesNotExist();
  });
});
