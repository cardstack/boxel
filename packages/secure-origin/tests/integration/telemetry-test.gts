import { click, fillIn, render, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import EnterKeyPage from '../../src/shell/keys/enter-key-page.gts';
import KeyPage from '../../src/shell/keys/key-page.gts';
import SharePage from '../../src/shell/keys/share-key-page.gts';
import { navigation } from '../../src/shell/navigation.js';
import {
  pageOpened,
  startTelemetry,
  stopTelemetry,
} from '../../src/shell/telemetry.ts';
import { SecureTelemetry } from '../../src/telemetry/instrument.ts';

// The secure origin's telemetry, driven through the key page and sharing a
// key with known secret values: every value a person types, every name, label
// and id a page reads, the realm's URL and name, the session's token and the
// server's own error messages. No beacon may carry any of them. The key-page
// tests run the same check through every key page's flows, swapping a key
// in place of a suspended share among them.

const REALM_SERVER = 'https://realm-server.test/';
const REALM = 'https://realm-server.test/secret-owner/classified-workspace/';
const KEY_ID = 'key-id-7f3c1d2e';
const OTHER_KEY_ID = 'key-id-0a9b8c7d';
const SHARE_ID = 'share-id-55aa66bb';

const SECRETS = {
  token: 'session-token-SHOULD-NOT-LEAK',
  keyValue: 'sk-live-TOPSECRET-value-9081',
  keyName: 'Zebra Payroll Key',
  otherKeyName: 'Okapi Billing Key',
  newKeyName: 'Narwhal Ledger Key',
  shareLabel: 'Quokka Share Label',
  realmName: 'Classified Workspace Name',
  serverMessage: 'Nothing matched Pangolin Lookup Detail',
  // The beacon is attributed by its session; its body names no user.
  matrixUser: '@someone:example.test',
};
const IDS = [KEY_ID, OTHER_KEY_ID, SHARE_ID];

const SESSION = {
  token: SECRETS.token,
  user: SECRETS.matrixUser,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

type Answer = { status: number; body?: unknown };
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
type QUnitAssert = Parameters<Parameters<typeof test>[1]>[0];

function json(status: number, body: unknown): Answer {
  return { status, body };
}

function key(id: string, name: string) {
  return {
    type: 'user-key',
    id,
    attributes: {
      name,
      kind: 'static',
      state: 'active',
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
  };
}

const KEYS = {
  data: [key(KEY_ID, SECRETS.keyName), key(OTHER_KEY_ID, SECRETS.otherKeyName)],
};

const SHARE = {
  type: 'key-share',
  id: SHARE_ID,
  attributes: {
    realm: REALM,
    label: SECRETS.shareLabel,
    owner: '@former:example.test',
    state: 'suspended',
    suspensionReason: 'owner-lost-write',
  },
};

module('Integration | telemetry', function (hooks) {
  setupRenderingTest(hooks);

  let routes: Record<string, (body: any) => Answer>;
  let beacons: { headers: Record<string, string>; body: string }[];
  let originalFetch = window.fetch;
  let originalNavigation = { ...navigation };
  let originalURL: string;
  let meta: HTMLMetaElement;

  hooks.before(function () {
    originalURL = window.location.href;
  });

  hooks.after(function () {
    history.replaceState(null, '', originalURL);
  });

  hooks.beforeEach(function () {
    beacons = [];
    routes = {
      'GET _secure-session': () => ({ status: 204 }),
      'GET _user-keys': () => json(200, KEYS),
      'POST _key-write-tickets': () =>
        json(201, {
          data: {
            attributes: {
              ticket: 'ticket-SECRET-abc',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        }),
    };
    window.fetch = async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1] = {},
    ) => {
      let url = new URL(String(input));
      let method = init.method ?? 'GET';
      let path = url.pathname.replace(/^\//, '');
      let route = routes[`${method} ${path}`];
      let answer = route
        ? route(init.body ? JSON.parse(String(init.body)) : undefined)
        : json(404, { errors: [{ status: 404, detail: 'Not found' }] });
      return new Response(
        answer.status === 204 ? null : JSON.stringify(answer.body ?? {}),
        {
          status: answer.status,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        },
      );
    };
    navigation.assign = () => {};
    navigation.replace = () => {};
    navigation.close = () => {};
    meta = document.createElement('meta');
    meta.name = 'boxel-realm-server-url';
    meta.content = REALM_SERVER;
    document.head.append(meta);
    storeSession(SESSION);
    startTelemetry({
      fetch: (async (_url: URL, init: FetchInit) => {
        beacons.push({
          headers: init.headers as Record<string, string>,
          body: String(init.body),
        });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
  });

  hooks.afterEach(function () {
    stopTelemetry();
    window.fetch = originalFetch;
    Object.assign(navigation, originalNavigation);
    meta.remove();
    forgetSession();
  });

  function assertNothingSecret(assert: QUnitAssert) {
    stopTelemetry();
    assert.ok(beacons.length > 0, 'the pages beaconed');
    let sent = beacons.map((b) => b.body).join('\n');
    for (let [name, value] of Object.entries(SECRETS)) {
      assert.false(sent.includes(value), `no beacon carries the ${name}`);
    }
    for (let id of IDS) {
      assert.false(sent.includes(id), `no beacon carries the id ${id}`);
    }
    for (let part of [REALM, 'secret-owner', 'classified-workspace', '#']) {
      assert.false(sent.includes(part), `no beacon carries ${part}`);
    }
    assert.false(sent.includes('ticket-SECRET'), 'no beacon carries a ticket');
    return beacons.flatMap((b) => JSON.parse(b.body).events);
  }

  test('entering a key sends none of what was typed', async function (assert) {
    routes['POST _user-keys'] = () =>
      json(201, { data: key('key-id-new', SECRETS.newKeyName) });
    pageOpened('enter-key');
    await render(EnterKeyPage);
    await waitFor('[data-test-enter-key-form]');
    await fillIn('[data-test-key-name]', SECRETS.newKeyName);
    await fillIn('[data-test-key-value]', SECRETS.keyValue);
    await click('[data-test-enter-key-save]');
    await waitFor('[data-test-keys-done]');
    let events = assertNothingSecret(assert);
    assert.true(
      events.some(
        (e: any) =>
          e.event_type === 'server-request' &&
          e.endpoint === '_user-keys' &&
          e.method === 'POST' &&
          e.status === 201,
      ),
      'the save is recorded by its endpoint',
    );
    assert.true(
      events.every((e: any) => !('key-id-new' in e)),
      'and not by what it created',
    );
  });

  test('the key page and sharing a key send no name, label, realm or id', async function (assert) {
    routes['GET _secure-window/realms'] = () =>
      json(200, {
        data: [
          {
            type: 'secure-window-realm',
            id: REALM,
            attributes: { name: SECRETS.realmName },
          },
        ],
      });
    routes['POST _key-shares'] = () => json(201, { data: SHARE });

    pageOpened('keys.index');
    await render(KeyPage);
    await waitFor(`[data-test-key-row="${SECRETS.keyName}"]`);

    pageOpened('keys.share');
    await render(<template><SharePage @keyId={{KEY_ID}} /></template>);
    await waitFor('[data-test-share-key-form]');
    await fillIn('[data-test-share-label]', SECRETS.shareLabel);
    await click('[data-test-share-key-save]');
    await waitFor('[data-test-keys-done]');

    let events = assertNothingSecret(assert);
    let endpoints = new Set(
      events
        .filter((e: any) => e.event_type === 'server-request')
        .map((e: any) => e.endpoint),
    );
    for (let endpoint of [
      '_user-keys',
      '_key-shares',
      '_secure-window/realms',
      '_key-write-tickets',
    ]) {
      assert.true(endpoints.has(endpoint), `${endpoint} is recorded`);
    }
    assert.deepEqual(
      events
        .filter((e: any) => e.event_type === 'page-load')
        .map((e: any) => [e.page, e.outcome]),
      [
        ['keys', 'loaded'],
        ['keys/share', 'loaded'],
      ],
    );
    assert.true(
      beacons.every(
        (b) => b.headers.Authorization === `Bearer ${SECRETS.token}`,
      ),
      'the session goes only in the header that authenticates the beacon',
    );
  });

  test("a load that fails sends its endpoint and status, never the server's message", async function (assert) {
    routes['GET _user-keys'] = () =>
      json(404, { errors: [{ status: 404, detail: SECRETS.serverMessage }] });
    pageOpened('keys.index');
    await render(KeyPage);
    await waitFor('[data-test-keys-load-failed]');
    let load = assertNothingSecret(assert).find(
      (e: any) => e.event_type === 'page-load',
    );
    assert.deepEqual(
      [load.page, load.outcome, load.failed_endpoint, load.failed_status],
      ['keys', 'load-failed', '_user-keys', 404],
    );
  });

  test('a window with no session sends its outcome without a session', async function (assert) {
    forgetSession();
    pageOpened('keys.index');
    await render(KeyPage);
    await waitFor('[data-test-keys-signed-out]');
    let load = assertNothingSecret(assert).find(
      (e: any) => e.event_type === 'page-load',
    );
    assert.strictEqual(load.outcome, 'signed-out');
    assert.true(
      beacons.every((b) => !('Authorization' in b.headers)),
      'sent anonymously',
    );
  });
});

module('Unit | telemetry errors', function () {
  // A window the test dispatches errors at, so the test runner's own error
  // handling never sees them.
  function fakeWindow() {
    let target = new EventTarget() as EventTarget & Record<string, unknown>;
    target.setInterval = window.setInterval.bind(window);
    target.clearInterval = window.clearInterval.bind(window);
    target.document = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    return target as unknown as Window;
  }

  test('an uncaught throw or rejection is sent scrubbed, and repeats are counted', function (assert) {
    let win = fakeWindow();
    let bodies: string[] = [];
    let telemetry = new SecureTelemetry({
      window: win,
      serverURL: new URL(REALM_SERVER),
      session: () => undefined,
      fetch: (async (_url: URL, init: FetchInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    telemetry.start();
    telemetry.pageOpened('enter-key');
    let thrown = new SyntaxError(
      `Unexpected token in "${SECRETS.keyValue}" from ${REALM}`,
    );
    for (let i = 0; i < 3; i++) {
      win.dispatchEvent(
        new ErrorEvent('error', { error: thrown, message: thrown.message }),
      );
    }
    let refused = Object.assign(new Error(SECRETS.serverMessage), {
      status: 403,
      code: 'forbidden',
    });
    let rejection = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: refused,
    });
    win.dispatchEvent(rejection);
    telemetry.stop();

    let sent = bodies.join('\n');
    assert.false(sent.includes(SECRETS.keyValue), 'no typed value');
    assert.false(sent.includes(SECRETS.serverMessage), 'no server message');
    assert.false(sent.includes('realm-server.test/secret'), 'no realm URL');
    let errors = bodies
      .flatMap((b) => JSON.parse(b).events)
      .filter((e: any) => e.event_type === 'client-error');
    assert.deepEqual(
      errors.map((e: any) => [e.kind, e.page, e.message, e.dedup_count]),
      [
        ['error', 'enter-key', 'SyntaxError: Unexpected token in * from *', 3],
        [
          'unhandledrejection',
          'enter-key',
          'request failed: status 403 (forbidden)',
          1,
        ],
      ],
    );
    assert.true(
      errors.every((e: any) => !e.stack.includes('Unexpected token')),
      'the stack keeps only its frames',
    );
    assert.true(errors[0].stack.length > 0, 'and keeps them');
  });
});
