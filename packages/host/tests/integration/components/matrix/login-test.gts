import { click, render } from '@ember/test-helpers';

import window from 'ember-window-mock';

import { module, test } from 'qunit';

import Login from '@cardstack/host/components/matrix/login';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { setupRenderingTest } from '../../../helpers/setup';

const GOOGLE_SSO_FLOW = {
  flows: [
    {
      type: 'm.login.sso',
      identity_providers: [
        { id: 'oidc-google', name: 'Google', brand: 'google' },
      ],
    },
    { type: 'm.login.password' },
    { type: 'm.login.token' },
  ],
};

const PASSWORD_ONLY_FLOW = { flows: [{ type: 'm.login.password' }] };

const OTHER_SSO_FLOW = {
  flows: [
    {
      type: 'm.login.sso',
      identity_providers: [
        { id: 'oidc-github', name: 'GitHub', brand: 'github' },
      ],
    },
  ],
};

const noop = () => {};

module('Integration | Component | matrix/login', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {});
  let { setLoginFlows, setSsoLoginUrl, setLoginWithTokenInterceptor } =
    mockMatrixUtils;

  function getEnvironmentService(testContext: any): EnvironmentService {
    return testContext.owner.lookup(
      'service:environment-service',
    ) as EnvironmentService;
  }

  function getMatrixService(testContext: any): MatrixService {
    return testContext.owner.lookup('service:matrix-service') as MatrixService;
  }

  hooks.beforeEach(function () {
    // Reset the mocked URL so leftover ?loginToken= from a previous test
    // doesn't bleed in. Goes through ember-window-mock's location setter;
    // history.replaceState would hit the real History API and leave the
    // mocked window.location.search unchanged.
    window.location.href = '/';
  });

  test('hides Google button when GOOGLE_AUTH_ENABLED flag is off', async function (assert) {
    getEnvironmentService(this).googleAuthEnabled = false;
    setLoginFlows(GOOGLE_SSO_FLOW);
    await render(<template><Login @setMode={{noop}} /></template>);
    assert.dom('[data-test-google-login-btn]').doesNotExist();
    assert.dom('[data-test-login-form]').exists();
  });

  test('hides Google button when server advertises only m.login.password', async function (assert) {
    getEnvironmentService(this).googleAuthEnabled = true;
    setLoginFlows(PASSWORD_ONLY_FLOW);
    await render(<template><Login @setMode={{noop}} /></template>);
    assert.dom('[data-test-google-login-btn]').doesNotExist();
  });

  test('hides Google button when m.login.sso is advertised but oidc-google IDP is missing', async function (assert) {
    getEnvironmentService(this).googleAuthEnabled = true;
    setLoginFlows(OTHER_SSO_FLOW);
    await render(<template><Login @setMode={{noop}} /></template>);
    assert.dom('[data-test-google-login-btn]').doesNotExist();
  });

  test('shows Google button when flag on AND oidc-google IDP advertised', async function (assert) {
    getEnvironmentService(this).googleAuthEnabled = true;
    setLoginFlows(GOOGLE_SSO_FLOW);
    await render(<template><Login @setMode={{noop}} /></template>);
    assert.dom('[data-test-google-login-btn]').exists();
  });

  test('clicking Sign in with Google navigates via getSsoLoginUrl', async function (assert) {
    let expectedUrl =
      'http://localhost:8008/_matrix/client/v3/login/sso/redirect/oidc-google?redirectUrl=test';
    getEnvironmentService(this).googleAuthEnabled = true;
    setLoginFlows(GOOGLE_SSO_FLOW);
    setSsoLoginUrl(expectedUrl);
    await render(<template><Login @setMode={{noop}} /></template>);
    await click('[data-test-google-login-btn]');
    assert.strictEqual(
      window.location.href,
      expectedUrl,
      'window.location was navigated to the SSO redirect URL',
    );
  });

  test('?loginToken= triggers loginWithToken, hides form, clears the query param', async function (assert) {
    window.location.href = '/?loginToken=abc123';

    let receivedToken: string | undefined;
    let startCalled = false;
    let replaceStateUrls: (string | null | undefined)[] = [];

    // Spy on history.replaceState. ember-window-mock's proxy lets us
    // override functions on `window.history` by assignment — subsequent
    // reads return the override instead of the wrapped real method. The
    // mocked window.location is not updated by the real History API, so a
    // spy is the only way to verify the URL-cleanup step.
    let originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _state: unknown,
      _title: string,
      url?: string | null,
    ) => {
      replaceStateUrls.push(url);
    };

    setLoginWithTokenInterceptor((token: string) => {
      receivedToken = token;
      return Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any);
    });

    let matrixService = getMatrixService(this);
    let originalStart = matrixService.start.bind(matrixService);
    // Stub start so the test doesn't try to talk to a realm. The component
    // stays mounted through the assertions, which is what lets us observe
    // the exchanging state.
    matrixService.start = (async () => {
      startCalled = true;
    }) as typeof matrixService.start;

    try {
      await render(<template><Login @setMode={{noop}} /></template>);

      assert
        .dom('[data-test-sso-exchanging]')
        .exists('Signing-in placeholder visible during SSO exchange');
      assert
        .dom('[data-test-login-form]')
        .doesNotExist('Password form hidden during SSO exchange');
      assert.strictEqual(
        receivedToken,
        'abc123',
        'loginWithToken received the URL token',
      );
      assert.true(startCalled, 'matrixService.start was invoked');
      let cleanupUrl = replaceStateUrls.at(-1);
      let cleanupHasLoginToken =
        cleanupUrl != null &&
        new URLSearchParams(new URL(cleanupUrl, 'http://x').search).has(
          'loginToken',
        );
      assert.notEqual(
        cleanupUrl,
        null,
        'history.replaceState was called to clean up the URL',
      );
      assert.false(
        cleanupHasLoginToken,
        'loginToken query param was cleared via history.replaceState',
      );
    } finally {
      matrixService.start = originalStart;
      (window.history as any).replaceState = originalReplaceState;
    }
  });

  test('?loginToken= exchange failure falls back to the password form with an error', async function (assert) {
    window.location.href = '/?loginToken=bad';

    setLoginWithTokenInterceptor(() =>
      Promise.reject(new Error('synapse said no')),
    );

    await render(<template><Login @setMode={{noop}} /></template>);

    assert
      .dom('[data-test-login-form]')
      .exists('Password form is restored after the failed SSO exchange');
    assert.dom('[data-test-login-error]').includesText('Google sign-in failed');
  });

  test('?loginToken= falls back to the password form when start() fails after a successful token exchange', async function (assert) {
    window.location.href = '/?loginToken=abc123';

    setLoginWithTokenInterceptor(() =>
      Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any),
    );

    let matrixService = getMatrixService(this);
    let originalStart = matrixService.start.bind(matrixService);
    // Token exchange succeeds but session start blows up — the component must
    // not get stranded on the "Signing you in…" placeholder.
    matrixService.start = (async () => {
      throw new Error('realm unreachable');
    }) as typeof matrixService.start;

    try {
      await render(<template><Login @setMode={{noop}} /></template>);

      assert
        .dom('[data-test-sso-exchanging]')
        .doesNotExist('Exchanging placeholder is cleared when start() fails');
      assert
        .dom('[data-test-login-form]')
        .exists('Password form is restored after the failed start()');
      assert
        .dom('[data-test-login-error]')
        .includesText('Google sign-in failed');
    } finally {
      matrixService.start = originalStart;
    }
  });
});
