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
  owner: string;
  state: 'active' | 'suspended';
  suspensionReason:
    | 'owner-lost-write'
    | 'suspended-by-writer'
    | 'key-deleted'
    | null;
  suspendedBy: string | null;
};

// The shares a realm's direct writers see: one of the user's own, active; one
// of another writer's, active; and three suspended shares, one for each reason.
function fixtureShares(): ShareRow[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'OpenAI',
      owner: ME,
      state: 'active',
      suspensionReason: null,
      suspendedBy: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      label: 'Weather',
      owner: OTHER_WRITER,
      state: 'active',
      suspensionReason: null,
      suspendedBy: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      label: 'Maps',
      owner: FORMER_WRITER,
      state: 'suspended',
      suspensionReason: 'owner-lost-write',
      suspendedBy: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      label: 'Search',
      owner: OTHER_WRITER,
      state: 'suspended',
      suspensionReason: 'suspended-by-writer',
      suspendedBy: FORMER_WRITER,
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      label: 'Translate',
      owner: ME,
      state: 'suspended',
      suspensionReason: 'key-deleted',
      suspendedBy: null,
    },
  ];
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
    paths.push(byId, suspend);
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
    listings: () => requests.filter((r) => r.method === 'GET'),
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

  let originalFlag: boolean;
  let api: ReturnType<typeof stubSharesAPI> | undefined;

  hooks.beforeEach(function () {
    originalFlag = ENV.signInOnSecureOrigin;
    ENV.signInOnSecureOrigin = true;
  });

  hooks.afterEach(function () {
    ENV.signInOnSecureOrigin = originalFlag;
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
        ['OpenAI', 'Weather', 'Maps', 'Search', 'Translate'],
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

      for (let label of ['Maps', 'Search', 'Translate']) {
        assert.dom(`${share(label)} [data-test-realm-key-share-swap]`).exists();
        assert
          .dom(`${share(label)} [data-test-realm-key-share-suspend]`)
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
          .dom(`${share(label)} [data-test-realm-key-share-suspend]`)
          .exists();
      }
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-unshare]`)
        .exists();
      assert
        .dom(`${share('Translate')} [data-test-realm-key-share-unshare]`)
        .exists();
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-unshare]`)
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
      assert.strictEqual(calls[0].features, 'popup,width=640,height=720');
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

    test('the listing is read again when the page comes back into focus', async function (assert) {
      await visitConfig();
      await waitFor(share('Maps'));
      let before = api!.listings().length;
      window.dispatchEvent(new Event('focus'));
      await waitUntil(() => api!.listings().length > before);
      assert.true(api!.listings().length > before);
    });

    test('suspending a share asks first, then suspends it', async function (assert) {
      await visitConfig();
      await waitFor(share('Weather'));
      await click(`${share('Weather')} [data-test-realm-key-share-suspend]`);

      assert
        .dom(
          `${share('Weather')} [data-test-realm-key-share-confirm="suspend"]`,
        )
        .containsText('Suspend “Weather”?');
      await click(`${share('Weather')} [data-test-realm-key-share-cancel]`);
      assert.dom('[data-test-realm-key-share-confirm]').doesNotExist();
      assert.deepEqual(api!.changes(), [], 'Cancel changes nothing');

      await click(`${share('Weather')} [data-test-realm-key-share-suspend]`);
      await click(
        `${share('Weather')} [data-test-realm-key-share-confirm-button]`,
      );
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
        .hasText(`Suspended by ${ME}.`);
      assert
        .dom(`${share('Weather')} [data-test-realm-key-share-swap]`)
        .exists();
    });

    test('unsharing your own share asks first, then withdraws it', async function (assert) {
      await visitConfig();
      await waitFor(share('OpenAI'));
      await click(`${share('OpenAI')} [data-test-realm-key-share-unshare]`);
      assert
        .dom(`${share('OpenAI')} [data-test-realm-key-share-confirm="unshare"]`)
        .containsText('Unshare “OpenAI”?');
      await click(
        `${share('OpenAI')} [data-test-realm-key-share-confirm-button]`,
      );
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
      await click(`${share('Weather')} [data-test-realm-key-share-suspend]`);
      await click(
        `${share('Weather')} [data-test-realm-key-share-confirm-button]`,
      );
      await waitFor('[data-test-realm-key-share-change-error]');

      assert
        .dom('[data-test-realm-key-share-change-error]')
        .hasText(`only a realm's direct writers suspend its shares`);
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
      assert.dom('[data-test-realm-config-policy]').exists();
    });
  });
});
