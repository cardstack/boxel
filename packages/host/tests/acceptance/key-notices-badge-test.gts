import { click, waitFor, waitUntil } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  KEY_NOTICES_UPDATED_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

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
const POLICY_NOTICES_PATH = '/_key-policy-notices';
const LIMIT_NOTICES_PATH = '/_key-limit-notices';

interface Unread {
  // Unread policy notices, and unread limit notices.
  policy: number;
  limit: number;
}

// The realm server's notice listings, as far as the app reads them: the
// unread count in each one's `meta`.
function stubNotices(unread: Unread) {
  let reads = 0;
  let listings: [string, () => number][] = [
    [POLICY_NOTICES_PATH, () => unread.policy],
    [LIMIT_NOTICES_PATH, () => unread.limit],
  ];
  for (let [path, count] of listings) {
    registerRealmServerRoute({
      path,
      handler: async (req) => {
        if (req.method !== 'GET') {
          return null;
        }
        reads++;
        return new Response(
          JSON.stringify({ data: [], meta: { unread: count() } }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
      },
    });
  }
  return {
    get reads() {
      return reads;
    },
    restore: () => {
      for (let [path] of listings) {
        unregisterRealmServerRoute(path);
      }
    },
  };
}

module('Acceptance | key notices badge', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: ME,
    activeRealms: [testRealmURL],
    directRooms: ['test-auth-realm-server-session-room'],
  });

  let unread: Unread = { policy: 0, limit: 0 };
  let api: ReturnType<typeof stubNotices> | undefined;
  let opened: string[];

  hooks.beforeEach(async function () {
    unread.policy = 0;
    unread.limit = 0;
    api = stubNotices(unread);
    opened = [];
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return { opener: window as unknown };
    }) as typeof window.open;
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      permissions: { [ME]: ['read', 'write', 'realm-owner'] },
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'realm.json': realmConfigCardJSON({ name: 'Research Notes' }),
      },
    });
  });

  hooks.afterEach(function () {
    api?.restore();
    api = undefined;
  });

  async function visitApp() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await waitFor('[data-test-profile-icon-button]');
  }

  test('unread notices put a count on the avatar and on API Keys, which opens the key page', async function (assert) {
    unread.policy = 2;
    await visitApp();
    await waitFor('[data-test-profile-icon-key-notices-badge]');
    let avatarSpoken = document.querySelector(
      '[data-test-profile-icon-key-notices-badge] [data-test-pretui-badge-spoken]',
    );
    assert.strictEqual(
      avatarSpoken?.textContent?.trim(),
      '2 unseen key notices',
      'the avatar says what the count means',
    );
    assert
      .dom('[data-test-profile-icon-button]')
      .hasAttribute(
        'aria-describedby',
        avatarSpoken!.id,
        'the avatar keeps its own name and is described by the count',
      );
    assert
      .dom('[data-test-profile-icon-button]')
      .doesNotHaveAttribute('aria-label');
    let mark = document.querySelector(
      '[data-test-profile-icon-key-notices-badge] [data-test-pretui-badge-mark]',
    )!;
    assert.strictEqual(
      mark.textContent?.trim(),
      '2',
      'the avatar shows the count',
    );
    // The badge wraps the avatar button and carries the top bar's stacking;
    // a z-index on the button itself would draw the avatar over the count.
    assert.strictEqual(
      getComputedStyle(
        document.querySelector('[data-test-profile-icon-button]')!,
      ).zIndex,
      'auto',
      'the avatar takes no stacking of its own, so the count is drawn over it',
    );

    await click('[data-test-profile-icon-button]');
    assert
      .dom('[data-test-profile-api-keys-badge] [data-test-pretui-badge-mark]')
      .hasText('2');
    assert
      .dom('[data-test-profile-api-keys-badge] [data-test-pretui-badge-spoken]')
      .hasText('2 unseen key notices');

    await click('[data-test-profile-api-keys-button]');
    assert.deepEqual(
      opened,
      [new URL('keys', `${ENV.secureOriginURL.replace(/\/+$/, '')}/`).href],
      'the secure origin’s key page opens in the secure window',
    );
  });

  test('with no unread notices the API Keys item is there and nothing is badged', async function (assert) {
    await visitApp();
    await waitUntil(() => api!.reads > 0);
    assert.dom('[data-test-profile-icon-key-notices-badge]').doesNotExist();
    assert.dom('[data-test-pretui-badge-mark]').doesNotExist();
    assert
      .dom('[data-test-profile-icon-button]')
      .doesNotHaveAttribute('aria-describedby');
    await click('[data-test-profile-icon-button]');
    assert.dom('[data-test-profile-api-keys-button]').hasText('API Keys');
    assert.dom('[data-test-profile-api-keys-badge]').doesNotExist();
  });

  test('once the key page has marked the notices read, both badges go away', async function (assert) {
    unread.policy = 1;
    unread.limit = 1;
    await visitApp();
    await waitFor('[data-test-profile-icon-key-notices-badge]');

    // The key page marks what it lists read, and the realm server tells the
    // owner's sessions.
    unread.policy = 0;
    unread.limit = 0;
    mockMatrixUtils.simulateRemoteMessage(
      'test-auth-realm-server-session-room',
      '@realm-server:localhost',
      {
        msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
        body: JSON.stringify({ eventType: KEY_NOTICES_UPDATED_EVENT_TYPE }),
      },
    );
    await waitUntil(
      () =>
        !document.querySelector('[data-test-profile-icon-key-notices-badge]'),
    );
    assert.dom('[data-test-pretui-badge-mark]').doesNotExist();
    assert
      .dom('[data-test-profile-icon-button]')
      .doesNotHaveAttribute('aria-describedby');
    await click('[data-test-profile-icon-button]');
    assert.dom('[data-test-profile-api-keys-badge]').doesNotExist();
    assert.dom('[data-test-pretui-badge-mark]').doesNotExist();
  });

  test('the count adds up unread policy notices and unread limit notices', async function (assert) {
    unread.policy = 1;
    unread.limit = 2;
    await visitApp();
    await waitFor('[data-test-profile-icon-key-notices-badge]');
    assert
      .dom(
        '[data-test-profile-icon-key-notices-badge] [data-test-pretui-badge-mark]',
      )
      .hasText('3');
    await click('[data-test-profile-icon-button]');
    assert
      .dom('[data-test-profile-api-keys-badge] [data-test-pretui-badge-spoken]')
      .hasText('3 unseen key notices');
  });

  test('a limit notice recorded while the app is open shows as soon as the realm server says so', async function (assert) {
    await visitApp();
    await waitUntil(() => api!.reads > 0);
    assert.dom('[data-test-profile-icon-key-notices-badge]').doesNotExist();

    unread.limit = 1;
    // The realm server writes to the user's session room, the one room the
    // app takes its events from.
    mockMatrixUtils.simulateRemoteMessage(
      'test-auth-realm-server-session-room',
      '@realm-server:localhost',
      {
        msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
        body: JSON.stringify({ eventType: KEY_NOTICES_UPDATED_EVENT_TYPE }),
      },
    );
    await waitFor('[data-test-profile-icon-key-notices-badge]');
    assert.dom('[data-test-profile-icon-key-notices-badge]').exists();
  });
});
