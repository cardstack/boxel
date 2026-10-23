import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';
import {
  RealmServerSessionLocalStorageKey,
  SessionLocalStorageKey,
} from '@cardstack/host/utils/local-storage-keys';

import {
  createJWT,
  testRealmSecretSeed,
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);
const SIGNED_IN_USER = '@testuser:localhost';
const PREVIOUS_USER = '@previous-account:localhost';
const PREVIOUS_ACCOUNT_REALM = `${new URL(testRealmURL).origin}/previous-account/personal/`;

function claimsOf(token: string) {
  return JSON.parse(atob(token.split('.')[1]));
}

// Sessions are stored per browser. A browser that signed in to one Matrix
// account and then to another still holds the first account's realm and
// realm-server sessions when the second boots.
module(
  'Integration | matrix-service | sessions left by another account',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: SIGNED_IN_USER,
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      window.localStorage.setItem(
        RealmServerSessionLocalStorageKey,
        createJWT(
          { user: PREVIOUS_USER, sessionRoom: 'previous-account-room' },
          '1d',
          testRealmSecretSeed,
        ),
      );
      window.localStorage.setItem(
        SessionLocalStorageKey,
        JSON.stringify({
          [PREVIOUS_ACCOUNT_REALM]: createJWT(
            {
              user: PREVIOUS_USER,
              realm: PREVIOUS_ACCOUNT_REALM,
              sessionRoom: 'previous-account-realm-room',
              permissions: ['read', 'write', 'realm-owner'],
              realmServerURL: testRealmServerURL,
            },
            '1d',
            testRealmSecretSeed,
          ),
        }),
      );
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('booting as a different user replaces the previous account’s sessions', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.strictEqual(
        claimsOf(realmServer.token!).user,
        SIGNED_IN_USER,
        'the realm-server session is minted for the signed-in user',
      );
      assert.strictEqual(
        claimsOf(
          window.localStorage.getItem(RealmServerSessionLocalStorageKey)!,
        ).user,
        SIGNED_IN_USER,
        'the stored realm-server session is the signed-in user’s',
      );

      let stored = JSON.parse(
        window.localStorage.getItem(SessionLocalStorageKey) ?? '{}',
      ) as Record<string, string>;
      assert.notOk(
        PREVIOUS_ACCOUNT_REALM in stored,
        'the previous account’s realm session is gone',
      );
      assert.deepEqual(
        [...new Set(Object.values(stored).map((t) => claimsOf(t).user))],
        Object.keys(stored).length ? [SIGNED_IN_USER] : [],
        'every stored realm session is the signed-in user’s',
      );
      assert.notOk(
        realmServer.userRealmIdentifiers.some((r) =>
          String(r).includes('previous-account'),
        ),
        'the realm list is not the previous account’s',
      );
    });
  },
);
