import { click, fillIn, render, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';

import { forgetSession, storeSession } from '../../src/security/session.js';
import { navigation } from '../../src/shell/navigation.js';
import KeyPage from '../../src/shell/keys/key-page.gts';
import ShareLimitsPage from '../../src/shell/keys/share-limits-page.gts';
import {
  setupTelemetrySecretsCheck,
  stringsIn,
} from '../helpers/telemetry-secrets.ts';
import { setupWaitedBrowserWork, waitedFetch } from '../helpers/waiters.ts';

// A key's and a share's usage and limits in the secure window, against a
// realm server that answers the requests the pages make: the key page opens a
// key's usage on its tile and changes its limits in place; the share-limits
// page shows a share's usage to the owner of the key it holds and changes its
// limits, and tells a direct writer who doesn't own it that only its owner
// does.

const REALM_SERVER = 'https://realm-server.test/';
const REALM = 'https://realm-server.test/someone/workspace/';
const SESSION = {
  token: 'secure-session-token',
  user: '@someone:example.test',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const CALLER = '@a-reader:example.test';

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

const KEY = {
  id: 'key-1',
  name: 'Weather service',
  kind: 'static',
  state: 'active',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  usedWith: ['openweathermap.org'],
  sharedInto: [],
  grants: [],
};

const LIMITS = {
  rateBurst: 25,
  rateRefillPerMinute: 15,
  dailyBudget: 2400,
  monthlyBudget: 72000,
};

function usage(overrides: Record<string, unknown> = {}) {
  return {
    limits: LIMITS,
    budgets: {
      day: { used: 12, budget: 2400, resetsAt: '2026-11-03T00:00:00.000Z' },
      month: {
        used: 340,
        budget: 72000,
        resetsAt: '2026-12-01T00:00:00.000Z',
      },
    },
    since: '2026-11-01T00:00:00.000Z',
    calls: 352,
    lastUse: {
      at: '2026-11-02T14:05:00.000Z',
      caller: CALLER,
      operation: 'forecast',
      outcome: 'refused',
    },
    topCallers: [
      { caller: CALLER, calls: 300 },
      { caller: null, calls: 52, withheld: true },
    ],
    refusals: [{ code: 'over-budget', count: 4 }],
    vendorOutcomes: [
      { status: 200, count: 340 },
      { status: 403, count: 8, outcome: 'vendor-forbidden' },
    ],
    grants: [
      {
        id: 'grant-1',
        host: 'api.openweathermap.org',
        destination: 'https://api.openweathermap.org/data/',
        state: 'rejected',
        rejectedAt: '2026-11-01T08:00:00.000Z',
        lastForbiddenAt: null,
      },
    ],
    canEditLimits: true,
    ...overrides,
  };
}

function usageResource(id: string, attributes: Record<string, unknown>) {
  return json(200, { data: { type: 'key-usage', id, attributes } });
}

module('Integration | key usage and limits', function (hooks) {
  setupRenderingTest(hooks);
  setupWaitedBrowserWork(hooks);

  let requests: { method: string; path: string; url: URL; body: any }[];
  let routes: Record<string, Route>;
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

  hooks.before(function () {
    originalURL = window.location.href;
  });

  hooks.after(function () {
    history.replaceState(null, '', originalURL);
  });

  hooks.beforeEach(function () {
    requests = [];
    routes = {
      'GET _secure-session': () => ({ status: 204 }),
      'GET _user-keys': () =>
        json(200, {
          data: [
            {
              type: 'user-key',
              id: KEY.id,
              attributes: { ...KEY, id: undefined },
            },
          ],
        }),
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
    navigation.close = () => undefined;
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

  // No beacon carries what a page sent or showed: a caller's id, a key's
  // name or id, a share's label or id, the workspace, the session's token.
  setupTelemetrySecretsCheck(hooks, () => [
    ...stringsIn(requests.map((r) => r.body)),
    SESSION.token,
    REALM,
    'someone/workspace',
    'Weather service',
    'Team weather',
    CALLER,
    '"key-1"',
    '"share-1"',
  ]);

  module('the key page', function () {
    test('opens a key’s usage on its tile: budgets, callers, refusals, the service’s answers and rejected grants', async function (assert) {
      serve({
        'GET _user-keys/key-1/usage': () => usageResource('key-1', usage()),
      });
      visitShell('keys');
      await render(KeyPage);
      await waitFor('[data-test-key-row="Weather service"]');
      assert.dom('[data-test-key-usage]').doesNotExist('closed until asked');
      assert.false(
        requests.some((r) => r.path.endsWith('/usage')),
        'nothing is asked for until it is opened',
      );

      await click('[data-test-key-usage-toggle]');
      await waitFor('[data-test-key-usage]');
      assert
        .dom('[data-test-key-usage-details]')
        .doesNotHaveAttribute('open', 'the detailed counts start closed');
      assert
        .dom('[data-test-key-usage-budget="day"] progress')
        .hasAttribute('value', '12', 'the meter shows the day’s use');
      assert
        .dom('[data-test-key-usage-budget="day"]')
        .includesText('12 of 2,400 calls');
      assert
        .dom('[data-test-key-usage-budget="month"]')
        .includesText('340 of 72,000 calls');
      assert
        .dom('[data-test-key-usage-last]')
        .includesText(`by ${CALLER}, refused`);
      assert
        .dom(`[data-test-key-usage-caller="${CALLER}"]`)
        .includesText('300');
      assert
        .dom('[data-test-key-usage-callers] li:last-child')
        .hasText('Others 52', 'callers withheld from the viewer together');
      assert
        .dom('[data-test-key-usage-refusal="over-budget"]')
        .hasText('Over budget 4');
      assert
        .dom('[data-test-key-usage-outcome="403"]')
        .hasText('403 Forbidden 8');
      assert
        .dom(
          '[data-test-key-usage-grant="api.openweathermap.org"][data-test-key-usage-grant-state="rejected"]',
        )
        .includesText('Rejected');
      assert
        .dom('[data-test-key-limit-input="dailyBudget"]')
        .hasValue('2400', 'the limits in force fill the form');
      assert.deepEqual(
        [
          ...document.querySelectorAll('[data-test-key-limit-group] legend'),
        ].map((el) => el.textContent!.trim()),
        ['How fast', 'How many'],
        'a personal key’s limits don’t speak of other people',
      );
    });

    test('changes a key’s limits in place, sending only what changed', async function (assert) {
      let current = usage();
      serve({
        'GET _user-keys/key-1/usage': () => usageResource('key-1', current),
        'PUT _user-keys/key-1/limits': ({ body }) => {
          let set = { ...current.limits, ...body.data.attributes };
          // A limit set to null goes back to the platform's default.
          for (let [name, value] of Object.entries(set)) {
            if (value === null) {
              set[name as keyof typeof set] =
                LIMITS[name as keyof typeof LIMITS];
            }
          }
          current = { ...current, limits: set };
          return json(200, {
            data: {
              type: 'key-limits',
              id: 'key-1',
              attributes: current.limits,
            },
          });
        },
      });
      visitShell('keys');
      await render(KeyPage);
      await click('[data-test-key-usage-toggle]');
      await waitFor('[data-test-key-limits-form]');

      await fillIn('[data-test-key-limit-input="dailyBudget"]', '500');
      await fillIn('[data-test-key-limit-input="rateBurst"]', '');
      await click('[data-test-key-limits-save]');
      await waitFor('[data-test-key-limits-saved]');

      let put = requests.find((r) => r.method === 'PUT')!;
      assert.strictEqual(put.path, '_user-keys/key-1/limits');
      assert.deepEqual(put.body, {
        data: {
          type: 'key-limits',
          attributes: { rateBurst: null, dailyBudget: 500 },
        },
      });
      assert
        .dom('[data-test-key-limit-input="rateBurst"]')
        .hasValue('25', 'an emptied field shows the default it went back to');
      assert.dom('[data-test-key-limit-input="dailyBudget"]').hasValue('500');
      assert
        .dom('[data-test-key-usage-budget="day"]')
        .exists('the usage is still shown');

      await click('[data-test-key-limits-save]');
      assert.strictEqual(
        requests.filter((r) => r.method === 'PUT').length,
        1,
        'saving again with nothing changed sends nothing',
      );
    });

    test('limits that saved stay saved when the usage can’t be read again', async function (assert) {
      let reads = 0;
      serve({
        'GET _user-keys/key-1/usage': () =>
          ++reads === 1
            ? usageResource('key-1', usage())
            : refusal(500, 'Internal server error'),
        'PUT _user-keys/key-1/limits': ({ body }) =>
          json(200, {
            data: {
              type: 'key-limits',
              id: 'key-1',
              attributes: { ...LIMITS, ...body.data.attributes },
            },
          }),
      });
      visitShell('keys');
      await render(KeyPage);
      await click('[data-test-key-usage-toggle]');
      await waitFor('[data-test-key-limits-form]');
      await fillIn('[data-test-key-limit-input="dailyBudget"]', '900');
      await click('[data-test-key-limits-save]');
      await waitFor('[data-test-key-limits-saved]');
      assert.dom('[data-test-key-limits-error]').doesNotExist();
      assert.dom('[data-test-key-usage]').exists('the usage stays shown');
    });

    test('a limit that isn’t one is refused before anything is sent', async function (assert) {
      serve({
        'GET _user-keys/key-1/usage': () => usageResource('key-1', usage()),
      });
      visitShell('keys');
      await render(KeyPage);
      await click('[data-test-key-usage-toggle]');
      await waitFor('[data-test-key-limits-form]');
      await fillIn('[data-test-key-limit-input="monthlyBudget"]', '2.5');
      await click('[data-test-key-limits-save]');
      assert
        .dom('[data-test-key-limits-error]')
        .hasText('Calls a month must be a whole number of at least 1.');
      assert.false(requests.some((r) => r.method === 'PUT'));
    });

    test('a usage that fails to load says so and offers to try again', async function (assert) {
      let fail = true;
      serve({
        'GET _user-keys/key-1/usage': () =>
          fail
            ? refusal(500, 'Internal server error')
            : usageResource('key-1', usage()),
      });
      visitShell('keys');
      await render(KeyPage);
      await click('[data-test-key-usage-toggle]');
      await waitFor('[data-test-key-usage-error]');
      fail = false;
      await click('[data-test-key-usage-retry]');
      await waitFor('[data-test-key-usage]');
      assert.dom('[data-test-key-usage-error]').doesNotExist();
    });
  });

  module('the share-limits page', function (hooks) {
    hooks.beforeEach(function () {
      serve({
        'POST _secure-window/context': () =>
          json(200, {
            data: {
              type: 'secure-window-context',
              attributes: {
                realm: {
                  url: REALM,
                  name: 'Team Workspace',
                  directWriter: true,
                },
              },
            },
          }),
        'GET _key-shares': () =>
          json(200, {
            data: [
              {
                type: 'key-share',
                id: 'share-1',
                attributes: {
                  realm: REALM,
                  label: 'Team weather',
                  owner: SESSION.user,
                  state: 'active',
                  suspensionReason: null,
                },
              },
            ],
          }),
      });
    });

    test('shows the share’s usage to the owner of its key and changes its limits', async function (assert) {
      serve({
        'GET _key-shares/share-1/usage': () =>
          usageResource('share-1', usage()),
        'PUT _key-shares/share-1/limits': ({ body }) =>
          json(200, {
            data: {
              type: 'key-limits',
              id: 'share-1',
              attributes: { ...LIMITS, ...body.data.attributes },
            },
          }),
      });
      visitShell(
        `share-limits#realm=${encodeURIComponent(REALM)}&share=share-1`,
      );
      await render(ShareLimitsPage);
      await waitFor('[data-test-share-limits]');
      assert
        .dom('[data-test-share-limits]')
        .includesText('Limits for Team weather');
      assert.deepEqual(
        [
          ...document.querySelectorAll('[data-test-key-limit-group] legend'),
        ].map((el) => el.textContent!.trim()),
        ['Each person', 'The key, in total across everyone'],
        'each of a share’s limits says whom it applies to',
      );
      assert
        .dom('[data-test-key-usage-budget="day"]')
        .includesText('12 of 2,400 calls');

      await fillIn('[data-test-key-limit-input="rateRefillPerMinute"]', '7.5');
      await click('[data-test-key-limits-save]');
      await waitFor('[data-test-key-limits-saved]');
      let put = requests.find((r) => r.method === 'PUT')!;
      assert.strictEqual(put.path, '_key-shares/share-1/limits');
      assert.deepEqual(put.body.data.attributes, { rateRefillPerMinute: 7.5 });
    });

    test('tells a direct writer who doesn’t own the share that only its owner changes its limits', async function (assert) {
      serve({
        'GET _key-shares/share-1/usage': () =>
          usageResource('share-1', usage({ canEditLimits: false })),
      });
      visitShell(
        `share-limits#realm=${encodeURIComponent(REALM)}&share=share-1`,
      );
      await render(ShareLimitsPage);
      await waitFor('[data-test-share-limits-not-owner]');
      assert.dom('[data-test-key-limits-form]').doesNotExist();
      assert
        .dom('[data-test-share-limits-not-owner]')
        .includesText('Only they change its limits');
    });

    test('a link naming no shared key in the workspace says so', async function (assert) {
      visitShell(
        `share-limits#realm=${encodeURIComponent(REALM)}&share=share-9`,
      );
      await render(ShareLimitsPage);
      await waitFor('[data-test-keys-load-failed]');
      assert.false(requests.some((r) => r.path.endsWith('/usage')));
    });
  });
});
