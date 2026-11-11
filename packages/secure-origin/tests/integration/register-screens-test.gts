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

    assert.dom('h1[data-test-secure-title]').exists({ count: 3 });
    assert.dom('[role="heading"]').doesNotExist();
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

    assert.dom('h2[data-test-secure-title]').exists({ count: 3 });
    assert.dom('h1').doesNotExist();
  });

  test('each field is labelled by a label for it, and the forms post', async function (assert) {
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
      </template>,
    );

    for (let name of ['name', 'email', 'username']) {
      let input = document.querySelector<HTMLInputElement>(
        `[data-test-register-form] input[name="${name}"]`,
      );
      assert.ok(input?.id, `${name}: the input has an id`);
      assert
        .dom(`[data-test-secure-field="${name}"] label[for="${input?.id}"]`)
        .exists(`${name}: a label is for the input`);
      assert.deepEqual(
        [...(input?.labels ?? [])].map((label) => label.textContent?.trim()),
        [{ name: 'Your Name', email: 'Email', username: 'Username' }[name]],
        `${name}: the input's label`,
      );
    }
    assert.dom('[data-test-register-form]').hasAttribute('method', 'post');
    assert.dom('[data-test-token-page]').hasAttribute('method', 'post');
  });
});
