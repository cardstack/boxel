import {
  click,
  fillIn,
  render,
  triggerEvent,
  waitFor,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { navigation } from '../../src/shell/navigation.js';
import ForgotPassword from '../../src/shell/password-reset/forgot-password.gts';
import {
  resetLink,
  takeResetLink,
  type ResetLink,
} from '../../src/shell/password-reset/reset-link.ts';
import ResetPassword from '../../src/shell/password-reset/reset-password.gts';
import { setupMockServers, setupPageAddress } from '../helpers/mock-servers.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';
import { fieldNames } from '../helpers/field-names.ts';
import { assertEnterSubmits } from '../helpers/implicit-submission.ts';

const CLI = {
  url: 'http://127.0.0.1:4567/callback',
  state: 'cli-state-0123456789abcdef',
};
const NEW_PASSWORD = 'a-new-password-1';

const error = (name: string) =>
  `[data-test-secure-field="${name}"] [data-test-boxel-input-error-message]`;

module('Integration | password reset', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let assigned: string[] = [];
  let assign = navigation.assign;

  hooks.beforeEach(function () {
    assigned = [];
    navigation.assign = (url: string) => assigned.push(url);
  });
  hooks.afterEach(function () {
    navigation.assign = assign;
  });
  setupTelemetrySecretsCheck(hooks, () => [
    // What the page sent: bodies and credentials, not the method and path
    // a label is made from.
    ...stringsIn(
      [...servers.requests('matrix'), ...servers.requests('realm-server')].map(
        (r) => [r.body, r.authorization],
      ),
    ),
    NEW_PASSWORD,
    'the-client-secret',
    'someone@example.com',
    'nobody@example.com',
    'something-else',
  ]);

  module('forgot-password', function () {
    test('requests the reset email, with the secret in the link’s fragment', async function (assert) {
      servers.matrix('POST account/password/email/requestToken', () => ({
        sid: 'sid-1',
      }));
      await render(
        <template>
          <ForgotPassword @cli={{CLI}} @signInURL='cli-sign-in' />
        </template>,
      );
      assert.dom('[data-test-email-field]').isFocused();
      assert.dom('[data-test-reset-your-password-btn]').isDisabled();
      await fillIn('[data-test-email-field]', 'someone@example.com');
      assertEnterSubmits(
        assert,
        '[data-test-forgot-password-form]',
        '[data-test-reset-your-password-btn]',
      );
      await triggerEvent('[data-test-forgot-password-form]', 'submit');
      await waitFor('[data-test-email-validation]');
      assert
        .dom('[data-test-email-validation]')
        .hasText('Please check your email to reset your password');
      assert
        .dom('.email-validation-instruction b')
        .hasText('someone@example.com');

      let [request] = servers.requests(
        'matrix',
        'POST account/password/email/requestToken',
      );
      assert.strictEqual(request!.body.email, 'someone@example.com');
      assert.strictEqual(request!.body.send_attempt, 1);
      let link = new URL(request!.body.next_link);
      assert.true(link.pathname.endsWith('/reset-password'));
      assert.strictEqual(
        link.search,
        '',
        'nothing in the query string, which access logs record',
      );
      assert.true(
        request!.body.next_link.includes('?#'),
        'an empty query, so the Matrix server adds the session id with `&`',
      );
      let fragment = new URLSearchParams(link.hash.slice(1));
      assert.strictEqual(
        fragment.get('clientSecret'),
        request!.body.client_secret,
      );
      assert.strictEqual(fragment.get('email'), 'someone@example.com');
      assert.strictEqual(fragment.get('port'), '4567');
      assert.strictEqual(fragment.get('state'), CLI.state);

      await click('[data-test-resend-validation-btn]');
      let sends = servers.requests(
        'matrix',
        'POST account/password/email/requestToken',
      );
      assert.deepEqual(
        sends.map(({ body }) => body.send_attempt),
        [1, 2],
      );
      assert.strictEqual(
        sends[1]!.body.client_secret,
        sends[0]!.body.client_secret,
      );
    });

    test('an address no account holds is refused', async function (assert) {
      servers.matrix('POST account/password/email/requestToken', () => ({
        status: 400,
        body: { errcode: 'M_THREEPID_NOT_FOUND', error: 'Email not found' },
      }));
      await render(
        <template><ForgotPassword @signInURL='sign-in' /></template>,
      );
      await fillIn('[data-test-email-field]', 'nobody@example.com');
      await click('[data-test-reset-your-password-btn]');
      await waitFor(error('email'));
      assert
        .dom(error('email'))
        .hasText('No account with the given email address exists');
      assert.deepEqual(fieldNames(), { email: 'Email Address' });
      assert.dom('[data-test-reset-your-password-btn]').isDisabled();
      await fillIn('[data-test-email-field]', 'someone@example.com');
      assert.dom(error('email')).doesNotExist();
      assert.dom('[data-test-reset-your-password-btn]').isNotDisabled();
    });

    test('"Back to login" goes to the sign-in page', async function (assert) {
      await render(
        <template><ForgotPassword @signInURL='sign-in' /></template>,
      );
      await click('[data-test-cancel-reset-password-btn]');
      assert.deepEqual(assigned, ['sign-in']);
    });
  });

  module('the reset link', function () {
    // The link as the Matrix server sends it: the session id appended with
    // `&` to a link with a query string, and with `?` to one without.
    function asSent(link: string, sid: string) {
      return `${link}${link.includes('?') ? '&' : '?'}sid=${sid}`;
    }

    test('its secret is read from the fragment and taken out of the history', async function (assert) {
      history.replaceState(
        null,
        '',
        asSent(
          resetLink('the-client-secret', 'someone@example.com', CLI),
          'sid-1',
        ),
      );
      let link = takeResetLink();
      assert.deepEqual(link, {
        clientSecret: 'the-client-secret',
        sid: 'sid-1',
        email: 'someone@example.com',
        cli: CLI,
      });
      assert.strictEqual(window.location.hash, '', 'out of the address bar');
      assert.true(window.location.pathname.endsWith('/reset-password'));
      assert.notOk(
        window.location.href.includes('the-client-secret'),
        'nowhere in the address',
      );
    });

    test('a link that names no CLI hands none on', function (assert) {
      history.replaceState(
        null,
        '',
        asSent(resetLink('secret', 'someone@example.com'), 'sid-1'),
      );
      assert.strictEqual(takeResetLink().cli, undefined);
    });

    test('a link sent without its empty query still reads its session id', function (assert) {
      let link = resetLink('secret', 'someone@example.com').replace('?#', '#');
      history.replaceState(null, '', asSent(link, 'sid-1'));
      assert.deepEqual(takeResetLink(), {
        clientSecret: 'secret',
        sid: 'sid-1',
        email: 'someone@example.com',
        cli: undefined,
      });
    });
  });

  module('reset-password', function () {
    const LINK: ResetLink = {
      clientSecret: 'the-client-secret',
      sid: 'sid-1',
      email: 'someone@example.com',
    };

    test('sets the new password through the realm server, which ends the secure sessions the old one signed in', async function (assert) {
      servers.realmServer('POST _secure-sessions/password-change', () => ({
        status: 200,
        body: {},
      }));
      await render(<template><ResetPassword @link={{LINK}} /></template>);
      assert.dom('[data-test-password-field]').isFocused();
      assertEnterSubmits(
        assert,
        '[data-test-reset-password-form]',
        '[data-test-reset-password-btn]',
      );
      await fillIn('[data-test-password-field]', NEW_PASSWORD);
      await fillIn('[data-test-confirm-password-field]', NEW_PASSWORD);
      await click('[data-test-reset-password-btn]');
      await waitFor('[data-test-reset-password-success]');
      assert
        .dom('[data-test-reset-password-success]')
        .hasText('Your password is now reset');

      assert.deepEqual(
        servers.requests(
          'realm-server',
          'POST _secure-sessions/password-change',
        )[0]!.body.data.attributes,
        {
          sid: 'sid-1',
          clientSecret: 'the-client-secret',
          newPassword: NEW_PASSWORD,
          email: 'someone@example.com',
        },
      );
      assert.strictEqual(
        servers.requests('matrix').length,
        0,
        'the page sends the new password to the Matrix server only through the realm server',
      );
      await click('[data-test-back-to-login-btn]');
      assert.true(
        new URL(assigned[0]!, window.location.href).pathname.endsWith(
          '/sign-in',
        ),
      );
    });

    test('checks the new password before it is sent', async function (assert) {
      await render(<template><ResetPassword @link={{LINK}} /></template>);
      await fillIn('[data-test-password-field]', 'short');
      await triggerEvent('[data-test-password-field]', 'blur');
      assert
        .dom(error('password'))
        .hasText('Password must be at least 8 characters long');
      await fillIn('[data-test-password-field]', NEW_PASSWORD);
      await fillIn('[data-test-confirm-password-field]', 'something-else');
      await triggerEvent('[data-test-confirm-password-field]', 'blur');
      assert.dom(error('confirm-password')).hasText('Passwords do not match');
      assert.deepEqual(
        fieldNames(),
        {
          password: 'Enter New Password',
          'confirm-password': 'Re-Enter New Password',
        },
        'each field is named by its label alone, with its error showing',
      );
      assert.dom('[data-test-reset-password-btn]').isDisabled();
      assert.strictEqual(
        servers.requests('realm-server').length,
        0,
        'nothing was sent',
      );
    });

    test('a link without its secret says to start again', async function (assert) {
      const link = { ...LINK, sid: '', cli: CLI };
      await render(<template><ResetPassword @link={{link}} /></template>);
      assert
        .dom('[data-test-reset-password-error]')
        .includesText('invalid password reset parameters');
      let restart = new URL(
        document
          .querySelector('[data-test-forgot-password-link]')!
          .getAttribute('href')!,
        window.location.href,
      );
      assert.true(restart.pathname.endsWith('/forgot-password'));
      assert.strictEqual(
        restart.searchParams.get('port'),
        '4567',
        "the CLI's listener is carried back",
      );
    });

    test('a refused reset says to start again, and a server error says so', async function (assert) {
      let status = 401;
      servers.realmServer('POST _secure-sessions/password-change', () => ({
        status,
        body: { errcode: 'M_UNAUTHORIZED', error: 'Not validated' },
      }));
      await render(<template><ResetPassword @link={{LINK}} /></template>);
      await fillIn('[data-test-password-field]', NEW_PASSWORD);
      await fillIn('[data-test-confirm-password-field]', NEW_PASSWORD);
      await click('[data-test-reset-password-btn]');
      await waitFor('[data-test-reset-password-error]');
      assert
        .dom('[data-test-reset-password-error]')
        .includesText('invalid password reset parameters');

      status = 500;
      await click('[data-test-reset-password-btn]');
      await waitFor('[data-test-reset-password-error]:not(:has(a))');
      assert
        .dom('[data-test-reset-password-error]')
        .hasText(
          'An unknown error happened. Please try again, or contact support if the problem persists.',
        );
    });
  });
});
