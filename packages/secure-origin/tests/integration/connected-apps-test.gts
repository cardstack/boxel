import {
  click,
  find,
  findAll,
  render,
  settled,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { navigation } from '../../src/shell/navigation.js';
import { clock } from '../../src/shell/connected-apps/clock.ts';
import ConnectedAppsPage from '../../src/shell/connected-apps/connected-apps-page.gts';
import {
  setupMockServers,
  setupPageAddress,
  type Answer,
} from '../helpers/mock-servers.ts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';

// The Connected apps page, against a realm server that answers the list of
// the user's OAuth connections and ends one when asked.

const STORAGE_KEY = 'boxel-secure-session';
const SESSION = {
  token: 'window-session-token',
  user: '@person:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const LIST = 'GET _oauth-provider/connections';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const WORKSPACES = {
  id: 'https://realm-server.example.test/mcp',
  name: 'Boxel workspaces',
  scopes: [
    { name: 'boxel:read', label: 'Read' },
    { name: 'boxel:write', label: 'Change' },
  ],
};
const WORKSPACES_READ = {
  ...WORKSPACES,
  scopes: [{ name: 'boxel:read', label: 'Read' }],
};
const API = {
  id: 'https://realm-server.example.test',
  name: 'Boxel API',
  scopes: [{ name: 'boxel:read', label: 'Read' }],
};

const CLAUDE = {
  kind: 'metadata-document',
  shown: 'claude.ai',
  verified: true,
};
const CHATGPT = {
  kind: 'metadata-document',
  shown: 'chatgpt.com',
  verified: true,
};
const AGENT_NAME = 'Example agent app';
const AGENT = {
  kind: 'dynamic',
  shown: 'an app on this computer',
  verified: false,
  claimedName: AGENT_NAME,
  standIn: 'loopback',
};
const UNKNOWN = {
  kind: 'dynamic',
  shown: 'an unknown app',
  verified: false,
  standIn: 'unknown',
};

// The page's clock is pinned to midday in the browser's time zone, and every
// date the server lists is an offset from it. The page counts calendar days
// in that zone, so "2 hours ago" and "5 minutes ago" fall on the same day
// whatever zone and time of day the tests run in.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

function iso(offset: number) {
  return new Date(NOW.getTime() + offset).toISOString();
}

// The pinned time and the zone the page counts days in, for the message of
// an assertion on date wording.
function pinnedAt() {
  let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `now pinned at ${NOW.toISOString()} (${NOW.toString()}, zone ${zone})`;
}

function connection(
  id: string,
  app: object,
  more: Record<string, unknown> = {},
) {
  return {
    id,
    app,
    resources: [WORKSPACES],
    connectedAt: iso(-3 * DAY),
    lastUsedAt: iso(-2 * 60 * MINUTE),
    endsAt: iso(27 * DAY),
    renewing: true,
    ...more,
  };
}

// The connections the user has: two for claude.ai, one each for chatgpt.com
// and an app that registered itself, not kept, on this computer.
function everyApp() {
  return [
    connection('grant-claude-new', CLAUDE, { connectedAt: iso(-1 * DAY) }),
    connection('grant-claude-old', CLAUDE, {
      connectedAt: iso(-5 * DAY),
      lastUsedAt: iso(-5 * DAY),
    }),
    connection('grant-chatgpt', CHATGPT, {
      connectedAt: iso(-10 * DAY),
      resources: [WORKSPACES_READ],
    }),
    connection('grant-agent', AGENT, {
      connectedAt: iso(-5 * MINUTE),
      lastUsedAt: null,
      endsAt: iso(55 * MINUTE),
      renewing: false,
    }),
  ];
}

module('Integration | connected apps', function (hooks) {
  setupRenderingTest(hooks);
  setupPageAddress(hooks);
  let servers = setupMockServers(hooks);
  let original = { ...navigation };
  let originalNow = clock.now;
  let closed = 0;
  // What the server lists now; a disconnect takes the connection out.
  let listed: ReturnType<typeof connection>[];

  hooks.beforeEach(function () {
    closed = 0;
    navigation.close = () => {
      closed++;
    };
    listed = [];
    clock.now = () => new Date(NOW);
    localStorage.removeItem(STORAGE_KEY);
  });

  hooks.afterEach(function () {
    Object.assign(navigation, original);
    clock.now = originalNow;
    localStorage.removeItem(STORAGE_KEY);
  });

  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(
      servers.requests('realm-server').map((r) => [r.body, r.authorization]),
    ),
    SESSION.token,
    ...listed.map((c) => c.id),
    'grant-claude-new',
    'grant-claude-old',
    'grant-chatgpt',
    'grant-agent',
    'claude.ai',
    'chatgpt.com',
    AGENT_NAME,
    'Boxel workspaces',
  ]);

  function signedIn() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SESSION));
    servers.realmServer('GET _secure-session', () => ({}));
  }

  function serveList(connections: ReturnType<typeof connection>[]) {
    listed = connections;
    servers.realmServer(LIST, () => ({ connections: listed }));
  }

  function serveDisconnect(id: string, answer?: Answer) {
    servers.realmServer(`DELETE _oauth-provider/connections/${id}`, () => {
      if (answer) {
        return answer;
      }
      listed = listed.filter((c) => c.id !== id);
      return { status: 204, body: undefined };
    });
  }

  function listRequests() {
    return servers.requests('realm-server', LIST);
  }

  function disconnects() {
    return servers
      .requests('realm-server')
      .filter((r) => r.method === 'DELETE');
  }

  async function open() {
    await render(ConnectedAppsPage);
  }

  const app = (name: string) => `[data-test-connected-app="${name}"]`;
  const row = (id: string) => `[data-test-connection="${id}"]`;

  test('with no apps connected it says so', async function (assert) {
    signedIn();
    serveList([]);
    await open();
    assert
      .dom('[data-test-keys-window-title]')
      .hasText('Boxel · Connected apps');
    assert.dom('[data-test-keys-heading]').hasText('Connected apps');
    assert
      .dom('[data-test-connected-apps]')
      .includesText('Apps that can use your Boxel account.');
    assert
      .dom('[data-test-connected-apps-empty]')
      .includesText('No apps are connected to your Boxel account.')
      .includesText(
        'Apps you connect, such as Claude or ChatGPT, appear here.',
      );
    assert.dom('[data-test-connected-apps-list]').doesNotExist();
    let [request] = listRequests();
    assert.strictEqual(request?.authorization, `Bearer ${SESSION.token}`);
  });

  test("lists each app's connections under its name, newest first", async function (assert) {
    signedIn();
    serveList(everyApp());
    await open();

    assert.deepEqual(
      findAll('[data-test-connected-app-name]').map((el) =>
        el.textContent!.trim(),
      ),
      [`“${AGENT_NAME}”`, 'claude.ai · 2 connections', 'chatgpt.com'],
      'the app with the newest connection comes first',
    );
    assert.deepEqual(
      findAll(`${app('claude.ai')} [data-test-connection]`).map((el) =>
        el.getAttribute('data-test-connection'),
      ),
      ['grant-claude-new', 'grant-claude-old'],
      "an app's connections are newest first",
    );

    assert
      .dom(`${row('grant-claude-new')} [data-test-connection-resource]`)
      .hasText('Boxel workspaces · Read and change');
    assert
      .dom(`${row('grant-claude-new')} [data-test-connection-last-used]`)
      .hasText('Last used 2 hours ago', pinnedAt());
    assert
      .dom(`${row('grant-claude-old')} [data-test-connection-last-used]`)
      .hasText('Last used 5 days ago', pinnedAt());
    assert
      .dom(`${row('grant-chatgpt')} [data-test-connection-access]`)
      .hasText('Read');

    assert
      .dom(
        `${app('an app on this computer')} [data-test-connected-app-unverified]`,
      )
      .hasText('Unverified', 'an app that registered itself is unverified');
    assert
      .dom(`${app('an app on this computer')} [data-test-connected-app-note]`)
      .hasText('Returns to an app on this computer');
    assert
      .dom(`${app('claude.ai')} [data-test-connected-app-unverified]`)
      .doesNotExist();
    assert
      .dom(`${row('grant-agent')} [data-test-connection-last-used]`)
      .hasText('Never used');
    assert
      .dom(`${row('grant-agent')} [data-test-connection-connected]`)
      .hasText('Connected today', pinnedAt());
    assert
      .dom(`${row('grant-agent')} [data-test-connection-ends]`)
      .hasText('Ends in 55 min', pinnedAt());
    assert.dom('[data-test-connection-disconnect]').exists({ count: 4 });
  });

  test('a connection reaching several resources lists what it may do at each', async function (assert) {
    signedIn();
    serveList([
      connection('grant-claude-new', CLAUDE, {
        resources: [WORKSPACES, API],
      }),
    ]);
    await open();
    assert.deepEqual(
      findAll('[data-test-connection-resource]').map((el) =>
        el.textContent!.replace(/\s+/g, ' ').trim(),
      ),
      ['Boxel workspaces · Read and change', 'Boxel API · Read'],
    );
  });

  test("a connection whose end has passed isn't shown", async function (assert) {
    signedIn();
    serveList([
      connection('grant-claude-new', CLAUDE),
      connection('grant-chatgpt', CHATGPT, { endsAt: iso(-1000) }),
    ]);
    await open();
    assert.dom(row('grant-claude-new')).exists();
    assert.dom(row('grant-chatgpt')).doesNotExist();
  });

  test("disconnecting one of an app's connections ends only that one", async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-claude-new');
    await open();

    await click(`${row('grant-claude-new')} [data-test-connection-disconnect]`);
    assert
      .dom('[data-test-connected-apps-confirm]')
      .includesText('Disconnect this claude.ai connection?')
      .includesText(
        'It loses access to Boxel workspaces right away. Other connections stay as they are. To use it again, connect it from claude.ai.',
      );
    assert
      .dom('[data-test-connected-apps-cancel]')
      .isFocused('Cancel has focus, so a stray Enter cancels');
    assert.strictEqual(disconnects().length, 0, 'nothing is ended yet');

    await click('[data-test-connected-apps-confirm-disconnect]');

    let [request] = disconnects();
    assert.strictEqual(
      request?.path,
      '_oauth-provider/connections/grant-claude-new',
    );
    assert.strictEqual(request?.authorization, `Bearer ${SESSION.token}`);
    assert.strictEqual(listRequests().length, 2, 'the list is read again');
    assert.dom(row('grant-claude-new')).doesNotExist();
    assert.dom(row('grant-claude-old')).exists('the other connection stays');
    assert
      .dom(`${app('claude.ai')} [data-test-connected-app-name]`)
      .hasText('claude.ai', 'one connection left, so no count');
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('Disconnected the claude.ai connection.');
    assert
      .dom(`${row('grant-claude-old')} [data-test-connection-disconnect]`)
      .isFocused('focus goes to the connection that took its place');
  });

  test('disconnecting the last connection leaves the empty list', async function (assert) {
    signedIn();
    serveList([connection('grant-chatgpt', CHATGPT)]);
    serveDisconnect('grant-chatgpt');
    await open();
    await click('[data-test-connection-disconnect]');
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert.dom('[data-test-connected-apps-empty]').exists().isFocused();
  });

  test('Cancel and Escape leave the connection as it was', async function (assert) {
    signedIn();
    serveList(everyApp());
    await open();
    let disconnect = `${row('grant-chatgpt')} [data-test-connection-disconnect]`;

    await click(disconnect);
    await click('[data-test-connected-apps-cancel]');
    assert.dom('[data-test-connected-apps-confirm]').doesNotExist();
    assert.dom(disconnect).isFocused('focus returns to its Disconnect');

    await click(disconnect);
    await triggerKeyEvent(
      '[data-test-connected-apps-confirm]',
      'keydown',
      'Escape',
    );
    assert.dom('[data-test-connected-apps-confirm]').doesNotExist();
    assert.dom(disconnect).isFocused();
    assert.strictEqual(disconnects().length, 0);
  });

  test('an app that registered itself is named as it named itself', async function (assert) {
    signedIn();
    serveList([connection('grant-agent', AGENT)]);
    await open();
    await click('[data-test-connection-disconnect]');
    assert
      .dom('[data-test-connected-apps-confirm]')
      .includesText(`Disconnect this “${AGENT_NAME}” connection?`)
      .includesText(`To use it again, connect it from “${AGENT_NAME}”.`);
  });

  test('an app that registered itself without a name is described, not named, in a sentence', async function (assert) {
    signedIn();
    serveList([
      connection('grant-nameless', {
        kind: 'dynamic',
        shown: 'an app on this computer',
        verified: false,
        standIn: 'loopback',
      }),
    ]);
    await open();
    assert
      .dom('[data-test-connected-app-name]')
      .hasText('An app on this computer');
    await click('[data-test-connection-disconnect]');
    assert
      .dom('[data-test-connected-apps-confirm]')
      .includesText('Disconnect this connection?')
      .includesText('To use it again, connect it from the app.');
  });

  test('an app that registered itself without a name, returning to a website, is named by its domain', async function (assert) {
    signedIn();
    serveList([
      connection('grant-site', {
        kind: 'dynamic',
        shown: 'example.com',
        verified: false,
      }),
    ]);
    serveDisconnect('grant-site');
    await open();
    assert.dom('[data-test-connected-app-name]').hasText('example.com');
    assert.dom('[data-test-connected-app-unverified]').exists();
    await click('[data-test-connection-disconnect]');
    assert
      .dom('[data-test-connected-apps-confirm]')
      .includesText('Disconnect this example.com connection?')
      .includesText('To use it again, connect it from example.com.');
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('Disconnected the example.com connection.');
  });

  test("each Disconnect is described by its connection's details", async function (assert) {
    signedIn();
    serveList(everyApp());
    await open();
    let ids = new Set<string>();
    for (let button of findAll('[data-test-connection-disconnect]')) {
      let id = button.getAttribute('aria-describedby');
      assert.ok(id, 'the button is described');
      ids.add(id!);
      let details = document.getElementById(id!);
      assert.ok(
        details?.closest('[data-test-connection]')?.contains(button),
        'by the details of its own connection',
      );
      assert.ok(details?.textContent?.includes('Boxel workspaces'));
    }
    assert.strictEqual(ids.size, 4, 'each by its own');
  });

  test('disconnecting two connections of one app announces each', async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-claude-new');
    serveDisconnect('grant-claude-old');
    await open();
    let announcement = () =>
      find('[data-test-connected-apps-announcement]')!.textContent;
    await click(`${row('grant-claude-new')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    let first = announcement();
    await click(`${row('grant-claude-old')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert
      .dom('[data-test-connected-apps-announcement]')
      .includesText('Disconnected the claude.ai connection.');
    assert.notStrictEqual(
      announcement(),
      first,
      'the status changes, so it is read out again',
    );
  });

  test('a read of the list that lands late never brings back a disconnected connection', async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-chatgpt');
    await open();
    // The read the window's focus starts is held until after the disconnect,
    // and answers the list as it was before it.
    let before = [...listed];
    let release!: () => void;
    let held = new Promise<Answer>((resolve) => {
      release = () => resolve({ connections: before });
    });
    let reads = 0;
    servers.realmServer(LIST, () => {
      reads++;
      return reads === 1 ? held : { connections: listed };
    });
    window.dispatchEvent(new Event('focus'));
    await waitUntil(() => reads === 1);

    (
      find(
        `${row('grant-chatgpt')} [data-test-connection-disconnect]`,
      ) as HTMLElement
    ).click();
    await waitFor('[data-test-connected-apps-confirm-disconnect]');
    (
      find('[data-test-connected-apps-confirm-disconnect]') as HTMLElement
    ).click();
    await waitUntil(() => reads === 2 && !find(row('grant-chatgpt')));

    release();
    await settled();
    assert.dom(row('grant-chatgpt')).doesNotExist();
    assert.dom(row('grant-claude-new')).exists();
  });

  test("an app Boxel can't name is still listed and can be disconnected", async function (assert) {
    signedIn();
    serveList([connection('grant-unknown', UNKNOWN)]);
    serveDisconnect('grant-unknown');
    await open();
    assert.dom('[data-test-connected-app-name]').hasText('An unknown app');
    assert.dom('[data-test-connected-app-unverified]').exists();
    await click('[data-test-connection-disconnect]');
    assert
      .dom('[data-test-connected-apps-confirm]')
      .includesText('Disconnect this connection?')
      .includesText('To use it again, connect it from the app.');
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('Disconnected the connection.');
    assert.dom('[data-test-connected-apps-empty]').exists();
  });

  test('a disconnect the server refuses keeps the connection and says so', async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-chatgpt', {
      status: 500,
      body: { error: 'failed' },
    });
    await open();
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert.dom(row('grant-chatgpt')).exists();
    assert
      .dom('[data-test-connected-apps-disconnect-error]')
      .hasText(
        'Boxel couldn’t end this connection. Check that you’re online and try again.',
      );
    assert
      .dom('[data-test-connected-apps-confirm-disconnect]')
      .isFocused('focus stays on Disconnect, ready to try again');
    assert.strictEqual(listRequests().length, 2, 'the list is read again');
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasNoText('nothing is announced as disconnected');
  });

  test("a disconnect answered not found isn't taken for done", async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-chatgpt', {
      status: 404,
      body: { error: 'not-found' },
    });
    await open();
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert.dom(row('grant-chatgpt')).exists('the list still has it');
    assert.dom('[data-test-connected-apps-disconnect-error]').exists();
  });

  test('a refused disconnect of a connection the list no longer has closes it, and says it has ended', async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-chatgpt', {
      status: 404,
      body: { error: 'not-found' },
    });
    await open();
    // It ended some other way after the page read the list.
    listed = listed.filter((c) => c.id !== 'grant-chatgpt');
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert.dom(row('grant-chatgpt')).doesNotExist();
    assert.dom('[data-test-connected-apps-confirm]').doesNotExist();
    assert.dom('[data-test-connected-apps-disconnect-error]').doesNotExist();
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('The chatgpt.com connection has ended.');
    assert
      .dom(`${row('grant-claude-old')} [data-test-connection-disconnect]`)
      .isFocused('focus moves on, as after a disconnect');

    await click(`${row('grant-claude-old')} [data-test-connection-disconnect]`);
    assert
      .dom('[data-test-connected-apps-confirm]')
      .exists('another connection can be confirmed');
  });

  test('a connection that ends while its Disconnect is being confirmed closes the confirmation', async function (assert) {
    signedIn();
    serveList(everyApp());
    await open();
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    listed = listed.filter((c) => c.id !== 'grant-chatgpt');
    window.dispatchEvent(new Event('focus'));
    await settled();
    assert.dom(row('grant-chatgpt')).doesNotExist();
    assert.dom('[data-test-connected-apps-confirm]').doesNotExist();
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('The chatgpt.com connection has ended.');
    assert
      .dom(`${row('grant-claude-old')} [data-test-connection-disconnect]`)
      .isFocused();
    assert.strictEqual(disconnects().length, 0, 'nothing was asked to end');
  });

  test("while one disconnect is under way, another connection's can't be confirmed", async function (assert) {
    signedIn();
    serveList(everyApp());
    let release!: () => void;
    servers.realmServer(
      'DELETE _oauth-provider/connections/grant-chatgpt',
      () =>
        new Promise<Answer>((resolve) => {
          release = () => resolve({ status: 500, body: { error: 'failed' } });
        }),
    );
    await open();
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    (
      find('[data-test-connected-apps-confirm-disconnect]') as HTMLElement
    ).click();
    await waitUntil(() => disconnects().length === 1);

    (
      find(
        `${row('grant-claude-new')} [data-test-connection-disconnect]`,
      ) as HTMLElement
    ).click();
    // Anything the click changed has rendered by the next task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert
      .dom(`${row('grant-claude-new')} [data-test-connected-apps-confirm]`)
      .doesNotExist('no second confirmation opens');
    assert
      .dom(`${row('grant-chatgpt')} [data-test-connected-apps-confirm]`)
      .exists('the first stays open');

    release();
    await settled();
    assert
      .dom(
        `${row('grant-chatgpt')} [data-test-connected-apps-disconnect-error]`,
      )
      .exists('the failure shows under its own connection');
    assert
      .dom('[data-test-connected-apps-disconnect-error]')
      .exists({ count: 1 });
  });

  test('a disconnect is done when the server answers it, before the list is read again', async function (assert) {
    signedIn();
    serveList(everyApp());
    serveDisconnect('grant-chatgpt');
    await open();
    let release!: () => void;
    let reads = 0;
    servers.realmServer(LIST, () => {
      reads++;
      return new Promise<Answer>((resolve) => {
        release = () => resolve({ connections: listed });
      });
    });
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    (
      find('[data-test-connected-apps-confirm-disconnect]') as HTMLElement
    ).click();
    await waitUntil(() => reads === 1);
    await waitUntil(() => !find(row('grant-chatgpt')));
    assert
      .dom('[data-test-connected-apps-announcement]')
      .hasText('Disconnected the chatgpt.com connection.');
    assert
      .dom(`${row('grant-claude-old')} [data-test-connection-disconnect]`)
      .isFocused('focus has moved on while the list is still being read');

    release();
    await settled();
    assert.dom(row('grant-claude-old')).exists();
  });

  test('a disconnect of a connection that has ended meanwhile is done', async function (assert) {
    signedIn();
    serveList(everyApp());
    // The server answers done, and its list no longer has the connection.
    serveDisconnect('grant-chatgpt');
    await open();
    listed = listed.filter((c) => c.id !== 'grant-chatgpt');
    await click(`${row('grant-chatgpt')} [data-test-connection-disconnect]`);
    await click('[data-test-connected-apps-confirm-disconnect]');
    assert.dom(row('grant-chatgpt')).doesNotExist();
    assert.dom('[data-test-connected-apps-disconnect-error]').doesNotExist();
  });

  test('the list is read again when the window comes back into focus', async function (assert) {
    signedIn();
    serveList(everyApp());
    await open();
    listed = listed.filter((c) => c.id !== 'grant-chatgpt');
    window.dispatchEvent(new Event('focus'));
    await settled();
    assert.strictEqual(listRequests().length, 2, 'the list is read again');
    assert.dom(row('grant-chatgpt')).doesNotExist();
  });

  test("a list that can't be loaded says so in the page's own words, and can be tried again", async function (assert) {
    signedIn();
    servers.realmServer(LIST, () => ({
      status: 500,
      body: { errors: [{ detail: 'database exploded at row 42' }] },
    }));
    await open();
    assert.dom('[data-test-keys-load-failed]').exists();
    assert.dom('[data-test-keys-heading]').hasText('Connected apps');
    assert
      .dom('[data-test-error-message]')
      .hasText('Boxel couldn’t load this page.');
    assert
      .dom('[data-test-toggle-details]')
      .doesNotExist("the server's own words aren't shown");
    assert.dom('[data-test-keys-load-failed]').doesNotIncludeText('exploded');

    serveList([connection('grant-chatgpt', CHATGPT)]);
    await click('[data-test-keys-retry]');
    assert.dom(row('grant-chatgpt')).exists();
  });

  test('signed out, the window says where to sign in, and shows no apps', async function (assert) {
    await open();
    assert.dom('[data-test-keys-signed-out]').exists();
    assert
      .dom('[data-test-keys-signed-out]')
      .includesText('then open Connected apps from there.');
    assert.strictEqual(listRequests().length, 0, 'nothing is asked for');
    await click('[data-test-keys-signed-out-close]');
    assert.strictEqual(closed, 1);
    assert.ok(find('[data-test-keys-page="connected-apps"]'));
  });
});
