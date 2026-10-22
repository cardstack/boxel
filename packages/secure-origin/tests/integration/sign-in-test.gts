import {
  click,
  fillIn,
  find,
  findAll,
  render,
  settled,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation } from '../../src/shell/navigation.js';
import CliAuthPage from '../../src/shell/sign-in/cli-auth-page.gts';
import CliSignInPage from '../../src/shell/sign-in/cli-sign-in-page.gts';
import GoogleCallback from '../../src/shell/sign-in/google-callback.gts';
import SignInPage from '../../src/shell/sign-in/sign-in-page.gts';

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
  window.fetch = async (
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
  };
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
  let navigations: { how: 'assign' | 'replace'; url: string }[];
  let handoffs: HTMLFormElement[];
  let originalNavigation = { ...navigation };
  let originalSubmit = HTMLFormElement.prototype.submit;
  let originalURL: string;
  let meta: HTMLMetaElement;

  function serve(...routes: Record<string, Route>[]) {
    server = realmServer(Object.assign({}, ...routes));
    return server;
  }

  // The page's address, as the shell would be loaded at it.
  function visitShell(query: string, path = '/secure/') {
    history.replaceState(null, '', `${path}${query}`);
  }

  hooks.beforeEach(function () {
    originalURL = window.location.href;
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

  module('the sign-in form', function () {
    test('offers no Google sign-in when the realm server has no Google client', async function (assert) {
      serve(NO_GOOGLE);
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell(`?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-google]');
      await click('[data-test-secure-google]');
      await waitUntil(() => navigations.length > 0);
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      window.fetch = async () => {
        throw new TypeError('Failed to fetch');
      };
      try {
        visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
      visitShell('?mode=sign-in');
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
        '?mode=cli-sign-in',
        `?mode=cli-sign-in&state=${STATE}`,
        '?mode=cli-sign-in&port=51234',
        `?mode=cli-sign-in&port=99999&state=${STATE}`,
        '?mode=cli-sign-in&port=51234&state=short',
      ]) {
        visitShell(query);
        await render(CliSignInPage);
        assert
          .dom('[data-test-secure-title]')
          .hasText('This sign-in link is not complete', query);
        assert.dom('[data-test-secure-sign-in-form]').doesNotExist(query);
      }
    });

    test('fills in the username the CLI named, and starts on the password', async function (assert) {
      serve(NO_GOOGLE);
      visitShell(`?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      assert.dom('[data-test-secure-username]').hasValue('someone');
      assert.dom('[data-test-secure-password]').isFocused();
    });

    test('hands the session to the CLI’s listener, and keeps none of it', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN));
      visitShell(`?mode=cli-sign-in&port=51234&state=${STATE}`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await fillIn('[data-test-secure-username]', 'someone');
      await fillIn('[data-test-secure-password]', 'a-password');
      await click('[data-test-secure-password-submit]');
      await waitUntil(() => handoffs.length > 0);
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
      visitShell(`?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`);
      await render(CliSignInPage);
      await waitFor('[data-test-secure-sign-in-form]');
      await click('[data-test-secure-forgot-password]');
      await click('[data-test-secure-register]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/?mode=forgot-password&port=51234&state=${STATE}&user=someone`,
        },
        {
          how: 'assign',
          url: `/secure/?mode=register&port=51234&state=${STATE}&user=someone`,
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
        '?mode=cli-auth',
        `?mode=cli-auth&state=${STATE}`,
        '?mode=cli-auth&port=0&state=' + STATE,
        '?mode=cli-auth&port=51234&state=short',
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
      visitShell(`?mode=cli-auth&port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-google]');
      assert.dom('[data-test-secure-title]').hasText('Authorize Boxel CLI');
      assert
        .dom('[data-test-secure-cli-auth-subtitle]')
        .hasText(
          'Signing in gives the Boxel CLI running on this computer access to your workspaces.',
        );
      assert.dom('[data-test-secure-sign-in-subtitle]').doesNotExist();
      assert.dom('[data-test-secure-username]').isFocused();
      await click('[data-test-secure-forgot-password]');
      await click('[data-test-secure-register]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/?mode=forgot-password&port=51234&state=${STATE}&cli=profile&session=secure`,
        },
        {
          how: 'assign',
          url: `/secure/?mode=register&port=51234&state=${STATE}&cli=profile&session=secure`,
        },
      ]);
    });

    test('a window already signed in asks that account to confirm its password', async function (assert) {
      storeSession(SESSION);
      serve(NO_GOOGLE, { 'GET _secure-session': () => ({ status: 204 }) });
      visitShell(`?mode=cli-auth&port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await waitFor('[data-test-secure-cli-auth-signed-in-as]');
      assert
        .dom('[data-test-secure-cli-auth-signed-in-as]')
        .hasText(SESSION.user);
      assert.dom('[data-test-secure-username]').hasValue('someone');
      assert.dom('[data-test-secure-password]').isFocused();
    });

    test('hands the CLI a login token and the secure session together, and keeps none of it', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS);
      visitShell(`?mode=cli-auth&port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await signInAs('someone');
      await waitUntil(() => handoffs.length > 0);
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

    test('a CLI that takes no secure session gets the login token in the query of a navigation, and the session is ended', async function (assert) {
      let server = serve(NO_GOOGLE, signsIn(SIGNED_IN), MINTS, ENDS);
      visitShell(`?mode=cli-auth&port=51234&state=${STATE}`);
      await render(CliAuthPage);
      await signInAs('someone');
      await waitUntil(() => navigations.length > 0);
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
      serve(NO_GOOGLE, signsIn(SIGNED_IN), {
        'POST _secure-session/login-token': () =>
          refusal(503, 'unavailable', 'signing in is unavailable right now'),
      });
      visitShell(`?mode=cli-auth&port=51234&state=${STATE}&session=secure`);
      await render(CliAuthPage);
      await signInAs('someone');
      await waitFor('[data-test-secure-cli-handoff-failed]');
      assert.dom('[data-test-secure-title]').hasText('That didn’t work');
      assert
        .dom('[data-test-secure-error]')
        .hasText('Signing in is unavailable right now.');
      assert
        .dom('[data-test-secure-cli-handoff-failed]')
        .hasText('Run boxel profile add in your terminal again.');
      assert.deepEqual(handoffs, []);
      assert.deepEqual(navigations, []);
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
      await waitUntil(() => handoffs.length > 0);
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
      await waitUntil(() => navigations.length > 0);
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `/secure/?mode=cli-auth&port=51234&state=${STATE}&cli=profile`,
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
        '/secure/?mode=sign-in',
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
      await waitUntil(() => handoffs.length > 0);
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
          `/secure/?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`,
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
        .hasAttribute('href', '/secure/?mode=sign-in');
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
      await waitUntil(() => navigations.length > 0);
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `/secure/?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`,
        },
      ]);
    });

    test('says it is signing in while the exchange is under way', async function (assert) {
      pendingGoogleSignIn({ client: 'window' });
      let answer!: (value: Answer) => void;
      serve({
        'POST _secure-session/google': () =>
          new Promise<Answer>((resolve) => (answer = resolve)),
      });
      visitShell('?state=google-state&code=a-code', '/secure/google-callback');
      let rendered = render(GoogleCallback);
      await waitFor('[data-test-secure-signing-in]');
      assert
        .dom('[data-test-secure-signing-in]')
        .includesText('Signing you in…');
      await waitUntil(() => answer);
      answer(SIGNED_IN);
      await rendered;
      await waitFor('[data-test-secure-signed-in]');
      assert.dom('[data-test-secure-signing-in]').doesNotExist();
    });
  });
});
