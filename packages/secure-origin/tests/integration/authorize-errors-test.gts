import {
  clearRender,
  click,
  find,
  render,
  settled,
  waitFor,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { ERROR_STATE_BY_REASON } from '../../src/security/oauth-error-states.js';
import { navigation } from '../../src/shell/navigation.js';
import AuthorizePage from '../../src/shell/authorize/authorize-page.gts';
import { errorCopy } from '../../src/shell/authorize/error-copy.ts';
import {
  REALM_SERVER_URL,
  setupMockServers,
  setupPageAddress,
  type Answer,
} from '../helpers/mock-servers.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

type QUnitAssert = Parameters<Parameters<typeof test>[1]>[0];

// An error reference as the realm server issues one: 43 base64url characters.
const REF = 'Rf0-error-reference_' + 'x'.repeat(23);
const DETAILS = `_oauth-provider/error/${REF}`;
const RETURN = `${REALM_SERVER_URL}_oauth-provider/error/${REF}/return`;
const APP = 'example-app.test';
const CLAIMED_NAME = 'Totally Boxel Itself';
// What a hand-made address carries, none of which the page may show, send
// anywhere or record.
const ATTACKER = 'https://attacker.example.test/landing';
const DESCRIPTION = 'Your account is locked, visit attacker example';

function details(overrides: Record<string, unknown> = {}) {
  return {
    error: 'invalid_request',
    reason: 'prompt-none',
    app: {
      kind: 'dynamic',
      shown: APP,
      verified: false,
      claimedName: CLAIMED_NAME,
    },
    returnOffered: true,
    ...overrides,
  };
}

module('Integration | authorize errors', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let moves: { how: 'assign' | 'replace' | 'close'; url?: string }[] = [];
  let original = { ...navigation };

  hooks.beforeEach(function () {
    moves = [];
    navigation.assign = (url: string) => {
      moves.push({ how: 'assign', url });
    };
    navigation.replace = (url: string) => {
      moves.push({ how: 'replace', url });
    };
    navigation.close = () => {
      moves.push({ how: 'close' });
    };
  });

  hooks.afterEach(function () {
    Object.assign(navigation, original);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(servers.requests('realm-server').map((r) => r.body)),
    REF,
    APP,
    CLAIMED_NAME,
    ATTACKER,
    DESCRIPTION,
  ]);

  function answers(answer: () => Answer | Promise<Answer>) {
    servers.realmServer(`GET ${DETAILS}`, answer);
  }

  async function open(query = `?error=${REF}`) {
    history.replaceState(null, '', `/secure/authorize${query}`);
    await render(AuthorizePage);
    await settled();
  }

  function shows(assert: QUnitAssert, state: string, app?: string) {
    let copy = errorCopy(state as Parameters<typeof errorCopy>[0], {
      ...(app ? { app: { shown: app, onThisComputer: false } } : {}),
    });
    assert.dom(`[data-test-oauth-error="${state}"]`).exists(state);
    assert.dom('[data-test-secure-title]').hasText(copy.heading);
    assert.dom('[data-test-secure-info]').hasText(copy.info);
    assert.dom('[data-test-oauth-error-close]').exists();
  }

  module('a stored error', function () {
    test('every reason the server gives shows its state, naming the app', async function (assert) {
      for (let [reason, state] of Object.entries(ERROR_STATE_BY_REASON)) {
        answers(() => details({ reason, returnOffered: false }));
        await open();
        shows(assert, state, APP);
        assert.dom('[data-test-oauth-error-return]').doesNotExist(reason);
      }
      assert.notOk(
        document.body.textContent?.includes(CLAIMED_NAME),
        "a name a self-registered app gave itself isn't shown",
      );
    });

    test('a state with no app, or one Boxel can\'t name, says "the app"', async function (assert) {
      answers(() => {
        let { app: _app, ...rest } = details({ returnOffered: false });
        return rest;
      });
      await open();
      shows(assert, 'unsupported');
      assert.dom('[data-test-secure-info]').includesText('The app asked');

      answers(() =>
        details({
          app: {
            kind: 'dynamic',
            shown: 'an unknown app',
            verified: false,
            standIn: 'unknown',
          },
        }),
      );
      await open();
      shows(assert, 'unsupported');
      assert.dom('[data-test-oauth-error-return]').doesNotExist();
    });

    test('an app on this computer is named as one', async function (assert) {
      answers(() =>
        details({
          app: {
            kind: 'dynamic',
            shown: 'an app on this computer',
            verified: false,
            standIn: 'loopback',
          },
        }),
      );
      await open();
      assert
        .dom('[data-test-secure-info]')
        .hasText(
          'An app on this computer asked to connect in a way Boxel doesn’t support. Nothing was shared.',
        );
      assert
        .dom('[data-test-oauth-error-return]')
        .hasText('Return to an app on this computer');
    });

    test('"Return" goes through the realm server, only where it is offered', async function (assert) {
      answers(() => details({ reason: 'client-not-allowed' }));
      await open();
      shows(assert, 'not-allowed', APP);
      assert.dom('[data-test-oauth-error-return]').hasText(`Return to ${APP}`);
      assert.dom('[data-test-oauth-error-return]').hasAttribute('href', RETURN);
      assert.notEqual(
        document.activeElement,
        find('[data-test-oauth-error-return]'),
        'focus never lands on "Return"',
      );
      assert.deepEqual(moves, [], 'the page sends the browser nowhere');
    });

    test('"Return" is drawn wherever the server offers it', async function (assert) {
      answers(() => details({ reason: 'library', returnOffered: true }));
      await open();
      shows(assert, 'cant-continue', APP);
      assert.dom('[data-test-oauth-error-return]').hasAttribute('href', RETURN);
    });

    test('a reference the server no longer knows is an expired request', async function (assert) {
      answers(() => ({ status: 404, body: { error: 'expired' } }));
      await open();
      shows(assert, 'expired');
      assert.dom('[data-test-oauth-error-return]').doesNotExist();
    });

    test("a 404 that isn't the realm server's own is a failed load", async function (assert) {
      answers(() => ({ status: 404, body: { message: 'Not Found' } }));
      await open();
      assert.dom('[data-test-oauth-error="load-failed"]').exists();
      assert.dom('[data-test-oauth-error-retry]').doesNotExist();
    });

    test('a page brought back from the browser cache looks its error up again', async function (assert) {
      answers(() => details({ reason: 'openid' }));
      await open();
      assert.dom('[data-test-oauth-error-return]').exists();
      // "Return" spends the reference.
      answers(() => ({ status: 404, body: { error: 'expired' } }));
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      );
      await settled();
      shows(assert, 'expired');
      assert.dom('[data-test-oauth-error-return]').doesNotExist();
      assert.strictEqual(
        servers.requests('realm-server', `GET ${DETAILS}`).length,
        2,
      );
    });

    test('a lookup still waiting when the page goes is stopped', async function (assert) {
      answers(() => new Promise<Answer>(() => {}));
      history.replaceState(null, '', `/secure/authorize?error=${REF}`);
      render(AuthorizePage);
      await waitFor('[data-test-oauth-error-loading]');
      await clearRender();
      let [lookup] = servers.requests('realm-server', `GET ${DETAILS}`);
      assert.true(lookup?.signal?.aborted);
    });

    test("a lookup that fails says the page couldn't load, and offers Try again only when it could help", async function (assert) {
      answers(() => ({ status: 403, body: { error: 'forbidden' } }));
      await open();
      assert.dom('[data-test-oauth-error="load-failed"]').exists();
      assert.dom('[data-test-oauth-error-retry]').doesNotExist();
      assert.dom('[data-test-oauth-error-return]').doesNotExist();

      answers(() => ({ network: 'down' }));
      await open();
      assert.dom('[data-test-oauth-error="load-failed"]').exists();
      assert.dom('[data-test-oauth-error-retry]').exists();

      answers(() => ({
        status: 200,
        body: '<html>Sign in to the Wi-Fi</html>',
      }));
      await open();
      assert.dom('[data-test-oauth-error="load-failed"]').exists();
      assert
        .dom('[data-test-oauth-error-retry]')
        .doesNotExist("an answer the page can't use comes back the same");

      answers(() => ({ status: 500, body: {} }));
      await open();
      assert.dom('[data-test-oauth-error-retry]').exists();
      answers(() => details({ reason: 'openid' }));
      await click('[data-test-oauth-error-retry]');
      shows(assert, 'not-offered', APP);
      assert.dom('[data-test-oauth-error-return]').exists();
    });
  });

  module('a state that needs no lookup', function () {
    test('too many attempts and an expired request ask nothing', async function (assert) {
      await open('?error=rate_limited');
      shows(assert, 'rate-limited');
      await open('?error=expired');
      shows(assert, 'expired');
      assert.strictEqual(servers.requests('realm-server').length, 0);
    });

    test('an error wins over an interaction, and consent never starts', async function (assert) {
      answers(() => details({ reason: 'openid' }));
      await open(`?interaction=flow-interaction-1&error=${REF}`);
      shows(assert, 'not-offered', APP);
      assert.dom('[data-test-authorize-consent]').doesNotExist();
      assert.deepEqual(
        servers.requests('realm-server').map((r) => r.path),
        [DETAILS],
      );
    });
  });

  module('a hand-made address', function () {
    test('sends the browser nowhere, asks nothing, and shows nothing from the address', async function (assert) {
      let query = new URLSearchParams({
        error: ATTACKER,
        error_description: DESCRIPTION,
        redirect_uri: ATTACKER,
        state: 'attacker-state',
      });
      await open(`?${query}`);
      shows(assert, 'expired');
      assert.strictEqual(servers.requests('realm-server').length, 0);
      assert.deepEqual(moves, []);
      let text = document.body.textContent ?? '';
      for (let value of [ATTACKER, DESCRIPTION, 'attacker']) {
        assert.notOk(text.includes(value), `the page doesn't show ${value}`);
      }
      assert.dom('a[href]').doesNotExist('the page links nowhere');
    });

    test('a well-formed reference never issued is an expired request', async function (assert) {
      answers(() => ({ status: 404, body: { error: 'expired' } }));
      await open(`?error=${REF}&redirect_uri=${encodeURIComponent(ATTACKER)}`);
      shows(assert, 'expired');
      assert.dom('a[href]').doesNotExist();
      assert.deepEqual(moves, []);
    });

    test('extra parameters beside a stored error change nothing', async function (assert) {
      answers(() => details({ reason: 'pkce-required', returnOffered: false }));
      let query = new URLSearchParams({
        error: REF,
        redirect_uri: ATTACKER,
        error_description: DESCRIPTION,
      });
      await open(`?${query}`);
      shows(assert, 'unsupported', APP);
      assert.dom('a[href]').doesNotExist();
      assert.notOk((document.body.textContent ?? '').includes(DESCRIPTION));
    });

    test('a repeated error is not looked up', async function (assert) {
      await open(`?error=${REF}&error=${REF}`);
      shows(assert, 'expired');
      assert.strictEqual(servers.requests('realm-server').length, 0);
    });
  });

  test('Close closes the window, and says it can be closed when it stays open', async function (assert) {
    await open('?error=rate_limited');
    assert
      .dom('[data-test-oauth-error-close-hint]')
      .hasAttribute(
        'role',
        'status',
        'the line is in the page, empty, before Close',
      );
    assert.dom('[data-test-oauth-error-close-hint]').hasNoText();
    await click('[data-test-oauth-error-close]');
    assert.deepEqual(moves, [{ how: 'close' }]);
    assert
      .dom('[data-test-oauth-error-close-hint]')
      .hasText('You can close this window.');
  });
});
