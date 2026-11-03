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
const NOTICES_PATH = '/_key-policy-notices';

// The realm server's notice listing, as far as the app reads it: the unread
// count in `meta`.
function stubNotices(unread: { count: number }) {
  let reads = 0;
  registerRealmServerRoute({
    path: NOTICES_PATH,
    handler: async (req) => {
      if (req.method !== 'GET') {
        return null;
      }
      reads++;
      return new Response(
        JSON.stringify({ data: [], meta: { unread: unread.count } }),
        {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
      );
    },
  });
  return {
    get reads() {
      return reads;
    },
    restore: () => unregisterRealmServerRoute(NOTICES_PATH),
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

  let unread = { count: 0 };
  let api: ReturnType<typeof stubNotices> | undefined;
  let opened: string[];

  hooks.beforeEach(async function () {
    unread.count = 0;
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

  test('unread notices put a dot on the avatar and a count beside API Keys, which opens the key page', async function (assert) {
    unread.count = 2;
    await visitApp();
    await waitFor('[data-test-profile-icon-key-notices-badge]');
    assert
      .dom('[data-test-profile-icon-button]')
      .hasAria('label', 'Profile, with key notices you haven’t seen');

    await click('[data-test-profile-icon-button]');
    assert.dom('[data-test-profile-api-keys-badge]').hasText('2');

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
    assert.dom('[data-test-profile-icon-button]').hasAria('label', 'Profile');
    await click('[data-test-profile-icon-button]');
    assert.dom('[data-test-profile-api-keys-button]').hasText('API Keys');
    assert.dom('[data-test-profile-api-keys-badge]').doesNotExist();
  });

  test('a notice recorded while the app is open shows as soon as the realm server says so', async function (assert) {
    await visitApp();
    await waitUntil(() => api!.reads > 0);
    assert.dom('[data-test-profile-icon-key-notices-badge]').doesNotExist();

    unread.count = 1;
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
