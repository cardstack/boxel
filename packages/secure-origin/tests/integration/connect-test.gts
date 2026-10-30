import { click, fillIn, render, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation } from '../../src/shell/navigation.js';
import ConnectPage from '../../src/shell/keys/connect-page.gts';
import ConnectedPage from '../../src/shell/keys/connected-page.gts';
import EnterKeyPage from '../../src/shell/keys/enter-key-page.gts';
import KeyPage from '../../src/shell/keys/key-page.gts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';
import { waitedFetch } from '../helpers/waiters.ts';

// OAuth on the key pages, against a realm server that answers the requests
// they make: connecting an account through an app the realm server offers,
// signing a connection in again, where the window lands once the service
// sends the user back, what the key page says of OAuth keys, and adding an
// OAuth app. Every change is made with a key write ticket the page mints with
// its own session for that change alone, just before making it.

const REALM_SERVER = 'https://realm-server.test/';
const REALM = 'https://realm-server.test/someone/workspace/';
const CARD = `${REALM}Repos/mine`;
const SESSION = {
  token: 'secure-session-token',
  user: '@someone:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const AUTHORIZE_URL =
  'https://github.com/login/oauth/authorize?client_id=Iv1.platform&state=state-from-the-server';

type Answer = { status: number; body?: unknown };
type Route = (request: {
  url: URL;
  method: string;
  body: any;
}) => Answer | Promise<Answer>;

function json(status: number, body: unknown): Answer {
  return { status, body };
}

function refusal(status: number, detail: string) {
  return json(status, { errors: [{ status, detail }] });
}

const PLATFORM_REF = {
  kind: 'platform',
  clientId: '11111111-1111-4111-8111-111111111111',
};
const SHARE_REF = {
  kind: 'share',
  shareId: '22222222-2222-4222-8222-222222222222',
};
const OWN_REF = { kind: 'own', keyId: '33333333-3333-4333-8333-333333333333' };

const CLIENTS = [
  {
    ref: PLATFORM_REF,
    kind: 'platform',
    label: 'GitHub',
    clientId: 'Iv1.platform',
    scopes: 'repo read:user',
    apiHosts: ['https://api.github.com/'],
    authorizeHost: 'github.com',
  },
  {
    ref: SHARE_REF,
    kind: 'share',
    label: 'Team GitHub App',
    clientId: 'Iv1.team',
    scopes: '',
    apiHosts: ['https://api.github.com/'],
    authorizeHost: 'github.com',
  },
  {
    ref: OWN_REF,
    kind: 'own',
    label: 'My Forge App',
    clientId: 'forge-client',
    scopes: 'read',
    apiHosts: [],
    authorizeHost: 'forge.example',
  },
];

function clientResources(clients = CLIENTS) {
  return {
    data: clients.map((attributes) => ({ type: 'oauth-client', attributes })),
  };
}

function key(id: string, name: string, more: Record<string, unknown> = {}) {
  return {
    type: 'user-key',
    id,
    attributes: {
      name,
      kind: 'static',
      state: 'active',
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
      usedWith: [],
      sharedInto: [],
      ...more,
    },
  };
}

function connection(status: string, label: string | null = 'GitHub') {
  return key('conn-1', 'Work GitHub', {
    kind: 'oauth-connection',
    oauth: {
      connection: {
        client: { kind: 'platform', label, ref: PLATFORM_REF },
        scopes: 'repo',
        status,
      },
    },
  });
}

function oauthClient(state: string, grantType = 'authorization_code') {
  return key('client-1', 'Forge app', {
    kind: 'oauth-client',
    oauth: {
      client: {
        clientId: 'forge-client-id',
        grantType,
        authorizeURL:
          grantType === 'authorization_code'
            ? 'https://forge.example/authorize'
            : null,
        tokenURL: 'https://forge.example/token',
        scopes: 'read',
        tokenAuth: 'client_secret_post',
        apiHosts: [],
        state,
      },
    },
  });
}

const DESTINATION = {
  href: 'https://api.github.com/user/repos',
  host: 'api.github.com',
  path: '/user/repos',
  registrableDomain: 'github.com',
};

function context(directWriter = true) {
  return json(200, {
    data: {
      type: 'secure-window-context',
      attributes: {
        realm: { url: REALM, name: 'Team Workspace', directWriter },
        card: { name: 'Repos', module: `${REALM}repos`, exportName: 'Repos' },
        operation: {
          name: 'listRepos',
          label: 'List repositories',
          base: 'callApi',
          method: 'GET',
          destination: DESTINATION,
          slots: [{ name: 'userKey', key: 'userKey' }],
        },
      },
    },
  });
}

module('Integration | connecting an account', function (hooks) {
  setupRenderingTest(hooks);

  let requests: { method: string; path: string; url: URL; body: any }[];
  let routes: Record<string, Route>;
  let tickets: number;
  let navigations: { how: string; url?: string }[];
  let originalFetch = window.fetch;
  let originalNavigation = { ...navigation };
  let originalURL: string;
  let meta: HTMLMetaElement;

  function serve(more: Record<string, Route>) {
    Object.assign(routes, more);
  }

  function visitShell(address: string) {
    history.replaceState(null, '', `/secure/${address}`);
  }

  function ticketRequests() {
    return requests
      .filter((r) => r.path === '_key-write-tickets')
      .map((r) => r.body.data.attributes);
  }

  function connectRequest() {
    return requests.find(
      (r) => r.method === 'POST' && r.path === '_oauth/connections',
    )?.body;
  }

  // Each test sets the page's address no more than a few times, and the
  // module puts it back once at the end: Chrome ignores
  // history.replaceState past about 100 calls in ten seconds.
  hooks.before(function () {
    originalURL = window.location.href;
  });

  hooks.after(function () {
    history.replaceState(null, '', originalURL);
  });

  hooks.beforeEach(function () {
    requests = [];
    tickets = 0;
    navigations = [];
    routes = {
      'GET _secure-session': () => ({ status: 204 }),
      'POST _key-write-tickets': () =>
        json(201, {
          data: {
            attributes: {
              ticket: `ticket-${++tickets}`,
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        }),
      'GET _oauth/clients': () => json(200, clientResources()),
      'POST _oauth/connections': () =>
        json(201, {
          data: {
            type: 'oauth-connect',
            attributes: {
              authorizeUrl: AUTHORIZE_URL,
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        }),
    };
    window.fetch = waitedFetch(
      async (
        input: Parameters<typeof fetch>[0],
        init: Parameters<typeof fetch>[1] = {},
      ) => {
        let url = new URL(String(input));
        let method = init.method ?? 'GET';
        let body = init.body ? JSON.parse(String(init.body)) : undefined;
        let path = url.pathname.replace(/^\//, '');
        requests.push({ method, path, url, body });
        let route = routes[`${method} ${path}`];
        let answer = route
          ? await route({ url, method, body })
          : refusal(404, 'Not found');
        return new Response(
          answer.status === 204 ? null : JSON.stringify(answer.body ?? {}),
          {
            status: answer.status,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        );
      },
    );
    navigation.assign = (url: string) =>
      navigations.push({ how: 'assign', url });
    navigation.replace = (url: string) =>
      navigations.push({ how: 'replace', url });
    navigation.close = () => navigations.push({ how: 'close' });
    meta = document.createElement('meta');
    meta.name = 'boxel-realm-server-url';
    meta.content = REALM_SERVER;
    document.head.append(meta);
    storeSession(SESSION);
  });

  hooks.afterEach(function () {
    window.fetch = originalFetch;
    Object.assign(navigation, originalNavigation);
    meta.remove();
    forgetSession();
  });

  // No beacon carries what a page sent or showed: a client secret, an app's
  // label or client id, a connection's name, the service's sign-in address
  // with its state, a ticket, the session's token.
  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(requests.map((r) => r.body)),
    SESSION.token,
    REALM,
    'someone/workspace',
    'state-from-the-server',
    'Team GitHub App',
    'My Forge App',
    'Iv1.platform',
    'forge-client',
    'Work GitHub',
    'Team Workspace',
    'conn-1',
  ]);

  module('the connect page', function () {
    test('opened for an operation, lists the apps that serve it with the permissions each asks for', async function (assert) {
      serve({
        'POST _secure-window/context': ({ body }) => {
          assert.deepEqual(body.data.attributes, {
            target: { kind: 'instance', url: CARD },
            operation: 'listRepos',
          });
          return context();
        },
        'GET _oauth/clients': ({ url }) => {
          assert.deepEqual(
            Object.fromEntries(url.searchParams),
            { realm: REALM, destination: DESTINATION.href },
            'asks for the apps serving the operation’s destination, in its realm',
          );
          // A workspace that shares no app for the service: Boxel's, then
          // the user's own.
          return json(200, clientResources([CLIENTS[0]!, CLIENTS[2]!]));
        },
      });
      visitShell(
        `connect#card=${encodeURIComponent(CARD)}&operation=listRepos`,
      );
      await render(ConnectPage);
      await waitFor('[data-test-connect-form]');
      assert.dom('[data-test-keys-heading]').hasText('Connect an account');
      assert
        .dom('[data-test-opened-for-operation]')
        .hasText('List repositories');
      assert.dom('[data-test-destination-domain]').hasText('github.com');

      let platform = '[data-test-client-choice="GitHub"]';
      assert.dom(`${platform} [data-test-client-owner]`).hasText('Boxel');
      assert.dom(`${platform} [data-test-client-host]`).hasText('github.com');
      assert.deepEqual(
        [
          ...document.querySelectorAll(
            `${platform} [data-test-client-permission]`,
          ),
        ].map((li) => li.textContent?.trim()),
        ['repo', 'read:user'],
        'each permission it asks for, one per line',
      );
      let own = '[data-test-client-choice="My Forge App"]';
      assert.dom(`${own} [data-test-client-owner]`).hasText('Your app');

      assert
        .dom(`${platform} input`)
        .isChecked('Boxel’s app, listed ahead of the user’s own, is chosen');
      assert.dom('[data-test-connect-name]').hasValue('GitHub');
      assert.dom('[data-test-connect-back]').doesNotExist();
      await click(`${own} input`);
      assert
        .dom('[data-test-connect-name]')
        .hasValue('My Forge App', 'named after the app until a name is typed');
      await fillIn('[data-test-connect-name]', ' Work GitHub ');
      await click(`${platform} input`);
      assert
        .dom('[data-test-connect-name]')
        .hasValue(' Work GitHub ', 'a typed name stays');
      await click('[data-test-connect-submit]');

      assert.deepEqual(ticketRequests(), [{ action: 'add' }]);
      assert.deepEqual(connectRequest(), {
        data: {
          type: 'oauth-connect',
          attributes: { client: PLATFORM_REF, name: 'Work GitHub' },
        },
        meta: { ticket: 'ticket-1' },
      });
      assert.deepEqual(
        navigations,
        [{ how: 'assign', url: AUTHORIZE_URL }],
        'the window goes to the service’s sign-in page',
      );
    });

    test('opened for an operation in a workspace that shares an app for the service, offers that app in Boxel’s place, chosen', async function (assert) {
      serve({
        'POST _secure-window/context': () => context(),
        'GET _oauth/clients': () =>
          json(200, clientResources([CLIENTS[1]!, CLIENTS[2]!])),
      });
      visitShell(
        `connect#card=${encodeURIComponent(CARD)}&operation=listRepos`,
      );
      await render(ConnectPage);
      await waitFor('[data-test-connect-form]');
      let shared = '[data-test-client-choice="Team GitHub App"]';
      assert
        .dom(`${shared} [data-test-client-owner]`)
        .hasText('Shared in Team Workspace');
      assert
        .dom(`${shared} [data-test-client-no-permissions]`)
        .hasText('No extra permissions requested');
      assert.dom(`${shared} [data-test-client-permissions]`).doesNotExist();
      assert.dom(`${shared} input`).isChecked();
      await click('[data-test-connect-submit]');
      await navigated();
      assert.deepEqual(connectRequest().data.attributes, {
        client: SHARE_REF,
        name: 'Team GitHub App',
      });
    });

    module('the app that starts out chosen', function () {
      let [platform, share, own] = CLIENTS;
      let otherShare = {
        ...share!,
        ref: { kind: 'share', shareId: '44444444-4444-4444-8444-444444444444' },
        label: 'Other Team App',
      };
      let otherService = {
        ...platform!,
        ref: {
          kind: 'platform',
          clientId: '66666666-6666-4666-8666-666666666666',
        },
        label: 'Linear',
        apiHosts: ['https://api.linear.app/'],
      };
      let otherOwn = {
        ...own!,
        ref: { kind: 'own', keyId: '55555555-5555-4555-8555-555555555555' },
        label: 'My Other App',
      };
      let cases: [string, unknown[], string[]][] = [
        ['the workspace’s one shared app', [share!, own!], ['Team GitHub App']],
        ['Boxel’s one app', [platform!, own!], ['GitHub']],
        ['none among two shared apps', [share!, otherShare, own!], []],
        [
          'none among apps for different services',
          [share!, otherService, own!],
          [],
        ],
        ['none among only the user’s own', [own!, otherOwn], []],
      ];
      for (let [name, clients, expected] of cases) {
        test(name, async function (assert) {
          serve({
            'GET _oauth/clients': () =>
              json(200, clientResources(clients as typeof CLIENTS)),
          });
          visitShell('connect');
          await render(ConnectPage);
          await waitFor('[data-test-connect-form]');
          assert.deepEqual(
            [...document.querySelectorAll('[data-test-client-choice]')]
              .filter((choice) => choice.querySelector('input')?.checked)
              .map((choice) => choice.getAttribute('data-test-client-choice')),
            expected,
          );
          if (expected.length === 0) {
            assert
              .dom('[data-test-connect-submit]')
              .isDisabled('nothing to connect through until the user picks');
          }
        });
      }
    });

    test('opened bare from the key page, asks for every app the user may use, and goes back', async function (assert) {
      serve({
        'GET _oauth/clients': ({ url }) => {
          assert.strictEqual(url.search, '', 'names no realm or destination');
          return json(200, clientResources([CLIENTS[0]!]));
        },
      });
      visitShell('connect');
      await render(ConnectPage);
      await waitFor('[data-test-connect-form]');
      assert.dom('[data-test-opened-for]').doesNotExist();
      assert
        .dom('[data-test-client-choice="GitHub"] input')
        .isChecked('a single app is chosen already');
      assert.dom('[data-test-connect-name]').hasValue('GitHub');
      await click('[data-test-connect-back]');
      assert.deepEqual(navigations, [{ how: 'replace', url: '/secure/keys' }]);
      assert.false(
        requests.some((r) => r.path === '_secure-window/context'),
        'nothing to ask the realm server about',
      );
    });

    test('a connect the server refuses says why and stays on the page', async function (assert) {
      serve({
        'POST _oauth/connections': () =>
          refusal(409, 'you already have a key named GitHub'),
      });
      visitShell('connect');
      await render(ConnectPage);
      await waitFor('[data-test-connect-form]');
      await click('[data-test-client-choice="GitHub"] input');
      await click('[data-test-connect-submit]');
      await waitFor('[data-test-keys-error]');
      assert
        .dom('[data-test-keys-error]')
        .hasText('You already have a key named GitHub.');
      assert.deepEqual(navigations, [], 'the window goes nowhere');
    });

    test('reconnecting signs the connection in again, with a ticket to replace it', async function (assert) {
      serve({
        'GET _user-keys/conn-1': () =>
          json(200, { data: connection('rejected') }),
      });
      visitShell('connect#reconnect=conn-1');
      await render(ConnectPage);
      await waitFor('[data-test-connect-form]');
      assert.dom('[data-test-keys-heading]').hasText('Reconnect an account');
      assert
        .dom('[data-test-connect-connection] [data-test-key-row-name]')
        .hasText('Work GitHub');
      assert
        .dom('[data-test-connect-name]')
        .doesNotExist('a connection keeps its name');
      assert
        .dom('[data-test-client-choice="GitHub"] input')
        .isChecked('the app it was made through is chosen already');
      assert.dom('[data-test-connect-submit]').hasText('Reconnect');
      assert.strictEqual(
        requests
          .find((r) => r.path === '_oauth/clients')
          ?.url.searchParams.get('reconnect'),
        'conn-1',
        'only the client the connection signs in through is asked for',
      );
      await click('[data-test-connect-submit]');
      assert.deepEqual(ticketRequests(), [
        { action: 'replace', keyId: 'conn-1' },
      ]);
      assert.deepEqual(connectRequest(), {
        data: {
          type: 'oauth-connect',
          attributes: { client: PLATFORM_REF, reconnect: 'conn-1' },
        },
        meta: { ticket: 'ticket-1' },
      });
      assert.deepEqual(navigations, [{ how: 'assign', url: AUTHORIZE_URL }]);
    });

    test('reconnecting a key that isn’t a connection says so and doesn’t offer to try again', async function (assert) {
      serve({
        'GET _user-keys/key-1': () =>
          json(200, { data: key('key-1', 'Weather service') }),
      });
      visitShell('connect#reconnect=key-1');
      await render(ConnectPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-keys-load-failed]')
        .includesText('This connection isn’t one of yours.');
      assert.dom('[data-test-keys-retry]').doesNotExist();
    });

    test('with no app for the service, a reader who isn’t a direct writer is told who can share one', async function (assert) {
      serve({
        'POST _secure-window/context': () => context(false),
        'GET _oauth/clients': () => json(200, clientResources([])),
      });
      visitShell(
        `connect#card=${encodeURIComponent(CARD)}&operation=listRepos`,
      );
      await render(ConnectPage);
      await waitFor('[data-test-connect-no-clients]');
      assert
        .dom('[data-test-connect-no-clients]')
        .includesText('No sign-in app is set up for this site.');
      assert
        .dom('[data-test-connect-needs-admin]')
        .hasText(
          'Someone with direct write access to Team Workspace (realm-server.test/someone/workspace/) needs to share one with it.',
        );
      assert.dom('[data-test-connect-submit]').doesNotExist();
      assert.dom('input').doesNotExist('nothing to type');
    });

    test('with no app at all, a direct writer is told to add one', async function (assert) {
      serve({ 'GET _oauth/clients': () => json(200, clientResources([])) });
      visitShell('connect');
      await render(ConnectPage);
      await waitFor('[data-test-connect-no-clients]');
      assert.dom('[data-test-connect-needs-admin]').doesNotExist();
      assert
        .dom('[data-test-connect-no-clients]')
        .includesText('Add one on your key page');
    });

    test('a list of apps that fails to load offers to try again', async function (assert) {
      let failing = true;
      serve({
        'GET _oauth/clients': () =>
          failing ? refusal(503, 'unavailable') : json(200, clientResources()),
      });
      visitShell('connect');
      await render(ConnectPage);
      await waitFor('[data-test-keys-load-failed]');
      failing = false;
      await click('[data-test-keys-retry]');
      await waitFor('[data-test-connect-form]');
      assert.dom('[data-test-client-choice]').exists({ count: 3 });
    });
  });

  module('back from the service', function () {
    test('connected, names the connection and takes the outcome out of the address bar', async function (assert) {
      serve({
        'GET _user-keys/conn-1': () =>
          json(200, { data: connection('active') }),
      });
      visitShell('connected#connected=conn-1');
      await render(ConnectedPage);
      await waitFor('[data-test-connected="connected"]');
      assert.dom('[data-test-keys-heading]').hasText('Connected');
      assert.dom('[data-test-connected-name]').hasText('Work GitHub');
      assert.strictEqual(window.location.hash, '', 'the fragment is gone');
      assert.strictEqual(window.location.pathname, '/secure/connected');
      await click('[data-test-connected-close]');
      await click('[data-test-connected-keys]');
      assert.deepEqual(navigations, [
        { how: 'close' },
        { how: 'assign', url: '/secure/keys' },
      ]);
    });

    test('finishes a sign-in from the service’s code with the window’s own session', async function (assert) {
      serve({
        'POST _oauth/connections/complete': () =>
          json(201, {
            data: {
              type: 'oauth-connection-result',
              attributes: { connected: 'conn-1', reconnected: false },
            },
          }),
        'GET _user-keys/conn-1': () =>
          json(200, { data: connection('active') }),
      });
      visitShell('connected#code=one-use-code&state=sign-in-state');
      await render(ConnectedPage);
      await waitFor('[data-test-connected="connected"]');
      let completed = requests.find(
        (r) => r.path === '_oauth/connections/complete',
      );
      assert.deepEqual(completed?.body, {
        data: {
          type: 'oauth-callback',
          attributes: { state: 'sign-in-state', code: 'one-use-code' },
        },
      });
      assert.dom('[data-test-connected-name]').hasText('Work GitHub');
      assert.strictEqual(window.location.hash, '', 'the code is gone');
    });

    test('a sign-in the CLI started is handed back to it once the user confirms, with no session of the window’s', async function (assert) {
      serve({ 'GET _secure-session': () => ({ status: 401 }) });
      let submitted: { action: string; fields: [string, string][] }[] = [];
      let submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push({
          action: this.action,
          fields: [...new FormData(this).entries()] as [string, string][],
        });
      };
      try {
        visitShell(
          `connected#code=one-use-code&state=sign-in-state&cli_port=51234&cli_state=${'c'.repeat(32)}`,
        );
        await render(ConnectedPage);
        await waitFor('[data-test-connected-cli-continue]');
        assert.strictEqual(window.location.hash, '', 'the code is gone');
        assert.deepEqual(submitted, [], 'nothing leaves before the user says');
        await click('[data-test-connected-cli-continue]');
        assert.deepEqual(submitted, [
          {
            action: 'http://127.0.0.1:51234/callback',
            fields: [
              ['state', 'c'.repeat(32)],
              ['oauth_code', 'one-use-code'],
              ['oauth_state', 'sign-in-state'],
            ],
          },
        ]);
        assert.notOk(
          requests.some((r) => r.path === '_oauth/connections/complete'),
          'the window finishes nothing itself',
        );
        assert
          .dom('[data-test-secure-title]')
          .hasText('Returning to your terminal…');
      } finally {
        HTMLFormElement.prototype.submit = submit;
      }
    });

    test('a sign-in the CLI started that the service declined tells the CLI why', async function (assert) {
      let submitted: [string, string][][] = [];
      let submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push([...new FormData(this).entries()] as [string, string][]);
      };
      try {
        visitShell(
          `connected#error=denied&cli_port=51234&cli_state=${'c'.repeat(32)}`,
        );
        await render(ConnectedPage);
        await click('[data-test-connected-cli-continue]');
        assert.deepEqual(submitted, [
          [
            ['state', 'c'.repeat(32)],
            ['oauth_error', 'denied'],
          ],
        ]);
      } finally {
        HTMLFormElement.prototype.submit = submit;
      }
    });

    test('a sign-in the realm server won’t finish for this user says it expired', async function (assert) {
      serve({
        'POST _oauth/connections/complete': () =>
          json(200, {
            data: {
              type: 'oauth-connection-result',
              attributes: { error: 'expired' },
            },
          }),
      });
      visitShell('connected#code=one-use-code&state=someone-elses');
      await render(ConnectedPage);
      await waitFor('[data-test-connected="failed"]');
      assert.dom('[data-test-keys-heading]').hasText('The sign-in expired');
    });

    test('connected, but the connection’s name can’t be read, still says it is connected', async function (assert) {
      serve({
        'GET _user-keys/conn-1': () => refusal(503, 'unavailable'),
      });
      visitShell('connected#connected=conn-1');
      await render(ConnectedPage);
      await waitFor('[data-test-connected="connected"]');
      assert
        .dom('[data-test-connected-message]')
        .includesText('Your account is connected.');
    });

    test('each way a sign-in fails is said in plain words', async function (assert) {
      for (let [error, heading] of [
        ['expired', 'The sign-in expired'],
        ['denied', 'The sign-in was declined'],
        ['failed', 'The sign-in didn’t finish'],
        ['name-taken', 'That name is taken'],
        ['something-new', 'The sign-in didn’t finish'],
      ]) {
        visitShell(`connected#error=${error}`);
        await render(ConnectedPage);
        await waitFor('[data-test-connected="failed"]');
        assert.dom('[data-test-keys-heading]').hasText(heading!, error);
        assert.strictEqual(window.location.hash, '', `${error}: no fragment`);
      }
      assert.false(
        requests.some((r) => r.path.startsWith('_user-keys')),
        'no key is asked for',
      );
    });

    test('a link that says nothing of a sign-in says so', async function (assert) {
      visitShell('connected');
      await render(ConnectedPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-keys-load-failed]')
        .includesText('This link doesn’t say how a sign-in ended.');
      assert.dom('[data-test-keys-retry]').doesNotExist();
    });
  });

  module('OAuth keys on the key page', function () {
    test('a connection whose sign-in was revoked offers Reconnect, and none is replaced', async function (assert) {
      serve({
        'GET _user-keys': () => json(200, { data: [connection('rejected')] }),
      });
      visitShell('keys');
      await render(KeyPage);
      let row = '[data-test-key-row="Work GitHub"]';
      await waitFor(row);
      assert.dom(`${row} [data-test-key-kind]`).hasText('Connected account');
      assert
        .dom(`${row} [data-test-oauth-connection-client]`)
        .hasText('Signs in with GitHub');
      assert
        .dom(`${row} [data-test-oauth-status="rejected"]`)
        .includesText('Your sign-in expired or was cancelled on the site.');
      assert
        .dom(`${row} [data-test-key-replace]`)
        .doesNotExist('a connection is signed in again, not replaced');
      await click(`${row} [data-test-key-reconnect]`);
      assert.deepEqual(navigations, [
        { how: 'assign', url: '/secure/connect#reconnect=conn-1' },
      ]);
    });

    test('a connection whose app is broken says it needs an administrator', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(200, { data: [connection('needs-admin', null)] }),
      });
      visitShell('keys');
      await render(KeyPage);
      let row = '[data-test-key-row="Work GitHub"]';
      await waitFor(row);
      assert
        .dom(`${row} [data-test-oauth-status="needs-admin"]`)
        .includesText('needs its owner to fix it');
      assert.dom(`${row} [data-test-key-reconnect]`).doesNotExist();
      assert
        .dom(`${row} [data-test-oauth-connection-client]`)
        .hasText('Signs in with an app that is no longer available');
    });

    test('an OAuth app gives its client id and grant, and says when its secret was refused', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(200, {
            data: [
              oauthClient('broken'),
              {
                ...oauthClient('active', 'client_credentials'),
                id: 'client-2',
                attributes: {
                  ...oauthClient('active', 'client_credentials').attributes,
                  name: 'Robot app',
                },
              },
            ],
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      let broken = '[data-test-key-row="Forge app"]';
      await waitFor(broken);
      assert.dom(`${broken} [data-test-key-kind]`).hasText('Sign-in app');
      assert
        .dom(`${broken} [data-test-oauth-client-id]`)
        .hasText('forge-client-id');
      assert
        .dom(`${broken} [data-test-oauth-client-grant]`)
        .doesNotExist('people signing in is what an app is for');
      assert
        .dom(`${broken} [data-test-oauth-status="broken"]`)
        .includesText('The site refused this app’s secret.');
      assert.dom(`${broken} [data-test-key-replace]`).exists();
      let robot = '[data-test-key-row="Robot app"]';
      assert
        .dom(`${robot} [data-test-oauth-client-grant]`)
        .hasText('· Signs in as itself, with no person’s account');
      assert.dom(`${robot} [data-test-oauth-status]`).doesNotExist();
    });

    test('Connect an account goes to the connect page', async function (assert) {
      serve({ 'GET _user-keys': () => json(200, { data: [] }) });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-page-connect]');
      await click('[data-test-key-page-connect]');
      assert.deepEqual(navigations, [
        { how: 'assign', url: '/secure/connect' },
      ]);
    });
  });

  module('adding an OAuth app', function () {
    function added() {
      return json(201, {
        data: {
          type: 'user-key',
          id: 'client-9',
          attributes: {
            name: 'Forge app',
            kind: 'oauth-client',
            state: 'active',
            createdAt: '2026-10-01T12:00:00.000Z',
            updatedAt: '2026-10-01T12:00:00.000Z',
          },
        },
      });
    }

    test('adds its settings beside its secret, with a ticket to add a key', async function (assert) {
      serve({ 'POST _user-keys': added });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert.dom('[data-test-oauth-client-id-input]').doesNotExist();
      await click('[data-test-radio-choice="oauth-client"] input');
      await click('[data-test-radio-choice="other"] input');
      assert.dom('[data-test-oauth-github-steps]').doesNotExist();
      assert.dom('[data-test-key-field="value"]').includesText('Client secret');
      assert.dom('[data-test-key-value]').hasAttribute('type', 'password');
      assert
        .dom('[data-test-radio-choice="client_secret_post"] input')
        .isChecked('the secret goes in the request body unless told otherwise');

      await fillIn('[data-test-key-name]', 'Forge app');
      await fillIn('[data-test-oauth-client-id-input]', ' forge-client-id ');
      await fillIn('[data-test-key-value]', 'forge-client-secret-value');
      await fillIn(
        '[data-test-oauth-authorize-url]',
        'https://forge.example/authorize',
      );
      assert
        .dom('[data-test-enter-key-save]')
        .isDisabled('a token URL is needed');
      await fillIn(
        '[data-test-oauth-token-url]',
        'https://forge.example/token',
      );
      await fillIn('[data-test-oauth-scopes]', ' read repo ');
      await click('[data-test-radio-choice="client_secret_basic"] input');
      await fillIn(
        '[data-test-oauth-api-hosts]',
        'https://api.forge.example/\n\n  https://uploads.forge.example/  \n',
      );
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');

      assert.deepEqual(ticketRequests(), [{ action: 'add' }]);
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body,
        {
          data: {
            type: 'user-key',
            attributes: {
              name: 'Forge app',
              kind: 'oauth-client',
              value: 'forge-client-secret-value',
              oauth: {
                clientId: 'forge-client-id',
                grantType: 'authorization_code',
                authorizeUrl: 'https://forge.example/authorize',
                tokenUrl: 'https://forge.example/token',
                scopes: 'read repo',
                tokenAuth: 'client_secret_basic',
                apiHosts: [
                  'https://api.forge.example/',
                  'https://uploads.forge.example/',
                ],
              },
            },
          },
          meta: { ticket: 'ticket-1' },
        },
      );
      assert.dom('[data-test-keys-done]').includesText('Your sign-in app');
    });

    test('for GitHub, says how to create the app and fills in GitHub’s settings', async function (assert) {
      serve({ 'POST _user-keys': added });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await click('[data-test-radio-choice="oauth-client"] input');
      assert
        .dom('[data-test-radio-choice="github"] input')
        .isChecked('GitHub is the first choice');
      assert
        .dom('[data-test-oauth-github-steps]')
        .includesText('create a GitHub App');
      assert
        .dom('[data-test-oauth-callback-url]')
        .hasText(`${REALM_SERVER}_oauth/callback`);
      assert
        .dom('[data-test-oauth-token-url]')
        .doesNotExist('nothing technical to fill in');
      await fillIn('[data-test-key-name]', 'Team GitHub');
      await fillIn('[data-test-oauth-client-id-input]', 'Iv23.team');
      await fillIn('[data-test-key-value]', 'github-client-secret');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body.data.attributes.oauth,
        {
          clientId: 'Iv23.team',
          grantType: 'authorization_code',
          authorizeUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          tokenAuth: 'client_secret_post',
          apiHosts: ['https://api.github.com/'],
        },
      );
    });

    test('an app no person signs in through takes no authorization URL', async function (assert) {
      serve({ 'POST _user-keys': added });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await click('[data-test-radio-choice="oauth-client"] input');
      await click('[data-test-radio-choice="other"] input');
      assert.dom('[data-test-oauth-authorize-url]').exists();
      await click('[data-test-radio-choice="client_credentials"] input');
      assert.dom('[data-test-oauth-authorize-url]').doesNotExist();
      await fillIn('[data-test-key-name]', 'Robot app');
      await fillIn('[data-test-oauth-client-id-input]', 'robot-client-id');
      await fillIn('[data-test-key-value]', 'robot-client-secret');
      await fillIn(
        '[data-test-oauth-token-url]',
        'https://forge.example/token',
      );
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body.data.attributes.oauth,
        {
          clientId: 'robot-client-id',
          grantType: 'client_credentials',
          tokenUrl: 'https://forge.example/token',
          tokenAuth: 'client_secret_post',
        },
        'no authorization URL, scopes or API hosts',
      );
    });
  });
});
