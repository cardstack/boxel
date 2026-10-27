import { render, waitFor, waitUntil } from '@ember/test-helpers';

import window from 'ember-window-mock';

import { module, test } from 'qunit';

import SecureSignIn from '@cardstack/host/components/matrix/secure-sign-in';
import ENV from '@cardstack/host/config/environment';
import {
  framing,
  noteRedirect,
  REDIRECT_GUARD_MS,
} from '@cardstack/host/lib/secure-sign-in';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { setupRenderingTest } from '../../../helpers/setup';

const APP_PAGE = '/some/path?operatorModeState=%7B%7D';

function secureURL(page: string) {
  let url = new URL(ENV.secureOriginURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${page}`;
  return url;
}

function signInURLFor(appPage: string) {
  let url = secureURL('sign-in');
  url.hash = new URLSearchParams({
    return: new URL(appPage, window.location.origin).href,
  }).toString();
  return url.href;
}

module('Integration | Component | matrix/secure-sign-in', function (hooks) {
  setupRenderingTest(hooks);

  let { setLoginWithTokenInterceptor } = setupMockMatrix(hooks, {});
  let originalFlag: boolean;

  hooks.beforeEach(function () {
    originalFlag = ENV.signInOnSecureOrigin;
    ENV.signInOnSecureOrigin = true;
    window.sessionStorage.clear();
    window.location.href = APP_PAGE;
  });

  hooks.afterEach(function () {
    ENV.signInOnSecureOrigin = originalFlag;
    window.sessionStorage.clear();
  });

  function matrixService(testContext: any): MatrixService {
    return testContext.owner.lookup('service:matrix-service') as MatrixService;
  }

  test('a signed-out app sends the user to the secure origin with the page to come back to, and draws no sign-in form', async function (assert) {
    let expected = signInURLFor(APP_PAGE);
    await render(<template><SecureSignIn /></template>);

    assert.strictEqual(
      window.location.href,
      expected,
      'the page is replaced by the secure origin’s sign-in, `return` in its fragment',
    );
    assert.notOk(
      new URL(expected).search.includes('return'),
      'nothing naming a URL is in the query string',
    );
    assert
      .dom('h1[data-test-secure-sign-in-status]')
      .hasText('Taking you to sign in…', 'the status is the heading');
    assert
      .dom('[data-test-secure-sign-in-button]')
      .hasAttribute('href', expected, 'a plain link goes there too');
    assert.dom('input').doesNotExist('no field to type a credential into');
    assert.dom('iframe').doesNotExist('no credential frame');
  });

  test('coming back signed out moments after being sent stops sending the user round', async function (assert) {
    noteRedirect(Date.now() - 1000);
    await render(<template><SecureSignIn /></template>);

    assert.strictEqual(
      new URL(window.location.href).pathname,
      '/some/path',
      'the page stays where it is',
    );
    assert
      .dom('h1[data-test-secure-sign-in-status]')
      .hasText('Sign-in didn’t complete');
    assert
      .dom('[data-test-secure-sign-in-button]')
      .hasAttribute('href', signInURLFor(APP_PAGE));
  });

  test('a sign-in long after the last redirect is sent on as usual', async function (assert) {
    noteRedirect(Date.now() - REDIRECT_GUARD_MS - 1000);
    let expected = signInURLFor(APP_PAGE);
    await render(<template><SecureSignIn /></template>);
    assert.strictEqual(window.location.href, expected);
  });

  test('a framed app is never navigated; its link opens sign-in in a page of its own', async function (assert) {
    let originalIsFramed = framing.isFramed;
    framing.isFramed = () => true;
    try {
      await render(<template><SecureSignIn /></template>);
      assert.strictEqual(
        new URL(window.location.href).pathname,
        '/some/path',
        'the frame stays where it is',
      );
      assert
        .dom('[data-test-secure-sign-in-button]')
        .hasAttribute('target', '_blank')
        .hasAttribute('href', signInURLFor(APP_PAGE));
    } finally {
      framing.isFramed = originalIsFramed;
    }
  });

  test('the login token the secure origin hands back is redeemed and taken out of the address', async function (assert) {
    window.location.href = `${APP_PAGE}&loginToken=handed-over`;
    let redeemed: string | undefined;
    setLoginWithTokenInterceptor((token: string) => {
      redeemed = token;
      return Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any);
    });
    let replaced: (string | null | undefined)[] = [];
    let originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _state: unknown,
      _title: string,
      url?: string | null,
    ) => replaced.push(url);
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let started = false;
    service.start = (async () => {
      started = true;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => started);
      assert.strictEqual(redeemed, 'handed-over');
      assert.true(started, 'the session boots');
      assert.false(
        new URLSearchParams(
          new URL(replaced.at(-1) ?? '', 'http://x').search,
        ).has('loginToken'),
        'the spent token is taken out of the address',
      );
      assert.strictEqual(
        new URL(window.location.href).host,
        new URL(window.location.origin).host,
        'and the app stays put rather than going back to sign in',
      );
      assert.strictEqual(
        window.sessionStorage.getItem('boxel-secure-sign-in-redirected-at'),
        null,
      );
    } finally {
      service.start = originalStart;
      (window.history as any).replaceState = originalReplaceState;
    }
  });

  test('a hand-off that names a device signs the app in as that device, and both leave the address', async function (assert) {
    window.location.href = `${APP_PAGE}#loginToken=handed-over&deviceId=WINDOWBOUND`;
    let redeemed: { token: string; deviceId?: string } | undefined;
    setLoginWithTokenInterceptor((token: string, deviceId?: string) => {
      redeemed = { token, deviceId };
      return Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: deviceId,
      } as any);
    });
    let replaced: (string | null | undefined)[] = [];
    let originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _state: unknown,
      _title: string,
      url?: string | null,
    ) => replaced.push(url);
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let started = false;
    service.start = (async () => {
      started = true;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => started);
      assert.deepEqual(redeemed, {
        token: 'handed-over',
        deviceId: 'WINDOWBOUND',
      });
      let address = new URL(replaced.at(-1) ?? '', 'http://x');
      assert.strictEqual(address.hash, '', 'neither is left in the fragment');
    } finally {
      service.start = originalStart;
      (window.history as any).replaceState = originalReplaceState;
    }
  });

  test('a sign-in that lands on the app’s root page shows the workspace chooser as soon as the session is up', async function (assert) {
    window.location.href = '/?loginToken=handed-over';
    setLoginWithTokenInterceptor(() =>
      Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any),
    );
    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as any;
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let chooserOpenAtStart: boolean | undefined;
    service.start = (async () => {
      chooserOpenAtStart = operatorModeStateService.workspaceChooserOpened;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => chooserOpenAtStart !== undefined);
      assert.true(
        chooserOpenAtStart,
        'the chooser is open before the session that renders it is up',
      );
    } finally {
      service.start = originalStart;
    }
  });

  test('a sign-in that lands on the root page with an empty interact state shows the workspace chooser as soon as the session is up', async function (assert) {
    let emptyInteract = encodeURIComponent(
      JSON.stringify({
        stacks: [],
        submode: 'interact',
        workspaceChooserOpened: false,
      }),
    );
    window.location.href = `/?operatorModeState=${emptyInteract}&loginToken=handed-over`;
    setLoginWithTokenInterceptor(() =>
      Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any),
    );
    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as any;
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let chooserOpenAtStart: boolean | undefined;
    service.start = (async () => {
      chooserOpenAtStart = operatorModeStateService.workspaceChooserOpened;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => chooserOpenAtStart !== undefined);
      assert.true(chooserOpenAtStart);
    } finally {
      service.start = originalStart;
    }
  });

  test('a sign-in that lands on a page naming its own state leaves the workspace chooser to it', async function (assert) {
    window.location.href = `${APP_PAGE}&loginToken=handed-over`;
    setLoginWithTokenInterceptor(() =>
      Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any),
    );
    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as any;
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let chooserOpenAtStart: boolean | undefined;
    service.start = (async () => {
      chooserOpenAtStart = operatorModeStateService.workspaceChooserOpened;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => chooserOpenAtStart !== undefined);
      assert.false(chooserOpenAtStart);
    } finally {
      service.start = originalStart;
    }
  });

  test('a login token handed over in the fragment is redeemed and taken out of the address', async function (assert) {
    window.location.href = `${APP_PAGE}#loginToken=in-the-fragment`;
    let redeemed: string | undefined;
    setLoginWithTokenInterceptor((token: string) => {
      redeemed = token;
      return Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any);
    });
    let replaced: (string | null | undefined)[] = [];
    let originalReplaceState = window.history.replaceState;
    (window.history as any).replaceState = (
      _state: unknown,
      _title: string,
      url?: string | null,
    ) => replaced.push(url);
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    let started = false;
    service.start = (async () => {
      started = true;
    }) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitUntil(() => started);
      assert.strictEqual(redeemed, 'in-the-fragment');
      assert.strictEqual(
        replaced.at(-1),
        APP_PAGE,
        'the address keeps its path and query, and loses the token',
      );
    } finally {
      service.start = originalStart;
      (window.history as any).replaceState = originalReplaceState;
    }
  });

  test('a session that fails to start after the token redeems says so, and keeps the guard', async function (assert) {
    window.location.href = `${APP_PAGE}#loginToken=handed-over`;
    noteRedirect(Date.now() - 1000);
    setLoginWithTokenInterceptor(() =>
      Promise.resolve({
        access_token: 't',
        user_id: '@u:s',
        device_id: 'd',
      } as any),
    );
    let service = matrixService(this);
    let originalStart = service.start.bind(service);
    // `start()` signs out again on a failure after the Matrix login, rather
    // than throwing; this one never signs in.
    service.start = (async () => {}) as typeof service.start;
    try {
      await render(<template><SecureSignIn /></template>);
      await waitFor('[data-test-secure-sign-in-landing="failed"]');
      assert
        .dom('[data-test-secure-sign-in-status]')
        .hasText('Sign-in didn’t complete');
      assert.dom('[data-test-secure-sign-in-button]').exists();
      assert.notStrictEqual(
        window.sessionStorage.getItem('boxel-secure-sign-in-redirected-at'),
        null,
        'the guard still stops the next signed-out arrival from redirecting',
      );
    } finally {
      service.start = originalStart;
    }
  });

  test('a spent login token says so, with a link to sign in again', async function (assert) {
    window.location.href = `${APP_PAGE}&loginToken=spent`;
    setLoginWithTokenInterceptor(() =>
      Promise.reject({
        httpStatus: 403,
        errcode: 'M_FORBIDDEN',
        data: { errcode: 'M_FORBIDDEN', error: 'Invalid login token' },
      }),
    );
    await render(<template><SecureSignIn /></template>);
    await waitFor('[data-test-secure-sign-in-message]');
    assert
      .dom('[data-test-secure-sign-in-message]')
      .hasText(
        'This sign-in link has expired or was already used. Sign in again.',
      );
    assert.dom('[data-test-secure-sign-in-button]').exists();
  });

  test('a password reset link sent to the app goes on to the secure origin’s reset page', async function (assert) {
    window.location.href =
      '/?clientSecret=a-secret#email=someone%40example.test&sid=a-sid';
    await render(<template><SecureSignIn /></template>);
    let landed = new URL(window.location.href);
    let expected = secureURL('reset-password');
    assert.strictEqual(
      landed.origin + landed.pathname,
      expected.origin + expected.pathname,
    );
    assert.strictEqual(landed.search, '', 'nothing rides in the query string');
    assert.false(
      landed.searchParams.has('clientSecret'),
      'the secret is not in the query string',
    );
    let fragment = new URLSearchParams(landed.hash.slice(1));
    assert.strictEqual(fragment.get('clientSecret'), 'a-secret');
    assert.strictEqual(fragment.get('sid'), 'a-sid');
    assert.strictEqual(fragment.get('email'), 'someone@example.test');
  });
});
