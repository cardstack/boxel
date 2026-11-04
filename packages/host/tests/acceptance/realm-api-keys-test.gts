import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  registerRealmServerRoute,
  unregisterRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { setupApplicationTest } from '../helpers/setup';

const ME = '@testuser:localhost';
const OTHER_WRITER = '@example-writer:localhost';
const FORMER_WRITER = '@sample-former-writer:localhost';

type ShareRow = {
  id: string;
  label: string;
  owner: string | null;
  state: 'active' | 'suspended';
  suspensionReason:
    | 'owner-lost-write'
    | 'suspended-by-writer'
    | 'key-deleted'
    | null;
  suspendedBy: string | null;
  operations: OperationRow[];
};

type OperationRow = {
  bindingId: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  state: 'active' | 'needs-reapproval' | 'suspended';
};

// The realm server names an operation's module and card in RRI form: by its
// prefix when the realm has one, and otherwise by URL.
const CATALOG_INBOX = '@cardstack/catalog/inbox/inbox';
const CHANNEL = `${testRealmURL}channel`;

// The shares a realm's direct writers see: one of the user's own, active; one
// of another writer's, active; three suspended shares, one for each reason;
// and a suspended one whose owner the realm no longer names. The user's own
// share is approved for an operation on a type and, per card, for one on an
// instance, one of them awaiting re-approval; another writer's for one; a
// suspended share keeps its operation, suspended; the rest are approved for
// none.
function fixtureShares(): ShareRow[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'OpenAI',
      owner: ME,
      state: 'active',
      suspensionReason: null,
      suspendedBy: null,
      operations: [
        {
          bindingId: '00000000-0000-4000-8000-0000000000b1',
          type: { module: CATALOG_INBOX, name: 'Inbox' },
          operation: 'summarize',
          instance: null,
          slot: 'apiKey',
          state: 'active',
        },
        {
          bindingId: '00000000-0000-4000-8000-0000000000b2',
          type: { module: CHANNEL, name: 'Channel' },
          operation: 'postReply',
          instance: `${testRealmURL}Channel/general`,
          slot: 'apiKey',
          state: 'needs-reapproval',
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      label: 'Weather',
      owner: OTHER_WRITER,
      state: 'active',
      suspensionReason: null,
      suspendedBy: null,
      operations: [
        {
          bindingId: '00000000-0000-4000-8000-0000000000b3',
          type: { module: `${testRealmURL}forecast`, name: 'Forecast' },
          operation: 'fetchForecast',
          instance: null,
          slot: 'apiKey',
          state: 'active',
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      label: 'Maps',
      owner: FORMER_WRITER,
      state: 'suspended',
      suspensionReason: 'owner-lost-write',
      suspendedBy: null,
      operations: [
        {
          bindingId: '00000000-0000-4000-8000-0000000000b4',
          type: { module: `${testRealmURL}directions`, name: 'Directions' },
          operation: 'route',
          instance: null,
          slot: 'apiKey',
          state: 'suspended',
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      label: 'Search',
      owner: OTHER_WRITER,
      state: 'suspended',
      suspensionReason: 'suspended-by-writer',
      suspendedBy: FORMER_WRITER,
      operations: [],
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      label: 'Translate',
      owner: ME,
      state: 'suspended',
      suspensionReason: 'key-deleted',
      suspendedBy: null,
      operations: [],
    },
    {
      // No permission row in the realm names this owner any more, so the
      // realm server leaves them out.
      id: '00000000-0000-4000-8000-000000000006',
      label: 'Calendar',
      owner: null,
      state: 'suspended',
      suspensionReason: 'owner-lost-write',
      suspendedBy: null,
      operations: [],
    },
  ];
}

// A share's usage as the realm server answers it to a direct writer, after
// calls through it: what it spent today and this month, the last use, the top
// callers, refusals by code, the service's answers by status (a 403 named
// `vendor-forbidden`), and its grants, one of them rejected by the service.
// Only the owner of the key a share holds may edit its limits.
function fixtureUsage(owner: string | null) {
  return {
    limits: {
      rateBurst: 25,
      rateRefillPerMinute: 15,
      dailyBudget: 2400,
      monthlyBudget: 72000,
    },
    budgets: {
      day: { used: 312, budget: 2400, resetsAt: '2026-11-03T00:00:00.000Z' },
      month: {
        used: 4180,
        budget: 72000,
        resetsAt: '2026-12-01T00:00:00.000Z',
      },
    },
    since: '2026-11-01T00:00:00.000Z',
    calls: 4207,
    lastUse: {
      at: '2026-11-02T14:05:00.000Z',
      caller: OTHER_WRITER,
      operation: 'summarize',
      outcome: 'sent',
    },
    topCallers: [
      { caller: OTHER_WRITER, calls: 3100 },
      { caller: ME, calls: 1050 },
      { caller: null, calls: 57, withheld: true },
    ],
    refusals: [
      { code: 'rate-limited', count: 21 },
      { code: 'over-budget', count: 6 },
    ],
    vendorOutcomes: [
      { status: 200, count: 4150 },
      { status: 403, count: 3, outcome: 'vendor-forbidden' },
      { status: 429, count: 27 },
    ],
    grants: [
      {
        id: 'grant-1',
        host: 'api.openai.com',
        destination: 'https://api.openai.com/v1/',
        state: 'active',
        rejectedAt: null,
        lastForbiddenAt: '2026-11-02T09:00:00.000Z',
      },
      {
        id: 'grant-2',
        host: 'eu.api.openai.com',
        destination: 'https://eu.api.openai.com/v1/',
        state: 'rejected',
        rejectedAt: '2026-11-01T08:00:00.000Z',
        lastForbiddenAt: null,
      },
    ],
    canEditLimits: owner === ME,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': SupportedMimeType.JSONAPI },
  });
}

type Request = { method: string; path: string; realm?: string | null };

// The realm server's shares API, as far as the entry uses it: the realm's
// listing, which answers 403 to anyone but a direct writer, and suspending and
// unsharing by id, each of which changes the listing as the server would.
function stubSharesAPI({ directWriter }: { directWriter: boolean }) {
  let shares = fixtureShares();
  let requests: Request[] = [];
  let paths = ['/_key-shares'];
  registerRealmServerRoute({
    path: '/_key-shares',
    handler: async (req, url) => {
      requests.push({
        method: req.method,
        path: url.pathname,
        realm: url.searchParams.get('realm'),
      });
      if (req.method !== 'GET') {
        return null;
      }
      if (!directWriter) {
        return json(403, {
          errors: [`only a realm's direct writers see its shares`],
        });
      }
      return json(200, {
        data: shares.map(({ id, ...attributes }) => ({
          type: 'key-share',
          id,
          attributes: {
            realm: testRealmURL,
            ...attributes,
            suspendedAt:
              attributes.state === 'suspended'
                ? '2026-10-20T00:00:00.000Z'
                : null,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        })),
      });
    },
  });
  for (let share of fixtureShares()) {
    let byId = `/_key-shares/${share.id}`;
    let suspend = `${byId}/suspend`;
    let usage = `${byId}/usage`;
    paths.push(byId, suspend, usage);
    registerRealmServerRoute({
      path: usage,
      handler: async (req, url) => {
        requests.push({ method: req.method, path: url.pathname });
        if (req.method !== 'GET') {
          return null;
        }
        if (!directWriter) {
          return json(404, { errors: ['no such share'] });
        }
        return json(200, {
          data: {
            type: 'key-usage',
            id: share.id,
            attributes: fixtureUsage(share.owner),
          },
        });
      },
    });
    registerRealmServerRoute({
      path: byId,
      handler: async (req, url) => {
        requests.push({ method: req.method, path: url.pathname });
        if (req.method !== 'DELETE') {
          return null;
        }
        shares = shares.filter((s) => s.id !== share.id);
        return new Response(null, { status: 204 });
      },
    });
    registerRealmServerRoute({
      path: suspend,
      handler: async (req, url) => {
        requests.push({ method: req.method, path: url.pathname });
        if (req.method !== 'POST') {
          return null;
        }
        let row = shares.find((s) => s.id === share.id);
        if (!row || row.state !== 'active') {
          return json(409, { errors: ['the share is already suspended'] });
        }
        row.state = 'suspended';
        row.suspensionReason = 'suspended-by-writer';
        row.suspendedBy = ME;
        return json(200, { data: { type: 'key-share', id: row.id } });
      },
    });
  }
  return {
    requests,
    changes: () => requests.filter((r) => r.method !== 'GET'),
    listings: () =>
      requests.filter((r) => r.method === 'GET' && r.path === '/_key-shares'),
    usages: () =>
      requests.filter((r) => r.method === 'GET' && r.path.endsWith('/usage')),
    restore: () => paths.forEach((p) => unregisterRealmServerRoute(p)),
  };
}

type OpenCall = { url: string; target?: string; features?: string };

function stubWindowOpen() {
  let calls: OpenCall[] = [];
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    calls.push({ url: String(url), target, features });
    return { opener: window as unknown };
  }) as typeof window.open;
  return calls;
}

function share(label: string) {
  return `[data-test-realm-key-share="${label}"]`;
}

module('Acceptance | realm config | API Keys', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: ME,
    activeRealms: [testRealmURL],
  });

  let api: ReturnType<typeof stubSharesAPI> | undefined;

  hooks.afterEach(function () {
    api?.restore();
    api = undefined;
  });

  async function setupRealm(permissions: string[]) {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      permissions: { [ME]: permissions as any },
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'realm.json': realmConfigCardJSON({ name: 'Research Notes' }),
      },
    });
  }

  async function visitConfig(format: 'edit' | 'isolated' = 'edit') {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format }]],
    });
    await waitFor(
      format === 'edit'
        ? '[data-test-realm-config-edit]'
        : '[data-test-realm-config-isolated]',
    );
  }

  module('a direct writer', function (hooks) {
    hooks.beforeEach(async function () {
      api = stubSharesAPI({ directWriter: true });
      await setupRealm(['read', 'write', 'realm-owner']);
    });

    test('sees each share with its label, owner and state', async function (assert) {
      await visitConfig();
      await waitFor('[data-test-realm-api-keys] [data-test-realm-key-share]');

      assert
        .dom('[data-test-field="apiKeys"]')
        .exists('the entry is a row of the config');
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-realm-key-share]')].map(
          (el) => el.getAttribute('data-test-realm-key-share'),
        ),
        ['OpenAI', 'Weather', 'Maps', 'Search', 'Translate', 'Calendar'],
      );
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-owner]`)
        .hasText('You');
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-owner]`)
        .hasText(OTHER_WRITER);
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-pill]`)
        .hasText('Active');
      assert
        .dom(`${share('Maps')} [data-test-realm-key-share-pill]`)
        .hasText('Suspended');

      let [listing] = api!.listings();
      assert.strictEqual(
        listing.realm,
        testRealmURL,
        "the realm's listing is read",
      );

      assert
        .dom('[data-test-realm-api-keys]')
        .doesNotContainText('sk-', 'no key value is shown');
      assert
        .dom(
          '[data-test-realm-api-keys] input, [data-test-realm-api-keys] textarea',
        )
        .doesNotExist('nothing in the entry can be typed into');

      assert
        .dom('[data-test-field="policy"]')
        .exists('the config keeps its other entries');
      assert.dom('[data-test-field="config"]').exists();
    });

    test('each share names the operations it is approved for, as the realm server names them', async function (assert) {
      await visitConfig();
      await waitFor(share('OpenAI'));

      let operation = (bindingId: string) =>
        `[data-test-realm-key-share-operation="00000000-0000-4000-8000-0000000000${bindingId}"]`;

      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-operation]`)
        .exists({ count: 2 });
      assert
        .dom(`${operation('b1')} [data-test-realm-key-share-operation-name]`)
        .hasText('summarize on Inbox');
      assert
        .dom(`${operation('b1')} [data-test-realm-key-share-operation-module]`)
        .hasText(CATALOG_INBOX, 'a module in prefix form is shown as given');
      assert
        .dom(
          `${operation('b1')} [data-test-realm-key-share-operation-instance]`,
        )
        .doesNotExist('an operation approved for the type names no card');
      assert
        .dom(`${operation('b1')} [data-test-realm-key-share-operation-state]`)
        .doesNotExist('an active operation needs no state');

      assert
        .dom(`${operation('b2')} [data-test-realm-key-share-operation-name]`)
        .hasText('postReply on Channel');
      assert
        .dom(`${operation('b2')} [data-test-realm-key-share-operation-module]`)
        .hasText(CHANNEL);
      assert
        .dom(
          `${operation('b2')} [data-test-realm-key-share-operation-instance]`,
        )
        .hasText(
          `For the card ${testRealmURL}Channel/general`,
          'an operation approved per card names its card',
        );
      assert
        .dom(
          `${operation('b2')} [data-test-realm-key-share-operation-state="needs-reapproval"]`,
        )
        .hasText('Needs re-approval');

      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-operation]`)
        .exists({ count: 1 });
      assert
        .dom(`${operation('b3')} [data-test-realm-key-share-operation-name]`)
        .hasText('fetchForecast on Forecast');

      assert
        .dom(
          `${operation('b4')} [data-test-realm-key-share-operation-state="suspended"]`,
        )
        .hasText('Suspended', "a suspended share's operation is suspended");

      for (let label of ['Search', 'Translate', 'Calendar']) {
        assert
          .dom(`${share(label)} [data-test-realm-key-share-operation]`)
          .doesNotExist();
        assert
          .dom(`${share(label)} [data-test-realm-key-share-no-operations]`)
          .hasText('No operation is approved to use it yet.');
      }
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-no-operations]`)
        .doesNotExist();
    });

    test('a suspended share shows why, and offers to swap a key in', async function (assert) {
      await visitConfig();
      await waitFor(share('Maps'));

      assert
        .dom(
          `${share('Maps')} [data-test-realm-key-share-reason="owner-lost-write"]`,
        )
        .hasText(
          'Its owner no longer has direct write access to this workspace.',
        );
      assert
        .dom(
          `${share('Search')} [data-test-realm-key-share-reason="suspended-by-writer"]`,
        )
        .hasText(`Suspended by ${FORMER_WRITER}.`);
      assert
        .dom(
          `${share('Translate')} [data-test-realm-key-share-reason="key-deleted"]`,
        )
        .hasText('Its owner deleted the key.');
      assert
        .dom(`${share('Calendar')} [data-test-realm-key-share-owner]`)
        .hasText(
          'A former member of this workspace',
          'an owner the realm no longer names is not shown by id',
        );

      for (let label of ['Maps', 'Search', 'Translate', 'Calendar']) {
        assert.dom(`${share(label)} [data-test-realm-key-share-swap]`).exists();
        assert
          .dom(`${share(label)} [data-test-realm-key-share-change="suspend"]`)
          .doesNotExist();
      }
      for (let label of ['OpenAI', 'Weather']) {
        assert
          .dom(`${share(label)} [data-test-realm-key-share-reason]`)
          .doesNotExist();
        assert
          .dom(`${share(label)} [data-test-realm-key-share-swap]`)
          .doesNotExist();
        assert
          .dom(`${share(label)} [data-test-realm-key-share-change="suspend"]`)
          .exists();
      }
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-change="unshare"]`)
        .exists();
      assert
        .dom(
          `${share('Translate')} [data-test-realm-key-share-change="unshare"]`,
        )
        .exists();
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-change="unshare"]`)
        .doesNotExist("someone else's share can't be unshared here");
    });

    test('Share one of my keys opens the secure window to share into this realm', async function (assert) {
      let calls = stubWindowOpen();
      await visitConfig();
      await waitFor('[data-test-realm-api-keys-share]');
      await click('[data-test-realm-api-keys-share]');
      await waitUntil(() => calls.length > 0);

      let opened = new URL(calls[0].url);
      assert.strictEqual(opened.origin, new URL(ENV.secureOriginURL).origin);
      assert.true(opened.pathname.endsWith('/share-key'), 'at the share page');
      assert.strictEqual(opened.search, '');
      let fragment = new URLSearchParams(opened.hash.slice(1));
      assert.deepEqual([...fragment.keys()], ['realm', 'reason']);
      assert.strictEqual(fragment.get('realm'), testRealmURL);
      assert.strictEqual(calls[0].features, 'popup,width=940,height=1100');
      assert.deepEqual(
        api!.changes(),
        [],
        'nothing is changed from the app page',
      );
    });

    test('swapping a key in opens the secure window for that share', async function (assert) {
      let calls = stubWindowOpen();
      await visitConfig();
      await waitFor(share('Maps'));
      await click(`${share('Maps')} [data-test-realm-key-share-swap]`);
      await waitUntil(() => calls.length > 0);

      let opened = new URL(calls[0].url);
      assert.true(opened.pathname.endsWith('/swap-key'), 'at the swap page');
      assert.strictEqual(opened.search, '');
      let fragment = new URLSearchParams(opened.hash.slice(1));
      assert.deepEqual([...fragment.keys()], ['realm', 'share', 'reason']);
      assert.strictEqual(fragment.get('realm'), testRealmURL);
      assert.strictEqual(
        fragment.get('share'),
        '00000000-0000-4000-8000-000000000003',
      );
      assert.deepEqual(api!.changes(), []);
    });

    test('each share shows its usage against its budgets, its callers, refusals by reason and how the service answered', async function (assert) {
      await visitConfig();
      await waitFor(`${share('OpenAI')} [data-test-realm-key-share-usage]`);
      let usage = `${share('OpenAI')} [data-test-realm-key-share-usage]`;

      assert
        .dom(`${usage} [data-test-realm-key-share-usage-details]`)
        .doesNotHaveAttribute('open', 'the detailed counts start closed');
      assert
        .dom(`${usage} [data-test-realm-key-share-budget="day"] progress`)
        .hasAttribute('value', '312', 'the meter shows the day’s use');
      assert
        .dom(`${usage} [data-test-realm-key-share-budget="day"]`)
        .hasText('Today 312 of 2,400 calls');
      assert
        .dom(`${usage} [data-test-realm-key-share-budget="month"]`)
        .hasText('This month 4,180 of 72,000 calls');
      assert
        .dom(`${usage} [data-test-realm-key-share-last-use]`)
        .includesText(`by ${OTHER_WRITER}`);
      assert.deepEqual(
        [
          ...document.querySelectorAll(
            `${usage} [data-test-realm-key-share-caller]`,
          ),
        ].map((el) => el.textContent!.replace(/\s+/g, ' ').trim()),
        [`${OTHER_WRITER} 3,100`, `${ME} 1,050`, 'Others 57'],
        'callers the user isn’t shown are counted together',
      );
      assert
        .dom(`${usage} [data-test-realm-key-share-refusal="rate-limited"]`)
        .hasText('Over a caller’s rate limit 21');
      assert
        .dom(`${usage} [data-test-realm-key-share-refusal="over-budget"]`)
        .hasText('Over budget 6');
      assert
        .dom(`${usage} [data-test-realm-key-share-outcome="403"]`)
        .hasText('403 Forbidden 3', 'a 403 is the service refusing the key');
      assert
        .dom(`${usage} [data-test-realm-key-share-outcome="200"]`)
        .hasText('200 OK 4,150');
      assert
        .dom(
          `${usage} [data-test-realm-key-share-grant="eu.api.openai.com"][data-test-realm-key-share-grant-state="rejected"]`,
        )
        .includesText('Rejected');
      assert
        .dom(`${usage} [data-test-realm-key-share-grant="api.openai.com"]`)
        .includesText('Last refused');
      assert
        .dom(`${usage} [data-test-realm-key-share-limit="rate"]`)
        .hasText(
          'Each person 25 calls at once, then 15 a minute',
          'the rate is per person',
        );
      assert
        .dom(`${usage} [data-test-realm-key-share-limit="budget"]`)
        .hasText(
          'The key, in total across everyone 2,400 calls a day, 72,000 a month',
          'the budgets are the key’s total',
        );
    });

    test('the owner of a share’s key edits its limits in the secure window', async function (assert) {
      let calls = stubWindowOpen();
      await visitConfig();
      await waitFor(`${share('OpenAI')} [data-test-realm-key-share-usage]`);
      await click(`${share('OpenAI')} [data-test-realm-key-share-edit-limits]`);
      await waitUntil(() => calls.length > 0);

      let opened = new URL(calls[0].url);
      assert.strictEqual(opened.origin, new URL(ENV.secureOriginURL).origin);
      assert.true(
        opened.pathname.endsWith('/share-limits'),
        'at the share limits page',
      );
      assert.strictEqual(opened.search, '');
      let fragment = new URLSearchParams(opened.hash.slice(1));
      assert.deepEqual([...fragment.keys()], ['realm', 'share', 'reason']);
      assert.strictEqual(fragment.get('realm'), testRealmURL);
      assert.strictEqual(
        fragment.get('share'),
        '00000000-0000-4000-8000-000000000001',
      );
      assert.deepEqual(
        api!.changes(),
        [],
        'no limit is changed from the app page',
      );
    });

    test('a direct writer who doesn’t own a share sees its usage but can’t edit its limits', async function (assert) {
      await visitConfig();
      await waitFor(`${share('Weather')} [data-test-realm-key-share-usage]`);
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-limits]`)
        .exists('the limits are shown');
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-edit-limits]`)
        .doesNotExist('only the owner of the share’s key edits them');
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-change="suspend"]`)
        .exists('they can suspend it instead');
    });

    test('the listing is read again when the page comes back into focus', async function (assert) {
      await visitConfig();
      await waitFor(share('Maps'));
      let before = api!.listings().length;
      window.dispatchEvent(new Event('focus'));
      await waitUntil(() => api!.listings().length > before);
      assert.true(api!.listings().length > before);
    });

    test('the listing is read again when the page becomes visible again', async function (assert) {
      await visitConfig();
      await waitFor(share('Maps'));
      let before = api!.listings().length;
      document.dispatchEvent(new Event('visibilitychange'));
      await waitUntil(() => api!.listings().length > before);
      assert.true(api!.listings().length > before);
    });

    test('a closed config card no longer reads the listing', async function (assert) {
      await visitConfig('isolated');
      await waitFor(share('Maps'));
      await click('[data-test-close-button]');
      await waitUntil(() => !document.querySelector(share('Maps')));
      await settled();
      let before = api!.listings().length;
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await settled();
      assert.strictEqual(
        api!.listings().length,
        before,
        'no listing after the entry is gone',
      );
    });

    test('suspending a share asks first, then suspends it', async function (assert) {
      await visitConfig();
      await waitFor(share('Weather'));
      await click(
        `${share('Weather')} [data-test-realm-key-share-change="suspend"]`,
      );

      assert
        .dom(
          `${share('Weather')} [data-test-realm-key-share-confirm="suspend"]`,
        )
        .containsText('Suspend “Weather”?');
      assert
        .dom(`${share('Weather')} [data-test-pretui-popconfirm-panel]`)
        .hasAttribute('role', 'dialog')
        .hasAttribute('aria-label', 'Suspend “Weather”?');
      assert
        .dom(`${share('Weather')} [data-test-pretui-popconfirm-cancel]`)
        .isFocused('focus moves into the question, onto Cancel');
      await click(`${share('Weather')} [data-test-pretui-popconfirm-cancel]`);
      assert.dom('[data-test-realm-key-share-confirm]').doesNotExist();
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-change="suspend"]`)
        .isFocused('and back to Suspend when it closes');
      assert.deepEqual(api!.changes(), [], 'Cancel changes nothing');

      await click(
        `${share('Weather')} [data-test-realm-key-share-change="suspend"]`,
      );
      await click(`${share('Weather')} [data-test-pretui-popconfirm-confirm]`);
      await waitFor(
        `${share('Weather')}[data-test-realm-key-share-state="suspended"]`,
      );

      assert.deepEqual(api!.changes(), [
        {
          method: 'POST',
          path: '/_key-shares/00000000-0000-4000-8000-000000000002/suspend',
        },
      ]);
      assert
        .dom(
          `${share('Weather')} [data-test-realm-key-share-reason="suspended-by-writer"]`,
        )
        .hasText('Suspended by you.');
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-swap]`)
        .exists();
    });

    test('unsharing your own share asks first, then withdraws it', async function (assert) {
      await visitConfig();
      await waitFor(share('OpenAI'));
      await click(
        `${share('OpenAI')} [data-test-realm-key-share-change="unshare"]`,
      );
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-confirm="unshare"]`)
        .containsText('Unshare “OpenAI”?');
      await click(`${share('OpenAI')} [data-test-pretui-popconfirm-confirm]`);
      await waitUntil(() => !document.querySelector(share('OpenAI')));

      assert.deepEqual(api!.changes(), [
        {
          method: 'DELETE',
          path: '/_key-shares/00000000-0000-4000-8000-000000000001',
        },
      ]);
      assert.dom(share('Weather')).exists('the other shares stay');
    });

    test('a refused change says why and keeps the question open', async function (assert) {
      registerRealmServerRoute({
        path: '/_key-shares/00000000-0000-4000-8000-000000000002/suspend',
        handler: async () =>
          json(403, {
            errors: [`only a realm's direct writers suspend its shares`],
          }),
      });
      await visitConfig();
      await waitFor(share('Weather'));
      await click(
        `${share('Weather')} [data-test-realm-key-share-change="suspend"]`,
      );
      await click(`${share('Weather')} [data-test-pretui-popconfirm-confirm]`);
      await waitFor('[data-test-realm-key-share-change-error]');

      assert
        .dom('[data-test-realm-key-share-change-error]')
        .hasText(`only a realm's direct writers suspend its shares`)
        .hasAttribute('role', 'alert');
      assert
        .dom(
          `${share('Weather')} [data-test-realm-key-share-confirm="suspend"]`,
        )
        .exists();
    });

    test('the entry is a section of the isolated config too', async function (assert) {
      await visitConfig('isolated');
      await waitFor(
        '[data-test-realm-api-keys-section] [data-test-realm-key-share]',
      );
      assert.dom('[data-test-realm-api-keys-section] h2').hasText('API Keys');
      assert.dom('[data-test-realm-config-policy]').exists();
    });
  });

  module('a reader', function (hooks) {
    hooks.beforeEach(async function () {
      api = stubSharesAPI({ directWriter: false });
      await setupRealm(['read']);
    });

    test("doesn't see the entry", async function (assert) {
      await visitConfig('isolated');
      await waitUntil(() => api!.listings().length > 0);
      await settled();

      assert.dom('[data-test-realm-api-keys]').doesNotExist();
      assert.dom('[data-test-realm-api-keys-section]').doesNotExist();
      assert.dom('[data-test-realm-key-share-usage]').doesNotExist();
      assert.deepEqual(api!.usages(), [], 'no share’s usage is asked for');
      assert.dom('[data-test-realm-config-policy]').exists();
    });
  });
});
