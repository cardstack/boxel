import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  AwaitingEmail,
  InviteCodeForm,
  RegisterForm,
} from '../../src/screens/register.gts';

const noop = () => {};

module('Integration | register screens', function (hooks) {
  setupRenderingTest(hooks);

  test("each step's title is the page's heading", async function (assert) {
    await render(
      <template>
        <RegisterForm
          @name=''
          @email=''
          @username=''
          @usernameState='initial'
          @onNameInput={{noop}}
          @onNameBlur={{noop}}
          @onEmailInput={{noop}}
          @onEmailBlur={{noop}}
          @onUsernameInput={{noop}}
          @onUsernameBlur={{noop}}
          @onSubmit={{noop}}
          @onSignIn={{noop}}
        />
        <InviteCodeForm @token='' @onTokenInput={{noop}} @onSubmit={{noop}} />
        <AwaitingEmail @onResend={{noop}} />
      </template>,
    );

    assert.dom('[role="heading"][aria-level="1"]').exists({ count: 3 });
  });

  test('a page with a heading of its own above them lowers their titles', async function (assert) {
    await render(
      <template>
        <RegisterForm
          @headingLevel={{2}}
          @name=''
          @email=''
          @username=''
          @usernameState='initial'
          @onNameInput={{noop}}
          @onNameBlur={{noop}}
          @onEmailInput={{noop}}
          @onEmailBlur={{noop}}
          @onUsernameInput={{noop}}
          @onUsernameBlur={{noop}}
          @onSubmit={{noop}}
          @onSignIn={{noop}}
        />
        <InviteCodeForm
          @headingLevel={{2}}
          @token=''
          @onTokenInput={{noop}}
          @onSubmit={{noop}}
        />
        <AwaitingEmail @headingLevel={{2}} @onResend={{noop}} />
      </template>,
    );

    assert.dom('[role="heading"][aria-level="2"]').exists({ count: 3 });
    assert.dom('[role="heading"][aria-level="1"]').doesNotExist();
  });
});
