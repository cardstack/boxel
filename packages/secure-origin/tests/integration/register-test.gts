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
import Register from '../../src/shell/register/register.gts';
import VerifyEmail from '../../src/shell/register/verify-email.gts';
import {
  interactiveAuth,
  secureSession,
  setupFormSubmits,
  setupMockServers,
  setupPageAddress,
  type MockServers,
} from '../helpers/mock-servers.ts';
import { fieldNames } from '../helpers/field-names.ts';
import { assertEnterSubmits } from '../helpers/implicit-submission.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

const STORAGE_KEY = 'boxel-secure-session';
const PASSWORD = 'mypassword1!';
const INVITE_CODE = 'good-invite-code';
const OPEN_FLOWS = [{ stages: ['m.login.email.identity', 'm.login.dummy'] }];
const CLI = {
  url: 'http://127.0.0.1:4567/callback',
  state: 'cli-state-0123456789abcdef',
};

const field = (name: string) => `[data-test-secure-field="${name}"]`;
const error = (name: string) =>
  `${field(name)} :is([data-test-boxel-input-error-message], [data-test-boxel-input-group-error-message])`;

// A Matrix server that asks for an invite code, then for the email to be
// validated, which it is once `validated()` is called.
function invitingServer(servers: MockServers) {
  let emailValidated = false;
  servers.realmServer('GET _secure-origin', () => ({
    data: { attributes: { matrixServerName: 'localhost' } },
  }));
  servers.matrix('GET register/available', () => ({ available: true }));
  servers.matrix('POST register/email/requestToken', () => ({ sid: 'sid-1' }));
  servers.matrix('POST register', (body) => {
    let auth = body.auth;
    if (!auth) {
      return interactiveAuth([]);
    }
    if (auth.type === 'm.login.registration_token') {
      return auth.token === INVITE_CODE
        ? interactiveAuth(['m.login.registration_token'])
        : interactiveAuth([]);
    }
    if (auth.type === 'm.login.email.identity' && emailValidated) {
      return { user_id: '@new-user:localhost', access_token: 'reg-token' };
    }
    return interactiveAuth(['m.login.registration_token']);
  });
  servers.matrix(
    `PUT profile/${encodeURIComponent('@new-user:localhost')}/displayname`,
    () => ({}),
  );
  servers.matrix('POST logout', () => ({}));
  return {
    validated() {
      emailValidated = true;
    },
  };
}

async function fillRegistration(password = PASSWORD) {
  await fillIn('[data-test-name-field]', 'New User');
  await fillIn('[data-test-email-field]', 'new-user@example.com');
  await fillIn('[data-test-username-field] input', 'new-user');
  await triggerEvent('[data-test-username-field] input', 'blur');
  await waitFor('[data-test-username-available]');
  await fillIn('[data-test-password-field]', password);
  await fillIn('[data-test-confirm-password-field]', password);
  await triggerEvent('[data-test-confirm-password-field]', 'blur');
}

module('Integration | register', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let submitted = setupFormSubmits(hooks);
  let assigned: string[] = [];
  let assign = navigation.assign;

  hooks.beforeEach(function () {
    localStorage.removeItem(STORAGE_KEY);
    assigned = [];
    navigation.assign = (url: string) => assigned.push(url);
  });
  hooks.afterEach(function () {
    navigation.assign = assign;
    localStorage.removeItem(STORAGE_KEY);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    // What the page sent: bodies and credentials, not the method and path
    // a label is made from.
    ...stringsIn(
      [...servers.requests('matrix'), ...servers.requests('realm-server')].map(
        (r) => [r.body, r.authorization],
      ),
    ),
    PASSWORD,
    INVITE_CODE,
    'new-user@example.com',
    'longenough1',
  ]);

  test('registers with an invite code, waiting by itself for the email to be validated', async function (assert) {
    let server = invitingServer(servers);
    servers.realmServer('POST _secure-session', () =>
      secureSession('@new-user:localhost'),
    );
    await render(<template><Register @signInURL='sign-in' /></template>);

    assert.dom('[data-test-name-field]').isFocused();
    assert
      .dom(`${field('username')} [data-test-input-group-suffix]`)
      .hasText('localhost');
    assert.dom('[data-test-register-btn]').isDisabled();
    await fillRegistration();
    assert.dom('[data-test-password-valid]').hasText('password is valid');
    assert.dom('[data-test-passwords-match]').hasText('passwords match');
    assert.dom('[data-test-register-btn]').isNotDisabled();
    assertEnterSubmits(
      assert,
      '[data-test-register-form]',
      '[data-test-register-btn]',
    );
    await triggerEvent('[data-test-register-form]', 'submit');

    await waitFor('[data-test-token-field]');
    assert.dom('[data-test-token-field]').isFocused();
    assertEnterSubmits(
      assert,
      '[data-test-token-page]',
      '[data-test-next-btn]',
    );
    await fillIn('[data-test-token-field]', INVITE_CODE);
    await click('[data-test-next-btn]');

    await waitFor('[data-test-email-validation]');
    assert
      .dom('[data-test-email-validation]')
      .hasText('Please check your email to complete registration');
    // The page polls on, and carries on once the link is followed.
    server.validated();
    await waitFor('[data-test-secure-signed-in]', { timeout: 5000 });

    let [emailRequest] = servers.requests(
      'matrix',
      'POST register/email/requestToken',
    );
    assert.strictEqual(emailRequest!.body.email, 'new-user@example.com');
    assert.strictEqual(emailRequest!.body.send_attempt, 1);
    assert.true(
      new URL(emailRequest!.body.next_link).pathname.endsWith('/verify-email'),
      'the email link lands on verify-email',
    );
    let registers = servers.requests('matrix', 'POST register');
    assert.ok(
      registers.every(({ body }) => body.password === PASSWORD),
      'every registration request carries the password',
    );
    let [named] = servers.requests(
      'matrix',
      `PUT profile/${encodeURIComponent('@new-user:localhost')}/displayname`,
    );
    assert.deepEqual(named!.body, { displayname: 'New User' });
    assert.strictEqual(named!.authorization, 'Bearer reg-token');
    assert.strictEqual(
      servers.requests('matrix', 'POST logout')[0]!.authorization,
      'Bearer reg-token',
      "the registration's own session is signed out",
    );
    let [signIn] = servers.requests('realm-server', 'POST _secure-session');
    assert.deepEqual(signIn!.body.data.attributes, {
      username: '@new-user:localhost',
      password: PASSWORD,
      client: 'window',
      registrationToken: INVITE_CODE,
    });
    assert.strictEqual(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).token,
      'secure-token-1',
    );
    assert.true(window.location.pathname.endsWith('/sign-in'));
  });

  test('creates an account with no invite step when the server asks for none', async function (assert) {
    servers.realmServer('GET _secure-origin', () => ({
      data: { attributes: { matrixServerName: 'localhost' } },
    }));
    servers.matrix('GET register/available', () => ({ available: true }));
    servers.matrix('POST register/email/requestToken', () => ({
      sid: 'sid-1',
    }));
    servers.matrix('POST register', (body) => {
      if (!body.auth) {
        return interactiveAuth([], OPEN_FLOWS);
      }
      if (body.auth.type === 'm.login.email.identity') {
        return interactiveAuth(['m.login.email.identity'], OPEN_FLOWS);
      }
      return { user_id: '@new-user:localhost', access_token: 'reg-token' };
    });
    servers.matrix(
      `PUT profile/${encodeURIComponent('@new-user:localhost')}/displayname`,
      () => ({}),
    );
    servers.matrix('POST logout', () => ({}));
    servers.realmServer('POST _secure-session', () =>
      secureSession('@new-user:localhost'),
    );
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-secure-signed-in]', { timeout: 5000 });
    assert.dom('[data-test-token-field]').doesNotExist();
    assert.deepEqual(
      servers
        .requests('matrix', 'POST register')
        .map(({ body }) => body.auth?.type),
      [undefined, 'm.login.email.identity', 'm.login.dummy'],
    );
    assert.notOk(
      'registrationToken' in
        servers.requests('realm-server', 'POST _secure-session')[0]!.body.data
          .attributes,
      'no invite code to record',
    );
  });

  test('resends the email validation message', async function (assert) {
    invitingServer(servers);
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-token-field]');
    await fillIn('[data-test-token-field]', INVITE_CODE);
    await click('[data-test-next-btn]');
    await waitFor('[data-test-resend-validation]');
    await click('[data-test-resend-validation]');
    let sends = servers.requests('matrix', 'POST register/email/requestToken');
    assert.deepEqual(
      sends.map(({ body }) => body.send_attempt),
      [1, 2],
    );
    assert.strictEqual(
      sends[0]!.body.client_secret,
      sends[1]!.body.client_secret,
      'the same validation session',
    );
    assert.dom('[data-test-email-validation]').exists('still waiting');
  });

  test('checks each field as it is left', async function (assert) {
    servers.realmServer('GET _secure-origin', () => ({
      data: { attributes: { matrixServerName: 'localhost' } },
    }));
    servers.matrix('GET register/available', () => ({
      status: 400,
      body: { errcode: 'M_USER_IN_USE', error: 'User ID already taken.' },
    }));
    await render(<template><Register @signInURL='sign-in' /></template>);

    await triggerEvent('[data-test-name-field]', 'blur');
    assert.dom(error('name')).hasText('Your name is missing');
    await triggerEvent('[data-test-email-field]', 'blur');
    assert.dom(error('email')).hasText('Email address is missing');

    for (let [value, message] of [
      ['', 'Username is missing'],
      ['_underscore', 'Username cannot start with an underscore'],
      ['realm/name', 'Username cannot start with "realm/"'],
      ['taken', 'Username is already taken'],
    ] as const) {
      await fillIn('[data-test-username-field] input', value);
      await triggerEvent('[data-test-username-field] input', 'blur');
      assert.dom(error('username')).hasText(message, value || 'empty');
      // An error the availability check shows on its own is announced, and
      // read with its field.
      let input = document.querySelector('[data-test-username-field] input')!;
      let described = input.getAttribute('aria-describedby');
      assert.ok(
        described,
        `${value || 'empty'}: the input names a description`,
      );
      assert
        .dom(document.getElementById(described!))
        .hasAttribute('aria-live', 'polite')
        .hasText(message);
    }
    assert.deepEqual(
      servers.requests('matrix', 'GET register/available').map(() => 'checked'),
      ['checked'],
      'only a username that could be registered is checked with the server',
    );

    await fillIn('[data-test-password-field]', 'short');
    await triggerEvent('[data-test-password-field]', 'blur');
    assert
      .dom(error('password'))
      .hasText('Password must be at least 8 characters long');
    await fillIn('[data-test-password-field]', 'longenough1');
    await fillIn('[data-test-confirm-password-field]', 'different1');
    await triggerEvent('[data-test-confirm-password-field]', 'blur');
    assert.dom(error('confirm-password')).hasText('Passwords do not match');
    assert.deepEqual(
      fieldNames(),
      {
        name: 'Your Name',
        email: 'Email',
        username: 'Username',
        password: 'Password',
        'confirm-password': 'Confirm Password',
      },
      'each field is named by its label alone, with its error showing',
    );
    assert.dom('[data-test-register-btn]').isDisabled();
    await fillIn('[data-test-name-field]', 'typing clears the error');
    assert.dom(error('name')).doesNotExist();
  });

  test('a username taken by the time the account is made is shown on its field', async function (assert) {
    invitingServer(servers);
    servers.matrix('POST register', () => ({
      status: 400,
      body: { errcode: 'M_USER_IN_USE', error: 'User ID already taken.' },
    }));
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor(error('username'));
    assert.dom(error('username')).hasText('Username is already taken');
    assert.dom('[data-test-register-form]').exists();
  });

  test('an email address another account holds is refused on its field', async function (assert) {
    invitingServer(servers);
    servers.matrix('POST register/email/requestToken', () => ({
      status: 400,
      body: { errcode: 'M_THREEPID_IN_USE', error: 'Email is in use' },
    }));
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor(error('email'));
    assert
      .dom(error('email'))
      .hasText('Email address is already attached to a Boxel account');
  });

  test('an error from the register request is shown on the form', async function (assert) {
    invitingServer(servers);
    servers.matrix('POST register', () => ({
      status: 403,
      body: { errcode: 'M_FORBIDDEN', error: 'Registration has been disabled' },
    }));
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-register-user-error]');
    assert
      .dom('[data-test-register-user-error]')
      .hasText(
        'There was an error registering: Registration has been disabled',
      );
    assert
      .dom('[data-test-register-btn]')
      .isNotDisabled('it can be tried again');
  });

  test('an invalid invite code is asked for again', async function (assert) {
    invitingServer(servers);
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-token-field]');
    await fillIn('[data-test-token-field]', 'not-an-invite-code');
    await click('[data-test-next-btn]');
    await waitFor(error('token'));
    assert
      .dom(error('token'))
      .hasText(
        'This registration token does not exist or has exceeded its usage limit.',
      );
    await fillIn('[data-test-token-field]', INVITE_CODE);
    assert.dom(error('token')).doesNotExist('typing clears the error');
  });

  test('an error from submitting the invite code is shown on its field', async function (assert) {
    invitingServer(servers);
    let first = true;
    servers.matrix('POST register', () => {
      if (first) {
        first = false;
        return interactiveAuth([]);
      }
      return { network: 'down' };
    });
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-token-field]');
    await fillIn('[data-test-token-field]', INVITE_CODE);
    await click('[data-test-next-btn]');
    await waitFor(error('token'));
    assert.dom(error('token')).hasText('Could not connect to server');
  });

  test('a failed first sign-in is tried again with the same password and invite code', async function (assert) {
    let server = invitingServer(servers);
    server.validated();
    let attempts = 0;
    servers.realmServer('POST _secure-session', () => {
      attempts++;
      return attempts === 1
        ? {
            status: 503,
            body: {
              errors: [
                {
                  status: '503',
                  code: 'unavailable',
                  detail:
                    'signing in is unavailable right now; try again later',
                },
              ],
            },
          }
        : secureSession('@new-user:localhost');
    });
    await render(<template><Register @signInURL='sign-in' /></template>);
    await fillRegistration();
    await click('[data-test-register-btn]');
    await waitFor('[data-test-token-field]');
    await fillIn('[data-test-token-field]', INVITE_CODE);
    await click('[data-test-next-btn]');
    await waitFor('[data-test-secure-retry-sign-in]', { timeout: 5000 });
    assert
      .dom('[data-test-secure-error]')
      .hasText('Signing in is unavailable right now; try again later.');
    await click('[data-test-secure-retry-sign-in]');
    await waitFor('[data-test-secure-signed-in]');
    let [first, second] = servers
      .requests('realm-server', 'POST _secure-session')
      .map(({ body }) => body.data.attributes);
    assert.deepEqual(second, first, 'the same sign-in, tried again');
    assert.strictEqual(second!.password, PASSWORD);
    assert.strictEqual(second!.registrationToken, INVITE_CODE);
  });

  test('a registration a CLI started hands the CLI its session, even from a browser that already holds one', async function (assert) {
    let held = { token: 'held-token', user: '@someone-else:localhost' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
    let server = invitingServer(servers);
    server.validated();
    servers.realmServer('POST _secure-session', () =>
      secureSession('@new-user:localhost', 'cli-token'),
    );
    await render(
      <template>
        <Register @cli={{CLI}} @username='new-user' @signInURL='cli-sign-in' />
      </template>,
    );
    assert
      .dom('[data-test-username-field] input')
      .hasValue('new-user', "the CLI's suggested username is filled in");
    await fillIn('[data-test-name-field]', 'New User');
    await fillIn('[data-test-email-field]', 'new-user@example.com');
    await triggerEvent('[data-test-username-field] input', 'blur');
    await waitFor('[data-test-username-available]');
    await fillIn('[data-test-password-field]', PASSWORD);
    await fillIn('[data-test-confirm-password-field]', PASSWORD);
    await click('[data-test-register-btn]');
    await waitFor('[data-test-token-field]');
    await fillIn('[data-test-token-field]', INVITE_CODE);
    await click('[data-test-next-btn]');

    let [form] = submitted;
    assert.strictEqual(form!.method, 'post');
    assert.strictEqual(form!.action, CLI.url);
    assert.deepEqual(Object.fromEntries(new FormData(form!)), {
      state: CLI.state,
      secure_session: 'cli-token',
      user_id: '@new-user:localhost',
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    assert.strictEqual(
      servers.requests('realm-server', 'POST _secure-session')[0]!.body.data
        .attributes.client,
      'cli',
    );
    assert.deepEqual(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!),
      held,
      "the browser's own session is left as it was",
    );
  });

  test('"Login with an existing account" goes to the sign-in page', async function (assert) {
    servers.realmServer('GET _secure-origin', () => ({
      data: { attributes: { matrixServerName: 'localhost' } },
    }));
    await render(
      <template><Register @signInURL='cli-sign-in?port=1' /></template>,
    );
    await click('[data-test-cancel-btn]');
    assert.deepEqual(assigned, ['cli-sign-in?port=1']);
  });

  test('the email validation link lands on a page that says so', async function (assert) {
    await render(<template><VerifyEmail /></template>);
    assert
      .dom('[data-test-secure-title]')
      .hasText('Your email has now been validated');
    assert
      .dom('[data-test-email-validated]')
      .hasText(
        'Return to the window where you are creating your Boxel account to finish. You can close this one.',
      );
  });
});
