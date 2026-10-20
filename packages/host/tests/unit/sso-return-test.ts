import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { CLI_AUTH_TIMEOUT_MS } from '@cardstack/runtime-common/cli-auth';

import { consumeLoginTokenFromUrl } from '@cardstack/host/utils/login-token';
import {
  SSO_RETURN_TTL_MS,
  forgetSsoReturn,
  rememberSsoReturn,
  takeSsoReturn,
} from '@cardstack/host/utils/sso-return';

// A Google sign-in that didn't finish leaves Synapse's SSO error page for the
// host's root with `ssoReturn`, and goes back to the page that started it.
module('Unit | sso-return', function (hooks) {
  setupWindowMock(hooks);

  // The mocked `window.location` doesn't follow the real History API, so the
  // URL a landing is rewritten to is read from a spy instead.
  let replacedWith: (string | URL | null | undefined)[];
  let originalReplaceState: History['replaceState'];

  hooks.beforeEach(function () {
    forgetSsoReturn();
    replacedWith = [];
    originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _data: unknown,
      _unused: string,
      url?: string | URL | null,
    ) => {
      replacedWith.push(url);
    };
  });

  hooks.afterEach(function () {
    (window.history as any).replaceState = originalReplaceState;
  });

  test('a cancelled sign-in returns to the page that started it', function (assert) {
    window.location.href = '/cli-auth?port=53412&state=abc123def456';
    rememberSsoReturn();
    let startedFrom = window.location.href;

    window.location.href = '/?ssoReturn=1&other=kept#hash';
    assert.strictEqual(takeSsoReturn(), startedFrom);
    assert.deepEqual(
      replacedWith,
      ['/?other=kept#hash'],
      'the param is stripped from the landing',
    );
    assert.strictEqual(takeSsoReturn(), undefined, 'the entry is used once');
  });

  test('only a landing from the SSO error page reads the entry', function (assert) {
    window.location.href = '/some/deep/link';
    rememberSsoReturn();

    window.location.href = '/';
    assert.strictEqual(takeSsoReturn(), undefined);

    window.location.href = '/?ssoReturn=1';
    assert.strictEqual(
      new URL(takeSsoReturn()!).pathname,
      '/some/deep/link',
      'a later landing from the error page still finds it',
    );
  });

  test('a landing with nothing to return to stays put', function (assert) {
    window.location.href = '/?ssoReturn=1';
    assert.strictEqual(takeSsoReturn(), undefined);
    assert.deepEqual(replacedWith, ['/'], 'the param is stripped anyway');
  });

  test('a sign-in started on the root page stays on it', function (assert) {
    window.location.href = '/';
    rememberSsoReturn();
    window.location.href = '/?ssoReturn=1';
    assert.strictEqual(takeSsoReturn(), undefined);
  });

  test('a sign-in started on the landing page with another fragment stays put', function (assert) {
    window.location.href = '/#somewhere';
    rememberSsoReturn();
    window.location.href = '/?ssoReturn=1';
    assert.strictEqual(takeSsoReturn(), undefined);
  });

  test('an entry lasts as long as the CLI waits for its sign-in', function (assert) {
    let realNow = Date.now;
    try {
      window.location.href = '/cli-auth?port=53412&state=abc123def456';
      rememberSsoReturn();
      let startedFrom = window.location.href;
      Date.now = () => realNow() + CLI_AUTH_TIMEOUT_MS - 1000;
      window.location.href = '/?ssoReturn=1';
      assert.strictEqual(takeSsoReturn(), startedFrom);
    } finally {
      Date.now = realNow;
    }
  });

  test('an entry for another origin is refused', function (assert) {
    window.location.href = '/?ssoReturn=1';
    rememberSsoReturn('https://elsewhere.example/cli-auth');
    assert.strictEqual(takeSsoReturn(), undefined);
  });

  test('an expired entry is refused', function (assert) {
    let realNow = Date.now;
    try {
      window.location.href = '/some/deep/link';
      rememberSsoReturn();
      Date.now = () => realNow() + SSO_RETURN_TTL_MS + 1000;
      window.location.href = '/?ssoReturn=1';
      assert.strictEqual(takeSsoReturn(), undefined);
    } finally {
      Date.now = realNow;
    }
  });

  test('a sign-in that reaches the host with a login token clears the entry', function (assert) {
    window.location.href = '/some/deep/link';
    rememberSsoReturn();
    window.location.href = '/some/deep/link?loginToken=abc123';
    assert.strictEqual(consumeLoginTokenFromUrl(), 'abc123');

    window.location.href = '/?ssoReturn=1';
    assert.strictEqual(takeSsoReturn(), undefined);
  });
});
