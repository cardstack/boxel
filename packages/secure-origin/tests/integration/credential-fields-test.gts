import {
  blur,
  fillIn,
  render,
  settled,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { Changes } from '../../src/credentials/changes.ts';
import CredentialFields from '../../src/credentials/credential-fields.gts';
import {
  applyStyle,
  customProperties,
  LAYOUT_PROPERTY,
  whenStyled,
} from '../../src/credentials/style.ts';
import { CredentialFrame, FORMS } from '../../src/security/credentials.js';
import { nextResize } from '../helpers/waiters.ts';

const APP_ORIGIN = 'https://app.example.test';

interface Rendered {
  frame: CredentialFrame;
  sent: any[];
  receive(data: unknown): void;
}

async function renderForm(formName: keyof typeof FORMS): Promise<Rendered> {
  let parent = {};
  let sent: any[] = [];
  // Read by the template, so not reassignable.
  const changes = new Changes();
  const frame = new CredentialFrame({
    form: FORMS[formName],
    appOrigin: APP_ORIGIN,
    matrixURL: new URL('https://matrix.example.test/'),
    parent,
    send: (message) => sent.push(message),
    measure: () =>
      document.getElementById('credential-fields')!.getBoundingClientRect()
        .height,
    onChange: changes.bump,
  });
  await render(
    <template>
      <CredentialFields @frame={{frame}} @changes={{changes}} />
    </template>,
  );
  return {
    frame,
    sent,
    receive(data) {
      frame.receive({
        data,
        source: parent,
        origin: APP_ORIGIN,
      } as unknown as MessageEvent);
    },
  };
}

function inputs() {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      '#credential-fields input[data-test-boxel-input]',
    ),
  ];
}

module('Integration | credential fields', function (hooks) {
  setupRenderingTest(hooks);

  module('the fields each form draws', function () {
    test('login: username and password, each in an AuthFormField', async function (assert) {
      await renderForm('login');
      assert.dom('#credential-fields').hasClass('layout-auth');
      assert
        .dom('[data-test-boxel-field]')
        .exists({ count: 2 })
        .hasClass('auth-form-field')
        .hasTagName('label');
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-boxel-field-label]')].map(
          (label) => label.textContent!.trim(),
        ),
        ['Email Address or Username', 'Password'],
      );
      assert
        .dom('[data-test-username-field]')
        .hasAttribute('type', 'text')
        .hasAttribute('id', 'boxel-login-username')
        .hasAttribute('name', 'username')
        .hasAttribute('autocomplete', 'username')
        .hasAttribute('placeholder', 'Your email address')
        .hasAttribute('data-test-boxel-input-id', 'boxel-login-username')
        .doesNotHaveAttribute('data-test-boxel-input-validation-state');
      assert
        .dom('[data-test-password-field]')
        .hasAttribute('type', 'password')
        .hasAttribute('id', 'boxel-login-password')
        .hasAttribute('name', 'password')
        .hasAttribute('autocomplete', 'current-password')
        .hasAttribute('placeholder', 'Your password');
      assert
        .dom('input[name="username"][hidden]')
        .doesNotExist('no hidden username');
    });

    test('cli-login: username and password', async function (assert) {
      await renderForm('cli-login');
      assert
        .dom('[data-test-cli-auth-username]')
        .hasAttribute('id', 'boxel-cli-auth-username')
        .hasAttribute('autocomplete', 'username');
      assert
        .dom('[data-test-cli-auth-password]')
        .hasAttribute('type', 'password')
        .hasAttribute('id', 'boxel-cli-auth-password')
        .hasAttribute('autocomplete', 'current-password');
      assert.strictEqual(inputs().length, 2);
    });

    test('register: a new password and its confirmation, with a hidden username', async function (assert) {
      let { receive } = await renderForm('register');
      assert
        .dom('[data-test-password-field]')
        .hasAttribute('id', 'boxel-register-password')
        .hasAttribute('autocomplete', 'new-password')
        .hasAttribute('data-test-boxel-input-validation-state', 'initial');
      assert
        .dom('[data-test-confirm-password-field]')
        .hasAttribute('id', 'boxel-register-confirm-password')
        .hasAttribute('name', 'confirm-password')
        .hasAttribute('autocomplete', 'new-password')
        .hasAttribute('placeholder', 'Re-enter your password');
      receive({ type: 'context', username: 'new-user' });
      await settled();
      assert
        .dom('input[name="username"][hidden]')
        .hasAttribute('autocomplete', 'username')
        .hasAttribute('tabindex', '-1')
        .hasValue('new-user');
    });

    test('reset: a new password and its confirmation', async function (assert) {
      await renderForm('reset');
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-boxel-field-label]')].map(
          (label) => label.textContent!.trim(),
        ),
        ['Enter New Password', 'Re-Enter New Password'],
      );
      assert.deepEqual(
        inputs().map((input) => input.autocomplete),
        ['new-password', 'new-password'],
      );
      assert.dom('input[name="username"][hidden]').doesNotExist();
    });

    test('change-password: three horizontal fields, as the settings modal draws them', async function (assert) {
      await renderForm('change-password');
      assert.dom('#credential-fields').hasClass('layout-settings');
      assert
        .dom('[data-test-boxel-field]')
        .exists({ count: 3 })
        .hasClass('horizontal')
        .hasClass('password-settings-field');
      assert.dom('[data-test-current-password-field]').exists();
      assert.dom('[data-test-new-password-field]').exists();
      assert.dom('[data-test-confirm-password-field]').exists();
      assert.deepEqual(
        inputs().map((input) => input.autocomplete),
        ['current-password', 'new-password', 'new-password'],
      );
      assert.dom('input[name="username"][hidden]').exists();
    });

    test('confirm-password: one unlabelled field, as the change-email modal draws it', async function (assert) {
      await renderForm('confirm-password');
      assert.dom('#credential-fields').hasClass('layout-modal');
      assert.dom('[data-test-boxel-field]').hasClass('vertical');
      assert.dom('[data-test-boxel-field-label]').doesNotExist();
      assert
        .dom('[data-test-password-field]')
        .hasAttribute('autocomplete', 'current-password')
        .hasAttribute('data-test-boxel-input-validation-state', 'initial');
    });
  });

  module('validity', function () {
    test('reports what is typed to the frame, and the app hears only that a field is filled in', async function (assert) {
      let { frame, sent } = await renderForm('login');
      await fillIn('[data-test-username-field]', 'example-user');
      await fillIn('[data-test-password-field]', 'a-long-password');
      assert.strictEqual(frame.value('username'), 'example-user');
      assert.strictEqual(frame.value('password'), 'a-long-password');
      assert.deepEqual(
        sent.filter((message) => message.type === 'state').at(-1),
        {
          type: 'state',
          filled: { username: true, password: true },
          complete: true,
        },
      );
      assert.notOk(JSON.stringify(sent).includes('a-long-password'));
    });

    test('shows an invalid field as BoxelInput does, and clears it on typing', async function (assert) {
      await renderForm('reset');
      await fillIn('[data-test-password-field]', 'short');
      await blur('[data-test-password-field]');
      assert
        .dom('[data-test-password-field]')
        .hasClass('invalid')
        .hasAttribute('aria-invalid', 'true')
        .hasAttribute('data-test-boxel-input-validation-state', 'invalid');
      assert
        .dom('[data-test-boxel-input-error-message]')
        .hasText('Password must be at least 8 characters long');
      let errorId = document
        .querySelector('[data-test-boxel-input-error-message]')!
        .getAttribute('id');
      assert
        .dom('[data-test-password-field]')
        .hasAttribute('aria-errormessage', errorId!);

      await fillIn('[data-test-password-field]', 'shorter');
      assert
        .dom('[data-test-password-field]')
        .doesNotHaveClass('invalid')
        .doesNotHaveAttribute('aria-invalid')
        .hasAttribute('data-test-boxel-input-validation-state', 'initial');
      assert.dom('[data-test-boxel-input-error-message]').doesNotExist();
    });

    test('takes a value that arrives with only a `change` event', async function (assert) {
      let { frame, sent } = await renderForm('login');
      let password = document.querySelector<HTMLInputElement>(
        '[data-test-password-field]',
      )!;
      password.value = 'a-long-password';
      await triggerEvent(password, 'change');
      assert.strictEqual(frame.value('password'), 'a-long-password');
      assert.deepEqual(
        sent.filter((message) => message.type === 'state').at(-1).filled,
        { username: false, password: true },
      );
    });

    test('a `change` after typing keeps the error the field was given', async function (assert) {
      let { frame, receive } = await renderForm('login');
      await fillIn('[data-test-password-field]', 'a-password');
      receive({
        type: 'field-error',
        field: 'password',
        message: 'Wrong password',
      });
      await triggerEvent('[data-test-password-field]', 'change');
      assert.strictEqual(frame.error('password'), 'Wrong password');
      assert
        .dom('[data-test-boxel-input-error-message]')
        .hasText('Wrong password');
    });

    test('a field is named by its label alone, not by its error message', async function (assert) {
      await renderForm('reset');
      await fillIn('[data-test-password-field]', 'short');
      await blur('[data-test-password-field]');
      assert.dom('[data-test-boxel-input-error-message]').exists();
      let input = document.querySelector('[data-test-password-field]')!;
      let labelId = input.getAttribute('aria-labelledby');
      assert.ok(labelId, 'the input names its label');
      assert
        .dom(document.getElementById(labelId!))
        .hasAttribute('data-test-boxel-field-label')
        .hasText('Enter New Password');
    });

    test('a field with no label is still named', async function (assert) {
      await renderForm('confirm-password');
      assert
        .dom('[data-test-password-field]')
        .doesNotHaveAttribute('aria-labelledby')
        .hasAttribute('aria-label', 'Password');
    });

    test("an invalid field's error message describes it", async function (assert) {
      let { receive } = await renderForm('confirm-password');
      receive({
        type: 'field-error',
        field: 'current',
        message: 'Invalid password',
      });
      await settled();
      let input = document.querySelector('[data-test-password-field]')!;
      let described = input.getAttribute('aria-describedby');
      assert.ok(described, 'the input names a description');
      assert.strictEqual(described, input.getAttribute('aria-errormessage'));
      assert
        .dom(document.getElementById(described!))
        .hasAttribute('data-test-boxel-input-error-message')
        .hasText('Invalid password');
    });

    test('shows the error the app reports for a field', async function (assert) {
      let { receive } = await renderForm('login');
      receive({
        type: 'field-error',
        field: 'password',
        message: 'Sign in failed. Please check your credentials and try again.',
      });
      await settled();
      assert
        .dom('[data-test-boxel-input-error-message]')
        .hasText(
          'Sign in failed. Please check your credentials and try again.',
        );
      assert.dom('[data-test-password-field]').hasClass('invalid');
    });

    test('register: shows that the password is valid, and that the passwords match', async function (assert) {
      await renderForm('register');
      await fillIn('[data-test-password-field]', 'a-long-password');
      assert.dom('[data-test-password-valid]').hasText('password is valid');
      assert.dom('[data-test-password-valid] svg').exists('with a check mark');
      assert.dom('[data-test-passwords-match]').doesNotExist();
      await fillIn('[data-test-confirm-password-field]', 'a-long-password');
      assert.dom('[data-test-passwords-match]').hasText('passwords match');
      await fillIn('[data-test-confirm-password-field]', 'a-long-passwor');
      assert.dom('[data-test-passwords-match]').doesNotExist();
    });

    test('Enter in a field asks the app to submit', async function (assert) {
      let { sent } = await renderForm('login');
      let before = sent.length;
      await triggerKeyEvent('[data-test-password-field]', 'keydown', 'Enter');
      // The fields may also report their size or state meanwhile; Enter
      // sends one submit-request and makes no request of its own.
      let requests = sent
        .slice(before)
        .filter((message) =>
          ['submit-request', 'result'].includes(message.type),
        );
      assert.deepEqual(requests, [{ type: 'submit-request' }]);
    });

    test('a username the app knows fills in the username field', async function (assert) {
      let { receive } = await renderForm('login');
      receive({ type: 'context', username: 'example-user' });
      await settled();
      assert.dom('[data-test-username-field]').hasValue('example-user');
    });
  });

  module('sizing and theming', function () {
    test('reports the height of the fields, and again when it changes', async function (assert) {
      let { sent, receive } = await renderForm('reset');
      let sizes = () => sent.filter((message) => message.type === 'size');
      let formHeight = () =>
        document.getElementById('credential-fields')!.getBoundingClientRect()
          .height;
      receive({ type: 'style', properties: {} });
      // The frame measures itself once the styles are drawn, so the report
      // arrives after this message is handled.
      await settled();
      let first = sizes().at(-1);
      assert.strictEqual(first.height, formHeight(), 'the height of the form');
      await fillIn('[data-test-password-field]', 'short');
      await blur('[data-test-password-field]');
      await nextResize(document.getElementById('credential-fields')!);
      assert.true(sizes().at(-1).height > first.height, 'reports a new height');
      assert.strictEqual(
        sizes().at(-1).height,
        formHeight(),
        'grows with an error message, to the height of the form',
      );
    });

    test('change-password: the narrow layout stacks each label over its field', async function (assert) {
      let { receive } = await renderForm('change-password');
      receive({
        type: 'style',
        properties: { [LAYOUT_PROPERTY]: 'narrow' },
      });
      // The grid tracks each field has: its label and its input side by side,
      // or the label stacked over the input.
      let tracks = () =>
        getComputedStyle(
          document.querySelector('[data-test-boxel-field]')!,
        ).gridTemplateColumns.split(' ').length;
      await settled();
      assert.dom('#credential-fields').hasClass('narrow');
      assert.strictEqual(tracks(), 1, 'stacked');
      receive({ type: 'style', properties: { [LAYOUT_PROPERTY]: 'wide' } });
      await settled();
      assert.dom('#credential-fields').doesNotHaveClass('narrow');
      assert.strictEqual(tracks(), 2, 'side by side');
    });

    test("applyStyle writes the app's values through the CSSOM", function (assert) {
      let doc = document.implementation.createHTMLDocument();
      let root = doc.documentElement;
      root.style.setProperty('--boxel-sp-xs', '1px');
      applyStyle(doc, [LAYOUT_PROPERTY, '--boxel-sp', '--boxel-sp-xs'], {
        properties: {
          [LAYOUT_PROPERTY]: 'narrow',
          '--boxel-sp': '1.25rem',
          '--boxel-sp-xs': ' ',
        },
        inherited: {
          color: 'rgb(1, 2, 3)',
          'color-scheme': 'dark',
          'font-family': '"IBM Plex Sans"',
          'letter-spacing': 7,
        },
        backdrop: 'rgb(10, 20, 30)',
        width: 300.5,
        offset: { x: 0.25, y: 3 },
      });
      assert.strictEqual(root.style.getPropertyValue('--boxel-sp'), '1.25rem');
      assert.strictEqual(
        root.style.getPropertyValue(LAYOUT_PROPERTY),
        'narrow',
      );
      assert.strictEqual(
        root.style.getPropertyValue('--boxel-sp-xs'),
        '',
        'a property the app has no value for is removed',
      );
      assert.strictEqual(doc.body.style.color, 'rgb(1, 2, 3)');
      assert.strictEqual(root.style.getPropertyValue('color-scheme'), 'dark');
      assert.strictEqual(doc.body.style.fontFamily, '"IBM Plex Sans"');
      assert.strictEqual(
        doc.body.style.letterSpacing,
        '',
        'only strings are taken',
      );
      assert.strictEqual(root.style.backgroundColor, 'rgb(10, 20, 30)');
      assert.strictEqual(doc.body.style.width, '300.5px');
      assert.strictEqual(doc.body.style.left, '0.25px');
      assert.strictEqual(
        doc.body.style.top,
        '',
        'an offset of a pixel or more is not a part of one',
      );
      assert.true(root.classList.contains('styled'));

      applyStyle(doc, [LAYOUT_PROPERTY], {
        properties: {},
        backdrop: 'not a color',
      });
      assert.strictEqual(root.style.backgroundColor, '', 'no backdrop');
      assert.strictEqual(doc.body.style.width, '', 'no width');
      assert.strictEqual(doc.body.style.left, '', 'no offset');
    });

    // Whether `promise` settles within `ms`.
    async function settlesWithin(promise: Promise<void>, ms: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result = await Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), ms);
        }),
      ]);
      clearTimeout(timer);
      return result;
    }

    // A document with one stylesheet that is still loading.
    function loadingDocument() {
      let link = document.createElement('link');
      link.rel = 'stylesheet';
      let doc = {
        querySelectorAll: () => [link],
      } as unknown as Document;
      return { doc, link };
    }

    test('is styled once its stylesheets load', async function (assert) {
      let { doc, link } = loadingDocument();
      let styled = whenStyled(doc, 60000);
      assert.false(await settlesWithin(styled, 50), 'waits on the stylesheet');
      link.dispatchEvent(new Event('load'));
      assert.true(await settlesWithin(styled, 1000));
    });

    test('is styled once a stylesheet fails to load', async function (assert) {
      let { doc, link } = loadingDocument();
      let styled = whenStyled(doc, 60000);
      link.dispatchEvent(new Event('error'));
      assert.true(await settlesWithin(styled, 1000));
    });

    test('stops waiting on a stylesheet that never settles', async function (assert) {
      let { doc } = loadingDocument();
      let styled = whenStyled(doc, 100);
      assert.false(await settlesWithin(styled, 20), 'waits at first');
      assert.true(await settlesWithin(styled, 1000));
    });

    test("asks the app for the custom properties the fields' styles read", async function (assert) {
      await renderForm('change-password');
      let properties = customProperties(document);
      for (let name of [
        LAYOUT_PROPERTY,
        '--boxel-form-control-height',
        '--boxel-field-label-size',
        '--boxel-label-color',
        '--settings-modal-gap',
        '--destructive',
        '--boxel-sp',
      ]) {
        assert.true(properties.includes(name), name);
      }
      for (let name of [
        '--icon-size',
        '--_icon-full-length',
        '--boxel-label-letter-spacing',
      ]) {
        assert.false(
          properties.includes(name),
          `${name} is defined by the styles themselves`,
        );
      }
    });
  });
});
