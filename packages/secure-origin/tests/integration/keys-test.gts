import {
  click,
  fillIn,
  find,
  render,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation, noteDocumentAddress } from '../../src/shell/navigation.js';
import EnterKeyPage from '../../src/shell/keys/enter-key-page.gts';
import KeyPage from '../../src/shell/keys/key-page.gts';
import { openedFor } from '../../src/shell/keys/opened-for.ts';
import SharePage from '../../src/shell/keys/share-key-page.gts';
import SwapKeyPage from '../../src/shell/keys/swap-key-page.gts';
import ReplaceKeyPage from '../../src/shell/keys/replace-key-page.gts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';
import { setupWaitedBrowserWork, waitedFetch } from '../helpers/waiters.ts';

// The key pages, against a realm server that answers the requests they make.
// Every change to a key is made with a key write ticket the page mints with
// its own session for that change alone, just before making it.

const REALM_SERVER = 'https://realm-server.test/';
const REALM = 'https://realm-server.test/someone/workspace/';
// The same realm named in prefix form, as a page may open the window with it.
// The server answers with the realm's URL, and the page acts on that answer.
const REALM_PREFIX = '@someone/workspace/';
const CARD = `${REALM}Weather/today`;
const SESSION = {
  token: 'secure-session-token',
  user: '@someone:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
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

function refusal(status: number, detail: string) {
  return json(status, { errors: [{ status, detail }] });
}

const KEYS = [
  {
    id: 'key-1',
    name: 'Weather service',
    kind: 'static',
    state: 'active',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    anonymous: false,
    anonymousDailyCap: null as number | null,
    anonymousMonthlyCap: null as number | null,
    usedWith: ['github.com', 'openweathermap.org'],
    sharedInto: [
      {
        url: 'https://realm-server.test/someone/dashboard/',
        name: 'Dashboard',
        shares: [
          {
            id: 'share-dash',
            label: 'Weather',
            state: 'active',
            approvedCalls: 4,
          },
        ],
      },
      {
        url: 'https://realm-server.test/someone/workspace/',
        name: 'Team',
        shares: [
          {
            id: 'share-team-1',
            label: 'Weather',
            state: 'active',
            approvedCalls: 0,
          },
          {
            id: 'share-team-2',
            label: 'Team weather',
            state: 'suspended',
            approvedCalls: 0,
          },
        ],
      },
      {
        url: 'https://realm-server.test/someone/old-team/',
        name: null,
        shares: [
          {
            id: 'share-old',
            label: 'Weather',
            state: 'suspended',
            approvedCalls: 1,
          },
        ],
      },
    ] as {
      url: string;
      name: string | null;
      shares: {
        id: string;
        label: string;
        state: string;
        approvedCalls: number;
      }[];
    }[],
  },
  {
    id: 'key-2',
    name: 'Maps',
    kind: 'static',
    state: 'active',
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
    anonymous: false,
    anonymousDailyCap: null as number | null,
    anonymousMonthlyCap: null as number | null,
    usedWith: [] as string[],
    sharedInto: [] as {
      url: string;
      name: string | null;
      shares: {
        id: string;
        label: string;
        state: string;
        approvedCalls: number;
      }[];
    }[],
  },
];

// A key's attributes, as the server sends them: without its id.
function attributesOf({ id: _id, ...attributes }: (typeof KEYS)[number]) {
  return attributes;
}

function keyResources(keys = KEYS) {
  return {
    data: keys.map(({ id, ...attributes }) => ({
      type: 'user-key',
      id,
      attributes,
    })),
  };
}

function context(attributes: Record<string, unknown>) {
  return json(200, {
    data: { type: 'secure-window-context', attributes },
  });
}

const WORKSPACE = {
  url: REALM,
  name: 'Team Workspace',
  directWriter: true,
  opensToAnonymous: false,
};

// A Google service account's JSON key file, as Google issues it. The page
// only reads its type and email; the key itself is a placeholder.
const SERVICE_ACCOUNT_FILE = JSON.stringify(
  {
    type: 'service_account',
    project_id: 'boxel-test',
    private_key_id: 'kid-1',
    private_key:
      '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
    client_email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
  },
  null,
  2,
);

type QUnitAssert = Parameters<Parameters<typeof test>[1]>[0];

// Asserts the Scopes field holds these scopes one per line and is tall enough
// to show every one of them without scrolling.
function assertShowsEveryScope(assert: QUnitAssert, scopes: string[]) {
  assert
    .dom('[data-test-service-account-scopes]')
    .hasValue(scopes.join('\n'), 'each scope is on a line of its own');
  let field = document.querySelector<HTMLTextAreaElement>(
    '[data-test-service-account-scopes]',
  )!;
  assert.ok(
    field.scrollHeight <= field.clientHeight + 1,
    `the field shows all ${scopes.length} scopes without scrolling (${field.scrollHeight}px of content in ${field.clientHeight}px)`,
  );
}

// Chooses a key file. The module waits on file reads
// (`setupWaitedBrowserWork`), so this returns once the page has read it.
// Choosing a file and typing, without settling: for a test that holds a
// request open, where `triggerEvent` and `fillIn` would wait on it.
function chooseKeyFileNow(contents: string, name = 'boxel-test.json') {
  let input = document.querySelector<HTMLInputElement>(
    '[data-test-service-account-file]',
  )!;
  let files = new DataTransfer();
  files.items.add(new File([contents], name, { type: 'application/json' }));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function typeNow(selector: string, text: string) {
  let input = document.querySelector<HTMLInputElement>(selector)!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function chooseKeyFile(contents: string, name = 'boxel-test.json') {
  await triggerEvent('[data-test-service-account-file]', 'change', {
    files: [new File([contents], name, { type: 'application/json' })],
  });
}

// The workspace picker is Pret UI's Select: its trigger, and the options of
// its list, which renders in the dropdown's wormhole.
const WORKSPACE_TRIGGER =
  '[data-test-workspace-dropdown] [data-test-pretui-select-trigger]';
const OPTION_META = '[data-test-pretui-select-option-meta]';

// The options of the open workspace list, which renders outside the test's
// root element: those of the listbox the open list's search field controls,
// since a list just closed can still be leaving the page.
function workspaceOptions(): HTMLElement[] {
  let listbox = workspaceSearch()?.getAttribute('aria-controls');
  return listbox
    ? [
        ...document.querySelectorAll<HTMLElement>(
          `#${CSS.escape(listbox)} [role="option"]`,
        ),
      ]
    : [];
}

// The option of the open workspace list named `name`.
function workspaceOption(name: string): HTMLElement {
  let option = workspaceOptions().find(
    (o) =>
      o
        .querySelector('[data-test-pretui-select-option]')
        ?.textContent?.trim() === name,
  );
  if (!option) {
    throw new Error(`no workspace option named ${name}`);
  }
  return option;
}

// The open workspace list's search field: the last one, since a list just
// closed can still be leaving the page.
function workspaceSearch(): HTMLElement {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-select-search-input]',
    ),
  ].at(-1)!;
}

// The option the search field names as highlighted.
function activeOption(): HTMLElement | null {
  return document.getElementById(
    workspaceSearch().getAttribute('aria-activedescendant') ?? '',
  );
}

module('Integration | key pages', function (hooks) {
  setupRenderingTest(hooks);
  setupWaitedBrowserWork(hooks);

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

  function visitShell(query: string) {
    history.replaceState(null, '', `/secure/${query}`);
  }

  function ticketRequests() {
    return requests
      .filter((r) => r.path === '_key-write-tickets')
      .map((r) => r.body.data.attributes);
  }

  // Each test sets the page's address once, and the module puts it back once
  // at the end: Chrome ignores history.replaceState past about 100 calls in
  // ten seconds, and a suite that spent its allowance would leave the next
  // module's addresses unset.
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
      'GET _user-keys': () => json(200, keyResources()),
      'GET _key-bindings': () => json(200, { data: [] }),
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
    sessionStorage.clear();
  });

  hooks.afterEach(function () {
    window.fetch = originalFetch;
    Object.assign(navigation, originalNavigation);
    meta.remove();
    forgetSession();
    sessionStorage.clear();
  });

  // No beacon carries what a key page sent or showed: a key's value, name or
  // id, a share's label or id, a workspace's name or address, a ticket, the
  // session's token.
  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(requests.map((r) => r.body)),
    SESSION.token,
    REALM,
    REALM_PREFIX,
    'someone/workspace',
    'someone/dashboard',
    'Weather service',
    'Team Workspace',
    'Team weather',
    'Team maps',
    'Get the forecast',
    '"key-1"',
    '"key-2"',
    '"share-1"',
    '"share-4"',
    '"share-9"',
  ]);

  module('what a page was opened for', function () {
    test('reads its realm, card, operation and reason from the fragment', function (assert) {
      assert.deepEqual(
        openedFor(
          `#card=${encodeURIComponent(CARD)}&operation=forecast&reason=${encodeURIComponent('Needs\nyour   key')}`,
        ),
        {
          target: { kind: 'instance', url: CARD },
          operation: 'forecast',
          reason: 'Needs your key',
        },
      );
      assert.deepEqual(
        openedFor(
          `#module=${encodeURIComponent(`${REALM}weather`)}&name=Weather&realm=${encodeURIComponent(REALM)}&operation=forecast`,
        ),
        {
          realm: REALM,
          target: {
            kind: 'type',
            module: `${REALM}weather`,
            name: 'Weather',
            realm: REALM,
          },
          operation: 'forecast',
        },
      );
      assert.deepEqual(
        openedFor(
          `#card=${encodeURIComponent('@cardstack/catalog/weather/today')}&operation=forecast`,
        ),
        {
          target: { kind: 'instance', url: '@cardstack/catalog/weather/today' },
          operation: 'forecast',
        },
        'a prefix-form id is passed on for the server to resolve',
      );
      assert.deepEqual(openedFor('#key=key-2'), { key: 'key-2' });
      assert.deepEqual(
        openedFor('#realm=javascript%3Aalert(1)&card=data%3Atext%2Fhtml,x'),
        {},
        'only http(s) URLs and prefix-form ids name anything',
      );
      let long = openedFor(`#reason=${'a'.repeat(500)}`).reason!;
      assert.strictEqual([...long].length, 200, 'a reason is one short line');
      assert.true(long.endsWith('…'));
    });
  });

  module('the window', function () {
    test('opened without a session, says to sign in to Boxel, and offers no sign-in of its own', async function (assert) {
      forgetSession();
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-keys-signed-out]');
      assert.dom('[data-test-keys-heading]').hasText('You’re not signed in');
      assert
        .dom('[data-test-keys-signed-out]')
        .includesText('Sign in to Boxel in the Boxel window you opened this');
      assert.dom('input').doesNotExist('nothing to type');
      assert.dom('[data-test-key-page]').doesNotExist();
      assert.false(
        requests.some((r) => r.path === '_user-keys'),
        'nothing is asked for',
      );
    });

    test('signed out while open, stops and offers no sign-in of its own', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');

      // Another window on this origin forgets the session, as the app's
      // sign-out does through this origin's sign-out page.
      forgetSession();
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'boxel-secure-session' }),
      );
      await waitFor('[data-test-keys-signed-out]');
      assert.dom('[data-test-keys-heading]').hasText('You’re signed out');
      assert.dom('[data-test-key-page]').doesNotExist();
      assert.dom('input').doesNotExist();
      await click('[data-test-keys-signed-out-close]');
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('a request the server refuses as signed out stops the window', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      serve({
        'POST _key-write-tickets': () =>
          refusal(403, 'key write tickets are issued only to a session'),
        'GET _secure-session': () => refusal(401, 'signed out'),
      });
      await click('[data-test-key-row="Maps"] [data-test-key-replace]');
      await fillIn('[data-test-key-value]', 'new-value');
      await click('[data-test-key-replace-save]');
      await waitFor('[data-test-keys-signed-out]');
      assert.dom('[data-test-keys-heading]').hasText('You’re signed out');
    });

    test('a session past its end is renewed, while the app session it handed over lasts, and opens signed in', async function (assert) {
      let lapsed = { ...SESSION, expiresAt: '2000-01-01T00:00:00.000Z' };
      let renewed = {
        token: 'renewed-session-token',
        user: SESSION.user,
        expiresAt: '2099-01-08T00:00:00.000Z',
      };
      storeSession(lapsed);
      serve({
        'POST _secure-session/renewal': () =>
          json(201, { data: { type: 'secure-session', attributes: renewed } }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      assert.deepEqual(
        JSON.parse(localStorage.getItem('boxel-secure-session') ?? 'null'),
        renewed,
        'the renewed session is kept',
      );
      assert.false(
        requests.some(
          (r) => r.path === '_secure-session' && r.method === 'GET',
        ),
        'renewing is the check',
      );
    });

    test('a session past its end that isn’t renewed says to sign in to Boxel', async function (assert) {
      storeSession({ ...SESSION, expiresAt: '2000-01-01T00:00:00.000Z' });
      serve({
        'POST _secure-session/renewal': () =>
          json(401, {
            errors: [
              { status: '401', code: 'signed-out', detail: 'signed out' },
            ],
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-keys-signed-out]');
      assert.strictEqual(
        localStorage.getItem('boxel-secure-session'),
        null,
        'the ended session is forgotten',
      );
    });

    test('a request refused as signed out is made again under a renewed session', async function (assert) {
      let renewed = {
        token: 'renewed-session-token',
        user: SESSION.user,
        expiresAt: '2099-01-08T00:00:00.000Z',
      };
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      let refusedOnce = false;
      serve({
        'POST _key-write-tickets': () => {
          if (!refusedOnce) {
            refusedOnce = true;
            return refusal(401, 'the token has expired');
          }
          return json(201, {
            data: {
              attributes: {
                ticket: 'ticket-after-renewal',
                expiresAt: '2099-01-01T00:00:00.000Z',
              },
            },
          });
        },
        'POST _secure-session/renewal': () =>
          json(201, { data: { type: 'secure-session', attributes: renewed } }),
        'PATCH _user-keys/key-2': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-2',
              attributes: attributesOf(KEYS[1]),
            },
          }),
      });
      await click('[data-test-key-row="Maps"] [data-test-key-replace]');
      await fillIn('[data-test-key-value]', 'new-value');
      await click('[data-test-key-replace-save]');
      assert.dom('[data-test-keys-signed-out]').doesNotExist();
      assert.strictEqual(
        requests.filter((r) => r.path === '_key-write-tickets').length,
        2,
        'the ticket is asked for again',
      );
      assert.deepEqual(
        JSON.parse(localStorage.getItem('boxel-secure-session') ?? 'null'),
        renewed,
      );
    });

    test('a session far from its end is checked, not renewed', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      assert.false(
        requests.some((r) => r.path === '_secure-session/renewal'),
        'no renewal',
      );
    });

    test('the Close button closes the window', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-page]');
      await click('[data-test-keys-close]');
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });
  });

  module('the key page', function () {
    test('a key list that fails to load offers to try again, rather than reading as no keys', async function (assert) {
      let attempts = 0;
      serve({
        'GET _user-keys': () =>
          ++attempts === 1
            ? refusal(503, 'the server is unavailable')
            : json(200, keyResources()),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-keys-heading]')
        .hasText('Your keys', 'the page keeps its own title');
      assert
        .dom('[data-test-error-message]')
        .hasText('Boxel couldn’t load this page.');
      assert.dom('[data-test-error-details]').doesNotExist();
      await click('[data-test-toggle-details]');
      assert.dom('[data-test-error-detail="Status"]').hasText('503');
      assert
        .dom('[data-test-error-detail="Message"]')
        .hasText('The server is unavailable.');
      assert.dom('[data-test-key-list-empty]').doesNotExist();
      assert.dom('[data-test-key-page-add]').doesNotExist();
      await click('[data-test-keys-retry]');
      await waitFor('[data-test-key-row="Maps"]');
      assert.dom('[data-test-key-row]').exists({ count: 2 });
    });

    test('a server that can’t be reached is said so', async function (assert) {
      serve({
        'GET _user-keys': () => {
          throw new TypeError('Failed to fetch');
        },
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-error-message]')
        .hasText(
          'Boxel couldn’t be reached. Check your connection and try again.',
        );
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-detail="Error"]')
        .hasText('Boxel could not be reached.');
      assert.dom('[data-test-error-detail="Status"]').doesNotExist();
    });

    test('lists what workspaces opened the user’s keys to people who aren’t signed in, and offers to allow a key that doesn’t', async function (assert) {
      let notice = (
        id: string,
        attributes: Record<string, unknown>,
      ): Record<string, unknown> => ({
        type: 'key-policy-notice',
        id,
        attributes: {
          realm: REALM,
          policy: `${REALM}policies/team`,
          savedBy: '@admin:example.test',
          createdAt: '2026-11-01T12:00:00.000Z',
          ...attributes,
        },
      });
      serve({
        'GET _key-policy-notices': () =>
          json(200, {
            data: [
              notice('2', {
                share: 'share-team-2',
                label: 'Team weather',
                key: 'key-1',
                reason: 'visitors-wanted',
                operations: [`${REALM}weather#Weather.alerts`],
              }),
              notice('1', {
                share: 'share-team-1',
                label: 'Weather',
                key: 'key-1',
                reason: 'visitors-use',
                operations: [`${REALM}weather#Weather.forecast`],
              }),
              notice('0', {
                share: 'share-gone',
                label: 'Deleted',
                key: null,
                reason: 'visitors-wanted',
                operations: [`${REALM}weather#Weather.alerts`],
              }),
            ],
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-policy-requests]');
      assert
        .dom('[data-test-key-policy-requests] [data-test-key-policy-notice]')
        .exists(
          { count: 1 },
          'only the request still waiting on an answer asks for one: a deleted key’s is settled',
        );
      assert
        .dom('[data-test-key-policy-requests]')
        .containsText('Action needed')
        .containsText('wants people who aren’t signed in to use your key')
        .containsText('Team weather');
      assert
        .dom(
          '[data-test-key-policy-notices] [data-test-key-policy-notice="Weather"]',
        )
        .containsText('now use')
        .containsText('Weather.forecast');
      assert
        .dom(
          '[data-test-key-policy-notices] [data-test-key-policy-notice-allow]',
        )
        .doesNotExist('a key visitors already use asks for nothing');
      await click('[data-test-key-policy-notice-allow]');
      assert
        .dom('[data-test-key-anonymous-use-form]')
        .exists('allowing it opens the key’s own setting');
      assert
        .dom(
          '[data-test-key-anonymous-use-form] [data-test-anonymous-use-input]',
        )
        .isChecked('already set to allow it, so one Save finishes it');
    });

    test('the notices the page lists are marked read, so the app’s badge for them clears', async function (assert) {
      let notice = (id: string, readAt: string | null) => ({
        type: 'key-policy-notice',
        id,
        attributes: {
          realm: REALM,
          share: `share-${id}`,
          label: `Shared ${id}`,
          key: 'key-1',
          policy: `${REALM}policies/team`,
          savedBy: null,
          reason: 'visitors-use',
          operations: [`${REALM}weather#Weather.forecast`],
          declinedAt: null,
          readAt,
          createdAt: '2026-11-01T12:00:00.000Z',
        },
      });
      serve({
        'GET _key-policy-notices': () =>
          json(200, {
            data: [
              notice('9', null),
              notice('8', null),
              notice('4', '2026-10-30T09:00:00.000Z'),
            ],
            meta: { unread: 2 },
          }),
        'POST _key-policy-notices/read': () =>
          json(200, { meta: { marked: 2, unread: 0 } }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-policy-notices]');
      await settled();
      let marked = requests.filter(
        (r) => r.method === 'POST' && r.path === '_key-policy-notices/read',
      );
      assert.deepEqual(
        marked.map((r) => r.body),
        [
          {
            data: [
              { type: 'key-policy-notice', id: '9' },
              { type: 'key-policy-notice', id: '8' },
            ],
          },
        ],
        'the unread notices it lists, and only those, are marked once',
      );
    });

    test('a page whose notices are all read marks nothing', async function (assert) {
      serve({
        'GET _key-policy-notices': () =>
          json(200, {
            data: [
              {
                type: 'key-policy-notice',
                id: '4',
                attributes: {
                  realm: REALM,
                  share: 'share-4',
                  label: 'Shared 4',
                  key: 'key-1',
                  policy: `${REALM}policies/team`,
                  savedBy: null,
                  reason: 'visitors-use',
                  operations: [`${REALM}weather#Weather.forecast`],
                  declinedAt: null,
                  readAt: '2026-10-30T09:00:00.000Z',
                  createdAt: '2026-10-30T08:00:00.000Z',
                },
              },
            ],
            meta: { unread: 0 },
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-policy-notices]');
      await settled();
      assert.false(
        requests.some((r) => r.path === '_key-policy-notices/read'),
        'nothing is sent',
      );
    });

    test('a workspace’s request can be declined, which leaves the key as it is', async function (assert) {
      let declined = false;
      let request = {
        type: 'key-policy-notice',
        id: '7',
        attributes: {
          realm: REALM,
          share: 'share-team-2',
          label: 'Team weather',
          key: 'key-1',
          policy: `${REALM}policies/team`,
          savedBy: null,
          reason: 'visitors-wanted',
          operations: [`${REALM}weather#Weather.alerts`],
          declinedAt: null as string | null,
          readAt: '2026-11-01T12:05:00.000Z',
          createdAt: '2026-11-01T12:00:00.000Z',
        },
      };
      serve({
        'GET _key-policy-notices': () =>
          json(200, {
            data: [
              declined
                ? {
                    ...request,
                    attributes: {
                      ...request.attributes,
                      declinedAt: '2026-11-02T12:00:00.000Z',
                    },
                  }
                : request,
            ],
          }),
        'POST _key-policy-notices/7/decline': () => {
          declined = true;
          return json(200, { data: request });
        },
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-policy-requests]');
      await click('[data-test-key-policy-notice-decline]');
      await settled();
      assert.dom('[data-test-key-policy-requests]').doesNotExist();
      assert.deepEqual(
        requests
          .filter((r) => r.method === 'POST' && r.path.startsWith('_key'))
          .map((r) => r.path),
        ['_key-policy-notices/7/decline'],
        'nothing about the key is changed',
      );
    });

    test('a notice that a workspace wants visitors to use a key is settled once the key allows them', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(200, keyResources([{ ...KEYS[0], anonymous: true }, KEYS[1]])),
        'GET _key-policy-notices': () =>
          json(200, {
            data: [
              {
                type: 'key-policy-notice',
                id: '1',
                attributes: {
                  realm: REALM,
                  share: 'share-team-2',
                  label: 'Team weather',
                  key: 'key-1',
                  policy: `${REALM}policies/team`,
                  savedBy: null,
                  reason: 'visitors-wanted',
                  operations: [`${REALM}weather#Weather.alerts`],
                  createdAt: '2026-11-01T12:00:00.000Z',
                },
              },
            ],
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      assert.dom('[data-test-key-policy-requests]').doesNotExist();
    });

    test('a link naming a key opens its setting for people who aren’t signed in', async function (assert) {
      visitShell('keys#anonymous=key-2');
      await render(KeyPage);
      await waitFor('[data-test-key-anonymous-use-form]');
      assert.dom('[data-test-key-policy-requests]').doesNotExist();
      assert.dom('[data-test-key-anonymous-use-form]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-key-anonymous-use-form] [data-test-anonymous-use-input]',
        )
        .isChecked();
    });

    test('lists the keys, and replaces one with a ticket for that key', async function (assert) {
      serve({
        'GET _key-shares': () =>
          json(200, {
            data: [
              { realm: REALM, label: 'Maps' },
              { realm: REALM, label: 'Team maps' },
              {
                realm: 'https://realm-server.test/someone/dashboard/',
                label: 'Maps',
              },
            ].map((attributes, i) => ({
              type: 'key-share',
              id: `share-${i}`,
              attributes,
            })),
          }),
        'PATCH _user-keys/key-2': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-2',
              attributes: attributesOf(KEYS[1]),
            },
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      assert.dom('[data-test-key-row]').exists({ count: 2 });
      assert.dom('[data-test-key-value]').doesNotExist('no value is shown');
      await click('[data-test-key-row="Maps"] [data-test-key-replace]');
      await settled();
      assert
        .dom('[data-test-key-replace-where]')
        .includesText(
          '2 workspaces use this key. Replacing it switches them all to the new key right away, so make sure all of these workspaces use the same key.',
          'says how many workspaces the key is shared with',
        );
      assert.dom('[data-test-key-value]').hasAttribute('type', 'password');
      await fillIn('[data-test-key-value]', 'sk-new-value');
      await click('[data-test-key-replace-save]');
      assert.deepEqual(ticketRequests(), [
        { action: 'replace', keyId: 'key-2' },
      ]);
      let patch = requests.find((r) => r.method === 'PATCH')!;
      assert.deepEqual(patch.body, {
        data: {
          type: 'user-key',
          id: 'key-2',
          attributes: { value: 'sk-new-value' },
        },
        meta: { ticket: 'ticket-1' },
      });
      assert.dom('[data-test-key-replace-form]').doesNotExist();
    });

    test('each key says which services it is used with and lists the workspaces it is shared with, from the key listing alone', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      let weather = '[data-test-key-row="Weather service"]';
      assert
        .dom(`${weather} [data-test-key-used-with]`)
        .hasText('Used with github.com, openweathermap.org');
      assert
        .dom(`${weather} [data-test-key-shared-into-summary]`)
        .hasText('Shared with 3 workspaces');
      let dashboard = `${weather} [data-test-key-shared-into-workspace="https://realm-server.test/someone/dashboard/"]`;
      assert
        .dom(`${dashboard} [data-test-workspace-name]`)
        .hasText('Dashboard');
      assert
        .dom(`${dashboard} [data-test-workspace-address]`)
        .hasText('realm-server.test/someone/dashboard/');
      assert
        .dom(`${dashboard} [data-test-workspace-labels]`)
        .hasText('As “Weather”');
      let team = `${weather} [data-test-key-shared-into-workspace="${REALM}"]`;
      assert
        .dom(`${team} [data-test-workspace-labels]`)
        .hasText('As “Weather”, “Team weather” (suspended)');
      let gone = `${weather} [data-test-key-shared-into-workspace="https://realm-server.test/someone/old-team/"]`;
      assert
        .dom(`${gone} [data-test-workspace-name]`)
        .hasText(
          'realm-server.test/someone/old-team/',
          'a workspace the user can no longer read is shown by its address',
        );
      assert.dom(`${gone} [data-test-workspace-address]`).doesNotExist();
      assert
        .dom(`${dashboard} [data-test-key-unshare]`)
        .hasAria('label', 'Unshare Weather service from Dashboard');

      let maps = '[data-test-key-row="Maps"]';
      assert
        .dom(`${maps} [data-test-key-used-with]`)
        .hasText('Not used with any site yet');
      assert
        .dom(`${maps} [data-test-key-shared-into]`)
        .hasText('Not shared with any workspace');
      assert.dom(`${maps} [data-test-key-unshare]`).doesNotExist();

      assert.deepEqual(
        requests
          .filter((r) => r.path !== '_secure-session')
          .map((r) => `${r.method} ${r.path}`),
        [
          'GET _user-keys',
          'GET _key-bindings',
          'GET _key-policy-notices',
          'GET _key-limit-notices',
        ],
        'the page asks nothing per key',
      );
    });

    test('each key says whether people who aren’t signed in can use it, and changes that with its own request', async function (assert) {
      let keys = [
        KEYS[0],
        {
          ...KEYS[1],
          anonymous: true,
          anonymousDailyCap: 50,
          anonymousMonthlyCap: 1000,
        },
      ];
      serve({
        'GET _user-keys': () => json(200, keyResources(keys)),
        'PUT _user-keys/key-1/anonymous-use': ({ body }) => {
          keys = [{ ...KEYS[0], ...body.data.attributes }, keys[1]];
          return json(200, {
            data: { type: 'user-key', id: 'key-1', attributes: keys[0] },
          });
        },
        'PUT _user-keys/key-2/anonymous-use': ({ body }) => {
          keys = [keys[0], { ...keys[1], ...body.data.attributes }];
          return json(200, {
            data: { type: 'user-key', id: 'key-2', attributes: keys[1] },
          });
        },
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      let weather = '[data-test-key-row="Weather service"]';
      let maps = '[data-test-key-row="Maps"]';
      assert
        .dom(`${weather} [data-test-key-anonymous-use-summary]`)
        .hasText('Only people who are signed in can use it');
      assert
        .dom(`${maps} [data-test-key-anonymous-use-summary]`)
        .hasText(
          'People who aren’t signed in can use it where a workspace lets them, up to 50 calls a day and 1000 a month all together',
        );
      assert
        .dom(`${weather} [data-test-key-anonymous-use-change]`)
        .hasAria(
          'label',
          'Change whether people who aren’t signed in can use Weather service',
        );

      await click(`${weather} [data-test-key-anonymous-use-change]`);
      assert.dom('[data-test-key-anonymous-use-form]').exists();
      assert.dom('[data-test-anonymous-use-input]').isNotChecked();
      assert
        .dom('[data-test-anonymous-use-agreement]')
        .hasText('Allow people who aren’t signed in to use this key');
      assert.dom('[data-test-anonymous-cap-input]').doesNotExist();
      assert.dom('[data-test-anonymous-monthly-cap-input]').doesNotExist();
      await click('[data-test-anonymous-use-input]');
      let capInput = find('[data-test-anonymous-cap-input]')!;
      let capName = capInput
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .join(' ');
      assert.strictEqual(
        capName,
        'Daily anonymous cap (optional)',
        'the cap is named by its label alone',
      );
      let monthlyInput = find('[data-test-anonymous-monthly-cap-input]')!;
      assert.strictEqual(
        monthlyInput
          .getAttribute('aria-labelledby')!
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .join(' '),
        'Monthly anonymous cap (optional)',
        'so is the monthly cap',
      );
      assert
        .dom(
          document.getElementById(
            monthlyInput.getAttribute('aria-describedby')!,
          ),
        )
        .includesText('each calendar month (UTC)', 'its note describes it');
      assert
        .dom(
          document.getElementById(capInput.getAttribute('aria-describedby')!),
        )
        .includesText('Leave it empty for no cap', 'its note describes it');
      await fillIn('[data-test-anonymous-cap-input]', '0');
      assert
        .dom('[data-test-key-anonymous-use-save]')
        .isDisabled('a cap is at least one call');
      await fillIn('[data-test-anonymous-cap-input]', '25');
      await fillIn('[data-test-anonymous-monthly-cap-input]', '0');
      assert
        .dom('[data-test-key-anonymous-use-save]')
        .isDisabled('a monthly cap is at least one call too');
      await fillIn('[data-test-anonymous-monthly-cap-input]', '500');
      await click('[data-test-key-anonymous-use-save]');
      await waitFor(
        `${weather} [data-test-key-anonymous-use-summary]:not(:empty)`,
      );
      let put = requests.find(
        (r) =>
          r.method === 'PUT' && r.path === '_user-keys/key-1/anonymous-use',
      )!;
      assert.deepEqual(put.body, {
        data: {
          type: 'anonymous-use',
          attributes: {
            anonymous: true,
            anonymousDailyCap: 25,
            anonymousMonthlyCap: 500,
          },
        },
      });
      assert.deepEqual(ticketRequests(), [], 'it takes no ticket');
      assert.dom('[data-test-key-anonymous-use-form]').doesNotExist();
      assert
        .dom(`${weather} [data-test-key-anonymous-use-summary]`)
        .hasText(
          'People who aren’t signed in can use it where a workspace lets them, up to 25 calls a day and 500 a month all together',
          'the list is read again',
        );

      await click(`${maps} [data-test-key-anonymous-use-change]`);
      assert
        .dom('[data-test-anonymous-use-input]')
        .isChecked('the panel starts from the key’s setting');
      assert.dom('[data-test-anonymous-cap-input]').hasValue('50');
      assert.dom('[data-test-anonymous-monthly-cap-input]').hasValue('1000');
      await click('[data-test-anonymous-use-input]');
      await click('[data-test-key-anonymous-use-save]');
      await settled();
      assert.deepEqual(
        requests.find(
          (r) =>
            r.method === 'PUT' && r.path === '_user-keys/key-2/anonymous-use',
        )!.body.data.attributes,
        {
          anonymous: false,
          anonymousDailyCap: null,
          anonymousMonthlyCap: null,
        },
        'turning it off clears both caps',
      );
      assert
        .dom(`${maps} [data-test-key-anonymous-use-summary]`)
        .hasText('Only people who are signed in can use it');
    });

    test('unsharing a key from one workspace asks first, then takes out each of its shares there', async function (assert) {
      let listings = 0;
      serve({
        'GET _user-keys': () => {
          listings++;
          return json(
            200,
            keyResources(
              listings === 1
                ? KEYS
                : [
                    {
                      ...KEYS[0],
                      sharedInto: KEYS[0].sharedInto.filter(
                        (w) => w.url !== REALM,
                      ),
                    },
                    KEYS[1],
                  ],
            ),
          );
        },
        'DELETE _key-shares/share-team-1': () => ({ status: 204 }),
        'DELETE _key-shares/share-team-2': () => ({ status: 204 }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      let team = `[data-test-key-row="Weather service"] [data-test-key-shared-into-workspace="${REALM}"]`;
      await click(`${team} [data-test-key-unshare]`);
      assert
        .dom(`${team} [data-test-key-unshare-confirm]`)
        .includesText(
          'Unshare from Team? Cards there stop using this key. It stays shared everywhere else.',
        );
      await click(`${team} [data-test-key-unshare-cancel]`);
      assert.dom(`${team} [data-test-key-unshare-confirm]`).doesNotExist();
      assert.false(
        requests.some((r) => r.method === 'DELETE'),
        'nothing is unshared until confirmed',
      );

      await click(`${team} [data-test-key-unshare]`);
      await click(`${team} [data-test-key-unshare-confirm-button]`);
      assert.deepEqual(
        requests
          .filter((r) => r.method === 'DELETE')
          .map((r) => ({ path: r.path, body: r.body })),
        [
          { path: '_key-shares/share-team-1', body: undefined },
          { path: '_key-shares/share-team-2', body: undefined },
        ],
        'each of its shares in that workspace, with no ticket',
      );
      assert.deepEqual(ticketRequests(), [], 'unsharing mints no ticket');
      assert.dom(team).doesNotExist('the workspace is gone from the list');
      assert
        .dom(
          '[data-test-key-row="Weather service"] [data-test-key-shared-into-summary]',
        )
        .hasText('Shared with 2 workspaces', 'and the key stays in the rest');
    });

    test('an unshare refused part-way through shows what is left, and unsharing again removes only that', async function (assert) {
      let teamShares = KEYS[0].sharedInto.find((w) => w.url === REALM)!.shares;
      let left = teamShares;
      let refuseSecond = true;
      serve({
        'GET _user-keys': () =>
          json(
            200,
            keyResources([
              {
                ...KEYS[0],
                sharedInto: KEYS[0].sharedInto
                  .map((w) => (w.url === REALM ? { ...w, shares: left } : w))
                  .filter((w) => w.shares.length),
              },
              KEYS[1],
            ]),
          ),
        'DELETE _key-shares/share-team-1': () => {
          left = left.filter((s) => s.id !== 'share-team-1');
          return { status: 204 };
        },
        'DELETE _key-shares/share-team-2': () => {
          if (refuseSecond) {
            return refusal(403, 'Not now');
          }
          left = left.filter((s) => s.id !== 'share-team-2');
          return { status: 204 };
        },
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      let team = `[data-test-key-row="Weather service"] [data-test-key-shared-into-workspace="${REALM}"]`;
      await click(`${team} [data-test-key-unshare]`);
      await click(`${team} [data-test-key-unshare-confirm-button]`);
      await waitFor('[data-test-keys-error]');
      await settled();
      assert.dom('[data-test-keys-error]').includesText('Not now');
      assert
        .dom(`${team} [data-test-workspace-labels]`)
        .hasText(
          'As “Team weather” (suspended)',
          'the list is read again, so the share already removed is gone',
        );
      assert
        .dom(`${team} [data-test-key-unshare-confirm]`)
        .exists('the question stays open');

      refuseSecond = false;
      let before = requests.length;
      await click(`${team} [data-test-key-unshare-confirm-button]`);
      await settled();
      assert.deepEqual(
        requests
          .slice(before)
          .filter((r) => r.method === 'DELETE')
          .map((r) => r.path),
        ['_key-shares/share-team-2'],
        'unsharing again removes only the share that is left',
      );
      assert.dom(team).doesNotExist('the workspace is gone from the list');
      assert.strictEqual(teamShares.length, 2);
    });

    test('an unshare the server refuses says why and keeps the workspace', async function (assert) {
      serve({
        'DELETE _key-shares/share-dash': () =>
          refusal(403, `only a share's owner unshares it`),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      let dashboard = `[data-test-key-row="Weather service"] [data-test-key-shared-into-workspace="https://realm-server.test/someone/dashboard/"]`;
      await click(`${dashboard} [data-test-key-unshare]`);
      await click(`${dashboard} [data-test-key-unshare-confirm-button]`);
      await waitFor('[data-test-keys-error]');
      assert
        .dom('[data-test-keys-error]')
        .includesText("Only a share's owner unshares it.");
      assert
        .dom(`${dashboard} [data-test-key-unshare-confirm]`)
        .exists('the question stays open');
    });

    test('replacing a key says what it switches, however many workspaces use it', async function (assert) {
      let answer: () => Answer = () => json(200, { data: [] });
      serve({ 'GET _key-shares': () => answer() });
      visitShell('?mode=keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      let where = '[data-test-key-replace-where]';
      async function openReplace() {
        await click('[data-test-key-row="Maps"] [data-test-key-replace]');
        await settled();
      }
      async function closeReplace() {
        await click('[data-test-key-replace-form] button[type="button"]');
      }

      answer = () =>
        json(200, {
          data: [
            {
              type: 'key-share',
              id: 'share-1',
              attributes: { realm: REALM, label: 'Maps' },
            },
          ],
        });
      await openReplace();
      assert
        .dom(where)
        .hasText(
          'One workspace uses this key. Replacing it switches that workspace to the new key right away, so make sure the new key is right for that workspace.',
        );
      await closeReplace();

      answer = () => json(200, { data: [] });
      await openReplace();
      assert
        .dom(where)
        .hasText(
          'No workspace uses this key. Make sure the new key is for the same service.',
        );
      await closeReplace();

      answer = () => refusal(500, 'the shares could not be listed');
      await openReplace();
      assert
        .dom(where)
        .hasText(
          'Replacing this key switches every workspace that uses it to the new key right away, so make sure all of them use the same key.',
          'when the shares can’t be listed, it says so in general terms',
        );
      assert
        .dom('[data-test-key-replace-save]')
        .exists('and the replace is still offered');
    });

    test('deleting a key lists the shares it would stop, then deletes it', async function (assert) {
      serve({
        'GET _key-shares': ({ url }) => {
          assert.strictEqual(url.searchParams.get('key'), 'key-1');
          return json(200, {
            data: [
              {
                type: 'key-share',
                id: 'share-1',
                attributes: { label: 'Weather', realm: REALM },
              },
            ],
          });
        },
        'DELETE _user-keys/key-1': () => ({ status: 204 }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      await click(
        '[data-test-key-row="Weather service"] [data-test-key-delete]',
      );
      await waitFor('[data-test-key-delete-shares]');
      assert.dom('[data-test-key-delete-shares]').includesText('Weather');
      assert.dom('[data-test-key-delete-shares]').includesText(REALM);
      assert
        .dom('[data-test-key-delete-confirm]')
        .includesText('is permanent', 'says the delete is permanent');
      assert
        .dom('[data-test-key-delete-confirm]')
        .includesText(
          'Someone with direct write access to one of them can put their own key in its place.',
        );
      await click('[data-test-key-delete-confirm-button]');
      assert.deepEqual(ticketRequests(), [
        { action: 'delete', keyId: 'key-1' },
      ]);
      assert.deepEqual(requests.find((r) => r.method === 'DELETE')!.body, {
        meta: { ticket: 'ticket-1' },
      });
    });

    test('a delete can’t be confirmed until the shares it would stop have loaded', async function (assert) {
      let release!: () => void;
      serve({
        'GET _key-shares': () =>
          new Promise((resolve) => {
            release = () => resolve(json(200, { data: [] }));
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      // Not awaited: the share list is held back until released. It is
      // released on every path: a stubbed request still open keeps its waiter
      // pending, and every later test's `settled()` with it.
      click('[data-test-key-row="Maps"] [data-test-key-delete]');
      try {
        await waitFor('[data-test-key-delete-loading]');
        assert.dom('[data-test-key-delete-confirm-button]').isDisabled();
      } finally {
        release?.();
      }
      await settled();
      assert.dom('[data-test-key-delete-confirm-button]').isNotDisabled();
      assert
        .dom('[data-test-key-delete-confirm]')
        .includesText('It isn’t shared with any workspace');
    });

    test('a delete whose share lookup fails is withdrawn, not offered', async function (assert) {
      serve({
        'GET _key-shares': () => refusal(500, 'the server failed'),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      await click('[data-test-key-row="Maps"] [data-test-key-delete]');
      await waitFor('[data-test-keys-error]');
      assert.dom('[data-test-key-delete-confirm]').doesNotExist();
      assert.false(requests.some((r) => r.method === 'DELETE'));
    });

    test('a share no call is approved for says so, and Approve for a card sets it up for one of the workspace’s cards', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(
            200,
            keyResources([
              KEYS[0]!,
              {
                ...KEYS[1]!,
                sharedInto: [
                  {
                    url: REALM,
                    name: 'Team',
                    shares: [
                      {
                        id: 'share-maps',
                        label: 'Maps',
                        state: 'active',
                        approvedCalls: 0,
                      },
                    ],
                  },
                ],
              },
            ]),
          ),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      let weather = '[data-test-key-row="Weather service"]';
      let team = `${weather} [data-test-key-shared-into-workspace="${REALM}"]`;
      assert
        .dom(`${team} [data-test-key-share-unapproved="share-team-1"]`)
        .hasText(
          '“Weather” isn’t approved for any calls yet Approve for a card…',
          'one of a workspace’s several shares is named by its label',
        );
      assert
        .dom(`${team} [data-test-key-share-unapproved="share-team-2"]`)
        .doesNotExist('a suspended share is said to be suspended instead');
      assert
        .dom(`${weather} [data-test-key-share-unapproved="share-dash"]`)
        .doesNotExist('a share approved for calls says nothing more');
      assert
        .dom(`${team} [data-test-key-share-approve="share-team-1"]`)
        .hasAria('label', 'Approve for a card: “Weather” in Team');
      assert
        .dom(
          '[data-test-key-row="Maps"] [data-test-key-share-unapproved="share-maps"]',
        )
        .hasText(
          'Not approved for any calls yet Approve for a card…',
          'a workspace’s only share needs no label',
        );

      await click(`${team} [data-test-key-share-approve="share-team-1"]`);
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/keys/key-1/use#${new URLSearchParams({
            realm: REALM,
            share: 'share-team-1',
            back: 'keys',
          })}`,
        },
      ]);
    });

    test('Share on a key goes to the share page for that key', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Maps"]');
      await click('[data-test-key-row="Maps"] [data-test-key-share]');
      assert.deepEqual(navigations, [
        { how: 'assign', url: '/secure/keys/key-2/share' },
      ]);
    });

    test('Add a key goes to the key entry page, which comes back here', async function (assert) {
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-page]');
      await click('[data-test-key-page-add]');
      assert.deepEqual(navigations, [
        { how: 'assign', url: '/secure/keys/add' },
      ]);
    });
  });

  module('entering a key', function () {
    test('adds a key with a ticket to add one, then closes', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: { ...attributesOf(KEYS[0]), name: 'Forecasts' },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert.dom('[data-test-opened-for]').doesNotExist();
      assert.dom('[data-test-enter-key-save]').isDisabled();
      assert.dom('[data-test-key-value]').hasAttribute('type', 'password');
      await fillIn('[data-test-key-name]', ' Forecasts ');
      await fillIn('[data-test-key-value]', 'sk-forecast');
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
              name: 'Forecasts',
              kind: 'static',
              value: 'sk-forecast',
            },
          },
          meta: { ticket: 'ticket-1' },
        },
      );
      assert.dom('[data-test-keys-done-name]').hasText('Forecasts');
      assert
        .dom('[data-test-keys-done-next]')
        .doesNotExist('opened for no card, there is no card to mention');
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('a key can let people who aren’t signed in use it, with an optional cap', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: {
                ...attributesOf(KEYS[0]),
                name: 'Forecasts',
                anonymous: true,
                anonymousDailyCap: 100,
                anonymousMonthlyCap: 2000,
              },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert
        .dom('[data-test-anonymous-use]')
        .includesText('People who aren’t signed in');
      assert
        .dom('[data-test-anonymous-use-agreement]')
        .hasText('Allow people who aren’t signed in to use this key');
      assert
        .dom('[data-test-anonymous-use-note]')
        .hasText(
          'Only where a workspace you share it into lets them use its cards. Their calls are made with your key and count against your quota.',
        );
      assert.dom('[data-test-anonymous-use-input]').isNotChecked();
      assert
        .dom('[data-test-anonymous-cap]')
        .doesNotExist('the cap is asked for only once they are allowed');
      await fillIn('[data-test-key-name]', 'Forecasts');
      await fillIn('[data-test-key-value]', 'sk-forecast');
      await click('[data-test-anonymous-use-input]');
      assert
        .dom('[data-test-anonymous-cap]')
        .includesText('Daily anonymous cap (optional)');
      assert
        .dom('[data-test-anonymous-cap]')
        .includesText(
          'How many calls people who aren’t signed in can make with this key each day (UTC), all together, in every workspace it’s shared into. Leave it empty for no cap.',
        );
      assert.dom('[data-test-anonymous-cap-input]').hasValue('');
      await fillIn('[data-test-anonymous-cap-input]', '1.5');
      assert
        .dom('[data-test-enter-key-save]')
        .isDisabled('a cap is a whole number of calls');
      await fillIn('[data-test-anonymous-cap-input]', '100');
      assert
        .dom('[data-test-anonymous-monthly-cap]')
        .includesText('Monthly anonymous cap (optional)');
      assert
        .dom('[data-test-anonymous-monthly-cap]')
        .includesText(
          'How many calls people who aren’t signed in can make with this key each calendar month (UTC), all together, in every workspace it’s shared into. Leave it empty for no cap.',
        );
      await fillIn('[data-test-anonymous-monthly-cap-input]', 'lots');
      assert
        .dom('[data-test-enter-key-save]')
        .isDisabled('a monthly cap is a whole number of calls');
      await fillIn('[data-test-anonymous-monthly-cap-input]', '2000');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body.data.attributes,
        {
          name: 'Forecasts',
          kind: 'static',
          value: 'sk-forecast',
          anonymous: true,
          anonymousDailyCap: 100,
          anonymousMonthlyCap: 2000,
        },
      );
    });

    test('a key that lets people who aren’t signed in use it needs no cap, and a sign-in app isn’t asked', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: { ...attributesOf(KEYS[0]), anonymous: true },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await click('[data-test-radio-choice="oauth-client"] input');
      assert.dom('[data-test-anonymous-use]').doesNotExist();
      await click('[data-test-radio-choice="static"] input');
      await fillIn('[data-test-key-name]', 'Forecasts');
      await fillIn('[data-test-key-value]', 'sk-forecast');
      await click('[data-test-anonymous-use-input]');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      let { attributes } = requests.find(
        (r) => r.method === 'POST' && r.path === '_user-keys',
      )!.body.data;
      assert.true(attributes.anonymous);
      assert.false('anonymousDailyCap' in attributes, 'the cap is optional');
      assert.false(
        'anonymousMonthlyCap' in attributes,
        'so is the monthly cap',
      );
    });

    test('opened for an operation, says what it is for, as the server describes it', async function (assert) {
      serve({
        'POST _secure-window/context': ({ body }) => {
          assert.deepEqual(body.data.attributes, {
            target: { kind: 'instance', url: CARD },
            operation: 'forecast',
          });
          return context({
            realm: WORKSPACE,
            card: {
              name: 'Weather',
              module: `${REALM}weather`,
              exportName: 'Weather',
            },
            operation: {
              name: 'forecast',
              label: 'Get the forecast',
              base: 'callApi',
              method: 'GET',
              destination: {
                href: 'https://api.weather.co.uk/v2/',
                host: 'api.weather.co.uk',
                path: '/v2/',
                registrableDomain: 'weather.co.uk',
              },
              slots: [{ name: 'userKey', key: 'userKey' }],
            },
          });
        },
      });
      visitShell(
        `enter-key#card=${encodeURIComponent(CARD)}&operation=forecast&reason=${encodeURIComponent('Forecasts need your \u202eweather key')}`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert
        .dom('[data-test-opened-for-operation]')
        .hasText('Get the forecast');
      assert.dom('[data-test-opened-for-card]').hasText('Weather');
      assert.dom('[data-test-opened-for-realm]').hasText('Team Workspace');
      assert
        .dom('[data-test-opened-for-realm-address]')
        .hasText('realm-server.test/someone/workspace/', 'and its address');
      assert.dom('[data-test-destination-domain]').hasText('weather.co.uk');
      assert.dom('[data-test-destination-host]').hasText('api.weather.co.uk');
      assert.dom('[data-test-destination-path]').hasText('/v2/');
      assert
        .dom('[data-test-destination-method]')
        .hasText('Reads from', 'the method in plain words');
      assert
        .dom('[data-test-destination-realm-address]')
        .hasText('realm-server.test/someone/workspace/');
      assert
        .dom('[data-test-opened-for-reason]')
        .includesText(
          '“Forecasts need your weather key”',
          'with the bidi override dropped',
        );
      assert
        .dom('[data-test-opened-for-reason-by]')
        .hasText('Given by Get the forecast when it opened this window.');
    });

    test('opened for a card, says once saved that the card will ask before it uses the key', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          context({
            realm: WORKSPACE,
            card: {
              name: 'Weather',
              module: `${REALM}weather`,
              exportName: 'Weather',
            },
          }),
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: { ...attributesOf(KEYS[0]), name: 'Forecasts' },
            },
          }),
      });
      visitShell(`?mode=enter-key#card=${encodeURIComponent(CARD)}`);
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await fillIn('[data-test-key-name]', 'Forecasts');
      await fillIn('[data-test-key-value]', 'sk-forecast');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      assert
        .dom('[data-test-keys-done-next]')
        .hasText(
          'Saving it doesn’t give Weather the key. Weather will ask you to approve where it sends the key before it can use it.',
        );
    });

    test('opened for something the server doesn’t know of, says so and doesn’t offer to try again', async function (assert) {
      visitShell(
        `enter-key#card=${encodeURIComponent(CARD)}&operation=forecast`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert.dom('[data-test-enter-key-form]').doesNotExist();
      assert
        .dom('[data-test-error-message]')
        .hasText(
          'This workspace, card or request doesn’t exist, or you don’t have access to it.',
        );
      assert.dom('[data-test-keys-retry]').doesNotExist();
      await click('[data-test-toggle-details]');
      assert.dom('[data-test-error-detail="Status"]').hasText('404');
      assert.dom('[data-test-error-detail="Message"]').hasText('Not found.');
    });

    test('reached from an approve page the CLI opened, Close tells the CLI the approval was cancelled', async function (assert) {
      let submitted: [string, string][][] = [];
      let submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push([...new FormData(this).entries()] as [string, string][]);
      };
      try {
        let cli = `cli_port=51234&cli_state=${'c'.repeat(32)}`;
        visitShell(
          `enter-key#card=${encodeURIComponent(CARD)}&operation=forecast&then=approve&${cli}`,
        );
        await render(EnterKeyPage);
        await waitFor('[data-test-keys-load-failed]');
        await click('[data-test-keys-close]');
        assert.deepEqual(submitted, [
          [
            ['state', 'c'.repeat(32)],
            ['window_outcome', 'cancelled'],
          ],
        ]);
        assert.deepEqual(navigations, [], 'the window goes to the CLI');
      } finally {
        HTMLFormElement.prototype.submit = submit;
      }
    });

    test('opened with a CLI listener but not from an approve page, Close only closes', async function (assert) {
      let submitted = 0;
      let submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = () => submitted++;
      try {
        visitShell(
          `enter-key#card=${encodeURIComponent(CARD)}&operation=forecast&cli_port=51234&cli_state=${'c'.repeat(32)}`,
        );
        await render(EnterKeyPage);
        await waitFor('[data-test-keys-load-failed]');
        await click('[data-test-keys-close]');
        assert.strictEqual(submitted, 0);
        assert.deepEqual(navigations, [{ how: 'close' }]);
      } finally {
        HTMLFormElement.prototype.submit = submit;
      }
    });

    test('refused access, says so and doesn’t offer to try again', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          refusal(403, 'the secure window asks this with its own session'),
      });
      visitShell(`?mode=enter-key#realm=${encodeURIComponent(REALM)}`);
      await render(EnterKeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-error-message]')
        .hasText('You don’t have access to this.');
      assert.dom('[data-test-keys-retry]').doesNotExist();
      await click('[data-test-toggle-details]');
      assert.dom('[data-test-error-detail="Status"]').hasText('403');
    });

    test('a load that fails for another reason offers to try again', async function (assert) {
      let attempts = 0;
      serve({
        'POST _secure-window/context': () =>
          ++attempts === 1
            ? refusal(503, 'the server is unavailable')
            : context({ realm: WORKSPACE }),
      });
      visitShell(`enter-key#realm=${encodeURIComponent(REALM)}`);
      await render(EnterKeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert.dom('[data-test-keys-heading]').hasText('Add key');
      await click('[data-test-toggle-details]');
      assert.dom('[data-test-error-detail="Status"]').hasText('503');
      await click('[data-test-keys-retry]');
      await waitFor('[data-test-enter-key-form]');
      assert.dom('[data-test-opened-for-realm]').hasText('Team Workspace');
    });

    test('reached from the key page, goes back to it', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: attributesOf(KEYS[0]),
            },
          }),
      });
      visitShell('keys/add');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await fillIn('[data-test-key-name]', 'Forecasts');
      await fillIn('[data-test-key-value]', 'sk-forecast');
      await click('[data-test-enter-key-save]');
      assert.deepEqual(navigations, [{ how: 'replace', url: '/secure/keys' }]);
    });

    test('shows why a key can’t be added', async function (assert) {
      serve({
        'POST _user-keys': () =>
          refusal(409, 'the owner already has a key of that name'),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await fillIn('[data-test-key-name]', 'Maps');
      await fillIn('[data-test-key-value]', 'sk-maps');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-error]');
      assert
        .dom('[data-test-keys-error]')
        .hasText('The owner already has a key of that name.');
      assert.deepEqual(navigations, []);
    });
  });

  module('entering a Google service account', function () {
    test('adds one from its key file, with the user to act as and its scopes', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: {
                ...attributesOf(KEYS[0]),
                name: 'Sheets',
                kind: 'google-service-account',
              },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert
        .dom('[data-test-radio-choice="static"] input')
        .isChecked('a key pasted in as it is is the default');
      await fillIn('[data-test-key-value]', 'typed before switching');
      await click('[data-test-radio-choice="google-service-account"] input');
      assert
        .dom('[data-test-key-value]')
        .doesNotExist('a service account has no value to paste');
      await fillIn('[data-test-key-name]', 'Sheets');
      assert.dom('[data-test-enter-key-save]').isDisabled('no key file yet');
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-service-account-email]')
        .includesText(
          'sheets-bot@boxel-test.iam.gserviceaccount.com',
          'names the service account the file holds',
        );
      assert
        .dom('[data-test-service-account-email]')
        .doesNotIncludeText('placeholder', 'shows nothing else of the file');
      assert.dom('[data-test-enter-key-save]').isDisabled('no scopes yet');
      await fillIn(
        '[data-test-service-account-subject]',
        ' owner@example.com ',
      );
      await fillIn(
        '[data-test-service-account-scopes]',
        'https://www.googleapis.com/auth/spreadsheets  https://www.googleapis.com/auth/drive.readonly',
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
              name: 'Sheets',
              kind: 'google-service-account',
              value: SERVICE_ACCOUNT_FILE,
              subject: 'owner@example.com',
              scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive.readonly',
              ],
            },
          },
          meta: { ticket: 'ticket-1' },
        },
        'the file is sent as chosen, and nothing typed for the other kind goes with it',
      );
    });

    test('acting as the service account itself sends no subject', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: {
                ...attributesOf(KEYS[0]),
                kind: 'google-service-account',
              },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await click('[data-test-radio-choice="google-service-account"] input');
      await fillIn('[data-test-key-name]', 'Sheets');
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      await fillIn('[data-test-service-account-scopes]', 'openid');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      let attributes = (
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body as { data: { attributes: Record<string, unknown> } }
      ).data.attributes;
      assert.false('subject' in attributes);
      assert.deepEqual(attributes.scopes, ['openid']);
    });

    test('a file that isn’t a service account key says so and can’t be saved', async function (assert) {
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await click('[data-test-radio-choice="google-service-account"] input');
      await fillIn('[data-test-key-name]', 'Sheets');
      await fillIn('[data-test-service-account-scopes]', 'openid');
      await chooseKeyFile('{"type": "authorized_user"}', 'credentials.json');
      assert
        .dom('[data-test-service-account-problem]')
        .hasText(
          'This isn’t a service account key file. Choose the JSON key file Google gave you for the service account.',
        );
      assert.dom('[data-test-enter-key-save]').isDisabled();
      await chooseKeyFile('not json at all', 'notes.txt');
      assert
        .dom('[data-test-service-account-problem]')
        .includesText('This isn’t a JSON key file.');
      assert.dom('[data-test-enter-key-save]').isDisabled();
      assert.deepEqual(
        requests.filter((r) => r.method === 'POST'),
        [],
        'nothing is sent',
      );
    });

    test('a key file pasted as a key is caught, and taken as a service account in one click', async function (assert) {
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: {
                ...attributesOf(KEYS[0]),
                kind: 'google-service-account',
              },
            },
          }),
      });
      visitShell('enter-key');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await fillIn('[data-test-key-name]', 'Sheets');
      await fillIn('[data-test-key-value]', SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-pasted-key-file]')
        .includesText('This is a Google service account’s JSON key file.');
      assert
        .dom('[data-test-enter-key-save]')
        .isDisabled('a key file is never saved as a key sent as it is');
      await click('[data-test-use-service-account]');
      assert
        .dom('[data-test-radio-choice="google-service-account"] input')
        .isChecked();
      assert
        .dom('[data-test-service-account-email]')
        .includesText('sheets-bot@boxel-test.iam.gserviceaccount.com');
      assert.dom('[data-test-pasted-key-file]').doesNotExist();
      await fillIn('[data-test-service-account-scopes]', 'openid');
      await click('[data-test-enter-key-save]');
      await waitFor('[data-test-keys-done]');
      let attributes = (
        requests.find((r) => r.method === 'POST' && r.path === '_user-keys')!
          .body as { data: { attributes: Record<string, unknown> } }
      ).data.attributes;
      assert.strictEqual(attributes.kind, 'google-service-account');
      assert.deepEqual(
        JSON.parse(attributes.value as string),
        JSON.parse(SERVICE_ACCOUNT_FILE),
        'the pasted file is sent, its line breaks dropped by the input',
      );
    });

    test('opened for an operation that sends to a Google API, says when a service account fits, without choosing one', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          context({
            realm: WORKSPACE,
            card: {
              name: 'Budget',
              module: `${REALM}budget`,
              exportName: 'Budget',
            },
            operation: {
              name: 'values',
              label: 'Read the budget',
              base: 'callApi',
              method: 'GET',
              destination: {
                href: 'https://sheets.googleapis.com/v4/spreadsheets/',
                host: 'sheets.googleapis.com',
                path: '/v4/spreadsheets/',
                registrableDomain: 'googleapis.com',
              },
              slots: [{ name: 'userKey', key: 'userKey' }],
            },
          }),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert
        .dom('[data-test-google-destination-hint]')
        .includesText('This request goes to a Google API.');
      assert
        .dom('[data-test-radio-choice="static"] input')
        .isChecked('the page doesn’t choose for the user');
      await click('[data-test-radio-choice="google-service-account"] input');
      assert.dom('[data-test-google-destination-hint]').doesNotExist();
    });

    test('opened for an operation elsewhere, says nothing about service accounts', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          context({
            realm: WORKSPACE,
            operation: {
              name: 'forecast',
              label: 'Get the forecast',
              base: 'callApi',
              method: 'GET',
              destination: {
                href: 'https://api.weather.co.uk/v2/',
                host: 'api.weather.co.uk',
                path: '/v2/',
                registrableDomain: 'weather.co.uk',
              },
              slots: [{ name: 'userKey', key: 'userKey' }],
            },
          }),
      });
      visitShell(
        `enter-key#card=${encodeURIComponent(CARD)}&operation=forecast`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert.dom('[data-test-google-destination-hint]').doesNotExist();
    });

    test('the key page names a service account, and replaces it with a new key file', async function (assert) {
      let serviceAccount = {
        ...KEYS[1],
        id: 'key-sa',
        name: 'Sheets',
        kind: 'google-service-account',
      };
      serve({
        'GET _user-keys': () =>
          json(200, keyResources([KEYS[1], serviceAccount])),
        'GET _key-shares': () => json(200, { data: [] }),
        'PATCH _user-keys/key-sa': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-sa',
              attributes: attributesOf(serviceAccount),
            },
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Sheets"]');
      assert
        .dom('[data-test-key-row="Sheets"] [data-test-key-kind]')
        .hasText('Google service account');
      assert
        .dom('[data-test-key-row="Maps"] [data-test-key-kind]')
        .doesNotExist('a key pasted in as it is goes unlabelled');
      await click('[data-test-key-row="Sheets"] [data-test-key-replace]');
      await settled();
      assert
        .dom('[data-test-key-replace-form] [data-test-key-value]')
        .doesNotExist();
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText(
          'sets the key file, the scopes and who it acts as all anew',
        );
      assert.dom('[data-test-key-replace-save]').isDisabled();
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      await fillIn(
        '[data-test-service-account-scopes]',
        'https://www.googleapis.com/auth/spreadsheets',
      );
      await click('[data-test-key-replace-save]');
      assert.deepEqual(ticketRequests(), [
        { action: 'replace', keyId: 'key-sa' },
      ]);
      assert.deepEqual(requests.find((r) => r.method === 'PATCH')!.body, {
        data: {
          type: 'user-key',
          id: 'key-sa',
          attributes: {
            value: SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          },
        },
        meta: { ticket: 'ticket-1' },
      });
    });

    test('the key page shows a service account’s email, subject and scopes, and a replace starts from them', async function (assert) {
      const SHEETS = 'https://www.googleapis.com/auth/spreadsheets';
      const DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
      const CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
      let serviceAccount = {
        ...KEYS[1],
        id: 'key-sa',
        name: 'Sheets',
        kind: 'google-service-account',
        serviceAccount: {
          email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
          subject: 'owner@example.com',
          scopes: [SHEETS, DRIVE, CALENDAR],
        },
      };
      let actsAsItself = {
        ...serviceAccount,
        id: 'key-sa-2',
        name: 'Reports',
        serviceAccount: { ...serviceAccount.serviceAccount, subject: null },
      };
      serve({
        'GET _user-keys': () =>
          json(200, keyResources([KEYS[1], actsAsItself, serviceAccount])),
        'GET _key-shares': () => json(200, { data: [] }),
        'PATCH _user-keys/key-sa': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-sa',
              attributes: attributesOf(serviceAccount),
            },
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Sheets"]');
      let row = '[data-test-key-row="Sheets"]';
      assert
        .dom(`${row} [data-test-service-account-detail="email"]`)
        .hasText('sheets-bot@boxel-test.iam.gserviceaccount.com');
      assert
        .dom(`${row} [data-test-service-account-detail="subject"]`)
        .hasText('owner@example.com');
      assert.deepEqual(
        [
          ...document.querySelectorAll(
            `${row} [data-test-service-account-scope]`,
          ),
        ].map((scope) => scope.textContent?.trim()),
        [SHEETS, DRIVE, CALENDAR],
      );
      assert
        .dom(
          '[data-test-key-row="Reports"] [data-test-service-account-detail="subject"]',
        )
        .hasText('The service account itself');
      assert
        .dom('[data-test-key-row="Maps"] [data-test-service-account-details]')
        .doesNotExist('a key pasted in as it is has none');

      await click(`${row} [data-test-key-replace]`);
      await settled();
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText('start as the key has them now');
      assert
        .dom('[data-test-service-account-subject]')
        .hasValue('owner@example.com', 'Act as starts as it is');
      assertShowsEveryScope(assert, [SHEETS, DRIVE, CALENDAR]);
      assert
        .dom('[data-test-key-replace-save]')
        .isDisabled('the key file is still chosen anew');
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-service-account-changed]')
        .doesNotExist(
          'a key file for the same service account changes nothing',
        );
      await click('[data-test-key-replace-save]');
      assert.deepEqual(
        requests.find((r) => r.method === 'PATCH')!.body.data.attributes,
        {
          value: SERVICE_ACCOUNT_FILE,
          subject: 'owner@example.com',
          scopes: [SHEETS, DRIVE, CALENDAR],
        },
        'leaving the fields as they are keeps them',
      );
    });

    test('a key file for another service account says the prefilled fields were granted to the old one', async function (assert) {
      let serviceAccount = {
        ...KEYS[1],
        id: 'key-sa',
        name: 'Sheets',
        kind: 'google-service-account',
        serviceAccount: {
          email: 'reports-bot@boxel-test.iam.gserviceaccount.com',
          subject: 'owner@example.com',
          scopes: ['openid'],
        },
      };
      serve({
        'GET _user-keys': () => json(200, keyResources([serviceAccount])),
        'GET _key-shares': () => json(200, { data: [] }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Sheets"]');
      await click('[data-test-key-row="Sheets"] [data-test-key-replace]');
      await settled();
      assert.dom('[data-test-service-account-changed]').doesNotExist();
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-service-account-changed]')
        .includesText(
          'This key file is for sheets-bot@boxel-test.iam.gserviceaccount.com, not reports-bot@boxel-test.iam.gserviceaccount.com',
        );
    });

    test('a replace cancelled after editing the prefilled fields starts from the key again', async function (assert) {
      let serviceAccount = {
        ...KEYS[1],
        id: 'key-sa',
        name: 'Sheets',
        kind: 'google-service-account',
        serviceAccount: {
          email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
          subject: 'owner@example.com',
          scopes: ['openid'],
        },
      };
      serve({
        'GET _user-keys': () => json(200, keyResources([serviceAccount])),
        'GET _key-shares': () => json(200, { data: [] }),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Sheets"]');
      await click('[data-test-key-row="Sheets"] [data-test-key-replace]');
      await settled();
      await fillIn('[data-test-service-account-subject]', '');
      await fillIn('[data-test-service-account-scopes]', 'email');
      await click('[data-test-key-replace-form] button[type="button"]');
      await click('[data-test-key-row="Sheets"] [data-test-key-replace]');
      await settled();
      assert
        .dom('[data-test-service-account-subject]')
        .hasValue('owner@example.com');
      assert.dom('[data-test-service-account-scopes]').hasValue('openid');
    });
  });

  module('entering the kind of key an operation takes', function () {
    // A window opened for an operation whose `userKey` slots take `kinds`,
    // sending to `host`.
    function kindsContext(
      kinds: string[],
      host = 'sheets.googleapis.com',
      slots: { name: string; key: string; kinds: string[] }[] = [
        { name: 'userKey', key: 'userKey', kinds },
      ],
    ) {
      return () =>
        context({
          realm: WORKSPACE,
          card: {
            name: 'Budget',
            module: `${REALM}budget`,
            exportName: 'Budget',
          },
          operation: {
            name: 'values',
            label: 'Read the budget',
            base: 'callApi',
            method: 'GET',
            destination: {
              href: `https://${host}/v4/`,
              host,
              path: '/v4/',
              registrableDomain: host.split('.').slice(-2).join('.'),
            },
            slots,
          },
        });
    }

    test('opened for an operation that takes one kind of key, asks for it without a choice', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext(['google-service-account']),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert.dom('[data-test-radio-choices="kind"]').doesNotExist();
      assert
        .dom('[data-test-only-kind="google-service-account"]')
        .includesText('Budget needs a Google service account.');
      assert
        .dom('[data-test-key-field="key-file"]')
        .exists('the page shows the service account’s own fields');
      assert.dom('[data-test-google-destination-hint]').doesNotExist();
    });

    test('opened for an operation that takes only a pasted key, asks for one and doesn’t offer a key file as a service account', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext(['static']),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert.dom('[data-test-radio-choices="kind"]').doesNotExist();
      assert
        .dom('[data-test-only-kind="static"]')
        .includesText('Budget needs an API key or token.');
      assert.dom('[data-test-google-destination-hint]').doesNotExist();
      await fillIn('[data-test-key-value]', SERVICE_ACCOUNT_FILE);
      assert.dom('[data-test-pasted-key-file]').exists();
      assert.dom('[data-test-use-service-account]').doesNotExist();
      assert
        .dom('[data-test-pasted-key-file]')
        .includesText('Budget needs a key or token sent as it is');
    });

    test('opened for an operation that takes only a connected account, goes on to connect one', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext(
          ['oauth'],
          'api.github.com',
        ),
      });
      visitShell(
        `enter-key#card=${encodeURIComponent(CARD)}&operation=values&then=approve`,
      );
      await render(EnterKeyPage);
      await waitUntil(() => navigations.length > 0);
      let [move] = navigations;
      assert.strictEqual(move?.how, 'replace');
      let url = new URL(move!.url!, window.location.href);
      assert.true(url.pathname.endsWith('/connect'));
      let fragment = new URLSearchParams(url.hash.slice(1));
      assert.strictEqual(fragment.get('card'), CARD);
      assert.strictEqual(fragment.get('operation'), 'values');
      assert.strictEqual(
        fragment.get('then'),
        'approve',
        'the connect page goes back to the approval too',
      );
    });

    test('opened for an operation that takes several kinds, offers only those', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext(
          ['static', 'oauth'],
          'api.github.com',
        ),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert.dom('[data-test-only-kind]').doesNotExist();
      assert.dom('[data-test-radio-choice="static"] input').isChecked();
      assert
        .dom('[data-test-radio-choice="oauth-client"]')
        .includesText('Connected account (OAuth)');
      assert
        .dom('[data-test-radio-choice="google-service-account"]')
        .doesNotExist();

      await click('[data-test-radio-choice="oauth-client"] input');
      assert
        .dom('[data-test-connect-instead]')
        .exists('a connected account is signed in to, not entered');
      assert.dom('[data-test-oauth-client-id-input]').doesNotExist();
      assert.dom('[data-test-enter-key-save]').doesNotExist();
      await click('[data-test-go-to-connect]');
      let [move] = navigations;
      assert.strictEqual(move?.how, 'assign');
      assert.true(
        new URL(move!.url!, window.location.href).pathname.endsWith('/connect'),
      );
    });

    test('opened for an operation with several slots, offers the kinds any of its own keys take', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext([], 'api.github.com', [
          { name: 'token', key: 'userKey', kinds: ['static'] },
          { name: 'signin', key: 'userKey', kinds: ['oauth'] },
          {
            name: 'apiKey',
            key: 'apiKey',
            kinds: ['google-service-account'],
          },
        ]),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert.dom('[data-test-radio-choice="static"]').exists();
      assert.dom('[data-test-radio-choice="oauth-client"]').exists();
      assert
        .dom('[data-test-radio-choice="google-service-account"]')
        .doesNotExist('a workspace key’s slot is not the user’s to fill here');
    });

    test('opened for an operation that takes a service account or a connected account, starts on the first of them', async function (assert) {
      serve({
        'POST _secure-window/context': kindsContext([
          'google-service-account',
          'oauth',
        ]),
      });
      visitShell(`enter-key#card=${encodeURIComponent(CARD)}&operation=values`);
      await render(EnterKeyPage);
      await waitFor('[data-test-opened-for]');
      assert
        .dom('[data-test-radio-choice="google-service-account"] input')
        .isChecked();
      assert.dom('[data-test-radio-choice="static"]').doesNotExist();
      assert.dom('[data-test-google-destination-hint]').doesNotExist();
    });
  });

  module('sharing a key', function () {
    const OTHER_REALM = 'https://realm-server.test/someone/dashboard/';

    function shares() {
      return ({ body }: { body: any }) =>
        json(201, {
          data: {
            type: 'key-share',
            id: 'share-9',
            attributes: { ...body.data.attributes, state: 'active' },
          },
        });
    }

    // The context of a workspace chosen on the page, by its address.
    function chosenWorkspace(opensToAnonymous = false) {
      return ({ body }: { body: any }) =>
        context({
          realm: {
            ...WORKSPACE,
            url: body.data.attributes.realm,
            opensToAnonymous,
          },
        });
    }

    test('from the key page, picks a workspace the user writes, with a ticket for that key and realm', async function (assert) {
      serve({
        'GET _secure-window/realms': () =>
          json(200, {
            data: [
              {
                type: 'secure-window-realm',
                id: OTHER_REALM,
                attributes: { name: 'Dashboard' },
              },
              {
                type: 'secure-window-realm',
                id: REALM,
                attributes: { name: 'Team Workspace' },
              },
            ],
          }),
        'POST _secure-window/context': chosenWorkspace(),
        'POST _key-shares': shares(),
      });
      visitShell('keys/key-2/share');
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert.dom('[data-test-share-key-key]').includesText('Maps');
      assert.dom('[data-test-key-picker]').doesNotExist('the key is chosen');
      assert.dom('[data-test-key-value]').doesNotExist('no key is entered');
      assert
        .dom('[data-test-share-label]')
        .hasValue('Maps', 'labelled with its key’s name until one is typed');
      assert.dom('[data-test-share-key-save]').isDisabled();

      await click(WORKSPACE_TRIGGER);
      assert.strictEqual(workspaceOptions().length, 2);
      assert.dom(workspaceSearch()).hasAttribute('role', 'combobox');
      assert
        .dom(activeOption())
        .hasText(
          'Dashboard',
          'the highlighted option is named for a screen reader',
        );
      await triggerKeyEvent(workspaceSearch(), 'keydown', 'ArrowDown');
      assert.dom(activeOption()).hasText('Team Workspace');
      await triggerKeyEvent(workspaceSearch(), 'keydown', 'Escape');
      assert
        .dom(WORKSPACE_TRIGGER)
        .hasAttribute('aria-expanded', 'false', 'Escape closes the list');

      await click(WORKSPACE_TRIGGER);
      await fillIn(workspaceSearch(), 'team');
      assert.strictEqual(workspaceOptions().length, 1);
      await triggerKeyEvent(workspaceSearch(), 'keydown', 'Enter');
      assert.dom(WORKSPACE_TRIGGER).hasText('Team Workspace');
      await fillIn('[data-test-share-label]', 'Team maps');
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(ticketRequests(), [
        { action: 'share', keyId: 'key-2', realm: REALM },
      ]);
      assert.deepEqual(requests.find((r) => r.path === '_key-shares')!.body, {
        data: {
          type: 'key-share',
          attributes: { realm: REALM, keyId: 'key-2', label: 'Team maps' },
        },
        meta: { ticket: 'ticket-1' },
      });
      assert.dom('[data-test-keys-done-label]').hasText('Team maps');
      assert.deepEqual(navigations, [], 'the window stays open');
      await click('[data-test-keys-done-close]');
      assert.deepEqual(
        navigations,
        [{ how: 'replace', url: '/secure/keys' }],
        'and goes back to the key page',
      );
    });

    test('from the key page, a workspace picked that lets people who aren’t signed in use its shared keys takes only a key that allows them', async function (assert) {
      serve({
        'GET _secure-window/realms': () =>
          json(200, {
            data: [
              {
                type: 'secure-window-realm',
                id: OTHER_REALM,
                attributes: { name: 'Dashboard' },
              },
              {
                type: 'secure-window-realm',
                id: REALM,
                attributes: { name: 'Team Workspace' },
              },
            ],
          }),
        'POST _secure-window/context': chosenWorkspace(true),
        'POST _key-shares': shares(),
      });
      visitShell('keys/key-2/share');
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert
        .dom('[data-test-share-key-intro="signed-in"]')
        .exists('until a workspace is picked, nothing is said of anyone else');
      await click(WORKSPACE_TRIGGER);
      await click(workspaceOption('Team Workspace'));
      assert
        .dom('[data-test-share-key-intro="anyone"] strong')
        .hasText('and so will people who aren’t signed in');
      assert
        .dom('[data-test-share-key-key-refuses-text]')
        .hasText(
          'This workspace lets people who aren’t signed in use the keys shared into it, and this key doesn’t allow them. Allow it on your key page first.',
        );
      assert.dom('[data-test-anonymous-use-input]').doesNotExist();
      assert.dom('[data-test-share-key-save]').isDisabled();
      await click('[data-test-share-key-go-to-key]');
      assert.deepEqual(navigations, [{ how: 'replace', url: '/secure/keys' }]);
      assert.false(
        requests.some((r) => r.path === '_key-shares'),
        'nothing is shared',
      );
    });

    test('two workspaces with the same name are told apart by their addresses', async function (assert) {
      const OTHER = 'https://realm-server.test/someone/another/';
      const DASHBOARD = 'https://realm-server.test/someone/dashboard/';
      serve({
        'GET _secure-window/realms': () =>
          json(200, {
            data: [
              [DASHBOARD, 'Dashboard'],
              [OTHER, 'Team Workspace'],
              [REALM, 'Team Workspace'],
            ].map(([id, name]) => ({
              type: 'secure-window-realm',
              id,
              attributes: { name },
            })),
          }),
        'POST _secure-window/context': chosenWorkspace(),
        'POST _key-shares': shares(),
      });
      visitShell('keys/key-2/share');
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      await click(WORKSPACE_TRIGGER);
      assert
        .dom(OPTION_META, workspaceOption('Dashboard'))
        .doesNotExist('a name of its own needs no address');
      assert.deepEqual(
        [
          ...workspaceOptions().flatMap((option) => [
            ...option.querySelectorAll(OPTION_META),
          ]),
        ].map((e) => e.textContent?.trim()),
        [OTHER, REALM].map((url) => url.replace('https://', '')),
      );
      await click(
        workspaceOptions().find((e) =>
          e.textContent?.includes(OTHER.replace('https://', '')),
        )!,
      );
      assert
        .dom(`${WORKSPACE_TRIGGER} ${OPTION_META}`)
        .hasText(OTHER.replace('https://', ''));
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert
        .dom('[data-test-keys-done]')
        .includesText(`Team Workspace (${OTHER.replace('https://', '')})`);
    });

    test('opened for a workspace, picks one of the user’s keys, then closes', async function (assert) {
      serve({
        'POST _secure-window/context': ({ body }) => {
          assert.strictEqual(
            body.data.attributes.realm,
            REALM_PREFIX,
            'the fragment’s realm is only asked about',
          );
          return context({ realm: WORKSPACE });
        },
        'POST _key-shares': shares(),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM_PREFIX)}`);
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert.dom('[data-test-opened-for-realm]').hasText('Team Workspace');
      assert
        .dom('[data-test-key-picker-prompt]')
        .hasText('Select a key', 'with several keys, it asks for one');
      assert
        .dom('[data-test-key-picker-prompt]')
        .doesNotHaveClass('visually-hidden');
      assert.dom(WORKSPACE_TRIGGER).doesNotExist();
      assert.dom('[data-test-key-value]').doesNotExist('no key is entered');
      await click('[data-test-key-choice="Maps"] input');
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        ticketRequests(),
        [{ action: 'share', keyId: 'key-2', realm: REALM }],
        'the ticket is for the realm the server described',
      );
      assert.strictEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_key-shares')!
          .body.data.attributes.realm,
        REALM,
        'and so is the share',
      );
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('a workspace that lets only signed-in people use its shared keys says so, and says nothing of anyone else even for a key that allows them', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(
            200,
            keyResources([
              KEYS[0],
              { ...KEYS[1], anonymous: true, anonymousDailyCap: 50 },
            ]),
          ),
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
        'POST _key-shares': shares(),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM)}`);
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert
        .dom('[data-test-share-key-intro="signed-in"]')
        .hasText(
          'People who can access the workspace can use the key in their requests. They never see the key itself. Only signed-in people with access to this workspace can use it. People who aren’t signed in can’t. Requests made by people who have access to this workspace will consume your quota and/or be billed against your account with this service provider.',
        );
      assert
        .dom('[data-test-share-key-intro="signed-in"] strong')
        .hasText('Only signed-in people');
      await click('[data-test-key-choice="Maps"] input');
      assert
        .dom('[data-test-share-key-intro="signed-in"]')
        .exists('the key allowing them changes nothing here');
      assert.dom('[data-test-share-key-key-allows]').doesNotExist();
      assert.dom('[data-test-share-key-key-refuses]').doesNotExist();
      assert.dom('[data-test-anonymous-use]').doesNotExist();
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_key-shares')!
          .body.data.attributes,
        { realm: REALM, keyId: 'key-2', label: 'Maps' },
      );
    });

    test('a workspace that lets people who aren’t signed in use its shared keys says they will, shares a key that allows them, and refuses one that doesn’t', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(
            200,
            keyResources([
              KEYS[0],
              {
                ...KEYS[1],
                anonymous: true,
                anonymousDailyCap: 50,
                anonymousMonthlyCap: 1500,
              },
            ]),
          ),
        'POST _secure-window/context': () =>
          context({ realm: { ...WORKSPACE, opensToAnonymous: true } }),
        'POST _key-shares': shares(),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM)}`);
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert
        .dom('[data-test-share-key-intro="anyone"]')
        .hasText(
          'People who can access the workspace can use the key in their requests, and so will people who aren’t signed in: this workspace lets anyone who opens its cards make calls with a shared key. Nobody sees the key itself. Requests made by anyone who opens those cards will consume your quota and/or be billed against your account with this service provider.',
        );
      assert
        .dom('[data-test-share-key-intro="anyone"] strong')
        .hasText('and so will people who aren’t signed in');

      await click('[data-test-key-choice="Weather service"] input');
      assert
        .dom('[data-test-share-key-key-refuses-text]')
        .includesText('this key doesn’t allow them');
      assert.dom('[data-test-share-key-go-to-key]').hasText('Go to your keys');
      assert.dom('[data-test-share-key-key-allows]').doesNotExist();
      assert.dom('[data-test-share-key-save]').isDisabled();

      await click('[data-test-key-choice="Maps"] input');
      assert.dom('[data-test-share-key-key-refuses]').doesNotExist();
      assert
        .dom('[data-test-share-key-key-allows-text]')
        .hasText(
          'This key allows it, up to 50 calls a day and 1500 a month all together. Sharing it here means they will use it.',
        );
      assert.dom('[data-test-anonymous-use-input]').doesNotExist();
      assert.dom('[data-test-share-key-save]').isEnabled();

      await click('[data-test-key-choice="Weather service"] input');
      assert
        .dom('[data-test-share-key-save]')
        .isDisabled('switching keys reads the page again');
      assert.dom('[data-test-share-key-key-refuses]').exists();
      await click('[data-test-key-choice="Maps"] input');
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'POST' && r.path === '_key-shares')!
          .body.data.attributes,
        { realm: REALM, keyId: 'key-2', label: 'Maps' },
        'no anonymous attributes are sent',
      );
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('from the key page, a key that allows people who aren’t signed in says they will use it once shared into a workspace that lets them', async function (assert) {
      serve({
        'GET _user-keys': () =>
          json(
            200,
            keyResources([
              KEYS[0],
              { ...KEYS[1], anonymous: true, anonymousDailyCap: null },
            ]),
          ),
        'GET _secure-window/realms': () =>
          json(200, {
            data: [
              {
                type: 'secure-window-realm',
                id: REALM,
                attributes: { name: 'Team Workspace' },
              },
            ],
          }),
        'POST _secure-window/context': chosenWorkspace(true),
        'POST _key-shares': shares(),
      });
      visitShell('keys/key-2/share');
      await render(SharePage);
      await waitFor('[data-test-share-key-key-allows]');
      assert
        .dom('[data-test-share-key-key-allows-text]')
        .hasText(
          'This key allows it. Sharing it here means they will use it.',
          'a key with no cap says no cap',
        );
      await click('[data-test-share-key-save]');
      await waitFor('[data-test-keys-done]');
      assert
        .dom('[data-test-share-key-done-anonymous]')
        .hasText('People who aren’t signed in will use it too');
    });

    test('with no keys, says to add one on the key page first', async function (assert) {
      serve({
        'GET _user-keys': () => json(200, keyResources([])),
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM)}`);
      await render(SharePage);
      await waitFor('[data-test-key-picker-empty]');
      await click('[data-test-key-picker-go-to-keys]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/keys#${new URLSearchParams({
            back: `share-key#realm=${encodeURIComponent(REALM)}`,
          })}`,
        },
      ]);
    });

    test('a link naming a key that isn’t the user’s says so and doesn’t offer to try again', async function (assert) {
      serve({
        'GET _secure-window/realms': () => json(200, { data: [] }),
      });
      visitShell('?mode=share-key#key=key-9');
      await render(SharePage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-error-message]')
        .hasText('This key isn’t one of yours. It may have been deleted.');
      assert.dom('[data-test-keys-retry]').doesNotExist();
    });

    test('a link naming neither a key nor a workspace says so and doesn’t offer to try again', async function (assert) {
      visitShell('?mode=share-key');
      await render(SharePage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-error-message]')
        .hasText(
          'This link doesn’t name a key or a workspace to share it with.',
        );
      assert.dom('[data-test-keys-retry]').doesNotExist();
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-detail="Message"]')
        .hasText('This page names neither a key nor a workspace.');
      assert.false(
        requests.some((r) => /^_(user-keys|secure-window)/.test(r.path)),
        'no key or workspace is asked for',
      );
    });

    test('a reader who isn’t a direct writer is told someone with direct write access must set it up', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          context({ realm: { ...WORKSPACE, directWriter: false } }),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM)}`);
      await render(SharePage);
      await waitFor('[data-test-keys-needs-admin]');
      assert
        .dom('[data-test-keys-needs-admin] h1')
        .hasText(
          'Someone with direct write access to this workspace needs to set this up',
        );
      assert
        .dom('[data-test-needs-admin-address]')
        .hasText('realm-server.test/someone/workspace/');
      assert.dom('input').doesNotExist('nothing to type');
      assert.false(
        requests.some((r) => r.path === '_user-keys'),
        'the user’s keys are not even listed',
      );
    });
  });

  module('sharing a key in place of a suspended one', function () {
    const SHARE = {
      id: 'share-4',
      realm: REALM,
      label: 'Team weather',
      owner: '@former:example.test',
      state: 'suspended',
      suspensionReason: 'owner-lost-write',
    };

    function shares(share: Record<string, unknown>) {
      return () =>
        json(200, {
          data: [{ type: 'key-share', id: share.id, attributes: { ...share } }],
        });
    }

    test('puts one of the user’s keys in, with a ticket for that key and share', async function (assert) {
      serve({
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
        'GET _key-shares': (request) => {
          assert.strictEqual(
            request.url.searchParams.get('realm'),
            REALM,
            'the shares are those of the realm the server described',
          );
          return shares(SHARE)();
        },
        'POST _key-shares/share-4/swap': () =>
          json(200, {
            data: {
              type: 'key-share',
              id: 'share-4',
              attributes: { ...SHARE, state: 'active', keyId: 'key-1' },
            },
          }),
      });
      visitShell(
        `swap-key#realm=${encodeURIComponent(REALM_PREFIX)}&share=share-4`,
      );
      await render(SwapKeyPage);
      await waitFor('[data-test-swap-key-form]');
      assert.dom('[data-test-swap-share-label]').hasText('Team weather');
      assert
        .dom('[data-test-swap-share]')
        .includesText('no longer has direct write access to this workspace');
      assert.dom('[data-test-key-value]').doesNotExist('no key is entered');
      await click('[data-test-key-choice="Weather service"] input');
      await click('[data-test-swap-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.dom('[data-test-keys-heading]').hasText('Key shared');
      assert.deepEqual(ticketRequests(), [
        { action: 'swap', keyId: 'key-1', shareId: 'share-4' },
      ]);
      assert.deepEqual(
        requests.find((r) => r.path === '_key-shares/share-4/swap')!.body,
        {
          data: { type: 'key-share', attributes: { keyId: 'key-1' } },
          meta: { ticket: 'ticket-1' },
        },
      );
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('in a workspace that lets people who aren’t signed in use shared keys, a key is swapped in only if it allows them, and the page says they will use it', async function (assert) {
      let allowing = KEYS.map((k) =>
        k.id === 'key-1' ? { ...k, anonymous: true, anonymousDailyCap: 50 } : k,
      );
      serve({
        'POST _secure-window/context': () =>
          context({ realm: { ...WORKSPACE, opensToAnonymous: true } }),
        'GET _key-shares': shares(SHARE),
      });
      visitShell(`swap-key#realm=${encodeURIComponent(REALM)}&share=share-4`);
      await render(SwapKeyPage);
      await waitFor('[data-test-swap-key-form]');
      await click('[data-test-key-choice="Weather service"] input');
      assert.dom('[data-test-swap-key-key-refuses]').exists();
      assert
        .dom('[data-test-swap-key-save]')
        .isDisabled('a key that doesn’t allow them isn’t swapped in');

      serve({ 'GET _user-keys': () => json(200, keyResources(allowing)) });
      visitShell(`swap-key#realm=${encodeURIComponent(REALM)}&share=share-4`);
      await render(SwapKeyPage);
      await waitFor('[data-test-swap-key-form]');
      await click('[data-test-key-choice="Weather service"] input');
      assert
        .dom('[data-test-swap-key-key-allows] strong')
        .hasText('they will use this key');
      assert.dom('[data-test-swap-key-key-allows]').includesText('up to 50');
      assert.dom('[data-test-swap-key-save]').isNotDisabled();
    });

    test('opened by the CLI, tells it once the key is in, and only then', async function (assert) {
      let submitted: { action: string; fields: [string, string][] }[] = [];
      let submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
        submitted.push({
          action: this.action,
          fields: [...new FormData(this).entries()] as [string, string][],
        });
      };
      try {
        serve({
          'POST _secure-window/context': () => context({ realm: WORKSPACE }),
          'GET _key-shares': shares(SHARE),
          'POST _key-shares/share-4/swap': () =>
            json(200, {
              data: {
                type: 'key-share',
                id: 'share-4',
                attributes: { ...SHARE, state: 'active', keyId: 'key-1' },
              },
            }),
        });
        visitShell(
          `swap-key#realm=${encodeURIComponent(REALM)}&share=share-4&cli_port=51234&cli_state=${'c'.repeat(32)}`,
        );
        await render(SwapKeyPage);
        await waitFor('[data-test-swap-key-form]');
        await click('[data-test-key-choice="Weather service"] input');
        await click('[data-test-swap-key-save]');
        await waitFor('[data-test-keys-done]');
        await click('[data-test-keys-close]');
        assert.deepEqual(submitted, [
          {
            action: 'http://127.0.0.1:51234/callback',
            fields: [
              ['state', 'c'.repeat(32)],
              ['window_outcome', 'done'],
            ],
          },
        ]);
        assert.deepEqual(
          navigations,
          [{ how: 'close' }],
          'the window goes to the CLI, and Close after that only closes',
        );
      } finally {
        HTMLFormElement.prototype.submit = submit;
      }
    });

    for (let [name, button] of [
      ['Cancel', '[data-test-keys-cancel]'],
      ['Close', '[data-test-keys-close]'],
    ]) {
      test(`opened by the CLI, ${name} tells it the swap was cancelled, and swaps nothing`, async function (assert) {
        let submitted: { action: string; fields: [string, string][] }[] = [];
        let submit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
          submitted.push({
            action: this.action,
            fields: [...new FormData(this).entries()] as [string, string][],
          });
        };
        try {
          serve({
            'POST _secure-window/context': () => context({ realm: WORKSPACE }),
            'GET _key-shares': shares(SHARE),
          });
          visitShell(
            `swap-key#realm=${encodeURIComponent(REALM)}&share=share-4&cli_port=51234&cli_state=${'c'.repeat(32)}`,
          );
          await render(SwapKeyPage);
          await waitFor('[data-test-swap-key-form]');
          await click('[data-test-key-choice="Weather service"] input');
          await click(button!);
          assert.deepEqual(submitted, [
            {
              action: 'http://127.0.0.1:51234/callback',
              fields: [
                ['state', 'c'.repeat(32)],
                ['window_outcome', 'cancelled'],
              ],
            },
          ]);
          assert.false(
            requests.some((r) => r.path === '_key-shares/share-4/swap'),
            'nothing is swapped',
          );
          assert.deepEqual(navigations, [], 'the window goes to the CLI');
        } finally {
          HTMLFormElement.prototype.submit = submit;
        }
      });
    }

    test('opened without the CLI, offers no Cancel', async function (assert) {
      serve({
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
        'GET _key-shares': shares(SHARE),
      });
      visitShell(`swap-key#realm=${encodeURIComponent(REALM)}&share=share-4`);
      await render(SwapKeyPage);
      await waitFor('[data-test-swap-key-form]');
      assert.dom('[data-test-keys-cancel]').doesNotExist();
    });

    test('a link naming a share the workspace doesn’t have says so and doesn’t offer to try again', async function (assert) {
      serve({
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
        'GET _key-shares': shares(SHARE),
      });
      visitShell(
        `?mode=swap-key#realm=${encodeURIComponent(REALM)}&share=share-9`,
      );
      await render(SwapKeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert
        .dom('[data-test-error-message]')
        .hasText(
          'This shared key isn’t in that workspace. It may have been removed.',
        );
      assert.dom('[data-test-keys-retry]').doesNotExist();
    });

    test('a share that is working has nothing to put a key in place of', async function (assert) {
      serve({
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
        'GET _key-shares': shares({
          ...SHARE,
          state: 'active',
          suspensionReason: null,
        }),
      });
      visitShell(`swap-key#realm=${encodeURIComponent(REALM)}&share=share-4`);
      await render(SwapKeyPage);
      await waitFor('[data-test-swap-key-active]');
      assert.dom('[data-test-swap-key-form]').doesNotExist();
    });

    test('a reader who isn’t a direct writer is told someone with direct write access must set it up', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          context({ realm: { ...WORKSPACE, directWriter: false } }),
      });
      visitShell(`swap-key#realm=${encodeURIComponent(REALM)}&share=share-4`);
      await render(SwapKeyPage);
      await waitFor('[data-test-keys-needs-admin]');
      assert.dom('input').doesNotExist();
    });
  });

  module('replacing the key an operation sends', function () {
    const FORECAST = {
      realm: WORKSPACE,
      card: {
        name: 'Weather',
        module: `${REALM}weather`,
        exportName: 'Weather',
      },
      operation: {
        name: 'forecast',
        label: 'Get the forecast',
        base: 'callApi',
        method: 'GET',
        destination: {
          href: 'https://api.weather.co.uk/v2/',
          host: 'api.weather.co.uk',
          path: '/v2/',
          registrableDomain: 'weather.co.uk',
        },
      },
    };

    function forecastWith(
      slots: { name: string; key: string; bound: unknown }[],
      realm: Record<string, unknown> = WORKSPACE,
    ) {
      return context({
        ...FORECAST,
        realm,
        operation: { ...FORECAST.operation, slots },
      });
    }

    const OPENED = `replace-key#card=${encodeURIComponent(CARD)}&operation=forecast`;

    test('replaces the key the user’s binding sends, which the server names, then closes', async function (assert) {
      serve({
        'POST _secure-window/context': ({ body }) => {
          assert.deepEqual(
            body.data.attributes,
            {
              target: { kind: 'instance', url: CARD },
              operation: 'forecast',
              bindings: true,
            },
            'asks what is bound to the operation’s slots',
          );
          return forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
          ]);
        },
        'PATCH _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: attributesOf(KEYS[0]),
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-form]');
      assert
        .dom('[data-test-opened-for-operation]')
        .hasText('Get the forecast');
      assert.dom('[data-test-replace-key-name]').hasText('Weather service');
      assert
        .dom('[data-test-replace-key-rejected]')
        .hasText(
          'weather.co.uk rejected this key. It will not be used until you replace it.',
        );
      assert.dom('[data-test-key-name]').doesNotExist('a replace has no name');
      assert.dom('[data-test-replace-key-save]').isDisabled();
      await fillIn('[data-test-key-value]', 'sk-new-forecast');
      await click('[data-test-replace-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(ticketRequests(), [
        { action: 'replace', keyId: 'key-1' },
      ]);
      assert.deepEqual(requests.find((r) => r.method === 'PATCH')!.body, {
        data: {
          type: 'user-key',
          id: 'key-1',
          attributes: { value: 'sk-new-forecast' },
        },
        meta: { ticket: 'ticket-1' },
      });
      assert.dom('[data-test-keys-done-name]').hasText('Weather service');
      assert.dom('[data-test-keys-done-next]').includesText('Weather');
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('a refused replace says why and keeps the form', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
          ]),
        'PATCH _user-keys/key-1': () => refusal(404, 'no such key'),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-form]');
      await fillIn('[data-test-key-value]', 'sk-new-forecast');
      await click('[data-test-replace-key-save]');
      await waitFor('[data-test-keys-error]');
      assert.dom('[data-test-keys-error]').hasText('No such key.');
      assert.dom('[data-test-replace-key-form]').exists();
      assert.deepEqual(navigations, []);
    });

    test('a service account is replaced with a new key file, subject and scopes', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: {
                  id: 'key-1',
                  name: 'Sheets',
                  kind: 'google-service-account',
                },
              },
            },
          ]),
        'PATCH _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: {
                ...attributesOf(KEYS[0]),
                kind: 'google-service-account',
              },
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-form]');
      assert.true(
        requests.some(
          (r) => r.method === 'GET' && r.path === '_user-keys/key-1',
        ),
        'asks for the key’s details',
      );
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText(
          'sets the key file, the scopes and who it acts as all anew',
          'a key whose details aren’t known is set anew',
        );
      assert.dom('[data-test-service-account-subject]').hasValue('');
      assert.dom('[data-test-service-account-scopes]').hasValue('');
      assert
        .dom('[data-test-key-value]')
        .doesNotExist('a service account has no value to paste');
      assert.dom('[data-test-replace-key-save]').isDisabled('no key file yet');
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      await fillIn(
        '[data-test-service-account-scopes]',
        'https://www.googleapis.com/auth/spreadsheets',
      );
      await click('[data-test-replace-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(requests.find((r) => r.method === 'PATCH')!.body, {
        data: {
          type: 'user-key',
          id: 'key-1',
          attributes: {
            value: SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          },
        },
        meta: { ticket: 'ticket-1' },
      });
    });

    function serviceAccountSlot() {
      return forecastWith([
        {
          name: 'userKey',
          key: 'userKey',
          bound: {
            rejected: true,
            key: {
              id: 'key-1',
              name: 'Sheets',
              kind: 'google-service-account',
            },
          },
        },
      ]);
    }

    function serviceAccountKey(serviceAccount: {
      email: string;
      subject: string | null;
      scopes: string[];
    }) {
      return json(200, {
        data: {
          type: 'user-key',
          id: 'key-1',
          attributes: {
            ...attributesOf(KEYS[0]),
            name: 'Sheets',
            kind: 'google-service-account',
            serviceAccount,
          },
        },
      });
    }

    test('a service account whose details are known starts from the user it acts as and its scopes', async function (assert) {
      const SHEETS = 'https://www.googleapis.com/auth/spreadsheets';
      const DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
      const CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
      serve({
        'POST _secure-window/context': () => serviceAccountSlot(),
        'GET _user-keys/key-1': () =>
          serviceAccountKey({
            email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
            subject: 'owner@example.com',
            scopes: [SHEETS, DRIVE, CALENDAR],
          }),
        'PATCH _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: {
                ...attributesOf(KEYS[0]),
                kind: 'google-service-account',
              },
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText('start as the key has them now');
      assert
        .dom('[data-test-service-account-subject]')
        .hasValue('owner@example.com', 'Act as starts as it is');
      assertShowsEveryScope(assert, [SHEETS, DRIVE, CALENDAR]);
      assert
        .dom('[data-test-replace-key-save]')
        .isDisabled('the key file is still chosen anew');
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-service-account-changed]')
        .doesNotExist(
          'a key file for the same service account changes nothing',
        );
      await click('[data-test-replace-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        requests.find((r) => r.method === 'PATCH')!.body.data.attributes,
        {
          value: SERVICE_ACCOUNT_FILE,
          subject: 'owner@example.com',
          scopes: [SHEETS, DRIVE, CALENDAR],
        },
        'leaving the fields as they are keeps them',
      );
    });

    test('a key file for another service account says the prefilled fields were granted to the old one', async function (assert) {
      serve({
        'POST _secure-window/context': () => serviceAccountSlot(),
        'GET _user-keys/key-1': () =>
          serviceAccountKey({
            email: 'reports-bot@boxel-test.iam.gserviceaccount.com',
            subject: null,
            scopes: ['openid'],
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      assert.dom('[data-test-service-account-scopes]').hasValue('openid');
      assert
        .dom('[data-test-service-account-subject]')
        .hasValue('', 'a key acting as itself starts with Act as empty');
      assert.dom('[data-test-service-account-changed]').doesNotExist();
      await chooseKeyFile(SERVICE_ACCOUNT_FILE);
      assert
        .dom('[data-test-service-account-changed]')
        .includesText(
          'This key file is for sheets-bot@boxel-test.iam.gserviceaccount.com, not reports-bot@boxel-test.iam.gserviceaccount.com',
        );
    });

    test('a key file chosen before the key’s details arrive stays, and the fields still start from them', async function (assert) {
      let answer!: () => void;
      let arrived = new Promise<void>((resolve) => (answer = resolve));
      serve({
        'POST _secure-window/context': () => serviceAccountSlot(),
        'GET _user-keys/key-1': async () => {
          await arrived;
          return serviceAccountKey({
            email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
            subject: 'owner@example.com',
            scopes: ['openid'],
          });
        },
      });
      visitShell(OPENED);
      // Not awaited: the key read is held back until answered, and anything
      // that settles waits for it. It is answered on every path: a stubbed
      // request still open keeps its waiter pending, and every later test's
      // `settled()` with it.
      let rendered = render(ReplaceKeyPage);
      try {
        await waitFor('[data-test-service-account-file]');
        assert
          .dom('[data-test-service-account-replace-note]')
          .doesNotExist(
            'nothing is said about the replace until the key is read',
          );
        chooseKeyFileNow(SERVICE_ACCOUNT_FILE);
        await waitFor('[data-test-service-account-email]');
      } finally {
        answer();
      }
      await rendered;
      await settled();
      assert.dom('[data-test-service-account-scopes]').hasValue('openid');
      assert
        .dom('[data-test-service-account-subject]')
        .hasValue('owner@example.com');
      assert
        .dom('[data-test-service-account-email]')
        .includesText('sheets-bot@boxel-test.iam.gserviceaccount.com');
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText('start as the key has them now');
      assert.dom('[data-test-replace-key-save]').isEnabled();
    });

    test('what the owner enters before the key’s details arrive is kept', async function (assert) {
      let answer!: () => void;
      let arrived = new Promise<void>((resolve) => (answer = resolve));
      serve({
        'POST _secure-window/context': () => serviceAccountSlot(),
        'GET _user-keys/key-1': async () => {
          await arrived;
          return serviceAccountKey({
            email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
            subject: 'owner@example.com',
            scopes: ['openid'],
          });
        },
      });
      visitShell(OPENED);
      // Not awaited, and answered on every path, as above.
      let rendered = render(ReplaceKeyPage);
      try {
        await waitFor('[data-test-service-account-scopes]');
        typeNow('[data-test-service-account-scopes]', 'email');
      } finally {
        answer();
      }
      await rendered;
      await settled();
      assert
        .dom('[data-test-replace-key-where]')
        .includesText('workspaces use this key', 'the key read has answered');
      assert.dom('[data-test-service-account-scopes]').hasValue('email');
      assert
        .dom('[data-test-service-account-replace-note]')
        .includesText(
          'all anew',
          'the note doesn’t claim a prefill it skipped',
        );
    });

    test('an OAuth connection is signed in again on the connect page, not replaced', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: {
                  id: 'key-1',
                  name: 'Weather sign-in',
                  kind: 'oauth-connection',
                },
              },
            },
          ]),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-reconnect]');
      assert.dom('[data-test-replace-key-name]').hasText('Weather sign-in');
      assert
        .dom('[data-test-replace-key-rejected]')
        .hasText(
          'weather.co.uk rejected this sign-in. It will not be used until you sign in again.',
        );
      assert
        .dom('[data-test-replace-key-form]')
        .doesNotExist('a connection takes no value');
      await click('[data-test-replace-key-reconnect]');
      assert.deepEqual(navigations, [
        {
          how: 'assign',
          url: `/secure/connect#${new URLSearchParams({
            reconnect: 'key-1',
            back: OPENED,
          })}`,
        },
      ]);
      assert.deepEqual(ticketRequests(), [], 'nothing is changed here');
    });

    test('a key the user shares into the workspace is theirs to replace', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'apiKey',
              key: 'apiKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
                share: {
                  label: 'Team weather',
                  suspended: false,
                  ownedByYou: true,
                  owner: SESSION.user,
                },
              },
            },
          ]),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-form]');
      assert
        .dom('[data-test-replace-key-slot="apiKey"]')
        .includesText('as “Team weather”');
    });

    test('someone else’s shared key: says who can replace it, to a direct writer by name', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'apiKey',
              key: 'apiKey',
              bound: {
                rejected: true,
                key: null,
                share: {
                  label: 'Team weather',
                  suspended: false,
                  ownedByYou: false,
                  owner: '@sharer:example.test',
                },
              },
            },
          ]),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-not-yours]');
      assert.dom('[data-test-replace-key-form]').doesNotExist();
      assert
        .dom('[data-test-replace-key-not-yours]')
        .includesText(
          'weather.co.uk rejected the workspace’s key “Team weather”. Only the person who shared it can replace it.',
        );
      assert
        .dom('[data-test-replace-key-owner]')
        .hasText('@sharer:example.test');
    });

    test('someone else’s shared key: a reader is sent to the workspace’s writers', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith(
            [
              {
                name: 'apiKey',
                key: 'apiKey',
                bound: {
                  rejected: true,
                  key: null,
                  share: { suspended: false, ownedByYou: false },
                },
              },
            ],
            { ...WORKSPACE, directWriter: false },
          ),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-not-yours]');
      assert.dom('[data-test-replace-key-owner]').doesNotExist();
      assert
        .dom('[data-test-replace-key-not-yours]')
        .includesText(
          'weather.co.uk rejected the workspace’s key. Only the person who shared it can replace it.',
          'names no share the reader can’t see',
        );
      assert
        .dom('[data-test-replace-key-not-yours]')
        .includesText('Ask someone with direct write access to Team Workspace');
    });

    test('a slot nothing is bound to has nothing to replace', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([{ name: 'userKey', key: 'userKey', bound: null }]),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-unbound]');
      assert.dom('[data-test-replace-key-form]').doesNotExist();
      assert
        .dom('[data-test-replace-key-unbound]')
        .hasText(
          'None of your keys is approved for this call yet, so there is nothing to replace.',
        );
    });

    test('two slots: each is named, a replaced one says so, and the window closes once both keys are replaced', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'first',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
            {
              name: 'second',
              key: 'userKey',
              bound: { rejected: true, key: { id: 'key-2', name: 'Maps' } },
            },
          ]),
        'PATCH _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: attributesOf(KEYS[0]),
            },
          }),
        'PATCH _user-keys/key-2': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-2',
              attributes: attributesOf(KEYS[1]),
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-slot="second"]');
      assert.dom('[data-test-replace-key-slot="first"] h2').hasText('first');
      await fillIn(
        '[data-test-replace-key-slot="first"] [data-test-key-value]',
        'sk-one',
      );
      await click(
        '[data-test-replace-key-slot="first"] [data-test-replace-key-save]',
      );
      await waitFor(
        '[data-test-replace-key-slot="first"] [data-test-replace-key-replaced]',
      );
      assert
        .dom(
          '[data-test-replace-key-slot="first"] [data-test-replace-key-replaced]',
        )
        .hasText('Weather service is replaced.');
      assert
        .dom(
          '[data-test-replace-key-slot="first"] [data-test-replace-key-form]',
        )
        .doesNotExist();
      assert
        .dom('[data-test-replace-key-slot="second"] h2')
        .hasText('second', 'the remaining row keeps its heading');
      assert
        .dom('[data-test-replace-key-slot="second"] [data-test-key-value]')
        .isFocused('focus moves to the next key’s value');
      assert.deepEqual(navigations, [], 'one key is still to replace');
      await fillIn(
        '[data-test-replace-key-slot="second"] [data-test-key-value]',
        'sk-two',
      );
      await click(
        '[data-test-replace-key-slot="second"] [data-test-replace-key-save]',
      );
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(ticketRequests(), [
        { action: 'replace', keyId: 'key-1' },
        { action: 'replace', keyId: 'key-2' },
      ]);
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('a key the service still accepts, beside one it rejected, isn’t offered for replacing', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'first',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
            {
              name: 'second',
              key: 'userKey',
              bound: { rejected: false, key: { id: 'key-2', name: 'Maps' } },
            },
          ]),
        'PATCH _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: attributesOf(KEYS[0]),
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-accepted]');
      assert
        .dom(
          '[data-test-replace-key-slot="second"] [data-test-replace-key-form]',
        )
        .doesNotExist();
      assert
        .dom('[data-test-replace-key-accepted]')
        .hasText(
          'Maps still works: weather.co.uk accepts it, so there’s nothing to replace.',
        );
      await fillIn('[data-test-key-value]', 'sk-one');
      await click('[data-test-replace-key-save]');
      await waitFor('[data-test-keys-done]');
      assert.deepEqual(
        ticketRequests(),
        [{ action: 'replace', keyId: 'key-1' }],
        'only the rejected key is replaced',
      );
      assert.deepEqual(navigations, [{ how: 'close' }]);
    });

    test('says how many workspaces the key it offers to replace is shared with', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
          ]),
        'GET _user-keys/key-1': () =>
          json(200, {
            data: {
              type: 'user-key',
              id: 'key-1',
              attributes: attributesOf(KEYS[0]),
            },
          }),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      assert
        .dom('[data-test-replace-key-where]')
        .includesText('3 workspaces use this key');
      assert
        .dom('[data-test-replace-key-where]')
        .includesText(
          'Replacing it switches them all to the new key right away',
        );
    });

    test('a key whose shares can’t be listed is still offered, in general terms', async function (assert) {
      serve({
        'POST _secure-window/context': () =>
          forecastWith([
            {
              name: 'userKey',
              key: 'userKey',
              bound: {
                rejected: true,
                key: { id: 'key-1', name: 'Weather service' },
              },
            },
          ]),
        'GET _user-keys/key-1': () => refusal(500, 'boom'),
      });
      visitShell(OPENED);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-replace-key-form]');
      await settled();
      assert
        .dom('[data-test-replace-key-where]')
        .includesText(
          'Replacing this key switches every workspace that uses it',
        );
    });

    test('a link that names no operation names nothing it can show', async function (assert) {
      visitShell(`replace-key#card=${encodeURIComponent(CARD)}`);
      await render(ReplaceKeyPage);
      await waitFor('[data-test-keys-load-failed]');
      assert.false(
        requests.some((r) => r.path === '_secure-window/context'),
        'asks the server nothing',
      );
    });
  });

  module('the trail of pages', function () {
    const OPENED_FOR_CARD = `card=${encodeURIComponent(CARD)}&operation=forecast`;

    function serveForecast() {
      serve({
        'POST _secure-window/context': () =>
          context({
            realm: WORKSPACE,
            card: {
              name: 'Weather',
              module: `${REALM}weather`,
              exportName: 'Weather',
            },
            operation: {
              name: 'forecast',
              label: 'Get the forecast',
              base: 'callApi',
              method: 'GET',
              destination: {
                href: 'https://api.weather.co.uk/v2/',
                host: 'api.weather.co.uk',
                path: '/v2/',
                registrableDomain: 'weather.co.uk',
              },
              slots: [{ name: 'userKey', key: 'userKey' }],
            },
          }),
      });
    }

    function crumbs() {
      return [...document.querySelectorAll('[data-test-breadcrumbs] li')].map(
        (li) => li.textContent!.replace('›', '').trim(),
      );
    }

    test('the page the window was opened on shows no trail, and is titled by its name', async function (assert) {
      serve({
        'POST _secure-window/context': () => context({ realm: WORKSPACE }),
      });
      visitShell(`share-key#realm=${encodeURIComponent(REALM)}`);
      await render(SharePage);
      await waitFor('[data-test-share-key-form]');
      assert.dom('[data-test-breadcrumbs]').doesNotExist();
      assert.dom('[data-test-keys-heading]').hasText('Share key');
    });

    test('the key page reached from a share opened for a workspace leads back to it', async function (assert) {
      let share = `share-key#realm=${encodeURIComponent(REALM)}`;
      visitShell(`keys#${new URLSearchParams({ back: share })}`);
      await render(KeyPage);
      await waitFor('[data-test-key-list]');
      assert.deepEqual(crumbs(), ['Share key', 'Your keys']);
      assert
        .dom('[data-test-breadcrumb-current]')
        .hasAttribute('aria-current', 'page');
      assert.dom('[data-test-keys-heading]').hasText('Your keys');
      assert
        .dom('[data-test-breadcrumb="0"]')
        .hasAttribute('href', `/secure/${share}`);
      await click('[data-test-breadcrumb="0"]');
      assert.deepEqual(navigations, [
        { how: 'replace', url: `/secure/${share}` },
      ]);
    });

    test('Add key reached from Approve leads back to the batch as it was opened', async function (assert) {
      serveForecast();
      navigation.back = (url: string) => navigations.push({ how: 'back', url });
      let approve = `approve#${OPENED_FOR_CARD}`;
      visitShell(
        `enter-key#${OPENED_FOR_CARD}&then=approve&${new URLSearchParams({ back: approve })}`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert.deepEqual(crumbs(), ['Approve', 'Add key']);
      assert.dom('[data-test-keys-heading]').hasText('Add key');
      await click('[data-test-breadcrumb="0"]');
      assert.deepEqual(navigations, [
        { how: 'replace', url: `/secure/${approve}` },
      ]);
      assert.deepEqual(ticketRequests(), [], 'nothing is changed on the way');
    });

    test('a key added from Approve goes back to the batch as it was opened, with the new key chosen', async function (assert) {
      serveForecast();
      serve({
        'POST _user-keys': () =>
          json(201, {
            data: {
              type: 'user-key',
              id: 'key-3',
              attributes: { ...attributesOf(KEYS[0]), name: 'Forecasts' },
            },
          }),
      });
      let approve = `approve#${OPENED_FOR_CARD}&key=key-1`;
      visitShell(
        `enter-key#${OPENED_FOR_CARD}&key=key-1&then=approve&${new URLSearchParams({ back: approve })}`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      await fillIn('[data-test-key-name]', 'Forecasts');
      await fillIn('[data-test-key-value]', 'sk-forecast');
      await click('[data-test-enter-key-save]');
      await settled();
      assert.deepEqual(navigations, [
        {
          how: 'replace',
          url: `/secure/approve#${OPENED_FOR_CARD}&key=key-3`,
        },
      ]);
    });

    test('a trail several pages long names each page, and goes back to any of them', async function (assert) {
      serveForecast();
      let use = 'keys/key-1/use';
      let approve = `approve#${OPENED_FOR_CARD}&${new URLSearchParams({ back: use })}`;
      visitShell(
        `enter-key#${OPENED_FOR_CARD}&then=approve&${new URLSearchParams({ back: approve })}`,
      );
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert.deepEqual(crumbs(), [
        'Your keys',
        'Use with card',
        'Approve',
        'Add key',
      ]);
      await click('[data-test-breadcrumb="0"]');
      await click('[data-test-breadcrumb="1"]');
      assert.deepEqual(navigations, [
        { how: 'replace', url: '/secure/keys' },
        { how: 'replace', url: `/secure/${use}` },
      ]);
    });

    test('a page beneath the key page has the key page above it', async function (assert) {
      visitShell('keys/add');
      await render(EnterKeyPage);
      await waitFor('[data-test-enter-key-form]');
      assert.deepEqual(crumbs(), ['Your keys', 'Add key']);
      await click('[data-test-breadcrumb="0"]');
      assert.deepEqual(navigations, [{ how: 'replace', url: '/secure/keys' }]);
    });

    test('a page beneath the key page, reached by a route transition from a key page with a trail, keeps that trail and goes back through the history', async function (assert) {
      let share = `share-key#realm=${encodeURIComponent(REALM)}`;
      let keys = `keys#${new URLSearchParams({ back: share })}`;
      navigation.back = (url: string) => navigations.push({ how: 'back', url });
      visitShell('keys/add');
      noteDocumentAddress(keys);
      try {
        await render(EnterKeyPage);
        await waitFor('[data-test-enter-key-form]');
        assert.deepEqual(crumbs(), ['Share key', 'Your keys', 'Add key']);
        await click('[data-test-breadcrumb="1"]');
        await click('[data-test-breadcrumb="0"]');
        assert.deepEqual(navigations, [
          { how: 'back', url: `/secure/${keys}` },
          { how: 'replace', url: `/secure/${share}` },
        ]);
      } finally {
        noteDocumentAddress(undefined);
      }
    });

    test('a way back that names a page that isn’t a key page ends the trail', async function (assert) {
      visitShell(`keys#${new URLSearchParams({ back: 'sign-out' })}`);
      await render(KeyPage);
      await waitFor('[data-test-key-list]');
      assert.dom('[data-test-breadcrumbs]').doesNotExist();
    });

    test('a way back that names no page of the shell ends the trail', async function (assert) {
      visitShell(
        `keys#${new URLSearchParams({ back: 'https://elsewhere.test/secure/keys' })}`,
      );
      await render(KeyPage);
      await waitFor('[data-test-key-list]');
      assert.dom('[data-test-breadcrumbs]').doesNotExist();
    });
  });
});
