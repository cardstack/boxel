import { click, fillIn, render, settled, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { navigation } from '../../src/shell/navigation.js';
import DevicePage from '../../src/shell/device/device-page.gts';
import GoogleCallback from '../../src/shell/sign-in/google-callback.gts';
import { userCodeFrom } from '../../src/security/oauth-provider-device.ts';
import {
  secureSession,
  setupMockServers,
  setupPageAddress,
} from '../helpers/mock-servers.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

const STORAGE_KEY = 'boxel-secure-session';
const GOOGLE_SIGN_IN_KEY = 'boxel-secure-google-sign-in';
const LOOKUP = 'POST _oauth-provider/device/lookup';
const DECISION = 'POST _oauth-provider/device/decision';
const USER_CODE = 'WDJB-MJHT';
const SESSION = {
  token: 'window-session-token',
  user: '@person:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const EMAIL = 'person@example.test';
const ALLOW_READY = '[data-test-authorize-allow]:not([disabled])';

const BOXEL_API = {
  id: 'https://realm-server.example.test',
  name: 'Boxel API',
  description: 'Lets the app use Boxel for you.',
  coverage:
    'This covers every workspace you can open, including shared ones and ones you create later.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'See the cards and files in your workspaces.',
      label: 'Read',
      caution: false,
    },
    {
      name: 'boxel:write',
      description: 'Create and change cards and files.',
      label: 'Change',
      caution: true,
    },
  ],
};

const DETAILS = {
  app: {
    kind: 'pre-registered',
    shown: 'Boxel CLI',
    verified: true,
    place: 'this-computer',
  },
  outsideApp: false,
  resources: [BOXEL_API],
  account: { email: EMAIL },
  renewalOffered: true,
  confirmationCode: USER_CODE,
};

module('Integration | device', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let moves: { how: 'assign' | 'replace'; url: string }[] = [];
  let original = { ...navigation };

  hooks.beforeEach(function () {
    moves = [];
    navigation.assign = (url: string) => {
      moves.push({ how: 'assign', url });
    };
    navigation.replace = (url: string) => {
      moves.push({ how: 'replace', url });
    };
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(GOOGLE_SIGN_IN_KEY);
  });

  hooks.afterEach(function () {
    Object.assign(navigation, original);
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(GOOGLE_SIGN_IN_KEY);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(
      servers.requests('realm-server').map((r) => [r.body, r.authorization]),
    ),
    USER_CODE,
    USER_CODE.replace('-', ''),
    SESSION.token,
    EMAIL,
    'a-password',
  ]);

  function at(path = '/secure/device', query = '') {
    history.replaceState(null, '', `${path}${query}`);
  }

  function signedIn() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SESSION));
    servers.realmServer('GET _secure-session', () => ({}));
  }

  async function open(query = '') {
    at('/secure/device', query);
    await render(DevicePage);
    await settled();
  }

  async function enter(code: string) {
    await fillIn('[data-test-device-code]', code);
    await click('[data-test-device-continue]');
    await settled();
  }

  test('a typed code is read in any case, with or without its dash', function (assert) {
    assert.strictEqual(userCodeFrom('wdjb-mjht'), USER_CODE);
    assert.strictEqual(userCodeFrom(' WDJB MJHT '), USER_CODE);
    assert.strictEqual(userCodeFrom('WDJBMJHT'), USER_CODE);
    assert.strictEqual(userCodeFrom('WDJB-MJH'), undefined, 'too short');
    assert.strictEqual(userCodeFrom('WDJB-MJHA'), undefined, 'a vowel');
    assert.strictEqual(userCodeFrom('WDJB/MJHT'), undefined, 'a slash');
  });

  test('without a session, signs in on the page first', async function (assert) {
    await open();
    assert
      .dom('[data-test-secure-sign-in-title]')
      .hasText('Sign in to Boxel to connect an app');
    assert
      .dom('[data-test-device-sign-in-intro]')
      .hasText('Then enter the code your terminal shows.');
    assert
      .dom('[data-test-secure-forgot-password]')
      .doesNotExist('nothing that leaves the page is offered');
    assert.dom('[data-test-secure-register]').doesNotExist();

    servers.realmServer('POST _secure-session', () =>
      secureSession(SESSION.user, SESSION.token),
    );
    await fillIn('[data-test-secure-username]', 'person');
    await fillIn('[data-test-secure-password]', 'a-password');
    await click('[data-test-secure-password-submit]');
    await waitFor('[data-test-device-code-form]');
    assert.dom('[data-test-device-code]').isFocused();
  });

  test('a Google sign-in started here comes back to the device page', async function (assert) {
    servers.realmServer('GET _secure-session/google', () => ({
      data: {
        attributes: {
          authorizationEndpoint: 'https://accounts.google.test/o/oauth2/auth',
          clientId: 'google-client-id',
          redirectURI: 'https://secure.test/google-callback',
        },
      },
    }));
    await open();
    await click('[data-test-secure-google]');
    let pending = JSON.parse(sessionStorage.getItem(GOOGLE_SIGN_IN_KEY)!);
    assert.strictEqual(pending.resume.page, 'device');

    servers.realmServer('POST _secure-session/google', () =>
      secureSession(SESSION.user, SESSION.token),
    );
    moves.length = 0;
    at('/secure/google-callback', `?state=${pending.state}&code=a-code`);
    await render(GoogleCallback);
    await settled();
    assert.deepEqual(moves, [{ how: 'replace', url: '/secure/device' }]);
  });

  test('asks for the code, warning to enter only one from your own terminal', async function (assert) {
    signedIn();
    await open();
    assert
      .dom('[data-test-device-heading]')
      .hasText('Enter the code shown in your terminal');
    assert
      .dom('[data-test-device-warning]')
      .includesText(
        'Only enter a code shown in your own terminal. If someone sent you this code, close this page.',
      );
    assert.dom('[data-test-authorize-account]').hasText(SESSION.user);
    assert.dom('[data-test-device-code]').hasValue('').isFocused();
    assert
      .dom('[data-test-device-code]')
      .hasAttribute(
        'aria-describedby',
        /device-code-warning/,
        'the field is described by the warning, so it is read with it',
      );
    assert.dom('#device-code-warning').exists();
  });

  test("ignores a code in the page's address", async function (assert) {
    signedIn();
    await open(`?user_code=${USER_CODE}#user_code=${USER_CODE}`);
    assert.dom('[data-test-device-code]').hasValue('');
    assert.strictEqual(
      servers.requests('realm-server', LOOKUP).length,
      0,
      'nothing is looked up',
    );
  });

  test("a code that isn't one is refused without asking", async function (assert) {
    signedIn();
    await open();
    await enter('HELLO');
    assert
      .dom('[data-test-device-error]')
      .includesText(
        'Enter the 8-letter code your terminal shows, such as BCDF-GHJK.',
      );
    assert.strictEqual(servers.requests('realm-server', LOOKUP).length, 0);
  });

  test('each refusal of a code says why, and keeps what was typed', async function (assert) {
    signedIn();
    let cases: [number, string, string][] = [
      [
        404,
        'unknown-code',
        'That code isn’t right. Check it against your terminal and try again.',
      ],
      [
        410,
        'expired',
        'That code has expired. Start signing in again in your terminal for a new one.',
      ],
      [
        409,
        'decided',
        'That code has already been used. Start signing in again in your terminal for a new one.',
      ],
      [
        429,
        'rate-limited',
        'Too many tries. Wait a few minutes, then try again.',
      ],
    ];
    await open();
    for (let [status, error, message] of cases) {
      servers.realmServer(LOOKUP, () => ({ status, body: { error } }));
      await enter('wdjb mjht');
      assert.dom('[data-test-device-error]').includesText(message, error);
      assert.dom('[data-test-device-code]').hasValue('wdjb mjht');
    }
  });

  test('a code shows consent for Boxel CLI, with the code to check and a warning about codes someone sent', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    await open();
    await enter('wdjb mjht');
    let [lookup] = servers.requests('realm-server', LOOKUP);
    assert.deepEqual(lookup?.body, { user_code: USER_CODE });
    assert.strictEqual(lookup?.authorization, `Bearer ${SESSION.token}`);
    assert
      .dom('[data-test-authorize-heading]')
      .hasText('Connect Boxel CLI to Boxel API?');
    assert.dom('[data-test-authorize-heading]').isFocused();
    assert.dom('[data-test-authorize-account]').hasText(EMAIL);
    assert
      .dom('[data-test-authorize-confirmation-warning]')
      .includesText(
        'Only allow this if you typed this code from your own terminal, where you just started signing in to Boxel CLI. If someone sent you this code, choose Deny.',
      );
    assert
      .dom('[data-test-authorize-confirmation]')
      .includesText('Check that your terminal shows this code:');
    assert.dom('[data-test-authorize-confirmation-code]').hasText(USER_CODE);
  });

  test('Allow signs the app in and sends the browser nowhere', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    servers.realmServer(DECISION, () => ({ decision: 'allow' }));
    await open();
    await enter(USER_CODE);
    await waitFor(ALLOW_READY);
    await click('[data-test-authorize-allow]');
    await settled();
    assert.deepEqual(servers.requests('realm-server', DECISION)[0]?.body, {
      user_code: USER_CODE,
      decision: 'allow',
      renew: true,
    });
    assert
      .dom('[data-test-device-outcome="allowed"] [data-test-secure-title]')
      .hasText('Boxel CLI is signed in');
    assert
      .dom('[data-test-device-outcome="allowed"] [data-test-secure-info]')
      .hasText(
        'Return to your terminal. You can see and disconnect your apps in Connected apps.',
      );
    assert.deepEqual(moves, [], 'the browser goes nowhere');
  });

  test('Allow without keeping the connection asks for no renewal', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    servers.realmServer(DECISION, () => ({ decision: 'allow' }));
    await open();
    await enter(USER_CODE);
    await click('[data-test-authorize-renew] input');
    await waitFor(ALLOW_READY);
    await click('[data-test-authorize-allow]');
    await settled();
    assert.false(servers.requests('realm-server', DECISION)[0]?.body.renew);
  });

  test('Deny signs nothing in', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    servers.realmServer(DECISION, () => ({ decision: 'deny' }));
    await open();
    await enter(USER_CODE);
    await click('[data-test-authorize-deny]');
    await settled();
    assert.deepEqual(servers.requests('realm-server', DECISION)[0]?.body, {
      user_code: USER_CODE,
      decision: 'deny',
      renew: false,
    });
    assert
      .dom('[data-test-device-outcome="denied"] [data-test-secure-title]')
      .hasText('Boxel CLI was not signed in');
  });

  test('a code that expired while consent was open goes back to entering one', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    servers.realmServer(DECISION, () => ({
      status: 410,
      body: { error: 'expired' },
    }));
    await open();
    await enter(USER_CODE);
    await waitFor(ALLOW_READY);
    await click('[data-test-authorize-allow]');
    await settled();
    assert.dom('[data-test-device-code-form]').exists();
    assert
      .dom('[data-test-device-error]')
      .includesText(
        'That code has expired. Start signing in again in your terminal for a new one.',
      );
  });

  test('an answer over the limit says to wait, and keeps consent open', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => DETAILS);
    servers.realmServer(DECISION, () => ({
      status: 429,
      body: { error: 'rate-limited' },
    }));
    await open();
    await enter(USER_CODE);
    await waitFor(ALLOW_READY);
    await click('[data-test-authorize-allow]');
    await settled();
    assert
      .dom('[data-test-authorize-error]')
      .includesText('Too many tries. Wait a few minutes, then try again.');
    assert.dom('[data-test-authorize-allow]').exists('consent stays open');
  });

  test('the warning shows for a device sign-in from any app', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => ({
      ...DETAILS,
      app: { kind: 'pre-registered', shown: 'Boxel CLI', verified: true },
    }));
    await open();
    await enter(USER_CODE);
    assert
      .dom('[data-test-authorize-confirmation-warning]')
      .includesText('If someone sent you this code, choose Deny.');
  });

  test('a session that ended asks for a sign-in again', async function (assert) {
    signedIn();
    servers.realmServer(LOOKUP, () => ({
      status: 401,
      body: { error: 'signed-out' },
    }));
    await open();
    await enter(USER_CODE);
    assert.dom('[data-test-device-session-ended]').exists();
  });

  test('Cancel before a code asks for nothing', async function (assert) {
    signedIn();
    await open();
    await click('[data-test-device-cancel]');
    assert
      .dom('[data-test-device-closed]')
      .includesText('Nothing was signed in');
    assert.strictEqual(servers.requests('realm-server', LOOKUP).length, 0);
  });
});
