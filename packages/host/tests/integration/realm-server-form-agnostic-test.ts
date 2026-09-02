import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// `window` here is ember-window-mock's, the same one the service reads its
// session tokens through — `setupRenderingTest` installs it. Writing to the
// real global instead would leave the service seeing no tokens at all.
//
// A realm mapped to an origin of its own, so the resolved URL is not the test
// realm's — `getRealmServersForRealms` skips anything at the test realm origin,
// which would hide the token lookup this exercises.
const MAPPED_REALM_URL = 'https://mapped-realm.example.com/realm/';
const REALM_SERVER_URL = 'https://mapped-server.example.com/';
const PREFIX = '@form-agnostic-test/';

// A session token is only ever read for its claims here, never verified, so a
// header-and-payload pair is the whole shape that matters.
function sessionToken(claims: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(claims))}`;
}

// `getRealmServersForRealms` answers "which realm server serves these realms?"
// by looking each realm's session token up by its identifier. A registered
// prefix is a realm identifier too, and it matches no token key — so without
// resolution the lookup misses, the loop skips the realm, and an empty result
// set makes the function answer with *this* realm server rather than the
// realm's. That is a wrong answer returned quietly, which is what these pin.
module('Integration | realm-server | identifier forms', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({ mockMatrixUtils, contents: {} });
  });

  hooks.afterEach(function () {
    window.localStorage.removeItem(SessionLocalStorageKey);
    getService('network').virtualNetwork.removeRealmMapping(PREFIX);
  });

  test('finds a realm server for a realm named by a URL identifier', function (assert) {
    window.localStorage.setItem(
      SessionLocalStorageKey,
      JSON.stringify({
        [MAPPED_REALM_URL]: sessionToken({ realmServerURL: REALM_SERVER_URL }),
      }),
    );

    let realmServer = getService('realm-server');
    assert.deepEqual(
      realmServer.getRealmServersForRealms([MAPPED_REALM_URL]),
      [REALM_SERVER_URL],
      'the URL form finds its token and reports the realm’s own server',
    );
  });

  test('finds a realm server for a realm named by a registered prefix', function (assert) {
    // The token is filed under the realm's URL, which is how a realm resource
    // that logged in with a URL files it — the prefix has to resolve to reach it.
    getService('network').virtualNetwork.addRealmMapping(
      PREFIX,
      MAPPED_REALM_URL,
    );
    window.localStorage.setItem(
      SessionLocalStorageKey,
      JSON.stringify({
        [MAPPED_REALM_URL]: sessionToken({ realmServerURL: REALM_SERVER_URL }),
      }),
    );

    let realmServer = getService('realm-server');
    assert.deepEqual(
      realmServer.getRealmServersForRealms([PREFIX]),
      [REALM_SERVER_URL],
      'the prefix form resolves to the same token and the same server',
    );
  });

  test('a prefix whose token is filed under the prefix is still found', function (assert) {
    // The other direction: a realm resource created from the prefix files its
    // token under the prefix, so the unresolved spelling has to work too.
    getService('network').virtualNetwork.addRealmMapping(
      PREFIX,
      MAPPED_REALM_URL,
    );
    window.localStorage.setItem(
      SessionLocalStorageKey,
      JSON.stringify({
        [PREFIX]: sessionToken({ realmServerURL: REALM_SERVER_URL }),
      }),
    );

    let realmServer = getService('realm-server');
    assert.deepEqual(
      realmServer.getRealmServersForRealms([PREFIX]),
      [REALM_SERVER_URL],
      'both spellings are accepted as token keys',
    );
  });
});
