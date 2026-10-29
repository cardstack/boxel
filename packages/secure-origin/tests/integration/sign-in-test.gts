import {
  click,
  fillIn,
  find,
  findAll,
  render,
  settled,
  triggerEvent,
  waitFor,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation } from '../../src/shell/navigation.js';
import CliAuthPage from '../../src/shell/sign-in/cli-auth-page.gts';
import CliSignInPage from '../../src/shell/sign-in/cli-sign-in-page.gts';
import GoogleCallback from '../../src/shell/sign-in/google-callback.gts';
import SignInPage from '../../src/shell/sign-in/sign-in-page.gts';
import SignOutPage from '../../src/shell/sign-in/sign-out-page.gts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';
import { waitedFetch } from '../helpers/waiters.ts';

// The realm server the pages talk to, named by the page's meta tag as the
// shell's document names it.
const REALM_SERVER = 'https://realm-server.test/';
const STATE = 'abcdefghijklmnop0123';
const SESSION = {
  token: 'secure-session-token',
  user: '@someone:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const GOOGLE = {
  authorizationEndpoint: 'https://accounts.google.test/o/oauth2/auth',
  clientId: 'google-client-id',
  redirectURI: 'https://secure.test/google-callback',
};

type Answer = { status: number; body?: unknown };
type Route = (request: {
  url: URL;
  method: string;
  body: any;
}) => Answer | Promise<Answer>;

function json(status: number, body: unknown): Answer {
  return { status, body };
}

function refusal(status: number, code: string, detail: string, meta?: object) {
  return json(status, { errors: [{ status, code, detail, meta }] });
}

// A realm server answering the requests the sign-in pages make. Every
// request is recorded; one with no route is refused with a 404, as a realm
// server without that endpoint would.
function realmServer(routes: Record<string, Route>) {
  let requests: { method: string; path: string; body: any }[] = [];
  let original = window.fetch;
  window.fetch = waitedFetch(
    async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1] = {},
    ) => {
      let url = new URL(String(input));
      let method = init.method ?? 'GET';
      let body = init.body ? JSON.parse(String(init.body)) : undefined;
      let path = url.pathname.replace(/^\//, '');
      requests.push({ method, path, body });
      let route = routes[`${method} ${path}`];
      let answer = route
        ? await route({ url, method, body })
        : refusal(404, 'not-found', 'Not found');
      return new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status,
        headers: { 'Content-Type': 'application/vnd.api+json' },
      });
    },
  );
  return {
    requests,
    restore() {
      window.fetch = original;
    },
  };
}

const NO_GOOGLE: Record<string, Route> = {};
const WITH_GOOGLE: Record<string, Route> = {
  'GET _secure-session/google': () =>
    json(200, { data: { attributes: GOOGLE } }),
};

function signsIn(answer: Answer): Record<string, Route> {
  return { 'POST _secure-session': () => answer };
}

const SIGNED_IN = json(201, { data: { attributes: SESSION } });

module('Integration | sign-in', function (hooks) {
  setupRenderingTest(hooks);

  let server: ReturnType<typeof realmServer> | undefined;
  // What the pages sent, still readable once the module's afterEach has let
  // the server go.
  let sent: ReturnType<typeof realmServer>['requests'] = [];
  let navigations: { how: 'assign' | 'replace'; url: string }[];
  let handoffs: HTMLFormElement[];
  let originalNavigation = { ...navigation };
  let originalSubmit = HTMLFormElement.prototype.submit;
  let originalURL: string;
  let meta: HTMLMetaElement;

  function serve(...routes: Record<string, Route>[]) {
    server = realmServer(Object.assign({}, ...routes));
    sent = server.requests;
    return server;
  }

  // The page's address, as the shell would be loaded at it.
  function visitShell(query: string, path = '/secure/') {
    history.replaceState(null, '', `${path}${query}`);
  }

  hooks.beforeEach(function () {
    originalURL = window.location.href;
    sent = [];
    navigations = [];
    handoffs = [];
    navigation.assign = (url: string) => {
      navigations.push({ how: 'assign', url });
    };
    navigation.replace = (url: string) => {
      navigations.push({ how: 'replace', url });
    };
    // A hand-off to the CLI is a form posted to its listener; recorded here
    // instead of leaving the test page.
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      handoffs.push(this);
    };
    meta = document.createElement('meta');
    meta.name = 'boxel-realm-server-url';
    meta.content = REALM_SERVER;
    document.head.append(meta);
    forgetSession();
    sessionStorage.clear();
  });

  hooks.afterEach(function () {
    server?.restore();
    server = undefined;
    Object.assign(navigation, originalNavigation);
    HTMLFormElement.prototype.submit = originalSubmit;
    for (let form of handoffs) {
      form.remove();
    }
    meta.remove();
    forgetSession();
    sessionStorage.clear();
    history.replaceState(null, '', originalURL);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    // What the page sent: bodies, not the method and path a label is made
    // from. A Google callback's code, verifier and state are among them.
    ...stringsIn(sent.map((r) => r.body)),
    'a-password',
    'not-the-password',
    'another-password',
    'someone@example.test',
    '"someone"',
    SESSION.token,
    STATE,
    'single-use-login-token',
  ]);

  module('the sign-in form', function () {
    test('offers no Google sign-in when the realm server has no Google client', async function (assert) {
      serve(NO_GOOGLE);
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await settled();
      assert
        .dom('[data-test-secure-sign-in-title]')
        .hasText('Sign in to your Boxel Account');
      assert.dom('[data-test-secure-google]').doesNotExist();
      assert.dom('[data-test-secure-sign-in-subtitle]').doesNotExist();
      assert.dom('[data-test-secure-divider-label]').doesNotExist();
      assert.dom('[data-test-secure-username]').exists();
      assert.dom('[data-test-secure-password]').exists();
    });

    test('offers Google sign-in when the realm server has a Google client', async function (assert) {
      serve(WITH_GOOGLE);
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-google]');
      assert.dom('[data-test-secure-google]').hasText('Continue with Google');
      assert
        .dom('[data-test-secure-sign-in-subtitle]')
        .hasText(
          "Use Google to get started in one tap - we'll create your Boxel account if you don't have one yet.",
        );
      assert
        .dom('[data-test-secure-divider-label]')
        .hasText('or use your email');
    });

    test('a Google sign-in sends the window to Google, remembering where it began', async function (assert) {
      serve(WITH_GOOGLE);
      visitShell(`cli-sign-in?port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-google]');
      await click('[data-test-secure-google]');
      assert.strictEqual(navigations.length, 1);
      let { how, url } = navigations[0];
      assert.strictEqual(how, 'assign');
      let google = new URL(url);
      assert.strictEqual(
        `${google.origin}${google.pathname}`,
        GOOGLE.authorizationEndpoint,
      );
      assert.strictEqual(google.searchParams.get('client_id'), GOOGLE.clientId);
      assert.strictEqual(
        google.searchParams.get('redirect_uri'),
        GOOGLE.redirectURI,
      );
      assert.strictEqual(
        google.searchParams.get('code_challenge_method'),
        'S256',
      );
      let pending = JSON.parse(
        Object.values({ ...sessionStorage })[0] as string,
      );
      assert.strictEqual(pending.state, google.searchParams.get('state'));
      assert.deepEqual(pending.resume, {
        client: 'cli',
        cli: { url: 'http://127.0.0.1:51234/callback', state: STATE },
        username: 'someone',
      });
    });

    test('Sign In waits for both fields', async function (assert) {
      serve(NO_GOOGLE);
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert.dom('[data-test-secure-password-submit]').isDisabled();
      await fillIn('[data-test-secure-username]', 'someone');
      assert.dom('[data-test-secure-password-submit]').isDisabled();
      await fillIn('[data-test-secure-password]', 'a-password');
      assert.dom('[data-test-secure-password-submit]').isEnabled();
      await fillIn('[data-test-secure-username]', '   ');
      assert
        .dom('[data-test-secure-password-submit]')
        .isDisabled('a username of spaces is no username');
    });

    test('focus starts on the username, and moves through the page in order', async function (assert) {
      serve(WITH_GOOGLE);
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-google]');
      assert.dom('[data-test-secure-username]').isFocused();
      let order = findAll(
        'button, input:not([type="hidden"]), a[href], [tabindex]',
      ).map((element) =>
        [
          'data-test-secure-google',
          'data-test-secure-username',
          'data-test-secure-password',
          'data-test-secure-forgot-password',
          'data-test-secure-password-submit',
          'data-test-secure-register',
        ].find((name) => element.hasAttribute(name)),
      );
      assert.deepEqual(order, [
        'data-test-secure-google',
        'data-test-secure-username',
        'data-test-secure-password',
        'data-test-secure-forgot-password',
        'data-test-secure-password-submit',
        'data-test-secure-register',
      ]);
      assert
        .dom('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')
        .doesNotExist('nothing reorders the tab sequence');
    });

    test('Enter in either field submits the form', async function (assert) {
      // The browser submits a form on Enter in one of its fields when the
      // form has a submit button; a synthetic key press doesn't, so this pins
      // what implicit submission needs, and that submitting signs in.
      serve(NO_GOOGLE, signsIn(SIGNED_IN));
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      let form = find('[data-test-secure-sign-in-form]') as HTMLFormElement;
      let submit = find(
        '[data-test-secure-password-submit]',
      ) as HTMLButtonElement;
      assert.strictEqual(submit.type, 'submit');
      assert.strictEqual(submit.form, form);
      for (let field of ['username', 'password']) {
        let input = find(`[data-test-secure-${field}]`) as HTMLInputElement;
        assert.strictEqual(input.form, form, `${field} is in the form`);
      }
      assert.deepEqual(
        findAll('[data-test-secure-sign-in-form] button')
          .filter((button) => (button as HTMLButtonElement).type === 'submit')
          .map((button) =>
            button.hasAttribute('data-test-secure-password-submit'),
          ),
        [true],
        'Sign In is the only submit button',
      );
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await triggerEvent(form, 'submit');
      await waitFor('[data-test-secure-signed-in]');
      assert.dom('[data-test-secure-signed-in]').exists();
    });

    test('signs the window in with the password, and keeps its session', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN));
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      await waitFor('[data-test-secure-signed-in]');
      assert
        .dom('[data-test-secure-title]')
        .hasText('You’re signed in to Boxel');
      assert
        .dom('[data-test-secure-signed-in]')
        .hasText('You can close this window.');
      let signIn = server.requests.find(
        (r) => r.method === 'POST' && r.path === '_secure-session',
      );
      assert.deepEqual(signIn?.body.data.attributes, {
        username: 'someone',
        password: 'a-password',
        client: 'window',
      });
      assert.deepEqual(
        JSON.parse(localStorage.getItem('boxel-secure-session') ?? 'null'),
        SESSION,
      );
    });

    test('signs in with an email address as the username', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN));
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert
        .dom('[data-test-secure-username]')
        .hasAttribute('placeholder', 'Your email address');
      await fillIn('[data-test-secure-username]', 'someone@example.test');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      await waitFor('[data-test-secure-signed-in]');
      let signIn = server.requests.find(
        (r) => r.method === 'POST' && r.path === '_secure-session',
      );
      assert.strictEqual(
        signIn?.body.data.attributes.username,
        'someone@example.test',
      );
    });

    test('a refused password reads as the app reads it, and typing clears it', async function (assert) {
      serve(
        NO_GOOGLE,
        signsIn(refusal(401, 'invalid-credentials', 'Invalid credentials')),
      );
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'not-the-password');
      await click('[data-test-secure-password-submit]');
      await waitFor('[data-test-secure-error]');
      assert
        .dom('[data-test-secure-error]')
        .hasText(
          'Sign-in failed. Please check your credentials and try again.',
        );
      assert
        .dom('[data-test-secure-password-submit]')
        .isEnabled('it can be tried again');
      await fillIn('[data-test-secure-password]', 'another-password');
      assert.dom('[data-test-secure-error]').doesNotExist();
    });

    test('too many failed attempts says how long to wait', async function (assert) {
      serve(
        NO_GOOGLE,
        signsIn(
          refusal(429, 'rate-limited', 'Too many attempts', {
            retryAfterMs: 191117,
          }),
        ),
      );
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      await waitFor('[data-test-secure-error]');
      assert
        .dom('[data-test-secure-error]')
        .hasText(
          'Sign-in failed. Too many failed attempts, try again in 4 minutes.',
        );
    });

    test('a server it cannot reach is said so', async function (assert) {
      serve(NO_GOOGLE);
      let original = window.fetch;
      window.fetch = waitedFetch(async () => {
        throw new TypeError('Failed to fetch');
      });
      try {
        visitShell('sign-in');
        await render(SignInPage);
        await waitFor('[data-test-secure-sign-in-form]');
        await fillIn('[data-test-secure-username]', 'someone');
        await fillIn('[data-test-secure-password]', 'a-password');
        await click('[data-test-secure-password-submit]');
        await waitFor('[data-test-secure-error]');
        assert
          .dom('[data-test-secure-error]')
          .hasText('Sign-in failed. Boxel could not be reached.');
      } finally {
        window.fetch = original;
      }
    });

    test('a window already signed in says so', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-signed-in]');
      assert.dom('[data-test-secure-sign-in-form]').doesNotExist();
    });

    test('a session the server has ended shows the sign-in, with no error', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, {
        'GET _secure-session': () =>
          refusal(401, 'signed-out', 'Session ended'),
      });
      visitShell('sign-in');
      await render(SignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert.dom('[data-test-secure-error]').doesNotExist();
      assert.strictEqual(localStorage.getItem('boxel-secure-session'), null);
    });
  });

  module('the CLI sign-in', function () {
    test('without a usable port and state it signs nothing in', async function (assert) {
      serve(NO_GOOGLE);
      for (let query of [
        'cli-sign-in',
        `cli-sign-in?state=${STATE}`,
        'cli-sign-in?port=51234',
        `cli-sign-in?port=99999&state=${STATE}`,
        'cli-sign-in?port=51234&state=short',
      ]) {
        visitShell(query);
        await render(CliSignInPage);
        assert
          .dom('[data-test-secure-title]')
          .hasText('This sign-in link is not complete', query);
        assert.dom('[data-test-secure-sign-in-form]').doesNotExist(query);
      }
    });

    test('names the CLI and what signing in lets it do, in place of the Google subtitle', async function (assert) {
      serve(WITH_GOOGLE);
      visitShell(`cli-sign-in?port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-google]');
      assert.dom('[data-test-secure-title]').hasText('Authorize Boxel CLI');
      assert
        .dom('[data-test-secure-cli-sign-in-subtitle]')
        .hasText(
          'Signing in lets the Boxel CLI running on this computer manage your keys.',
        );
      assert.dom('[data-test-secure-sign-in-subtitle]').doesNotExist();
    });

    test('fills in the username the CLI named, and starts on the password', async function (assert) {
      serve(NO_GOOGLE);
      visitShell(`cli-sign-in?port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert.dom('[data-test-secure-username]').hasValue('someone');
      assert.dom('[data-test-secure-password]').isFocused();
    });

    test('hands the session to the CLI’s listener, and keeps none of it', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN));
      visitShell(`cli-sign-in?port=51234&state=${STATE}`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      assert.strictEqual(handoffs.length, 1, 'posted once');
      let [form] = handoffs;
      assert.strictEqual(form.method, 'post');
      assert.strictEqual(form.action, 'http://127.0.0.1:51234/callback');
      assert.deepEqual(
        [...new FormData(form)].map(([name, value]) => [name, value]),
        [
          ['state', STATE],
          ['secure_session', SESSION.token],
          ['user_id', SESSION.user],
          ['expires_at', SESSION.expiresAt],
        ],
      );
      assert
        .dom('[data-test-secure-title]')
        .hasText('Returning to your terminal…');
      let signIn = server.requests.find(
        (r) => r.method === 'POST' && r.path === '_secure-session',
      );
      assert.strictEqual(signIn?.body.data.attributes.client, 'cli');
      assert.strictEqual(
        localStorage.getItem('boxel-secure-session'),
        null,
        'the window keeps no session of its own',
      );
    });

    test('its links carry the CLI’s port, state and username along', async function (assert) {
      serve(NO_GOOGLE);
      visitShell(`cli-sign-in?port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await click('[data-test-secure-forgot-password]');
      await click('[data-test-secure-register]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/forgot-password?port=51234&state=${STATE}&user=someone`,
        },
        {
          how: 'assign',
          url: `/secure/register?port=51234&state=${STATE}&user=someone`,
        },
      ]);
    });
  });

  module('the CLI profile sign-in', function () {
    const LOGIN_TOKEN = 'single-use-login-token';
    const MINTS: Record<string, Route> = {
      'POST _secure-session/login-token': () =>
        json(201, {
          data: {
            type: 'login-token',
            attributes: { loginToken: LOGIN_TOKEN, expiresInMs: 120000 },
          },
        }),
    };
    const ENDS: Record<string, Route> = {
      'DELETE _secure-session': () => ({ status: 204 }),
    };

    async function signInAs(username: string) {
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', username);
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
    }

    test('without a usable port and state it says it can’t authorize, as the app does', async function (assert) {
      serve(NO_GOOGLE);
      for (let query of [
        'cli-auth',
        `cli-auth?state=${STATE}`,
        'cli-auth?port=0&state=' + STATE,
        'cli-auth?port=51234&state=short',
      ]) {
        visitShell(query);
        await render(CliAuthPage);
        assert
          .dom('[data-test-secure-title]')
          .hasText("Can't authorize", query);
        assert
          .dom('[data-test-secure-info]')
          .hasText(
            'This page needs the `port` and `state` values that the Boxel CLI puts in its URL. Start it with `boxel profile add`.',
          );
        assert.dom('[data-test-secure-sign-in-form]').doesNotExist(query);
      }
    });

    test('asks the user to authorize the CLI, with every way to sign in', async function (assert) {
      serve(WITH_GOOGLE);
      visitShell(`cli-auth?port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-google]');
      assert.dom('[data-test-secure-title]').hasText('Authorize Boxel CLI');
      assert
        .dom('[data-test-secure-cli-auth-subtitle]')
        .hasText(
          'Signing in gives the Boxel CLI running on this computer access to your workspaces, and lets it manage your keys.',
        );
      assert.dom('[data-test-secure-sign-in-subtitle]').doesNotExist();
      assert.dom('[data-test-secure-username]').isFocused();
      await click('[data-test-secure-forgot-password]');
      await click('[data-test-secure-register]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/forgot-password?port=51234&state=${STATE}&cli=profile&session=secure`,
        },
        {
          how: 'assign',
          url: `/secure/register?port=51234&state=${STATE}&cli=profile&session=secure`,
        },
      ]);
    });

    test('a window already signed in asks that account to confirm its password', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, { 'GET _secure-session': () => ({ status: 204 }) });
      visitShell(`cli-auth?port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-cli-auth-signed-in-as]');
      assert
        .dom('[data-test-secure-cli-auth-signed-in-as]')
        .hasText(SESSION.user);
      assert
        .dom('[data-test-secure-cli-auth-confirm]')
        .hasText(
          `Confirm your password to give the Boxel CLI running on this computer access to the workspaces of ${SESSION.user}, and to let it manage their keys.`,
        );
      assert.dom('[data-test-secure-username]').hasValue('someone');
      assert.dom('[data-test-secure-password]').isFocused();
    });

    test('hands the CLI a login token and the secure session together, and keeps none of it', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS);
      visitShell(`cli-auth?port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await signInAs('someone');
      let [form] = handoffs;
      assert.strictEqual(form.method, 'post');
      assert.strictEqual(form.action, 'http://127.0.0.1:51234/callback');
      assert.deepEqual(
        [...new FormData(form)].map(([name, value]) => [name, value]),
        [
          ['state', STATE],
          ['login_token', LOGIN_TOKEN],
          ['secure_session', SESSION.token],
          ['user_id', SESSION.user],
          ['expires_at', SESSION.expiresAt],
        ],
      );
      assert.deepEqual(navigations, []);
      let signIn = server.requests.find(
        (r) => r.method === 'POST' && r.path === '_secure-session',
      );
      assert.strictEqual(signIn?.body.data.attributes.client, 'cli');
      assert.ok(
        server.requests.some(
          (r) =>
            r.method === 'POST' && r.path === '_secure-session/login-token',
        ),
        'the login token is minted with the session just signed in',
      );
      assert.notOk(
        server.requests.some((r) => r.method === 'DELETE'),
        'the session it hands over is not ended',
      );
      assert.strictEqual(localStorage.getItem('boxel-secure-session'), null);
    });

    test('a CLI that takes no secure session is told it gets access to the workspaces alone', async function (assert) {
      serve(NO_GOOGLE);
      visitShell(`cli-auth?port=51234&state=${STATE}`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert.dom('[data-test-secure-title]').hasText('Authorize Boxel CLI');
      assert
        .dom('[data-test-secure-cli-auth-subtitle]')
        .hasText(
          'Signing in gives the Boxel CLI running on this computer access to your workspaces.',
        );
    });

    test('a window already signed in, for a CLI that takes no secure session, asks only for access to the workspaces', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, { 'GET _secure-session': () => ({ status: 204 }) });
      visitShell(`cli-auth?port=51234&state=${STATE}`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-cli-auth-confirm]');
      assert
        .dom('[data-test-secure-cli-auth-confirm]')
        .hasText(
          `Confirm your password to give the Boxel CLI running on this computer access to the workspaces of ${SESSION.user}.`,
        );
    });

    test('a CLI that takes no secure session gets the login token in the query of a navigation, and the session is ended', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS, ENDS);
      visitShell(`cli-auth?port=51234&state=${STATE}`);
      await render(CliAuthPage);
      await signInAs('someone');
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `http://127.0.0.1:51234/callback?state=${STATE}&loginToken=${LOGIN_TOKEN}`,
        },
      ]);
      assert.deepEqual(handoffs, [], 'nothing is posted');
      let ended = server.requests.find((r) => r.method === 'DELETE');
      assert.strictEqual(ended?.path, '_secure-session');
    });

    test('a login token that can’t be minted says so, and how to start again', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), ENDS, {
        'POST _secure-session/login-token': () =>
          refusal(503, 'unavailable', 'signing in is unavailable right now'),
      });
      visitShell(`cli-auth?port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await signInAs('someone');
      await waitFor('[data-test-secure-cli-handoff-failed]');
      assert.dom('h1[data-test-secure-title]').hasText('That didn’t work');
      assert
        .dom('[data-test-secure-error]')
        .hasText('Signing in is unavailable right now.');
      assert
        .dom('[data-test-secure-cli-handoff-failed]')
        .hasText('Run boxel profile add in your terminal again.');
      assert.deepEqual(handoffs, []);
      assert.deepEqual(navigations, []);
      assert.strictEqual(
        server.requests.find((r) => r.method === 'DELETE')?.path,
        '_secure-session',
        'the session nobody will hold is ended',
      );
    });

    test('a Google sign-in for it hands the CLI a login token too', async function (assert) {
      sessionStorage.setItem(
        'boxel-secure-google-sign-in',
        JSON.stringify({
          state: 'google-state',
          nonce: 'nonce',
          codeVerifier: 'verifier',
          resume: {
            client: 'cli',
            cli: {
              url: 'http://127.0.0.1:51234/callback',
              state: STATE,
              profile: { secureSession: true },
            },
          },
        }),
      );
      serve(MINTS, {
        'POST _secure-session/google': () => SIGNED_IN,
      });
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      assert.deepEqual(
        [...new FormData(handoffs[0])].map(([name]) => name),
        ['state', 'login_token', 'secure_session', 'user_id', 'expires_at'],
      );
    });

    test('cancelling at Google returns to the profile sign-in', async function (assert) {
      sessionStorage.setItem(
        'boxel-secure-google-sign-in',
        JSON.stringify({
          state: 'google-state',
          nonce: 'nonce',
          codeVerifier: 'verifier',
          resume: {
            client: 'cli',
            cli: {
              url: 'http://127.0.0.1:51234/callback',
              state: STATE,
              profile: { secureSession: false },
            },
          },
        }),
      );
      serve(NO_GOOGLE);
      visitShell(
        '?state=google-state&error=access_denied',
        '/secure/google-callback',
      );
      await render(GoogleCallback);
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `/secure/cli-auth?port=51234&state=${STATE}&cli=profile`,
        },
      ]);
    });
  });

  module("Google's callback", function () {
    // What the window kept when it sent the user to Google.
    function pendingGoogleSignIn(resume: object) {
      sessionStorage.setItem(
        'boxel-secure-google-sign-in',
        JSON.stringify({
          state: 'google-state',
          nonce: 'nonce',
          codeVerifier: 'verifier',
          resume,
        }),
      );
    }

    const CLI_RESUME = {
      client: 'cli',
      cli: { url: 'http://127.0.0.1:51234/callback', state: STATE },
      username: 'someone',
    };

    function exchanges(answer: Answer): Record<string, Route> {
      return { 'POST _secure-session/google': () => answer };
    }

    test("signs the window in, and returns to the window's own address", async function (assert) {
      pendingGoogleSignIn({ client: 'window' });
      serve(exchanges(SIGNED_IN));
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      await waitFor('[data-test-secure-signed-in]');
      assert.strictEqual(
        `${window.location.pathname}${window.location.search}`,
        '/secure/sign-in',
      );
      assert.deepEqual(
        JSON.parse(localStorage.getItem('boxel-secure-session') ?? 'null'),
        SESSION,
      );
    });

    test('hands a CLI sign-in to the CLI’s listener', async function (assert) {
      pendingGoogleSignIn(CLI_RESUME);
      serve(exchanges(SIGNED_IN));
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      assert.strictEqual(handoffs[0].action, 'http://127.0.0.1:51234/callback');
      assert.strictEqual(localStorage.getItem('boxel-secure-session'), null);
    });

    test('a CLI sign-in whose kept listener is not on this machine goes nowhere', async function (assert) {
      pendingGoogleSignIn({
        client: 'cli',
        cli: { url: 'https://evil.example/callback', state: STATE },
      });
      serve(exchanges(SIGNED_IN));
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      await waitFor('[data-test-secure-title]');
      assert.strictEqual(handoffs.length, 0, 'nothing is posted');
      assert.strictEqual(
        localStorage.getItem('boxel-secure-session'),
        null,
        'nor kept as the window’s own session',
      );
      assert
        .dom('[data-test-secure-title]')
        .hasText('This sign-in link is not complete');
      assert
        .dom('[data-test-secure-start-again]')
        .doesNotExist('starting again here would sign in the window instead');
    });

    test('a failed exchange says so, and starts again where the sign-in began', async function (assert) {
      pendingGoogleSignIn(CLI_RESUME);
      serve(
        exchanges(
          refusal(
            403,
            'no-boxel-account',
            'no Boxel account uses this Google account',
          ),
        ),
      );
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      await waitFor('[data-test-secure-error]');
      assert.dom('[data-test-secure-title]').hasText('That didn’t work');
      assert
        .dom('[data-test-secure-error]')
        .hasText('No Boxel account uses this Google account.');
      assert
        .dom('[data-test-secure-start-again]')
        .hasAttribute(
          'href',
          `/secure/cli-sign-in?port=51234&state=${STATE}&user=someone`,
        );
    });

    test('a spent sign-in is explained, not blamed on the credentials', async function (assert) {
      pendingGoogleSignIn({ client: 'window' });
      serve(
        exchanges(
          refusal(
            409,
            'used',
            'this sign-in has already been used; start again',
          ),
        ),
      );
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      await waitFor('[data-test-secure-error]');
      assert
        .dom('[data-test-secure-error]')
        .hasText('This sign-in has already been used; start again.');
      assert.dom('[data-test-secure-error]').doesNotIncludeText('credentials');
      assert
        .dom('[data-test-secure-start-again]')
        .hasAttribute('href', '/secure/sign-in');
    });

    test('a callback this window never started is refused', async function (assert) {
      let server = serve(exchanges(SIGNED_IN));
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      await waitFor('[data-test-secure-error]');
      assert
        .dom('[data-test-secure-error]')
        .hasText('This sign-in wasn’t started here. Start again.');
      assert.deepEqual(server.requests, [], 'the code is never sent');
    });

    test('cancelling at Google returns to where the sign-in began', async function (assert) {
      pendingGoogleSignIn(CLI_RESUME);
      serve(exchanges(SIGNED_IN));
      visitShell(
        '?state=google-state&error=access_denied',
        '/secure/google-callback',
      );
      await render(GoogleCallback);
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `/secure/cli-sign-in?port=51234&state=${STATE}&user=someone`,
        },
      ]);
    });

    test('says it is signing in while the exchange is under way', async function (assert) {
      pendingGoogleSignIn({ client: 'window' });
      let answer!: (value: Answer) => void;
      let requested = new Promise<void>((asked) => {
        serve({
          'POST _secure-session/google': () => {
            asked();
            return new Promise<Answer>((resolve) => (answer = resolve));
          },
        });
      });
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      let rendered = render(GoogleCallback);
      await waitFor('[data-test-secure-signing-in]');
      assert
        .dom('[data-test-secure-signing-in]')
        .includesText('Signing you in…');
      await requested;
      answer(SIGNED_IN);
      await rendered;
      await waitFor('[data-test-secure-signed-in]');
      assert.dom('[data-test-secure-signing-in]').doesNotExist();
    });
  });

  module('handing a sign-in over to the app', function (hooks) {
    const APP = 'https://app.test';
    const RETURN = `${APP}/some/path?operatorModeState=%7B%7D`;
    let originsMeta: HTMLMetaElement;

    hooks.beforeEach(function () {
      originsMeta = document.createElement('meta');
      originsMeta.name = 'boxel-app-origins';
      originsMeta.content = `${APP} http://localhost:* https://localhost:* https://*.preview.test`;
      document.head.append(originsMeta);
    });

    hooks.afterEach(function () {
      originsMeta.remove();
    });

    function returnFragment(target: string) {
      return `#return=${encodeURIComponent(target)}`;
    }

    const MINTS = {
      'POST _secure-session/login-token': () =>
        json(201, {
          data: {
            type: 'login-token',
            attributes: { loginToken: 'a-login-token', expiresInMs: 120000 },
          },
        }),
    };

    async function signInWithPassword() {
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
    }

    test('a sign-in the app started goes back to its page with a login token', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS);
      visitShell(`sign-in${returnFragment(RETURN)}`);
      await render(SignInPage);
      assert.strictEqual(
        window.location.hash,
        '',
        'the page to go back to is taken out of the address',
      );
      await signInWithPassword();
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `${APP}/some/path?operatorModeState=%7B%7D#loginToken=a-login-token`,
        },
      ]);
      let mint = server.requests.find(
        (r) => r.path === '_secure-session/login-token',
      );
      assert.strictEqual(mint?.method, 'POST');
      assert.strictEqual(
        sessionStorage.getItem('boxel-secure-return'),
        null,
        'the page to go back to is forgotten once handed over',
      );
      assert.deepEqual(
        JSON.parse(localStorage.getItem('boxel-secure-session') ?? 'null'),
        SESSION,
        'the secure session stays here',
      );
    });

    test('a window session hands over the device the app signs in as, beside the token', async function (assert) {
      serve(NO_GOOGLE, signsIn(SIGNED_IN), {
        'POST _secure-session/login-token': () =>
          json(201, {
            data: {
              type: 'login-token',
              attributes: {
                loginToken: 'a-login-token',
                expiresInMs: 120000,
                deviceId: 'WINDOWBOUND',
              },
            },
          }),
      });
      visitShell(`sign-in${returnFragment(`${APP}/`)}`);
      await render(SignInPage);
      await signInWithPassword();
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `${APP}/#loginToken=a-login-token&deviceId=WINDOWBOUND`,
        },
      ]);
    });

    test('a window already signed in hands over at once, with no form', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, MINTS, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell(`sign-in${returnFragment(`${APP}/`)}`);
      await render(SignInPage);
      assert.deepEqual(navigations, [
        { how: 'replace', url: `${APP}/#loginToken=a-login-token` },
      ]);
      assert.dom('[data-test-secure-sign-in-form]').doesNotExist();
    });

    test('a page on a subdomain the realm server lists is handed over to', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, MINTS, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell(`sign-in${returnFragment('https://branch.preview.test/')}`);
      await render(SignInPage);
      assert.strictEqual(
        navigations[0].url,
        'https://branch.preview.test/#loginToken=a-login-token',
      );
    });

    test('a page on an origin the realm server does not list is not handed a sign-in', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS);
      visitShell(`sign-in${returnFragment('https://elsewhere.test/collect')}`);
      await render(SignInPage);
      await signInWithPassword();
      await waitFor('[data-test-secure-signed-in]');
      await settled();
      assert.deepEqual(navigations, []);
      assert.false(
        server.requests.some((r) => r.path === '_secure-session/login-token'),
        'no login token is minted',
      );
    });

    test('a hand-off to a program on this computer waits for the user to confirm it', async function (assert) {
      storeSession(SESSION);
      let server = serve(NO_GOOGLE, MINTS, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell(`sign-in${returnFragment('http://localhost:4200/')}`);
      await render(SignInPage);
      await waitFor('[data-test-secure-loopback-confirm]');
      assert
        .dom('[data-test-secure-title]')
        .hasText('Continue to http://localhost:4200?');
      assert
        .dom('[data-test-secure-loopback-confirm]')
        .hasText(
          'A program on this computer at http://localhost:4200 wants to sign in to Boxel as you. Continue only if you started this sign-in from that program.',
        );
      assert.false(
        server.requests.some((r) => r.path === '_secure-session/login-token'),
        'nothing is minted until the user confirms',
      );
      await click('[data-test-secure-loopback-continue]');
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: 'http://localhost:4200/#loginToken=a-login-token',
        },
      ]);
    });

    test('a hand-off to a program on this computer asks first over https too', async function (assert) {
      storeSession(SESSION);
      let server = serve(NO_GOOGLE, MINTS, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell(`sign-in${returnFragment('https://localhost:4200/')}`);
      await render(SignInPage);
      await waitFor('[data-test-secure-loopback-confirm]');
      assert
        .dom('[data-test-secure-title]')
        .hasText('Continue to https://localhost:4200?');
      assert.false(
        server.requests.some((r) => r.path === '_secure-session/login-token'),
      );
    });

    test('a session ended while handing over goes back to sign in, keeping the page to go back to', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, {
        'GET _secure-session': () => json(200, { data: {} }),
        'POST _secure-session/login-token': () =>
          refusal(401, 'signed-out', 'this session is signed out'),
      });
      visitShell(`sign-in${returnFragment(`${APP}/`)}`);
      await render(SignInPage);
      assert.deepEqual(navigations, [
        { how: 'replace', url: '/secure/sign-in' },
      ]);
      assert.strictEqual(
        localStorage.getItem('boxel-secure-session'),
        null,
        'the ended session is forgotten',
      );
      assert.strictEqual(
        sessionStorage.getItem('boxel-secure-return'),
        `${APP}/`,
        'the hand-off still waits for the next sign-in',
      );
    });

    test('declining a hand-off to a program on this computer hands nothing over', async function (assert) {
      storeSession(SESSION);
      let server = serve(NO_GOOGLE, MINTS, {
        'GET _secure-session': () => json(200, { data: {} }),
      });
      visitShell(`sign-in${returnFragment('http://localhost:4200/')}`);
      await render(SignInPage);
      await waitFor('[data-test-secure-loopback-cancel]');
      await click('[data-test-secure-loopback-cancel]');
      await waitFor('[data-test-secure-signed-in]');
      assert.deepEqual(navigations, []);
      assert.false(
        server.requests.some((r) => r.path === '_secure-session/login-token'),
      );
      assert.strictEqual(sessionStorage.getItem('boxel-secure-return'), null);
    });

    test('the page to go back to survives the round trip to Google', async function (assert) {
      sessionStorage.setItem('boxel-secure-return', RETURN);
      sessionStorage.setItem(
        'boxel-secure-google-sign-in',
        JSON.stringify({
          state: 'google-state',
          nonce: 'a-nonce',
          codeVerifier: 'a-verifier',
          resume: { client: 'window' },
        }),
      );
      serve(MINTS, { 'POST _secure-session/google': () => SIGNED_IN });
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      await render(GoogleCallback);
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `${APP}/some/path?operatorModeState=%7B%7D#loginToken=a-login-token`,
        },
      ]);
    });

    test('a hand-off moments after another waits for the Matrix server to mint the next token', async function (assert) {
      storeSession(SESSION);
      let attempts = 0;
      let retried!: () => void;
      let retry = new Promise<void>((resolve) => (retried = resolve));
      serve(NO_GOOGLE, {
        'GET _secure-session': () => json(200, { data: {} }),
        'POST _secure-session/login-token': () => {
          if (++attempts === 1) {
            return refusal(429, 'rate-limited', 'try again shortly', {
              retryAfterMs: 20,
            });
          }
          retried();
          return MINTS['POST _secure-session/login-token']();
        },
      });
      visitShell(`sign-in${returnFragment(`${APP}/`)}`);
      await render(SignInPage);
      // The page waits out the server's Retry-After with a timer `settled()`
      // can't see, so the test waits for the retry itself.
      await retry;
      await settled();
      assert.strictEqual(attempts, 2);
      assert.strictEqual(
        navigations[0].url,
        `${APP}/#loginToken=a-login-token`,
      );
    });

    test('a hand-off that fails says so, and can be tried again', async function (assert) {
      storeSession(SESSION);
      let attempts = 0;
      serve(NO_GOOGLE, {
        'GET _secure-session': () => json(200, { data: {} }),
        'POST _secure-session/login-token': () =>
          ++attempts === 1
            ? refusal(503, 'unavailable', 'signing in is unavailable')
            : MINTS['POST _secure-session/login-token'](),
      });
      visitShell(`sign-in${returnFragment(`${APP}/`)}`);
      await render(SignInPage);
      await waitFor('[data-test-secure-handoff-retry]');
      assert
        .dom('[data-test-secure-error]')
        .hasText('Signing in is unavailable.');
      await click('[data-test-secure-handoff-retry]');
      assert.strictEqual(
        navigations[0].url,
        `${APP}/#loginToken=a-login-token`,
      );
    });

    test('signing out ends the window session and goes back to the app', async function (assert) {
      storeSession(SESSION);
      sessionStorage.setItem('boxel-secure-return', RETURN);
      let server = serve({
        'DELETE _secure-session': () => ({ status: 200, body: {} }),
      });
      visitShell(`sign-out${returnFragment(`${APP}/`)}`);
      await render(SignOutPage);
      assert.deepEqual(navigations, [{ how: 'replace', url: `${APP}/` }]);
      assert.true(
        server.requests.some(
          (r) => r.method === 'DELETE' && r.path === '_secure-session',
        ),
        'the session is ended on the server',
      );
      assert.strictEqual(localStorage.getItem('boxel-secure-session'), null);
      assert.strictEqual(sessionStorage.getItem('boxel-secure-return'), null);
    });

    test('signing out ends a window session past its stored end too', async function (assert) {
      storeSession({ ...SESSION, expiresAt: '2000-01-01T00:00:00.000Z' });
      let server = serve({
        'DELETE _secure-session': () => ({ status: 200, body: {} }),
      });
      visitShell(`sign-out${returnFragment(`${APP}/`)}`);
      await render(SignOutPage);
      assert.true(
        server.requests.some(
          (r) => r.method === 'DELETE' && r.path === '_secure-session',
        ),
        'a session bound to the app’s can outlive its stored end, so it is ended on the server',
      );
      assert.strictEqual(localStorage.getItem('boxel-secure-session'), null);
    });

    test('signing out never goes to an origin the realm server does not list', async function (assert) {
      serve({});
      visitShell(`sign-out${returnFragment('https://elsewhere.test/')}`);
      await render(SignOutPage);
      assert.deepEqual(navigations, [
        { how: 'replace', url: '/secure/sign-in' },
      ]);
    });
  });
});
